/**
 * Session Logger - Records agent execution steps for offline analysis.
 *
 * Writes newline-delimited JSON (.jsonl) logs for consumption by the
 * pentest-data-refinery project (Phase 6 evaluation pipeline).
 *
 * This is the critical bridge between the main pentest agent and the
 * offline evaluation/distillation system.
 *
 * @module agent/utils/session-logger
 */

/**
 * Single execution step in a pentest session
 * Simplified log entry for agent calls (different from core AgentLogEntry for ML training)
 */
export interface AgentLogEntry {
  /** ISO timestamp */
  timestamp: string;
  /** Agent that produced this step */
  agent: 'reasoner' | 'executor' | 'mcp' | 'data-cleaner' | 'profiler' | 'vuln-lookup' | 'rag';
  /** Input to the agent */
  input: unknown;
  /** Output from the agent */
  output: unknown;
  /** Metadata for evaluation */
  metadata: {
    /** Token usage for this step */
    tokens: {
      prompt: number;
      completion: number;
    };
    /** Model used */
    model: string;
    /** Latency in milliseconds */
    latency_ms: number;
    /** Additional context-specific data */
    [key: string]: unknown;
  };
}

/**
 * SessionLogger - Records agent steps to JSONL files.
 *
 * Usage:
 * ```typescript
 * const logger = new SessionLogger();
 *
 * // Log a step
 * logger.logStep({
 *   timestamp: new Date().toISOString(),
 *   agent: 'reasoner',
 *   input: { context: '...' },
 *   output: { thought: '...', action: '...' },
 *   metadata: {
 *     tokens: { prompt: 1200, completion: 300 },
 *     model: 'claude-sonnet-4',
 *     latency_ms: 2400
 *   }
 * });
 *
 * // At end of session
 * await logger.writeSession('./logs/session_123.jsonl');
 * ```
 */
export class SessionLogger {
  private steps: AgentLogEntry[] = [];
  private sessionId: string;

  constructor(sessionId?: string) {
    this.sessionId = sessionId || `session_${Date.now()}`;
  }

  /**
   * Log a single agent execution step
   *
   * @param step - The step to log
   */
  logStep(step: AgentLogEntry): void {
    this.steps.push(step);
  }

  /**
   * Write all logged steps to a JSONL file
   *
   * Format: One JSON object per line (newline-delimited)
   * This format is optimal for:
   * - Streaming processing
   * - Large file handling
   * - Line-by-line analysis
   *
   * @param filepath - Path to write the session log
   */
  async writeSession(filepath: string): Promise<void> {
    const fs = await import('fs/promises');
    const content = this.steps.map((step) => JSON.stringify(step)).join('\n');
    await fs.writeFile(filepath, content);
  }

  /**
   * Get the current session ID
   */
  getSessionId(): string {
    return this.sessionId;
  }

  /**
   * Get the number of logged steps
   */
  getStepCount(): number {
    return this.steps.length;
  }

  /**
   * Get all logged steps (for in-memory analysis)
   */
  getSteps(): AgentLogEntry[] {
    return [...this.steps];
  }

  /**
   * Reset the logger (clear all steps)
   */
  reset(): void {
    this.steps = [];
  }
}
