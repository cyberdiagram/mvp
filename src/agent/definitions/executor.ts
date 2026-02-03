// Executor Subagent - Workflow orchestration (haiku)

import Anthropic from '@anthropic-ai/sdk';
import { ExecutorPlan, ExecutorStep, ReasonerOutput } from './types.js';

export const EXECUTOR_MODEL = 'claude-3-5-haiku-20241022';
export const EXECUTOR_MAX_TOKENS = 1000;

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

export class ExecutorAgent {
  private client: Anthropic;

  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey });
  }

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

  getNextStep(plan: ExecutorPlan): ExecutorStep | null {
    if (plan.current_step >= plan.steps.length) {
      return null;
    }
    return plan.steps[plan.current_step];
  }

  advancePlan(plan: ExecutorPlan): ExecutorPlan {
    return {
      ...plan,
      current_step: plan.current_step + 1,
      status: plan.current_step + 1 >= plan.steps.length ? 'completed' : 'in_progress',
    };
  }
}
