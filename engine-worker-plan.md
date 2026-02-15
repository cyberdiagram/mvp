# Plan: Engine Worker — Connect MVP PentestAgent to Cyber-Bridge via Redis

## Context

The cyber-bridge middleware accepts tasks from the web UI and pushes them onto a Redis queue (`cyberbridge:tasks`). Currently, no real worker exists to consume these tasks — only a simulated demo script (`examples/02-engine-worker.ts`). The MVP project (`/home/leo/mvp/`) contains the actual `PentestAgent` but only runs as an interactive CLI (`src/index.ts`).

**Goal:** Create a new `src/worker.ts` entry point in the MVP project that acts as a Redis consumer, picks up tasks from the queue, runs the real PentestAgent, streams logs back via Redis Pub/Sub, and publishes completion results — completing the full bridge loop.

## Architecture

```
Web UI → Cyber-Bridge → Redis LPUSH cyberbridge:tasks
                                    ↓
              MVP worker.ts → BRPOP cyberbridge:tasks
                                    ↓
                         PentestAgent.reconnaissance(target)
                                    ↓ (real-time)
                         PUBLISH logs:{tenant}:{taskId}  →  Cyber-Bridge → WebSocket → Web UI
                                    ↓ (on complete)
                         PUBLISH complete:{tenant}:{taskId}
                         HSET task:{tenant}:{taskId} state=completed result=...
```

## Standalone Compatibility Guarantee

The MVP must continue to work as a standalone CLI tool without Redis. This plan ensures:

- **`onLog` is optional** in `AgentConfig` — when not provided (standalone mode), behavior is identical to today
- **`reconnaissance()` returns `ReconResult`** instead of `void` — the existing CLI ignores the return value, so it's backward-compatible
- **`ioredis` is only imported in `worker.ts`** — never in orchestrator.ts or any agent file. The core agent has zero Redis dependency.
- **`npm run dev` / `npm start`** continue to launch the interactive CLI as before
- **`npm run worker`** is the new entry point that adds the Redis consumer layer *around* the unchanged agent

## File Changes

| File | Action | Purpose |
|------|--------|---------|
| `mvp/src/worker.ts` | **Create** | Redis consumer entry point (only file that imports ioredis) |
| `mvp/src/agent/core/orchestrator.ts` | **Modify** | Add optional `onLog` callback to AgentConfig; return results from `reconnaissance()` |
| `mvp/src/agent/execution/agentic-executor.ts` | **Modify** | Add `setOnLog()` + `log()` helper so `exec` phase logs are relayed |
| `mvp/src/agent/core/types.ts` | **Modify** | Export `LogLevel` and `LogEntry` types (shared by orchestrator + agentic-executor) |
| `mvp/package.json` | **Modify** | Add `ioredis` dependency + `worker` script |
| `mvp/tsconfig.json` | **Verify** | Ensure worker.ts is included in compilation |

---

## Task 1.1: Add `onLog` callback + return type to PentestAgent

**File:** `mvp/src/agent/core/orchestrator.ts`

### 1a. Extend `AgentConfig` with optional `onLog`

```typescript
export interface AgentConfig {
  // ... existing fields ...
  /** Optional callback invoked for every log line. Used by worker mode to relay logs to Redis Pub/Sub. */
  onLog?: (message: string) => void;
}
```

### 1b. Define `ReconResult` return type

```typescript
/** Result returned by the reconnaissance method for downstream consumption. */
export interface ReconResult {
  sessionId: string;
  iterations: number;
  results: CleanedData[];
  discoveredServices: DiscoveredService[];
  tacticalPlans: TacticalPlanObject[];
  intelligence: IntelligenceContext | null;
}
```

### 1c. Define structured log types and `log()` helper

Logs are tagged with a `level` so the frontend can filter or color them accordingly.

```typescript
/** Log severity levels for structured log output. */
export type LogLevel = 'INFO' | 'STEP' | 'RESULT' | 'VULN' | 'WARN' | 'ERROR';

/** Structured log entry emitted via the onLog callback. */
export interface LogEntry {
  level: LogLevel;
  phase: string;
  message: string;
}
```

