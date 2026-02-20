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
import { PentestAgent } from './agent/index.js';
import type { LogEntry, ReconResult } from './agent/core/types.js';

// ─── Configuration ───────────────────────────────────────────

const REDIS_HOST = process.env.REDIS_HOST || 'localhost';
const REDIS_PORT = parseInt(process.env.REDIS_PORT || '6379', 10);
const TASK_QUEUE = 'cyberbridge:tasks';

// ─── Redis Client Factory ────────────────────────────────────

function createRedisClient(name: string): InstanceType<typeof Redis> {
  const client = new Redis({
    host: REDIS_HOST,
    port: REDIS_PORT,
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

    // Set current log channel for onLog callback
    currentLogChannel = logChannel;

    // Mark task as running
    await redis.hset(taskKey, 'state', 'running');

    try {
      switch (phase) {
        case 'recon':
        case 'plan': {
          const reconResult: ReconResult = await agent.reconnaissance(target);

          // Build result payload
          const result = {
            session_id: reconResult.sessionId,
            target,
            iterations: reconResult.iterations,
            services_discovered: reconResult.discoveredServices.length,
            tactical_plans: reconResult.tacticalPlans.length,
            vulnerabilities: reconResult.intelligence?.vulnerabilities?.length ?? 0,
            summary: reconResult.results.map((r) => r.summary),
            completed_at: new Date().toISOString(),
            // Full intelligence data for web frontend modules
            target_profile: reconResult.intelligence?.targetProfile ?? null,
            discovered_services: reconResult.discoveredServices,
            key_findings: reconResult.intelligence?.vulnerabilities ?? [],
            // Full tactical plan array for Phase 2 UI
            tactical_plans_data: reconResult.tacticalPlans,
          };

          // Atomic update + publish
          const pipeline = redis.pipeline();
          pipeline.hset(taskKey, 'state', 'completed');
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

          const agentResult = await agent.agenticExecutor.runAgentLoop(target, 15);

          const result = {
            target,
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

        case 'report':
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
