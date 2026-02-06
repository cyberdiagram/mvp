# Configuration Guide

**Date:** 2026-02-06
**Version:** 1.3

---

## Overview

This guide explains how to configure the MVP Penetration Testing Agent with all available features including Intelligence Layer, Evaluation Loop, and RAG Memory System.

## Environment Variables

### Required Configuration

```bash
# Claude API Key (REQUIRED)
ANTHROPIC_API_KEY=your-api-key-here
```

### Optional MCP Server Paths

If not specified, the system uses default paths relative to the project directory.

```bash
# Nmap MCP Server (default: ../pentest-mcp-server/nmap-server-ts/dist/index.js)
NMAP_SERVER_PATH=/path/to/pentest-mcp-server/nmap-server-ts/dist/index.js

# SearchSploit MCP Server (default: ../pentest-mcp-server/searchsploit-server-ts/dist/index.js)
SEARCHSPLOIT_SERVER_PATH=/path/to/pentest-mcp-server/searchsploit-server-ts/dist/index.js

# RAG Memory MCP Server (no default - feature disabled if not set)
RAG_MEMORY_SERVER_PATH=/path/to/pentest-rag-memory/dist/server/index.js
```

### Optional Feature Flags

```bash
# Enable Evaluation Loop and Training Data Collection
ENABLE_EVALUATION=true

# Enable RAG Memory Recall (requires RAG_MEMORY_SERVER_PATH)
ENABLE_RAG_MEMORY=true

# Training Data Storage Path (default: ./logs/training_data)
TRAINING_DATA_PATH=./logs/training_data

# Session Logs Path for RAG ETL (default: ./logs/sessions)
SESSION_LOGS_PATH=./logs/sessions
```

---

## Feature Configuration Matrix

| Feature | Required Env Vars | Optional Env Vars | Status |
|---------|-------------------|-------------------|--------|
| **Nmap Scanning** | `ANTHROPIC_API_KEY` | `NMAP_SERVER_PATH` | ✅ Always enabled |
| **Service Enrichment** | `ANTHROPIC_API_KEY` | - | ✅ Always enabled |
| **Target Profiling** | `ANTHROPIC_API_KEY` | - | ✅ Always enabled |
| **VulnLookup (SearchSploit)** | `ANTHROPIC_API_KEY` | `SEARCHSPLOIT_SERVER_PATH` | ✅ Enabled by default |
| **Evaluation Loop** | `ANTHROPIC_API_KEY`, `ENABLE_EVALUATION=true` | `TRAINING_DATA_PATH` | ⚙️ Optional |
| **RAG Memory Recall** | `ANTHROPIC_API_KEY`, `RAG_MEMORY_SERVER_PATH`, `ENABLE_RAG_MEMORY=true` | `SESSION_LOGS_PATH` | ⚙️ Optional |

---

## Configuration Examples

### Minimal Configuration (Nmap Only)

```bash
# .env
ANTHROPIC_API_KEY=sk-ant-api03-...
```

**Features Available:**
- ✅ Nmap host discovery and port scanning
- ✅ Service detection and version enumeration
- ✅ Data cleaning and service enrichment
- ✅ Target profiling (OS, tech stack, security posture)
- ❌ VulnLookup (no SearchSploit)
- ❌ Evaluation Loop
- ❌ RAG Memory

---

### Standard Configuration (Nmap + SearchSploit)

```bash
# .env
ANTHROPIC_API_KEY=sk-ant-api03-...
SEARCHSPLOIT_SERVER_PATH=../pentest-mcp-server/searchsploit-server-ts/dist/index.js
```

**Features Available:**
- ✅ All Minimal features
- ✅ VulnLookup via SearchSploit (offline exploit research)
- ✅ CVE mapping and severity scoring
- ✅ PoC examination and local paths
- ❌ Evaluation Loop
- ❌ RAG Memory

---

### Full Configuration (All Features)

