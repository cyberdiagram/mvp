# LLM Cassette Recording & Replay Guide

VCR-style recording of all Anthropic API calls so that full recon/exec sessions
can be replayed offline without hitting the real API.

## How It Works

- **Record mode**: every `messages.create()` call is proxied to the real API and
  the request+response pair is appended as a JSONL line to a cassette file.
- **Replay mode**: the cassette is loaded into memory; each subsequent API call
  returns the next saved entry in sequence -- zero network activity.

Per-task cassettes are auto-named by the worker:

| Phase | Cassette filename |
|-------|-------------------|
| recon | `recon-{task_id}.jsonl` |
| exec (with recon_task_id) | `exec-{recon_task_id}.jsonl` |
| exec (no recon_task_id) | `exec-{task_id}.jsonl` |

---

## Prerequisites

### 1. Redis

```bash
cd /home/leo/cyber-bridge && docker compose up redis -d
```

### 2. Cyber-Bridge

```bash
cd /home/leo/cyber-bridge && npm run dev
```

Verify:

```bash
curl -s http://localhost:3002/health
# Expected: {"status":"ok"}
```

### 3. Kali MCP (needed for exec phase)

```bash
cd /home/leo/mvp/docker && docker compose up kali -d
```

---

## Step 1: Record a Recon Cassette

Start the worker in record mode:

```bash
cd /home/leo/mvp && npm run worker:record
```

Confirm you see:

```
[llm-recorder] RECORD mode  -> /home/leo/mvp/logs/cassettes/session.jsonl
[worker] Listening on queue: cyberbridge:tasks
[worker] Waiting for tasks...
```

In a separate terminal, create the recon task:

```bash
cd /home/leo/cyber-bridge
./scripts/create-task.sh -t <TARGET_IP> -p recon -e prod
```

Watch the worker terminal. On success you will see:

```
[llm-recorder] RECORD mode  -> /home/leo/mvp/logs/cassettes/recon-<TASK_ID>.jsonl
[llm-recorder] recorded entry 0  model=...  in=... out=... tokens
...
[worker] Task <TASK_ID> state -> completed
```

**Save the `task_id` and `session_id`** from the JSON response -- you will need
them for the exec step.

Verify the cassette was created:

```bash
ls -la /home/leo/mvp/logs/cassettes/
# Should show: recon-<TASK_ID>.jsonl with non-zero size
```

---

## Step 2: Record an Exec Cassette

With the worker still running in record mode, create an exec task that chains
off the completed recon. Substitute the IDs from Step 1:

```bash
cd /home/leo/cyber-bridge
./scripts/create-task.sh -t <TARGET_IP> -p exec \
  --recon-task-id <RECON_TASK_ID> \
  --session-id <SESSION_ID> -e prod
```

On success the worker creates:

```
/home/leo/mvp/logs/cassettes/exec-<RECON_TASK_ID>.jsonl
```

---

## Step 3: Retarget Cassette for a New IP

HTB/lab machines get a new IP on each restart. Before replaying a cassette
against a fresh instance, update the hardcoded target IP:

```bash
# Preview changes (no files modified)
./scripts/retarget-cassette.sh \
  --old-ip 10.129.2.199 --new-ip 10.129.5.42 --dry-run \
  logs/cassettes/

# Apply to a single cassette
./scripts/retarget-cassette.sh \
  --old-ip 10.129.2.199 --new-ip 10.129.5.42 \
  logs/cassettes/recon-abc123.jsonl

# Apply to all cassettes in a directory
./scripts/retarget-cassette.sh \
  --old-ip 10.129.2.199 --new-ip 10.129.5.42 \
  logs/cassettes/
```

The script:
- creates a `.bak` backup before modifying each file
- uses word-boundary-aware matching so `10.129.2.19` won't match inside `10.129.2.199`
- reports replacement count per file and warns on zero matches

Verify after retargeting:

```bash
# Old IP should be gone
grep -c '10.129.2.199' logs/cassettes/recon-abc123.jsonl
# Expected: 0

# New IP should be present
grep -c '10.129.5.42' logs/cassettes/recon-abc123.jsonl
```

---

## Step 4: Replay

One worker handles both recon and exec phases sequentially. It sits on the
Redis queue in a loop — each incoming task triggers per-task cassette swapping
via `resetGlobalRecorder()`.

### Per-task cassette lookup (`worker.ts:158-175`)

| Incoming task phase | Cassette file loaded |
|---|---|
| `recon` | `recon-{task_id}.jsonl` |
| `exec` (with `recon_task_id`) | `exec-{recon_task_id}.jsonl` |

Both cassettes share the same UUID because the exec cassette is keyed on the
**recon** task's ID, not its own.

### Replay sequence

```
Worker boots (replay mode)
  ↓
Queue recon task  →  worker loads recon-{uuid}.jsonl, replays, completes
  ↓
Queue exec task   →  worker loads exec-{uuid}.jsonl, replays, completes
  (passing --recon-task-id from the recon step)
```

