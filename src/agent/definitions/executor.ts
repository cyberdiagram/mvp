/**
 * Executor Subagent - Workflow orchestration.
 *
 * Takes high-level actions from the Reasoner and breaks them down into
 * concrete, executable tool steps. Uses Claude Haiku for fast, efficient
 * planning since this task is simpler than strategic reasoning.
 */

import Anthropic from '@anthropic-ai/sdk';
import { ExecutorPlan, ExecutorStep, ReasonerOutput } from './types.js';

/** Model used for execution planning - Haiku for speed and efficiency */
export const EXECUTOR_MODEL = 'claude-3-5-haiku-20241022';

/** Max tokens for Executor responses - plans are typically shorter */
export const EXECUTOR_MAX_TOKENS = 1000;

/**
 * System prompt that defines the Executor's role and behavior.
 *
 * Instructs the model to:
 * - Break down high-level plans into atomic tool calls
 * - Keep steps simple (one tool per step)
 * - Ensure proper sequencing (discovery before scan, etc.)
 * - Return structured JSON with steps array
 */
export const EXECUTOR_SYSTEM_PROMPT = `You are a workflow executor for penetration testing operations.

Your role is to:
1. Take high-level plans from the Reasoner
2. Break them down into executable tool calls
3. Sequence operations correctly
4. Report status and aggregate results

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

- Keep each step atomic (one tool call per step)
- Ensure proper sequencing (discovery before scan, scan before detection)
- Handle dependencies between steps
- Be concise and efficient`;

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
   * If the Reasoner already specified a tool and arguments, creates
   * a simple single-step plan. Otherwise, calls Claude Haiku to
   * break down the action into multiple steps.
   *
   * @param reasonerOutput - The Reasoner's decision with action/tool info
   * @returns ExecutorPlan with steps array ready for MCP Agent execution
   *
   * @example
   * // Single tool already specified
   * const plan = await executor.planExecution({
   *   thought: "...", action: "Scan ports",
   *   tool: "nmap_port_scan", arguments: { target: "192.168.1.1" }
   * });
   * // Returns: { steps: [{ tool: "nmap_port_scan", ... }], current_step: 0, status: "pending" }
   */
  async planExecution(reasonerOutput: ReasonerOutput): Promise<ExecutorPlan> {
    // If Reasoner already specified a tool, create a simple single-step plan
    if (reasonerOutput.tool && reasonerOutput.arguments) {
      return {
        steps: [
          {
            tool: reasonerOutput.tool,
            arguments: reasonerOutput.arguments as Record<string, unknown>,
            description: reasonerOutput.action,
          },
        ],
        current_step: 0,
        status: 'pending',
      };
    }

    // Otherwise, ask Executor to break down the action
    const response = await this.client.messages.create({
      model: EXECUTOR_MODEL,
      max_tokens: EXECUTOR_MAX_TOKENS,
      system: EXECUTOR_SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: `Break down this action into executable steps:\n\nThought: ${reasonerOutput.thought}\nAction: ${reasonerOutput.action}`,
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