Update the `onLog` callback signature in `AgentConfig`:

```typescript
export interface AgentConfig {
  // ... existing fields ...
  /** Optional callback invoked for every structured log entry. Used by worker mode to relay logs to Redis Pub/Sub. */
  onLog?: (entry: LogEntry) => void;
}
```

Add a private helper that both logs to console (human-readable) and emits the structured entry:

```typescript
/**
 * Logs a structured message to console and optionally to the onLog callback.
 * @param level - Severity tag (INFO, STEP, RESULT, VULN, WARN, ERROR).
 * @param phase - The orchestrator phase producing the log (e.g. "Reasoner", "MCP Agent").
 * @param message - The log message body.
 */
private log(level: LogLevel, phase: string, message: string): void {
  console.log(`[${phase}] ${message}`);
  this.config.onLog?.({ level, phase, message });
}
```

#### Tag mapping from existing orchestrator logs

The existing `console.log` calls map to tags as follows:

| Existing pattern | Level | Phase | Example |
|---|---|---|---|
| `[Orchestrator] Starting reconnaissance...` | `INFO` | `Orchestrator` | Mission start/end, iteration markers |
| `[Orchestrator] === Iteration N ===` | `STEP` | `Orchestrator` | Iteration boundary |
| `[Reasoner] Thought: ...` | `STEP` | `Reasoner` | Strategic reasoning output |
| `[Executor] Plan: N step(s)` | `STEP` | `Executor` | Execution plan details |
| `[MCP Agent] Executing: ...` | `STEP` | `MCP Agent` | Tool execution start |
| `[MCP Agent] ✓ Execution successful` | `RESULT` | `MCP Agent` | Tool success |
| `[MCP Agent] ✗ Execution failed: ...` | `ERROR` | `MCP Agent` | Tool failure |
| `[Data Cleaner] ✓ Type: ...` | `RESULT` | `Data Cleaner` | Parsed output summary |
| `[Data Cleaner] ✓ Extracted N services` | `RESULT` | `Data Cleaner` | Service discovery |
| `[Intelligence Layer] Analyzing...` | `STEP` | `Intelligence` | Intelligence phase start |
| `[Profiler] ✓ Profile: ...` | `RESULT` | `Profiler` | OS/tech profile |
| `[VulnLookup] ✓ Found N vulnerabilities` | `VULN` | `VulnLookup` | Vulnerability discoveries |
| `[RAG Memory] ✓ Injected N ...` | `INFO` | `RAG Memory` | Memory recall |
| `⚠ Attempt N failed, retrying...` | `WARN` | varies | Retry warnings |
| `✗ All attempts failed` | `ERROR` | varies | Complete failures |

The worker serializes each `LogEntry` to a human-readable tagged string before publishing to Redis:

```typescript
// In worker.ts — the onLog callback
onLog: (entry) => {
  const line = `[${entry.level}][${entry.phase}] ${entry.message}`;
  redis.publish(`logs:${tenantId}:${taskId}`, line);
}
```

This allows the frontend to:
- **Filter** logs by level (e.g. show only VULN + ERROR)
- **Color-code** by level (green for RESULT, red for ERROR, yellow for WARN, purple for VULN)
- **Group** logs by phase (collapse all "Data Cleaner" logs, expand "VulnLookup")
- **Fall back** to plain text display by just showing the raw string

### 1d. Replace `console.log` with `this.log()` in `reconnaissance()`

Replace all `console.log(...)` calls **within the `reconnaissance()` method and the private phase methods it calls** (`_runRAGMemoryRecall`, `_runReasoningPhase`, `_runExecutionPlanning`, `_runToolExecutionLoop`, `_runIntelligencePhase`, `_runEvaluationAndLogging`, `_runRAGMemoryForIntelligence`) with `this.log(level, phase, message)`, using the tag mapping table above to assign the correct level and phase.

This ensures every phase's output is captured by the callback without modifying subagent files (ReasonerAgent, ExecutorAgent, etc. still use console.log directly — their output is internal detail, not user-facing logs; the orchestrator-level logs are the meaningful semantic ones).

