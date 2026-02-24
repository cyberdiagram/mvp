/**
 * Executor Subagent - Workflow orchestration.
 *
 * Takes high-level actions from the Reasoner and breaks them down into
 * concrete, executable tool steps. Uses Claude Haiku for fast, efficient
 * planning since this task is simpler than strategic reasoning.
 */

import Anthropic from '@anthropic-ai/sdk';
import { ExecutorPlan, ExecutorStep, ReasonerOutput } from '../core/types.js';
import { createAnthropicClient } from '../utils/llm-recorder.js';

/** Model used for execution planning - Haiku for speed and efficiency */
export const EXECUTOR_MODEL = 'claude-haiku-4-5-20251001';

/** Max tokens for Executor responses - plans are typically shorter */
export const EXECUTOR_MAX_TOKENS = 1000;

/** Default tool descriptions — treated as a template; instances may enrich them. */
const DEFAULT_TOOL_DESCRIPTIONS: Record<string, string> = {
  execute_shell_cmd: '**execute_shell_cmd**: Execute an arbitrary shell command in the Kali container\n  Arguments: { "command": "shell command string" }',
  write_file: '**write_file**: Write content to a file in /app/scripts/\n  Arguments: { "filename": "name", "content": "file content" }',
  execute_script: '**execute_script**: Execute a Python script from /app/scripts/\n  Arguments: { "filename": "script.py", "args": "optional args" }',
  manage_packages: '**manage_packages**: Check or install system packages\n  Arguments: { "action": "check|install", "package_name": "package" }',
  searchsploit_search: '**searchsploit_search**: Search ExploitDB for vulnerabilities\n  Arguments: { "query": "search term", "exact": false }',
  searchsploit_examine: '**searchsploit_examine**: Read exploit source code by EDB-ID\n  Arguments: { "edb_id": "51193" }',
  rag_recall: '**rag_recall**: Recall security playbooks and anti-patterns\n  Arguments: { "query": "search query" }',
  rag_query_playbooks: '**rag_query_playbooks**: Search security handbook for attack strategies\n  Arguments: { "query": "search query", "n_results": 5 }',
};

/**
 * Builds the tool listing section for the system prompt from dynamic tool names.
 */
function buildToolListing(allowedTools: Set<string>, toolDescs: Record<string, string>): string {
  const lines: string[] = [];
  for (const tool of allowedTools) {
    const desc = toolDescs[tool];
    if (desc) {
      lines.push(`- ${desc}`);
    } else {
      lines.push(`- **${tool}**: (no description available)`);
    }
  }
  return lines.join('\n');
}

/**
 * Builds the executor system prompt with a dynamic tool listing.
 */
function buildExecutorSystemPrompt(allowedTools: Set<string>, toolDescs: Record<string, string>): string {
  return `You are a tactical workflow executor for penetration testing operations.

Your role is to:
1. Take HIGH-LEVEL strategic actions from the Reasoner
2. Break them down into SPECIFIC, executable tool calls
3. Sequence operations correctly with proper dependencies
4. Choose appropriate tools and parameters

# Available Tools (EXHAUSTIVE LIST — you MUST only use tools from this list)

${buildToolListing(allowedTools, toolDescs)}

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
      "tool": "execute_shell_cmd",
      "arguments": { "command": "nmap -sV -sC -T4 --top-ports 1000 10.0.0.1" },
      "description": "Scan top 1000 TCP ports with service detection"
    }
  ],
  "current_step": 0,
  "status": "pending"
}`;
}

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

  /** Dynamically populated set of allowed tool names */
  private allowedTools: Set<string>;

  /** Per-instance tool descriptions (copy of defaults, enriched by appendToToolDescription) */
  private toolDescriptions: Record<string, string>;

  /** Cached system prompt — rebuilt whenever tool descriptions change */
  private systemPrompt: string;

  /**
   * Creates a new ExecutorAgent.
   *
   * @param apiKey - Anthropic API key for Claude API calls
   * @param toolNames - Dynamic list of allowed tool names (from Kali MCP discovery + RAG tools)
   */
  constructor(apiKey: string, toolNames?: string[]) {
    this.client = createAnthropicClient(apiKey);
    this.allowedTools = new Set(
      toolNames || ['execute_shell_cmd', 'searchsploit_search', 'rag_recall', 'rag_query_playbooks']
    );
    this.toolDescriptions = { ...DEFAULT_TOOL_DESCRIPTIONS };
    this.systemPrompt = buildExecutorSystemPrompt(this.allowedTools, this.toolDescriptions);
    console.log(`[Executor] Initialized with ${this.allowedTools.size} allowed tools`);
  }

  /**
   * Appends skill-derived constraint text to a specific tool's description.
   *
   * This embeds rules (e.g. "NEVER use nmap -p-") directly inside the tool
   * listing the Executor reads, so the constraints appear exactly where the
   * model looks when choosing command arguments — without introducing
   * misleading tool names from old skill documentation.
   *
   * Rebuilds the system prompt after updating the description.
   *
   * @param toolName   - The MCP tool name to enrich (e.g. "execute_shell_cmd")
   * @param constraint - Constraint text extracted from a skill file
   */
  appendToToolDescription(toolName: string, constraint: string): void {
    if (!this.toolDescriptions[toolName]) {
      console.log(`[Executor] ⚠ appendToToolDescription: unknown tool "${toolName}" — skipped`);
      return;
    }
    this.toolDescriptions[toolName] += `\n  ${constraint}`;
    // Rebuild system prompt so the cache_control block reflects the new description
    this.systemPrompt = buildExecutorSystemPrompt(this.allowedTools, this.toolDescriptions);
    console.log(`[Executor] ✓ Appended skill constraints to ${toolName} description`);
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
        if (this.allowedTools.has(step.tool)) {
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

    // System prompt already embeds any skill constraints inside tool descriptions
    // (appended via appendToToolDescription). No second block needed.
    const response = await this.client.messages.create({
      model: EXECUTOR_MODEL,
      max_tokens: EXECUTOR_MAX_TOKENS,
      system: [{ type: 'text', text: this.systemPrompt, cache_control: { type: 'ephemeral' } }],
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
          if (this.allowedTools.has(step.tool)) {
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