```bash
# .env
ANTHROPIC_API_KEY=sk-ant-api03-...

# MCP Servers
NMAP_SERVER_PATH=../pentest-mcp-server/nmap-server-ts/dist/index.js
SEARCHSPLOIT_SERVER_PATH=../pentest-mcp-server/searchsploit-server-ts/dist/index.js
RAG_MEMORY_SERVER_PATH=../pentest-rag-memory/dist/server/index.js

# Feature Flags
ENABLE_EVALUATION=true
ENABLE_RAG_MEMORY=true

# Storage Paths
TRAINING_DATA_PATH=./logs/training_data
SESSION_LOGS_PATH=./logs/sessions
```

**Features Available:**
- ✅ All Standard features
- ✅ Evaluation Loop (TP/FP/FN/TN labeling)
- ✅ Training data collection for RLHF
- ✅ RAG Memory recall (anti-pattern warnings)
- ✅ Session logging for RAG ETL pipeline

---

## Verifying Configuration

### Check MCP Server Availability

```bash
# Check Nmap server
ls -la $(node -e "console.log(require('path').resolve('../pentest-mcp-server/nmap-server-ts/dist/index.js'))")

# Check SearchSploit server
ls -la $(node -e "console.log(require('path').resolve('../pentest-mcp-server/searchsploit-server-ts/dist/index.js'))")

# Check RAG Memory server (if configured)
ls -la /path/to/pentest-rag-memory/dist/server/index.js
```

### Test Configuration

Start the agent and look for initialization messages:

```bash
npm start
```

**Expected Output:**

```
[Orchestrator] Initializing...
[MCP] Connecting to Nmap MCP server...
[MCP] ✓ Connected to Nmap server (6 tools available)
[MCP] Connecting to SearchSploit MCP server...
[MCP] ✓ Connected to SearchSploit server (3 tools available)
[Orchestrator] Evaluation Loop: Enabled           # If ENABLE_EVALUATION=true
[Orchestrator] RAG Memory: Enabled                # If ENABLE_RAG_MEMORY=true
```

---

## Feature Descriptions

### 1. VulnLookup (SearchSploit Integration)

**Purpose:** Offline vulnerability research using local ExploitDB database

**When Enabled:**
- Runs after service detection completes
- Searches for CVEs matching discovered service versions
- Provides PoC scripts and local file paths
- No internet connection required
- No rate limits

**Requirements:**
- SearchSploit MCP server installed and built
- ExploitDB database installed (`sudo apt install exploitdb`)

**Console Output:**
```
[VulnLookup] Searching for vulnerabilities...
[VulnLookup] ✓ Found 2 exploit(s) for lighttpd 1.4.35
[VulnLookup] CVE-2014-2323 - Path Traversal (PoC available)
```

---

### 2. Evaluation Loop

**Purpose:** Automated outcome labeling for training data collection

**When Enabled:**
- Evaluates tactical plan predictions against actual results
- Labels outcomes as TP/FP/FN/TN (True/False Positive/Negative)
- Generates TrainingPair objects for RLHF
- Saves training data to JSON files

**Requirements:**
- `ENABLE_EVALUATION=true` in .env

**Console Output:**
```
[Evaluation Loop] Executing 2 attack vectors...
[Evaluation Loop] Vector 1/2 (vec_01)...
[Evaluator] ✓ Outcome: true_positive (confidence: 0.95)
[Training Data] ✓ Saved to logs/training_data/session_123_iter_3.json
```

**Training Data Location:**
- `./logs/training_data/session_<id>_iter_<n>.json`

---

### 3. RAG Memory System

**Purpose:** Recall anti-patterns from past sessions before making decisions

**When Enabled:**
- Queries RAG memory before each Reasoner decision
- Injects warnings about previously failed tactics
- Learns from past mistakes automatically
- Prevents repeated anti-patterns

**Requirements:**
- RAG Memory MCP server running
- `RAG_MEMORY_SERVER_PATH` set in .env
- `ENABLE_RAG_MEMORY=true` in .env

