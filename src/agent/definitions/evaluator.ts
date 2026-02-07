/**
 * Evaluator Agent - Post-execution analysis and outcome labeling.
 *
 * The "Referee" agent that provides ground truth labels for ML training.
 * Compares predicted outcomes against actual tool execution results to
 * generate training data for continuous improvement.
 *
 * Uses Claude Haiku for fast, cost-effective evaluation with prompt caching.
 */

import Anthropic from '@anthropic-ai/sdk';
import { PredictionMetrics, EvaluationResult } from '../core/types.js';

/** Model used for evaluation - Haiku for speed and cost efficiency */
export const EVALUATOR_MODEL = 'claude-3-5-haiku-20241022';

/** Max tokens for Evaluator responses */
export const EVALUATOR_MAX_TOKENS = 1000;

/**
 * System prompt for the EvaluatorAgent.
 *
 * Instructs the model to:
 * - Act as an impartial evaluator
 * - Compare predictions to actual outcomes
 * - Assign ground truth labels (TP/FP/FN/TN)
 * - Provide reasoning for labels
 */
export const EVALUATOR_SYSTEM_PROMPT = `You are an impartial penetration testing result evaluator.

Your task is to compare the PREDICTED outcome against the ACTUAL tool output and assign a ground truth label.

**Labels:**
- **true_positive**: Attack was predicted to succeed AND actually succeeded
- **false_positive**: Attack was predicted to succeed BUT actually failed
- **false_negative**: Attack was predicted to fail BUT actually succeeded (rare)
- **true_negative**: Attack was predicted to fail AND actually failed

**Evaluation Process:**

1. Review the success criteria:
   - match_type: How to detect success (regex, status_code, contains)
   - match_pattern: Pattern indicating success
   - negative_pattern: Pattern indicating failure

2. Analyze the actual output:
   - Search for match_pattern in output
   - Check for negative_pattern (failures)
   - Consider context (errors, timeouts, partial success)

3. Compare with prediction:
   - Was expected_success = true?
   - What was the confidence_score?
   - Does actual outcome match prediction?

4. Assign label and provide reasoning

**Output JSON:**
{
  "label": "true_positive|false_positive|false_negative|true_negative",
  "reasoning": "The output contains 'root:x:0:0' matching the success pattern...",
  "confidence": 0.95
}

Be objective. A partial success is still a success. A timeout or error is a failure.`;

/**
 * EvaluatorAgent performs post-execution analysis to label attack outcomes.
 *
 * Role: "The Referee" - Provides ground truth labels for ML training
 *
 * Responsibilities:
 * - Compare predicted success criteria against actual tool output
 * - Label outcomes: true_positive, false_positive, false_negative, true_negative
 * - Generate reasoning for the label
 * - Calculate calibration metrics for Reasoner confidence scores
 *
 * Uses Claude Haiku for cost-effective evaluation with prompt caching.
 */
export class EvaluatorAgent {
  /** Anthropic API client */
  private client: Anthropic;

  /**
   * Creates a new EvaluatorAgent.
   *
   * @param apiKey - Anthropic API key for Claude API calls
   */
  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey });
  }

  /**
   * Evaluate an attack vector execution result.
   *
   * Compares the Reasoner's prediction metrics against the actual tool
   * output to determine if the prediction was accurate. Returns a labeled
   * evaluation result for training data generation.
   *
   * @param vectorId - ID of the attack vector being evaluated
   * @param prediction - The Reasoner's prediction metrics
   * @param actualOutput - Raw output from tool execution
   * @returns Evaluation with label (TP/FP/FN/TN) and reasoning
   *
   * @example
   * const evaluation = await evaluator.evaluate(
   *   "vec_01",
   *   predictionMetrics,
   *   toolOutput
   * );
   * // Returns: { label: "true_positive", reasoning: "...", confidence: 0.92 }
   */
  async evaluate(
    vectorId: string,
    prediction: PredictionMetrics,
    actualOutput: string
  ): Promise<EvaluationResult> {
    const userMessage = `**Prediction:**
${JSON.stringify(prediction, null, 2)}

**Actual Tool Output:**
\`\`\`
${actualOutput.substring(0, 5000)}
\`\`\`

Evaluate this result.`;

    try {
      // Use cache_control to cache static system prompt (~90% token savings)
      const response = await this.client.messages.create({
        model: EVALUATOR_MODEL,
        max_tokens: EVALUATOR_MAX_TOKENS,
        system: [
          {
            type: 'text',
            text: EVALUATOR_SYSTEM_PROMPT,
            cache_control: { type: 'ephemeral' },
          },
        ],
        messages: [{ role: 'user', content: userMessage }],
      });

      const content = response.content[0];
      if (content.type === 'text') {
        const result = JSON.parse(this.extractJSON(content.text));

        return {
          vector_id: vectorId,
          prediction,
          actual_output: actualOutput,
          label: result.label,
          reasoning: result.reasoning,
          confidence: result.confidence,
          timestamp: new Date().toISOString(),
        };
      }

      throw new Error('No text content in response');
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);

      // Fallback: simple regex-based evaluation
      return this.fallbackEvaluation(vectorId, prediction, actualOutput, message);
    }
  }

  /**
   * Fallback evaluation using simple pattern matching.
   *
   * Used when LLM evaluation fails or is unavailable. Performs basic
   * regex matching against success/failure patterns to determine outcome.
   * Less reliable than LLM evaluation but provides a safety net.
   *
   * @param vectorId - Attack vector ID
   * @param prediction - Prediction metrics with success criteria
   * @param actualOutput - Actual tool output
   * @param error - Error message from LLM attempt
   * @returns Evaluation result with lower confidence score
   */
  private fallbackEvaluation(
    vectorId: string,
    prediction: PredictionMetrics,
    actualOutput: string,
    error: string
  ): EvaluationResult {
    const { success_criteria, hypothesis } = prediction;

    let actualSuccess = false;

    // Check for success pattern
    if (success_criteria.match_type === 'regex_match') {
      const successRegex = new RegExp(success_criteria.match_pattern, 'i');
      actualSuccess = successRegex.test(actualOutput);

      // Check for negative pattern (failure indicators)
      if (success_criteria.negative_pattern) {
        const failureRegex = new RegExp(success_criteria.negative_pattern, 'i');
        if (failureRegex.test(actualOutput)) {
          actualSuccess = false;
        }
      }
    } else if (success_criteria.match_type === 'contains') {
      actualSuccess = actualOutput.includes(success_criteria.match_pattern);
    }

    // Determine label
    let label: EvaluationResult['label'];
    if (hypothesis.expected_success && actualSuccess) {
      label = 'true_positive';
    } else if (hypothesis.expected_success && !actualSuccess) {
      label = 'false_positive';
    } else if (!hypothesis.expected_success && actualSuccess) {
      label = 'false_negative';
    } else {
      label = 'true_negative';
    }

    return {
      vector_id: vectorId,
      prediction,
      actual_output: actualOutput,
      label,
      reasoning: `Fallback evaluation (LLM failed: ${error}). Pattern match result: ${actualSuccess}`,
      confidence: 0.6, // Lower confidence for fallback
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Extract JSON from LLM response text.
   *
   * Looks for JSON object in response. If not found, assumes entire text is JSON.
   *
   * @param text - Raw text response from Claude
   * @returns Extracted JSON string
   */
  private extractJSON(text: string): string {
    const match = text.match(/\{[\s\S]*\}/);
    return match ? match[0] : text;
  }
}