### 1f. Propagate `onLog` to AgenticExecutor

**File:** `mvp/src/agent/execution/agentic-executor.ts`

**Problem:** `AgenticExecutor` is a separate class with its own `console.log` calls throughout `runAgentLoop()`, `autoExecute()`, `executeFinal()`, `autoExecuteFromPlan()`, and `printTraceStatistics()`. When the worker dispatches an `exec` phase task via `agenticExecutor.runAgentLoop()`, all real-time logs (tool calls, results, turn markers, token stats) would be lost — the frontend would see nothing until completion.

**Solution:** Add an optional `onLog` callback to `AgenticExecutor` and apply the same `log()` helper pattern:

1. Add an `onLog` property to `AgenticExecutor`:

```typescript
/** Optional structured log callback, injected by the orchestrator. */
private onLog?: (entry: LogEntry) => void;

/**
 * Sets the onLog callback for structured log relay.
 * Called by PentestAgent after construction when onLog is configured.
 * @param callback - The log callback to invoke for each log entry.
 */
setOnLog(callback: (entry: LogEntry) => void): void {
  this.onLog = callback;
}
```

2. Add a private `log()` helper (same pattern as orchestrator):

```typescript
/**
 * Logs a structured message to console and optionally to the onLog callback.
 * @param level - Severity tag.
 * @param phase - The component producing the log.
 * @param message - The log message body.
 */
private log(level: LogLevel, phase: string, message: string): void {
  console.log(`[${phase}] ${message}`);
  this.onLog?.({ level, phase, message });
}
```

3. Replace `console.log` calls in `AgenticExecutor` with `this.log()`:

| Existing pattern | Level | Phase |
|---|---|---|
| `--- Agent Turn N ---` | `STEP` | `AgenticExecutor` |
| `[tokens] in=... out=...` | `INFO` | `AgenticExecutor` |
| `[tool] toolName(...)` | `STEP` | `AgenticExecutor` |
| `[result] ...` | `RESULT` | `AgenticExecutor` |
| `--- Agent Complete ---` | `INFO` | `AgenticExecutor` |
| `--- Agent stopped: max turns ---` | `WARN` | `AgenticExecutor` |
| `[1/3] Generating script...` | `STEP` | `AgenticExecutor` |
| `[2/3] Writing script...` | `STEP` | `AgenticExecutor` |
| `[3/3] Executing script...` | `STEP` | `AgenticExecutor` |
| `--- Trace Statistics ---` (all lines) | `INFO` | `AgenticExecutor` |

4. In `PentestAgent.initialize()`, wire the callback after constructing `AgenticExecutor`:

```typescript
// In orchestrator.ts → initialize()
if (this.mcpAgent.isKaliConnected()) {
  this.agenticExecutor = new AgenticExecutor(this.mcpAgent, this.skillManager);
  // Propagate onLog to AgenticExecutor for exec-phase log relay
  if (this.config.onLog) {
    this.agenticExecutor.setOnLog(this.config.onLog);
  }
  this.log('INFO', 'Orchestrator', 'Agentic Executor initialized');
}
```

**Import note:** `LogLevel` and `LogEntry` types must be exported from `orchestrator.ts` (or moved to `types.ts`) so `agentic-executor.ts` can import them.

**Standalone compatibility:** When `setOnLog()` is never called (CLI mode), `this.onLog` is undefined and the `?.` optional chain in `log()` is a no-op — all behavior remains identical to today.

### 1e. Change `reconnaissance()` return type from `Promise<void>` to `Promise<ReconResult>`

At the end of the method, return the collected data:

```typescript
return {
  sessionId: this.sessionId,
  iterations: iteration,
  results: aggregatedResults,
  discoveredServices: allDiscoveredServices,
  tacticalPlans: allTacticalPlans,
  intelligence: currentIntelligence,
};
```

**Note:** The existing CLI entry point (`src/index.ts`) calls `await agent.reconnaissance(target)` without using the return value, so this is backward-compatible.

---

## Task 1.2: Create `src/worker.ts` — Redis Consumer Entry Point

**File:** `mvp/src/worker.ts` (new)

