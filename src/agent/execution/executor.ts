/**
 * Executor Subagent - Workflow orchestration.
 *
 * Takes high-level actions from the Reasoner and breaks them down into
 * concrete, executable tool steps. Uses Claude Haiku for fast, efficient
 * planning since this task is simpler than strategic reasoning.
 */

import Anthropic from '@anthropic-ai/sdk';
import { ExecutorPlan, ExecutorStep, ReasonerOutput } from '../core/types.js';

/** Model used for execution planning - Haiku for speed and efficiency */
export const EXECUTOR_MODEL = 'claude-haiku-4-5-20251001';

/** Max tokens for Executor responses - plans are typically shorter */
export const EXECUTOR_MAX_TOKENS = 1000;

/**
 * System prompt that defines the Executor's role and behavior.
 *
 * Instructs the model to:
 * - Break down high-level strategic actions into atomic tool calls
 * - Keep steps simple (one tool per step)
 * - Ensure proper sequencing (discovery before scan, etc.)
 * - Return structured JSON with steps array
 */
export const EXECUTOR_SYSTEM_PROMPT = `You are a tactical workflow executor for penetration testing operations.

Your role is to:
1. Take HIGH-LEVEL strategic actions from the Reasoner
2. Break them down into SPECIFIC, executable tool calls
3. Sequence operations correctly with proper dependencies
4. Choose appropriate tools and parameters

# Available Tools

- **nmap_host_discovery**: Discover live hosts on a network
  Arguments: { "target": "IP or CIDR" }

- **nmap_port_scan**: Scan ports on target(s)
  Arguments: { "target": "IP", "ports": "1-1000" or "top-1000", "scanType": "tcp" or "udp" }

- **nmap_service_detection**: Detect services and versions
  Arguments: { "target": "IP", "ports": "22,80,443" }

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
        return {
          steps: parsed.steps || [],
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
