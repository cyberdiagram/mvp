/**
 * Engine Worker — Redis Consumer Entry Point.
 *
 * Connects the MVP PentestAgent to the Cyber-Bridge middleware via Redis.
 * Consumes tasks from the `cyberbridge:tasks` queue, runs the real agent,
 * streams logs back via Redis Pub/Sub, and publishes completion results.
 *
 * Prerequisites:
 *   - Redis running (e.g. via cyber-bridge docker compose)
 *   - ANTHROPIC_API_KEY set in .env
 *   - Kali MCP server running (for exec-phase tasks)
 *
 * Usage:
 *   npm run worker          # Build + run
 *   npm run worker:dev      # Run directly with tsx
 */

import 'dotenv/config';
import path from 'path';
import Redis from 'ioredis';
import {
  setupLLMRecorder,
  resetGlobalRecorder,
  getGlobalRecorderMode,
} from './agent/utils/llm-recorder.js';
import { PentestAgent } from './agent/index.js';
import type { LogEntry, ReconResult } from './agent/core/types.js';

// Activate LLM recorder/replayer before any agent is instantiated.
// Reads RECORD_LLM_CALLS ('record'|'replay'|'off') and LLM_CASSETTE_PATH from env.
setupLLMRecorder();

// ─── Configuration ───────────────────────────────────────────

const REDIS_HOST = process.env.REDIS_HOST || 'localhost';
const REDIS_PORT = parseInt(process.env.REDIS_PORT || '6379', 10);
const REDIS_PASSWORD = process.env.REDIS_PASSWORD || undefined;
const TASK_QUEUE = 'cyberbridge:tasks';

// ─── Redis Client Factory ────────────────────────────────────

function createRedisClient(name: string): InstanceType<typeof Redis> {
  const client = new Redis({
    host: REDIS_HOST,
    port: REDIS_PORT,
    password: REDIS_PASSWORD,
    maxRetriesPerRequest: null,
  });
  client.on('error', (err: Error) => console.error(`[redis:${name}]`, err.message));
  client.on('connect', () => console.log(`[redis:${name}] connected`));
  return client;
}

// ─── Phase-to-Method Mapping ─────────────────────────────────

interface TaskData {
  task_id: string;
  tenant_id: string;
  phase: string;
  target: string;
  options?: string;
  /** UUID of the preceding recon task — present on exec tasks created via create-task.sh */
  recon_task_id?: string;
  [key: string]: string | undefined;
}

// ─── Main Worker Loop ────────────────────────────────────────

