/**
 * Token Monitor - Tracks token consumption and costs across agents.
 *
 * Monitors usage for budget management and optimization.
 * Tracks per-agent statistics to identify expensive operations.
 *
 * @module agent/utils/token-monitor
 */

/**
 * Token usage statistics for a single API call
 */
export interface TokenUsage {
  agent: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  timestamp: string;
}

/**
 * Aggregated statistics for a session
 */
export interface TokenStats {
  totalPromptTokens: number;
  totalCompletionTokens: number;
  totalTokens: number;
  costEstimateUSD: number;
  byAgent: Record<
    string,
    {
      promptTokens: number;
      completionTokens: number;
      totalTokens: number;
      callCount: number;
    }
  >;
  byModel: Record<
    string,
    {
      promptTokens: number;
      completionTokens: number;
      totalTokens: number;
      callCount: number;
    }
  >;
}

/**
 * Pricing per model (as of 2026-02-07)
 * Source: https://www.anthropic.com/pricing
 */
const MODEL_PRICING: Record<
  string,
  { promptPerMToken: number; completionPerMToken: number }
> = {
  'claude-sonnet-4-20250514': {
    promptPerMToken: 3.0,
    completionPerMToken: 15.0,
  },
  'claude-haiku-4-5-20251001': {
    promptPerMToken: 0.8,
    completionPerMToken: 4.0,
  },
  'claude-3-5-haiku-20241022': {
    promptPerMToken: 0.8,
    completionPerMToken: 4.0,
  },
};

/**
 * TokenMonitor - Tracks and aggregates token usage across agents.
 *
 * Usage:
 * ```typescript
 * const monitor = new TokenMonitor();
 * monitor.trackUsage('reasoner', 'claude-sonnet-4', 1200, 300);
 * const stats = monitor.getSessionStats();
 * monitor.exportReport('./logs/token_report.json');
 * ```
 */
export class TokenMonitor {
  private usageLog: TokenUsage[] = [];

  /**
   * Record token usage for an API call
   *
   * @param agent - Agent name (e.g., 'reasoner', 'executor')
   * @param model - Model ID (e.g., 'claude-sonnet-4-20250514')
   * @param promptTokens - Number of tokens in prompt
   * @param completionTokens - Number of tokens in completion
   */
  trackUsage(
    agent: string,
    model: string,
    promptTokens: number,
    completionTokens: number
  ): void {
    this.usageLog.push({
      agent,
      model,
      promptTokens,
      completionTokens,
      totalTokens: promptTokens + completionTokens,
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Get aggregated statistics for the current session
   *
   * @returns Session-level token statistics with cost estimates
   */
  getSessionStats(): TokenStats {
    const stats: TokenStats = {
      totalPromptTokens: 0,
      totalCompletionTokens: 0,
      totalTokens: 0,
      costEstimateUSD: 0,
      byAgent: {},
      byModel: {},
    };

    for (const usage of this.usageLog) {
      // Aggregate totals
      stats.totalPromptTokens += usage.promptTokens;
      stats.totalCompletionTokens += usage.completionTokens;
      stats.totalTokens += usage.totalTokens;

      // Calculate cost
      const pricing = MODEL_PRICING[usage.model];
      if (pricing) {
        const promptCost = (usage.promptTokens / 1_000_000) * pricing.promptPerMToken;
        const completionCost =
          (usage.completionTokens / 1_000_000) * pricing.completionPerMToken;
        stats.costEstimateUSD += promptCost + completionCost;
      }

      // Aggregate by agent
      if (!stats.byAgent[usage.agent]) {
        stats.byAgent[usage.agent] = {
          promptTokens: 0,
          completionTokens: 0,
          totalTokens: 0,
          callCount: 0,
        };
      }
      stats.byAgent[usage.agent].promptTokens += usage.promptTokens;
      stats.byAgent[usage.agent].completionTokens += usage.completionTokens;
      stats.byAgent[usage.agent].totalTokens += usage.totalTokens;
      stats.byAgent[usage.agent].callCount += 1;

      // Aggregate by model
      if (!stats.byModel[usage.model]) {
        stats.byModel[usage.model] = {
          promptTokens: 0,
          completionTokens: 0,
          totalTokens: 0,
          callCount: 0,
        };
      }
      stats.byModel[usage.model].promptTokens += usage.promptTokens;
      stats.byModel[usage.model].completionTokens += usage.completionTokens;
      stats.byModel[usage.model].totalTokens += usage.totalTokens;
      stats.byModel[usage.model].callCount += 1;
    }

    return stats;
  }

  /**
   * Export detailed usage report to JSON file
   *
   * @param filepath - Path to write report (e.g., './logs/token_report.json')
   */
  async exportReport(filepath: string): Promise<void> {
    const fs = await import('fs/promises');
    const stats = this.getSessionStats();

    const report = {
      generatedAt: new Date().toISOString(),
      summary: stats,
      detailedLog: this.usageLog,
    };

    await fs.writeFile(filepath, JSON.stringify(report, null, 2));
  }

  /**
   * Reset the monitor (clear all usage data)
   */
  reset(): void {
    this.usageLog = [];
  }
}
