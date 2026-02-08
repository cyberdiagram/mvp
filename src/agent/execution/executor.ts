/**
 * Executor Subagent - Workflow orchestration.
 *
 * Takes high-level actions from the Reasoner and breaks them down into
 * concrete, executable tool steps. Uses Claude Haiku for fast, efficient
 * planning since this task is simpler than strategic reasoning.
 */

import Anthropic from '@anthropic-ai/sdk';
import { ExecutorPlan, ExecutorStep, ReasonerOutput } from '../core/types.js';
import * as fs from 'fs';
import * as path from 'path';

/** Model used for execution planning - Haiku for speed and efficiency */
export const EXECUTOR_MODEL = 'claude-haiku-4-5-20251001';

/** Max tokens for Executor responses - plans are typically shorter */
export const EXECUTOR_MAX_TOKENS = 1000;

/**
 * Path to the canonical tool whitelist JSON.
 * Synced from pentest-mcp-server/tools_whitelist.json.
 *
 * Uses multiple candidate paths so it works from both src/ (ts-node)
 * and dist/ (compiled) without needing a copy step in the build.
 */
const WHITELIST_CANDIDATES = [
  path.resolve(__dirname, '../../config/allowed_tools.json'),         // from dist/agent/execution/
  path.resolve(__dirname, '../../../src/config/allowed_tools.json'),   // from dist/agent/execution/ → src/
  path.join(process.cwd(), 'src/config/allowed_tools.json'),          // from project root
];
const WHITELIST_PATH = WHITELIST_CANDIDATES.find((p) => fs.existsSync(p)) || WHITELIST_CANDIDATES[0];

/**
 * Loads the allowed tools list from the JSON configuration file.
 * Falls back to a hardcoded default if the file is missing or malformed.
 */
function loadAllowedTools(): Set<string> {
  try {
    const data = fs.readFileSync(WHITELIST_PATH, 'utf-8');
    const config = JSON.parse(data);
    if (Array.isArray(config.tools) && config.tools.length > 0) {
      console.log(`[Executor] Loaded ${config.tools.length} tools from whitelist (v${config.version || '?'})`);
      return new Set(config.tools);
    }
    throw new Error('tools array is empty or missing');
  } catch (error) {
    console.error(`[Executor] Failed to load tool whitelist from ${WHITELIST_PATH}. Using hardcoded defaults.`);
    return new Set([
      'nmap_host_discovery',
      'nmap_port_scan',
      'nmap_service_detection',
      'nmap_os_detection',
      'searchsploit_search',
      'searchsploit_examine',
      'rag_recall',
      'rag_query_playbooks',
    ]);
  }
}

/**
 * Canonical list of tools the Executor is allowed to use.
 * Loaded from src/config/allowed_tools.json at startup.
 * Any tool not in this set will be filtered out after LLM planning.
 */
export const ALLOWED_TOOLS = loadAllowedTools();

/** Tool descriptions for the system prompt, keyed by tool name */
const TOOL_DESCRIPTIONS: Record<string, string> = {
  nmap_host_discovery: '**nmap_host_discovery**: Discover live hosts on a network\n  Arguments: { "target": "IP or CIDR" }',
  nmap_port_scan: '**nmap_port_scan**: Scan ports on target(s)\n  Arguments: { "target": "IP", "ports": "1-1000" or "top-1000", "scanType": "tcp" or "udp" }',
  nmap_service_detection: '**nmap_service_detection**: Detect services and versions\n  Arguments: { "target": "IP", "ports": "22,80,443" }',
  nmap_os_detection: '**nmap_os_detection**: Detect operating system\n  Arguments: { "target": "IP" }',
  searchsploit_search: '**searchsploit_search**: Search ExploitDB for vulnerabilities\n  Arguments: { "query": "search term" }',
  searchsploit_examine: '**searchsploit_examine**: Examine a specific exploit\n  Arguments: { "id": "exploit-id" }',
  rag_recall: '**rag_recall**: Recall security playbooks and anti-patterns\n  Arguments: { "query": "search query" }',
  rag_query_playbooks: '**rag_query_playbooks**: Search security handbook for attack strategies\n  Arguments: { "query": "search query", "n_results": 5 }',
};

/**
 * Builds the tool listing section for the system prompt from ALLOWED_TOOLS.
 * Only tools present in both ALLOWED_TOOLS and TOOL_DESCRIPTIONS are listed.
 */
