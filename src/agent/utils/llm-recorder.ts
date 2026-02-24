/**
 * LLM Call Recorder / Replayer — VCR-style cassette for Anthropic API calls.
 *
 * Intercepts every `client.messages.create()` call across all agents in the MVP
 * engine and records request+response pairs to a JSONL "cassette" file.  During
 * local testing the same cassette can be replayed sequentially, returning the
 * saved responses without ever hitting the real Anthropic API.
 *
 * Architecture:
 *   Record:  real agent → createAnthropicClient() → real API → save to cassette
 *   Replay:  real agent → createAnthropicClient() → next cassette entry (no API call)
 *
 * Per-task cassettes (recommended):
 *   Set LLM_CASSETTE_DIR to a directory; the worker will auto-name each cassette
 *   based on phase and task ID:
 *     recon-{task_id}.jsonl
 *     exec-{recon_task_id}.jsonl   (or exec-{task_id}.jsonl when no recon_task_id)
 *
 * Usage:
 *   # 1. Record — auto-named per task
 *   RECORD_LLM_CALLS=record LLM_CASSETTE_DIR=./logs/cassettes npm run worker:dev
 *
 *   # 2. Replay — reads the cassette the worker derives per task
 *   RECORD_LLM_CALLS=replay LLM_CASSETTE_DIR=./logs/cassettes npm run worker:dev
 *
 *   # Legacy fixed-path usage still works:
 *   RECORD_LLM_CALLS=record LLM_CASSETTE_PATH=./logs/cassettes/recon.jsonl npm run worker:dev
 *
 * Environment variables:
 *   RECORD_LLM_CALLS   — 'record' | 'replay' | 'off'  (default: 'off')
 *   LLM_CASSETTE_DIR   — Directory for auto-named per-task cassettes
 *   LLM_CASSETTE_PATH  — Fixed JSONL cassette path (fallback when DIR not set;
 *                        default: ./logs/cassettes/session.jsonl)
 */

import fs from 'fs';
import path from 'path';
import Anthropic from '@anthropic-ai/sdk';

// ── Types ────────────────────────────────────────────────────────────────────

/** Recorder operating mode. */
export type RecorderMode = 'off' | 'record' | 'replay';

/**
 * A single recorded LLM API call — the complete request parameters and the
 * verbatim response returned by the Anthropic API, serialised as one JSONL line.
 */
interface CassetteEntry {
  /** Sequential call index within this cassette (0-based). */
  seq: number;
  /** Model name from the request (for human readability). */
  model: string;
  /** Full request parameters as sent to the Anthropic API. */
  request: Record<string, unknown>;
  /**
   * Response fields needed to reconstruct an `Anthropic.Message`-shaped object
   * that agents can consume identically to a real API response.
   */
  response: {
    id: string;
    type: string;
    role: string;
    content: Anthropic.ContentBlock[];
    model: string;
    stop_reason: string | null;
    stop_sequence: string | null;
    usage: Anthropic.Usage;
  };
  /** ISO 8601 timestamp of the original API call. */
  recorded_at: string;
}

// Convenience alias for the messages.create parameter type.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type CreateParams = any;

// ── LLMRecorder class ─────────────────────────────────────────────────────────

/**
 * VCR-style cassette recorder for Anthropic `messages.create()` calls.
 *
 * - **record**: proxies every call to the real API and appends request+response
 *   as a JSONL line to the cassette file.
 * - **replay**: reads the cassette into memory at startup; each subsequent call
 *   returns the next saved entry in sequence — no network activity.
 * - **off**: passes through to the real API unchanged.
 *
 * Instantiate via `setupLLMRecorder()` which also populates the global singleton
 * read by `createAnthropicClient()`.
 */
export class LLMRecorder {
  /** Active mode for this recorder instance. */
  readonly mode: RecorderMode;

  /** Absolute path to the cassette JSONL file. */
  private readonly cassettePath: string;

  /** Cassette entries loaded for replay (empty during record/off). */
  private cassette: CassetteEntry[] = [];