async function main(): Promise<void> {
  console.log('MVP Engine Worker');
  console.log('=================');

  // Create Redis clients (separate client for BRPOP blocking)
  const redis = createRedisClient('worker');
  const blockingRedis = createRedisClient('blocking');

  // Build agent config (same as index.ts)
  const anthropicApiKey = process.env.ANTHROPIC_API_KEY;
  if (!anthropicApiKey) {
    console.error('Error: ANTHROPIC_API_KEY environment variable is required');
    process.exit(1);
  }

  const ragMemoryPath = process.env.RAG_MEMORY_SERVER_PATH;
  const kaliMcpUrl = process.env.KALI_MCP_URL || 'http://localhost:3001';

  // Placeholder for the current task's log channel (set per-task)
  let currentLogChannel: string | null = null;

  const config = {
    anthropicApiKey,
    skillsDir: path.resolve('./src/skills'),
    kaliMcpUrl,
    ragMemoryServerPath: ragMemoryPath,
    enableEvaluation: process.env.ENABLE_EVALUATION === 'true',
    enableRAGMemory: process.env.ENABLE_RAG_MEMORY === 'true' && !!ragMemoryPath,
    trainingDataPath: process.env.TRAINING_DATA_PATH || './logs/training_data',
    sessionLogsPath: process.env.SESSION_LOGS_PATH || './logs/sessions',
    onLog: (entry: LogEntry) => {
      if (currentLogChannel) {
        const line = `[${entry.level}][${entry.phase}] ${entry.message}`;
        redis.publish(currentLogChannel, line).catch(() => {});
      }
    },
  };

  // Initialize agent once, reuse across tasks
  const agent = new PentestAgent(config);
  await agent.initialize();

  console.log(`[worker] Listening on queue: ${TASK_QUEUE}`);
  console.log('[worker] Waiting for tasks... (Ctrl+C to stop)\n');

  // Graceful shutdown
  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log('\n[worker] Shutting down...');
    await agent.shutdown();
    blockingRedis.disconnect();
    redis.disconnect();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  // ─── BRPOP Loop ──────────────────────────────────────────
  while (!shuttingDown) {
    const item = await blockingRedis.brpop(TASK_QUEUE, 0);
    if (!item) continue;

    const [, payload] = item;
    let taskMsg: { task_id: string; tenant_id: string; key: string };

    try {
      taskMsg = JSON.parse(payload);
    } catch {
      console.error('[worker] Failed to parse task payload:', payload);
      continue;
    }

    const { task_id: taskId, tenant_id: tenantId, key: taskKey } = taskMsg;
    console.log(`[worker] Picked up task: ${taskId} (tenant: ${tenantId})`);

    // Read task details from Redis hash
    const taskData = (await redis.hgetall(taskKey)) as unknown as TaskData;
    if (!taskData.task_id) {
      console.error(`[worker] Task hash not found at ${taskKey}, skipping`);
      continue;
    }

    const phase = taskData.phase || 'recon';
    const target = taskData.target;
    const logChannel = `logs:${tenantId}:${taskId}`;
    const completeChannel = `complete:${tenantId}:${taskId}`;

    console.log(`[worker] Phase: ${phase}, Target: ${target}`);

    // ── Per-task cassette: when LLM_CASSETTE_DIR is set, auto-name the cassette
    // based on phase + recon_task_id (exec) or task_id (recon/others) so each
    // run is independently replayable without overwriting a shared file.
    const cassetteDir = process.env.LLM_CASSETTE_DIR;
    if (cassetteDir && getGlobalRecorderMode() !== 'off') {
      let opts: Record<string, unknown> = {};
      try { opts = JSON.parse(taskData.options || '{}'); } catch { /* ignore */ }

      // For exec tasks, key the cassette on recon_task_id so the recording is
      // clearly associated with the recon results it was built on.
      const reconTaskId = taskData.recon_task_id
        || (typeof opts.recon_task_id === 'string' ? opts.recon_task_id : null);
      const cassetteId = (phase === 'exec' && reconTaskId)
        ? reconTaskId
        : taskId;
      const cassettePath = path.join(cassetteDir, `${phase}-${cassetteId}.jsonl`);
      resetGlobalRecorder(cassettePath);
    }

    // Set current log channel for onLog callback
    currentLogChannel = logChannel;

    // Mark task as running
    await redis.hset(taskKey, 'state', 'running');

    try {
      switch (phase) {
        case 'recon': {
          const reconResult: ReconResult = await agent.reconnaissance(target);

          /**
           * ReconResult payload published to `complete:{tenantId}:{taskId}`.
           *
           * Cyber-Bridge forwards this object verbatim as the `result` field of the
           * `task:complete` Socket.io event received by the web frontend.
           *
           * Scalar summary fields (used by the frontend's Summary panel):
           * @param session_id          - Unique session identifier assigned by PentestAgent at construction.
           *                              Source: reconResult.sessionId
           * @param target              - The IP address or hostname that was scanned.
           *                              Source: taskData.target (from the Redis task hash)
           * @param iterations          - Number of OODA loop iterations the recon mission completed.
           *                              Source: reconResult.iterations
           * @param services_discovered - Total count of unique host:port services found.
           *                              Source: reconResult.discoveredServices.length
           * @param tactical_plans      - Number of tactical attack plans generated during the session.
           *                              Source: reconResult.tacticalPlans.length
           * @param vulnerabilities     - Count of CVEs found by the VulnLookup agent and parsed from
           *                              file output (fileVulns). Zero when neither source returned data.
           *                              Source: reconResult.intelligence?.vulnerabilities?.length ?? 0
           * @param summary             - Array of short human-readable strings describing key findings,
           *                             one entry per CleanedData result collected across all iterations.
           *                              Source: reconResult.results.map(r => r.summary)
           * @param completed_at        - ISO 8601 timestamp of task completion (set by the worker).
           *
           * Structured intelligence fields (populate the four Phase 1 UI panels):
           * @param target_profile      - OS family/version, technology stack, security posture
           *                             ("hardened"|"standard"|"weak"), risk level, and evidence lines.
           *                             Null when the Profiler agent produced no output.
           *                              Source: reconResult.intelligence?.targetProfile ?? null
           *                              Frontend panel: Target Profile
           * @param discovered_services - Full array of enriched service objects, one per open port.
           *                             Each entry includes host, port, protocol, service name, product,
           *                             version, banner, category, criticality, and confidence score.
           *                              Source: reconResult.discoveredServices (DiscoveredService[])
           *                              Frontend panels: Network Topology, Target Profile (services table)
           * @param key_findings        - Array of VulnerabilityInfo objects merged from the VulnLookup
           *                             agent (CVE lookups via SearchSploit) and file-parsed vulns
           *                             (fileVulns extracted by the DataCleaner from tool output files).
           *                             Empty array when no CVEs were identified.
           *                              Source: reconResult.intelligence?.vulnerabilities ?? []
           *                              Frontend panel: Key Findings
           * @param tactical_plans_data - Full TacticalPlanObject array, each containing plan_id,
           *                             target_ip, context_hash, attack_vectors[], and created_at.
           *                             Each attack vector includes the action template, prediction
           *                             metrics (MITRE ATT&CK ID, CVE, confidence score), and RAG
           *                             context (payload snippet, exploitation logic, source).
           *                              Source: reconResult.tacticalPlans (TacticalPlanObject[])
           *                              Frontend panel: (Attack Planning Phase 2)
           */
          const result = {
            session_id: reconResult.sessionId,
            target,
            iterations: reconResult.iterations,
            services_discovered: reconResult.discoveredServices.length,
            tactical_plans: reconResult.tacticalPlans.length,
            vulnerabilities: reconResult.intelligence?.vulnerabilities?.length ?? 0,
            summary: reconResult.results.map((r) => r.summary),
            completed_at: new Date().toISOString(),
            target_profile: reconResult.intelligence?.targetProfile ?? null,
            discovered_services: reconResult.discoveredServices,
            key_findings: reconResult.intelligence?.vulnerabilities ?? [],
            tactical_plans_data: reconResult.tacticalPlans,
          };

          // Atomic update + publish
          const pipeline = redis.pipeline();
          pipeline.hset(taskKey, 'state', 'completed');
          pipeline.hset(taskKey, 'session_id', reconResult.sessionId);
          pipeline.hset(taskKey, 'result', JSON.stringify(result));
          await pipeline.exec();

          await redis.publish(completeChannel, JSON.stringify(result));
          console.log(`[worker] Task ${taskId} state -> completed`);
          break;
        }

        case 'exec': {
          if (!agent.agenticExecutor) {
            throw new Error('Kali MCP server not connected — cannot run exec phase');
          }

          // Parse options forwarded from the web UI
          let opts: Record<string, unknown> = {};
          try { opts = JSON.parse(taskData.options || '{}'); } catch { /* ignore */ }

          const planFilePath = typeof opts.plan_file_path === 'string' ? opts.plan_file_path : null;

          const agentResult = await (async () => {
            if (planFilePath) {
              try {
                const { readFileSync } = await import('fs');
                const plan = JSON.parse(readFileSync(planFilePath, 'utf-8'));
                return await agent.agenticExecutor.runAgentWithTacticalPlan(plan, 'tool');
              } catch (err: unknown) {
                const msg = err instanceof Error ? err.message : String(err);
                console.warn(`[worker] Plan file unavailable (${planFilePath}): ${msg} — falling back to free-form loop`);
              }
            }
            // Fallback: free-form agent loop on the target
            return await agent.agenticExecutor.runAgentLoop(target, 15);
          })();

          const result = {
            target,
            plan_file_path: planFilePath ?? null,
            turns_used: agentResult.turnsUsed,
            tool_calls: agentResult.toolCalls.length,
            final_text: agentResult.finalText,
            completed_at: new Date().toISOString(),
          };

          const pipeline = redis.pipeline();
          pipeline.hset(taskKey, 'state', 'completed');
          pipeline.hset(taskKey, 'result', JSON.stringify(result));
          await pipeline.exec();

          await redis.publish(completeChannel, JSON.stringify(result));
          console.log(`[worker] Task ${taskId} state -> completed`);
          break;
        }

        case 'report': {
          let opts: Record<string, unknown> = {};
          try { opts = JSON.parse(taskData.options || '{}'); } catch { /* ignore */ }
          opts.target = target;
          opts.session_id = taskData.session_id ?? '';

          const reportOnLog = (line: string) => {
            redis.publish(logChannel, line).catch(() => {});
          };

          const { generateReport } = await import('./phases/report.js');
          const reportResult = await generateReport(opts, reportOnLog);

          const pipeline = redis.pipeline();
          pipeline.hset(taskKey, 'state', 'completed');
          pipeline.hset(taskKey, 'session_id', reportResult.session_id);
          pipeline.hset(taskKey, 'result', JSON.stringify(reportResult));
          await pipeline.exec();

          await redis.publish(completeChannel, JSON.stringify(reportResult));
          console.log(`[worker] Task ${taskId} state -> completed`);
          break;
        }

        default: {
          throw new Error(`Phase "${phase}" is not yet supported`);
        }
      }
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`[worker] Task ${taskId} failed: ${errorMessage}`);

      // Mark task as failed
      const pipeline = redis.pipeline();
      pipeline.hset(taskKey, 'state', 'failed');
      pipeline.hset(taskKey, 'error', errorMessage);
      await pipeline.exec();

      // Publish error to complete channel so the web UI gets notified
      await redis.publish(
        completeChannel,
        JSON.stringify({ error: errorMessage, completed_at: new Date().toISOString() })
      );
    } finally {
      currentLogChannel = null;
    }

    console.log(`[worker] Done with task ${taskId}\n`);
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