Start the worker in replay mode:

```bash
# Terminal 1
cd /home/leo/mvp && npm run worker:replay
```

Then queue tasks from a second terminal using `-e replay` and `--task-id` to
force the original cassette UUID so the worker finds the recorded file
automatically:

```bash
# Terminal 2: queue recon with the original cassette UUID
cd /home/leo/cyber-bridge
./scripts/create-task.sh -t <TARGET_IP> -p recon \
  --task-id <ORIGINAL_RECON_UUID> -e replay
# → note the session_id from the response

# Terminal 2: queue exec (chained off the recon)
./scripts/create-task.sh -t <TARGET_IP> -p exec \
  --recon-task-id <ORIGINAL_RECON_UUID> \
  --session-id <SESSION_ID> -e replay
```

For example, if your cassettes are `recon-5c7bd663-abcd-1234-5678-abcdef012345.jsonl`
and `exec-5c7bd663-abcd-1234-5678-abcdef012345.jsonl`:

```bash
./scripts/create-task.sh -t 10.129.5.42 -p recon \
  --task-id 5c7bd663-abcd-1234-5678-abcdef012345 -e replay

./scripts/create-task.sh -t 10.129.5.42 -p exec \
  --recon-task-id 5c7bd663-abcd-1234-5678-abcdef012345 \
  --session-id <SESSION_ID_FROM_RECON_RESPONSE> -e replay
```

### Alternative: manual cassette matching

If you prefer not to use `--task-id`, two other options exist:

1. **Rename the cassettes** to match the new task IDs after creating the tasks:
   ```bash
   cp logs/cassettes/recon-5c7bd663-....jsonl logs/cassettes/recon-<NEW_UUID>.jsonl
   cp logs/cassettes/exec-5c7bd663-....jsonl  logs/cassettes/exec-<NEW_UUID>.jsonl
   ```

2. **Use `LLM_CASSETTE_PATH`** to force a specific cassette (single-phase only):
   ```bash
   LLM_CASSETTE_PATH=./logs/cassettes/recon-5c7bd663-....jsonl npm run worker:replay
   ```

### Replay fallback behaviour

If the per-task cassette does not exist, the worker logs a warning and keeps
using the cassette that was loaded at startup:

```
[llm-recorder] cassette not found for replay: .../recon-<NEW_ID>.jsonl -- keeping current recorder
```

This means you can point `LLM_CASSETTE_PATH` at a known-good recording and
replay it for any incoming task:

```bash
LLM_CASSETTE_PATH=./logs/cassettes/recon-legacy.jsonl npm run worker:replay
```

---

## Environment Variables

| Variable | Values | Description |
|----------|--------|-------------|
| `RECORD_LLM_CALLS` | `record` / `replay` / `off` | Operating mode (default: `off`) |
| `LLM_CASSETTE_DIR` | directory path | Per-task cassette directory (used by `worker:record` and `worker:replay` scripts) |
| `LLM_CASSETTE_PATH` | file path | Fixed cassette path; fallback when `LLM_CASSETTE_DIR` is not set (default: `./logs/cassettes/session.jsonl`) |

### npm scripts

| Script | Command |
|--------|---------|
| `npm run worker:record` | `RECORD_LLM_CALLS=record LLM_CASSETTE_DIR=./logs/cassettes tsx src/worker.ts` |
| `npm run worker:replay` | `RECORD_LLM_CALLS=replay LLM_CASSETTE_DIR=./logs/cassettes tsx src/worker.ts` |

---

## Quick Smoke Test (no real API calls needed)

Requires an existing cassette file (e.g. `recon-legacy.jsonl`).

```bash
# 1. Start cyber-bridge + redis (see Prerequisites above)

# 2. Start the worker with replay pointed at the existing cassette
cd /home/leo/mvp
LLM_CASSETTE_PATH=./logs/cassettes/recon-legacy.jsonl npm run worker:replay

# 3. Create a recon task
cd /home/leo/cyber-bridge
./scripts/create-task.sh -t 10.129.2.199 -p recon

# Expected: worker logs the fallback warning, then replays from recon-legacy.jsonl
```

---

## Key Source Files

| File | Role |
|------|------|
| `mvp/src/agent/utils/llm-recorder.ts` | `LLMRecorder` class, `setupLLMRecorder()`, `resetGlobalRecorder()`, `createAnthropicClient()` |
| `mvp/src/worker.ts` (lines 158-175) | Per-task cassette naming logic |
| `cyber-bridge/scripts/create-task.sh` | CLI to create recon/exec tasks via REST API |
| `cyber-bridge/src/routes/tasks.ts` | REST handler -- stores `recon_task_id` in Redis hash |
| `mvp/scripts/retarget-cassette.sh` | Replace target IP in cassette files for new lab instances |
| `cyber-bridge/src/ws/handler.ts` | WebSocket handler -- stores `recon_task_id` in Redis hash |