  /** Pointer to the next cassette entry to serve during replay. */
  private replayIndex = 0;

  /** Sequence counter incremented after each recorded entry. */
  private recordSeq = 0;

  /**
   * @param mode         - Operating mode: 'record' | 'replay' | 'off'.
   * @param cassettePath - Absolute path to the JSONL cassette file.
   */
  constructor(mode: RecorderMode, cassettePath: string) {
    this.mode = mode;
    this.cassettePath = cassettePath;

    if (mode === 'record') {
      fs.mkdirSync(path.dirname(cassettePath), { recursive: true });
      // Truncate any existing cassette at this path so recordings are clean.
      fs.writeFileSync(cassettePath, '', 'utf-8');
      console.log(`[llm-recorder] RECORD mode  → ${cassettePath}`);
    } else if (mode === 'replay') {
      this.loadCassette();
      console.log(
        `[llm-recorder] REPLAY mode  → ${cassettePath} (${this.cassette.length} entries)`,
      );
    }
  }

  /**
   * Reads the cassette JSONL file into memory.
   * Throws if the file is missing (user must record first).
   */
  private loadCassette(): void {
    if (!fs.existsSync(this.cassettePath)) {
      throw new Error(
        `[llm-recorder] Cassette not found at "${this.cassettePath}". ` +
          'Run RECORD_LLM_CALLS=record first to capture a session.',
      );
    }

    const lines = fs
      .readFileSync(this.cassettePath, 'utf-8')
      .split('\n')
      .filter((l) => l.trim());

    this.cassette = lines.map((l) => JSON.parse(l) as CassetteEntry);
  }

  /**
   * Intercepts a single `messages.create()` call.
   *
   * - **record**: calls the real `realFn`, persists the pair, returns the response.
   * - **replay**: returns the next cassette entry without calling `realFn`.
   *
   * @param realFn - Bound reference to the original `messages.create` method.
   * @param params - Request parameters forwarded by the agent.
   * @returns Real or replayed `Anthropic.Message`-shaped object.
   */
  async intercept(
    realFn: (params: CreateParams) => Promise<Anthropic.Message>,
    params: CreateParams,
  ): Promise<Anthropic.Message> {
    if (this.mode === 'record') {
      const response = await realFn(params);
      this.appendEntry(params, response);
      return response;
    }

    // replay mode
    if (this.replayIndex >= this.cassette.length) {
      throw new Error(
        `[llm-recorder] Cassette exhausted after ${this.cassette.length} entries ` +
          '(replay index ' +
          this.replayIndex +
          '). Re-record with RECORD_LLM_CALLS=record.',
      );
    }

    const entry = this.cassette[this.replayIndex++];
    console.log(
      `[llm-recorder] replay ${entry.seq}/${this.cassette.length - 1}` +
        `  model=${entry.model}  stop=${entry.response.stop_reason}`,
    );
    return entry.response as unknown as Anthropic.Message;
  }

  /**
   * Serialises a request/response pair as a JSONL line and appends it to the
   * cassette file.  Called only in record mode.
   *
   * @param params   - Request parameters as sent to the Anthropic API.
   * @param response - Full response returned by the API.
   */
  private appendEntry(params: CreateParams, response: Anthropic.Message): void {
    const entry: CassetteEntry = {
      seq: this.recordSeq++,
      model: params.model as string,
      request: params as Record<string, unknown>,
      response: {
        id: response.id,
        type: response.type,
        role: response.role,
        content: response.content,
        model: response.model,
        stop_reason: response.stop_reason,
        stop_sequence: response.stop_sequence ?? null,
        usage: response.usage,
      },
      recorded_at: new Date().toISOString(),
    };

    fs.appendFileSync(this.cassettePath, JSON.stringify(entry) + '\n', 'utf-8');
    console.log(
      `[llm-recorder] recorded entry ${entry.seq}` +
        `  model=${entry.model}` +
        `  in=${response.usage.input_tokens} out=${response.usage.output_tokens} tokens`,
    );
  }

  /** Total entries recorded or replayed so far. */
  get count(): number {
    return this.mode === 'replay' ? this.replayIndex : this.recordSeq;
  }
}