### Structure (modeled after `cyber-bridge/examples/02-engine-worker.ts`):

```
1. Redis connection (ioredis, connect to localhost:6379)
2. PentestAgent initialization (same config as index.ts)
3. BRPOP loop on `cyberbridge:tasks`
4. For each task:
   a. Parse queue message: { task_id, tenant_id, key }
   b. Read task hash from Redis: HGETALL task:{tenant}:{taskId}
   c. HSET state → "running"
   d. Map phase to agent method (see Task 1.3)
   e. Run agent with onLog callback → PUBLISH to logs:{tenant}:{taskId}
   f. On completion: HSET state → "completed", HSET result → JSON, PUBLISH to complete:{tenant}:{taskId}
   g. On error: HSET state → "failed", PUBLISH error to complete channel
5. Loop back to BRPOP
```

### Key implementation details:

- **Single agent instance**: Create one `PentestAgent`, call `initialize()` once, reuse across tasks. Call `reasoner.reset()` between tasks (already done inside `reconnaissance()`).
- **Error handling**: Wrap each task execution in try/catch. On failure, set state to `"failed"` and publish the error message to the complete channel so the web UI gets notified.
- **Graceful shutdown**: Listen for SIGINT/SIGTERM, call `agent.shutdown()` and `redis.quit()`.
- **Log format**: Publish plain text strings to `logs:{tenant}:{taskId}` (matching what cyber-bridge's `subscribeToTaskLogs` expects — it emits the raw message as `{ task_id, log: message }`).

---

## Task 1.3: Phase-to-Method Mapping

Map the cyber-bridge task `phase` field to the appropriate PentestAgent method:

| Phase | Agent Method | Notes |
|-------|-------------|-------|
| `recon` | `reconnaissance(target)` | Primary use case, fully supported |
| `plan` | `reconnaissance(target)` | Same flow — recon produces tactical plans |
| `exec` | `agenticExecutor.runAgentLoop(target, 15)` | Requires Kali MCP connection |
| `report` | Reserved for future | Return error: "phase not yet supported" |

The `options` field from the task hash is passed as-is for future extensibility (e.g., max iterations, scan depth). For now, only `target` is used.

---

## Task 1.4: Completion Signaling

After `reconnaissance()` returns its `ReconResult`:

```typescript
// Build result payload
const result = {
  session_id: reconResult.sessionId,
  target: taskData.target,
  iterations: reconResult.iterations,
  services_discovered: reconResult.discoveredServices.length,
  tactical_plans: reconResult.tacticalPlans.length,
  vulnerabilities: reconResult.intelligence?.vulnerabilities?.length ?? 0,
  summary: reconResult.results.map(r => r.summary),
  completed_at: new Date().toISOString(),
};

// Atomic update + publish
const pipeline = redis.pipeline();
pipeline.hset(taskKey, 'state', 'completed');
pipeline.hset(taskKey, 'result', JSON.stringify(result));
await pipeline.exec();

await redis.publish(`complete:${tenantId}:${taskId}`, JSON.stringify(result));
```

---

## Task 1.5: Package Updates

**File:** `mvp/package.json`

- Add dependency: `"ioredis": "^5.4.2"`
- Add scripts:
  ```json
  "worker": "tsc && node dist/worker.js",
  "worker:dev": "tsx src/worker.ts"
  ```
- Add devDependency: `"tsx": "^4.19.2"` (for worker:dev convenience)

---

## Verification

1. Start Redis: `docker compose up redis -d` (from cyber-bridge)
2. Start cyber-bridge: `cd /home/leo/cyber-bridge && npm run dev`
3. Start MVP worker: `cd /home/leo/mvp && npm run worker:dev`
4. Create a task: `npx tsx examples/01-web-create-task.ts` (from cyber-bridge)
5. Observe:
   - Worker picks up the task from Redis queue
   - Worker logs appear in its terminal
   - Web client (script 01) receives `task:log` events in real time
   - Web client receives `task:complete` with the result payload
6. Verify in Redis: `HGETALL task:demo-tenant:{taskId}` shows `state=completed` and populated `result`