function buildToolListing(): string {
  const lines: string[] = [];
  for (const tool of ALLOWED_TOOLS) {
    const desc = TOOL_DESCRIPTIONS[tool];
    if (desc) {
      lines.push(`- ${desc}`);
    } else {
      lines.push(`- **${tool}**: (no description available)`);
    }
  }
  return lines.join('\n');
}

export const EXECUTOR_SYSTEM_PROMPT = `You are a tactical workflow executor for penetration testing operations.

Your role is to:
1. Take HIGH-LEVEL strategic actions from the Reasoner
2. Break them down into SPECIFIC, executable tool calls
3. Sequence operations correctly with proper dependencies
4. Choose appropriate tools and parameters

# Available Tools (EXHAUSTIVE LIST — you MUST only use tools from this list)

${buildToolListing()}

# STRICT CONSTRAINT
You MUST ONLY use tools from the list above. Do NOT invent, guess, or hallucinate tool names.
If the requested action cannot be accomplished with the available tools, return an empty steps array.

# Response Format

Respond with a JSON object:
{
  "steps": [
    {
      "tool": "tool_name",
      "arguments": { "param": "value" },
      "description": "What this step does"
    }
  ],
  "current_step": 0,
  "status": "pending"
}

# Guidelines

- Break down strategic actions into 1-5 concrete tool calls
- Keep each step atomic (one tool call per step)
- Ensure proper sequencing (discovery before scan, scan before detection)
- Handle dependencies between steps
- Choose appropriate parameters based on the context
- Be concise and efficient

# Example

**Input**: "Perform comprehensive port scanning to identify all open services"
**Output**:
{
  "steps": [
    {
      "tool": "nmap_port_scan",
      "arguments": { "target": "10.0.0.1", "ports": "top-1000", "scanType": "tcp" },
      "description": "Scan top 1000 TCP ports"
    },
    {
      "tool": "nmap_service_detection",
      "arguments": { "target": "10.0.0.1", "ports": "discovered_ports" },
      "description": "Detect service versions on open ports"
    }
  ],
  "current_step": 0,
  "status": "pending"
}`;

/**
 * ExecutorAgent - Converts high-level actions into executable steps.
 *
 * Works as a "translator" between the Reasoner's strategic decisions
 * and the MCP Agent's tool execution. Creates ordered plans with
 * atomic steps that can be executed one by one.
 *
 * Uses Claude Haiku for fast, cost-effective planning.
 */
export class ExecutorAgent {
  /** Anthropic API client */
  private client: Anthropic;