// ── Global singleton ──────────────────────────────────────────────────────────

/** Module-level singleton populated by `setupLLMRecorder()`. */
let globalRecorder: LLMRecorder | null = null;

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Creates an Anthropic client whose `messages.create()` is transparently
 * intercepted by the active global recorder.
 *
 * All agents must call this instead of `new Anthropic({ apiKey })` so that
 * recording and replay work without any other per-agent changes.
 *
 * When no recorder is active (mode is 'off' or `setupLLMRecorder()` has not
 * been called), returns a plain Anthropic client — zero overhead.
 *
 * @param apiKey - Anthropic API key.  Ignored during replay but still required
 *                 so agents remain type-compatible with both modes.
 * @returns A (possibly wrapped) Anthropic client instance.
 */
export function createAnthropicClient(apiKey: string): Anthropic {
  const client = new Anthropic({ apiKey });

  if (!globalRecorder || globalRecorder.mode === 'off') {
    return client;
  }

  const boundCreate = client.messages.create.bind(client.messages) as (
    params: CreateParams,
  ) => Promise<Anthropic.Message>;

  // Replace messages.create on this specific client instance only.
  // Using `as any` here is intentional: the SDK's Messages class has a complex
  // overloaded signature (streaming vs non-streaming) that makes a direct
  // assignment impossible without a cast.  All agents in this project use
  // the non-streaming overload exclusively.
  //
  // NOTE: we reference `globalRecorder` directly (not via a captured snapshot)
  // so that `resetGlobalRecorder()` can hot-swap the cassette between tasks
  // without requiring agents to be re-initialised.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (client.messages as any).create = (params: CreateParams) =>
    globalRecorder!.intercept(boundCreate, params);

  return client;
}

/**
 * Reads `RECORD_LLM_CALLS` and `LLM_CASSETTE_PATH` from the environment,
 * constructs the global `LLMRecorder`, and returns it.
 *
 * Must be called **once**, **before** any agent is instantiated (i.e. before
 * `new PentestAgent(...)` in `worker.ts`), so that every subsequent
 * `createAnthropicClient()` call picks up the recorder.
 *
 * @returns The active `LLMRecorder`, or `null` when `RECORD_LLM_CALLS` is
 *          'off' or unset.
 */
export function setupLLMRecorder(): LLMRecorder | null {
  const mode = (process.env.RECORD_LLM_CALLS ?? 'off') as RecorderMode;
  if (mode === 'off') return null;

  const cassettePath = path.resolve(
    process.env.LLM_CASSETTE_PATH ?? './logs/cassettes/session.jsonl',
  );

  globalRecorder = new LLMRecorder(mode, cassettePath);
  return globalRecorder;
}

/**
 * Replaces the global recorder with a new instance pointing at `cassettePath`.
 * The mode is inherited from the existing recorder (record or replay).
 *
 * Safe to call between tasks — because `createAnthropicClient()` references
 * `globalRecorder` via a live closure (not a captured snapshot), all
 * previously-created clients immediately pick up the new cassette.
 *
 * No-ops when the recorder is off or when `cassettePath` is unchanged.
 *
 * @param cassettePath - Absolute path to the new cassette JSONL file.
 */
export function resetGlobalRecorder(cassettePath: string): void {
  if (!globalRecorder || globalRecorder.mode === 'off') return;
  const resolved = path.resolve(cassettePath);

  // In replay mode, skip the swap if the per-task cassette doesn't exist —
  // keep using the current recorder so the worker doesn't crash.
  if (globalRecorder.mode === 'replay' && !fs.existsSync(resolved)) {
    console.warn(
      `[llm-recorder] cassette not found for replay: ${resolved} — keeping current recorder`,
    );
    return;
  }

  globalRecorder = new LLMRecorder(globalRecorder.mode, resolved);
}

/**
 * Returns the active recorder mode, or `'off'` when no recorder is set.
 */
export function getGlobalRecorderMode(): RecorderMode {
  return globalRecorder?.mode ?? 'off';
}