**Console Output:**
```
[RAG Memory] Querying past experience...
[RAG Memory] ✓ Injecting warnings into Reasoner context

[MEMORY RECALL - WARNINGS FROM PAST EXPERIENCE]

[ANTI-PATTERN WARNING]
Scenario: SSH, port 22, remote access
⛔ AVOID: Immediately brute-forcing SSH with wordlists
⚠️ RISK: Fail2ban will block your IP after 3-5 attempts
✅ SUGGESTION: Check for SSH key auth, look for exposed keys
```

**Session Log Location:**
- `./logs/sessions/session_<id>.jsonl`

---

## Troubleshooting

### SearchSploit Server Not Found

**Error:** `[MCP] ✗ Failed to connect to SearchSploit server`

**Solutions:**
1. Check if server exists: `ls ../pentest-mcp-server/searchsploit-server-ts/dist/index.js`
2. Build the server: `cd ../pentest-mcp-server/searchsploit-server-ts && npm run build`
3. Set correct path in .env: `SEARCHSPLOIT_SERVER_PATH=/correct/path/to/index.js`

---

### RAG Memory Connection Failed

**Error:** `[RAG Memory] ⚠ Failed (continuing without memory)`

**Solutions:**
1. Verify RAG server is running: Check if `RAG_MEMORY_SERVER_PATH` points to a valid file
2. Ensure `ENABLE_RAG_MEMORY=true` is set
3. Check RAG server logs for errors
4. Note: System continues without memory if server unavailable

---

### Evaluation Loop Not Running

**Symptom:** No evaluation messages or training data files created

**Solutions:**
1. Check `ENABLE_EVALUATION=true` is set in .env
2. Verify Reasoner generates tactical plans (check console for `[Tactical Plan]`)
3. Check permissions on `TRAINING_DATA_PATH` directory
4. Ensure evaluation is triggered (currently manual in orchestrator)

---

## Performance Considerations

### Token Usage

With all features enabled:

| Feature | Model | Tokens/Request | Cost (Approx) |
|---------|-------|----------------|---------------|
| Reasoner | Sonnet 4 | 2,000-5,000 | $0.06-$0.15 |
| Executor | Haiku 4.5 | 500-1,500 | $0.001-$0.003 |
| DataCleaner | Haiku 4.5 | 1,000-3,000 | $0.002-$0.006 |
| Profiler | Haiku 3.5 (cached) | 500-2,000 | $0.0001-$0.0004 |
| Evaluator | Haiku 3.5 (cached) | 1,000-3,000 | $0.0002-$0.0006 |

**Total per iteration:** ~$0.06-$0.16 (with prompt caching)

---

### Prompt Caching

Enabled on:
- ✅ ProfilerAgent (90% cost reduction)
- ✅ EvaluatorAgent (90% cost reduction)

**Cache Duration:** 5 minutes
**Savings:** ~$0.05-$0.10 per iteration after first call

---

## Migration from Previous Versions

### From v1.0 to v1.3

**Breaking Changes:** None

**New Features:**
1. SearchSploit integration (automatic)
2. RAG memory support (opt-in)
3. Evaluation loop (opt-in)

**Migration Steps:**
1. Update .env with new variables (see Full Configuration example)
2. Rebuild project: `npm run build`
3. Test with: `npm start` → `recon <target>`

**Backward Compatibility:** ✅ Full
- All new features are optional
- Default configuration matches v1.0 behavior
- No code changes required

---

## Next Steps

1. **Install SearchSploit:** `sudo apt install exploitdb`
2. **Build SearchSploit Server:** See pentest-mcp-server repository
3. **Set up RAG Memory:** See pentest-rag-memory repository (optional)
4. **Enable Evaluation:** Set `ENABLE_EVALUATION=true` and run reconnaissance
5. **Review Logs:** Check `./logs/training_data/` and `./logs/sessions/`

---

**Last Updated:** 2026-02-06
**Architecture Version:** 1.3