  /**
   * Creates a new ExecutorAgent.
   *
   * @param apiKey - Anthropic API key for Claude API calls
   */
  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey });
  }

  /**
   * Creates an execution plan from the Reasoner's output.
   *
   * Takes the Reasoner's high-level strategic action and calls Claude Haiku
   * to break it down into specific, executable tool steps with concrete parameters.
   *
   * @param reasonerOutput - The Reasoner's decision with high-level action
   * @param contextInfo - Optional context (target IP, discovered data) to help with parameter selection
   * @returns ExecutorPlan with steps array ready for MCP Agent execution
   *
   * @example
   * const plan = await executor.planExecution({
   *   thought: "Need to identify services",
   *   action: "Enumerate web service versions to identify potential vulnerabilities"
   * }, { target: "192.168.1.1", openPorts: [80, 443] });
   * // Returns: { steps: [{ tool: "nmap_service_detection", arguments: {...}, ... }], ... }
   */
  async planExecution(
    reasonerOutput: ReasonerOutput,
    contextInfo?: { target?: string; openPorts?: number[] },
  ): Promise<ExecutorPlan> {
    // If the Reasoner already provided a structured tactical plan, use it directly.
    // This avoids a redundant LLM call and prevents the Executor from hallucinating
    // non-existent tools that override the Reasoner's valid tool selections.
    if (reasonerOutput.tactical_plan && reasonerOutput.tactical_plan.attack_vectors.length > 0) {
      console.log('[Executor] Using tactical plan from Reasoner — bypassing LLM planning.');

      const rawSteps: ExecutorStep[] = reasonerOutput.tactical_plan.attack_vectors
        .sort((a, b) => a.priority - b.priority)
        .map((vector) => ({
          tool: vector.action.tool_name,
          arguments: vector.action.parameters,
          description:
            vector.prediction_metrics.hypothesis.rationale_tags.join(', ') ||
            `Execute vector ${vector.vector_id}`,
        }));

      // Validate tactical plan steps against allowed tools whitelist
      const validSteps = rawSteps.filter((step) => {
        if (ALLOWED_TOOLS.has(step.tool)) {
          return true;
        }
        console.log(
          `[Executor] ⚠ Rejected unknown tool "${step.tool}" from Tactical Plan — not in allowed list`
        );
        return false;
      });

      if (validSteps.length < rawSteps.length) {
        console.log(
          `[Executor] Filtered ${rawSteps.length - validSteps.length}/${rawSteps.length} invalid tactical plan step(s)`,
        );
      }

      return {
        steps: validSteps,
        current_step: 0,
        status: 'pending',
      };
    }

    // Fallback: no tactical plan available, use LLM to generate execution steps
    // Build context string to help Executor choose appropriate parameters
    let contextStr = '';
    if (contextInfo) {
      if (contextInfo.target) {
        contextStr += `\nTarget: ${contextInfo.target}`;
      }
      if (contextInfo.openPorts && contextInfo.openPorts.length > 0) {
        contextStr += `\nKnown open ports: ${contextInfo.openPorts.join(', ')}`;
      }
    }

    // Use cache_control to cache static system prompt for token optimization
    const response = await this.client.messages.create({
      model: EXECUTOR_MODEL,
      max_tokens: EXECUTOR_MAX_TOKENS,
      system: [
        {
          type: 'text',
          text: EXECUTOR_SYSTEM_PROMPT,
          cache_control: { type: 'ephemeral' },
        },
      ],
      messages: [
        {
          role: 'user',
          content: `Break down this HIGH-LEVEL action into executable tool steps:\n\nStrategic Context: ${reasonerOutput.thought}\nAction to Execute: ${reasonerOutput.action}${contextStr}`,
        },
      ],
    });

    const text = response.content[0];
    if (text.type !== 'text') {
      throw new Error('Expected text response from Executor');
    }

    return this.parsePlan(text.text);
  }

  /**
   * Parses the LLM response text into an ExecutorPlan.
   *
   * Extracts JSON from the response and converts it to a typed plan.
   * Returns an empty plan if parsing fails.
   *
   * @param text - Raw text response from Claude
   * @returns Parsed ExecutorPlan or empty plan on failure
   */
  private parsePlan(text: string): ExecutorPlan {
    const jsonMatch = text.match(/\{[\s\S]*\}/);

    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[0]);
        const rawSteps: ExecutorStep[] = parsed.steps || [];

        // Validate each step against the allowed tool whitelist.
        // Reject any hallucinated tool names the LLM may have invented.
        const validSteps = rawSteps.filter((step) => {
          if (ALLOWED_TOOLS.has(step.tool)) {
            return true;
          }
          console.log(`[Executor] ⚠ Rejected unknown tool "${step.tool}" — not in allowed list`);
          return false;
        });

        if (validSteps.length < rawSteps.length) {
          console.log(
            `[Executor] Filtered ${rawSteps.length - validSteps.length}/${rawSteps.length} invalid step(s)`,
          );
        }

        return {
          steps: validSteps,
          current_step: parsed.current_step || 0,
          status: parsed.status || 'pending',
        };
      } catch {
        // Fallback
      }
    }

    // Return empty plan if parsing fails
    return {
      steps: [],
      current_step: 0,
      status: 'pending',
    };
  }

  /**
   * Gets the next step to execute from a plan.
   *
   * Returns the step at current_step index, or null if all steps are done.
   *
   * @param plan - The execution plan
   * @returns The next ExecutorStep to execute, or null if complete
   */
  getNextStep(plan: ExecutorPlan): ExecutorStep | null {
    if (plan.current_step >= plan.steps.length) {
      return null;
    }
    return plan.steps[plan.current_step];
  }

  /**
   * Advances the plan to the next step.
   *
   * Increments current_step and updates status to 'completed' if all steps done.
   * Returns a new plan object (immutable update).
   *
   * @param plan - The current execution plan
   * @returns New plan with incremented current_step
   */
  advancePlan(plan: ExecutorPlan): ExecutorPlan {
    return {
      ...plan,
      current_step: plan.current_step + 1,
      status: plan.current_step + 1 >= plan.steps.length ? 'completed' : 'in_progress',
    };
  }
}
