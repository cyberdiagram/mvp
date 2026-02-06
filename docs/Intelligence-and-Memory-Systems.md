# Intelligence Layer & Memory Systems - Complete Guide

**Document Version**: 1.0
**Created**: 2026-02-06
**Last Updated**: 2026-02-06
**Status**: Phase 1-5 Complete, Phase 6-7 Planned

---

## Document History

| Date | Version | Changes |
|------|---------|---------|
| 2026-02-05 | 0.1 | Memory Manager design (initial) |
| 2026-02-06 | 0.5 | RAG Memory System integration points added |
| 2026-02-06 | 1.0 | Phase 5 Tactical Planning completed, documents merged |

---

## Table of Contents

1. [Overview](#overview)
2. [Part I: Memory Manager (Short-Term Rules)](#part-i-memory-manager-short-term-rules)
3. [Part II: RAG Memory System (Long-Term Learning)](#part-ii-rag-memory-system-long-term-learning)
4. [Part III: Tactical Planning with Intelligence](#part-iii-tactical-planning-with-intelligence)
5. [Implementation Status](#implementation-status)
6. [Future Enhancements](#future-enhancements)

---

## Overview

This document covers three interconnected memory and intelligence systems in the MVP pentest agent:

### System Comparison

| System | Type | Storage | Purpose | Phase |
|--------|------|---------|---------|-------|
| **Memory Manager** | Short-term rules | agent_rules.json | User preferences (tools, flags) | ✅ v1.0 |
| **RAG Memory System** | Long-term learning | ChromaDB vectors | Anti-patterns from failures | ✅ Integration points ready |
| **Intelligence Layer** | Real-time enrichment | In-memory context | Target profiling, vulnerabilities | ✅ Phase 1-5 complete |

### Architecture Overview

```
┌──────────────────────────────────────────────────────────────────┐
│                     USER PREFERENCES                              │
│                   (Memory Manager)                                │
│  "remember nmap use -Pn" → agent_rules.json → Reasoner Context   │
└──────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────────────┐
│                  LONG-TERM MEMORY                                 │
│                 (RAG Memory System)                               │
│  Session Logs → ETL Pipeline → ChromaDB → Anti-pattern Warnings  │
└──────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────────────┐
│                 REAL-TIME INTELLIGENCE                            │
│              (Intelligence Layer + Tactical Planning)             │
│  Services → Profile → Vulnerabilities → Tactical Plans           │
└──────────────────────────────────────────────────────────────────┘
```

---

# Part I: Memory Manager (Short-Term Rules)

**Version**: 1.1
**Date**: 2026-02-05
**Status**: ✅ Production

## Overview

The Memory Manager is a CLAUDE.md-style context injection system that allows users to teach the agent their preferences for tool usage. This follows Anthropic's Claude Code architecture pattern of "soft prompts over hard code".

## Problem Statement

When users want to customize tool behavior (e.g., "always use `-Pn` with nmap after host discovery"), there was no way to persist this preference without modifying source code. This required:
- Editing MCP server code for each new parameter
- Rebuilding and redeploying
- No user visibility into what rules exist

## Solution Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                      User Command                             │
│         "remember nmap always use -Pn after discovery"       │
└──────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────────┐
│                    Memory Manager API                         │
│  addRule(tool: string, rule: string): void                  │
│  removeRule(tool: string): void                             │
│  listRules(tool?: string): Record<string, string[]>         │
└──────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────────┐
│                    agent_rules.json                           │
│  {                                                           │
│    "nmap": [                                                 │
│      "After host discovery, use -Pn in all subsequent scans" │
│    ]                                                         │
│  }                                                           │
└──────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────────┐
│                  Reasoner System Prompt                       │
│  # Tool Preferences (IMPORTANT - Follow these rules)        │
│  ## nmap                                                     │
│  - After host discovery, use -Pn in all subsequent scans    │
└──────────────────────────────────────────────────────────────┘
```

## Interactive Commands

| Command | Description | Example |
|---------|-------------|---------|
| `remember <tool> <rule>` | Save a tool preference | `remember nmap use -Pn` |
| `forget <tool>` | Clear all rules for tool | `forget nmap` |
| `rules [tool]` | List saved rules | `rules` or `rules nmap` |

## API Reference

### SkillsLoader.addRule(toolName, rule)

Adds a new preference rule for a tool.

**Parameters**:
- `toolName` (string) - Tool identifier (e.g., "nmap", "gobuster")
- `rule` (string) - Rule description

**Behavior**:
- Creates tool entry if doesn't exist
- Skips duplicate rules
- Persists to agent_rules.json immediately

### SkillsLoader.removeRule(toolName)

Removes all rules for a tool.

**Parameters**:
- `toolName` (string) - Tool identifier

**Returns**: `boolean` - true if removed, false if not found

### SkillsLoader.listRules(toolName?)

Lists rules for a tool or all tools.

**Parameters**:
- `toolName` (string, optional) - Tool to list rules for

**Returns**: `Record<string, string[]>` - Map of tool names to rule arrays

## File Format

**agent_rules.json**:
```json
{
  "nmap": [
    "After host discovery confirms host is up, ALL subsequent scans MUST include -Pn",
    "Use -T4 timing template for faster scans in lab environments"
  ],
  "gobuster": [
    "Use -t 50 for concurrent threads",
    "Always use -x php,html,txt for common extensions"
  ]
}
```

## Usage Examples

### Speed Optimization
```
> remember nmap use -T4 for faster scans
✓ Rule saved for nmap

> remember nmap use --min-rate=1000 for fast host discovery
✓ Rule saved for nmap
```

### Stealth Mode
```
> remember nmap use -T2 polite timing to avoid detection
✓ Rule saved for nmap

> remember nmap fragment packets with -f
✓ Rule saved for nmap
```

### Clearing Rules
```
> forget nmap
✓ Cleared all rules for nmap
```

---

# Part II: RAG Memory System (Long-Term Learning)

**Version**: 1.0 (Integration Points)
**Date**: 2026-02-06
**Status**: ✅ Ready for RAG MCP Server

## Overview

The RAG (Retrieval-Augmented Generation) Memory System enables the agent to learn from past failures and human interventions, preventing repeated mistakes across sessions.

**Status**: Phase 4b integration points implemented in main agent. RAG Memory MCP Server is a separate repository: `pentest-rag-memory`

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Main Agent (mvp)                         │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  1. Session Logger                                   │   │
│  │     - Logs each step to JSONL                        │   │
│  │     - Location: logs/sessions/<session_id>.jsonl    │   │
│  └──────────────────────────────────────────────────────┘   │
│                          │                                   │
│                          ▼                                   │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  2. RAG Memory Recall (via MCP)                      │   │
│  │     - Query: rag_recall(observation)                 │   │
│  │     - Returns: Anti-pattern warnings                 │   │
│  │     - Injected into Reasoner context                 │   │
│  └──────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│            RAG Memory System (pentest-rag-memory)           │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  ETL Pipeline                                        │   │
│  │  1. Extractor - Read JSONL logs                      │   │
│  │  2. Transformer - DeepSeek generalizes patterns      │   │
│  │  3. Loader - Store in ChromaDB                       │   │
│  └──────────────────────────────────────────────────────┘   │
│                          │                                   │
│                          ▼                                   │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  ChromaDB Vector Store                               │   │
│  │  Collections:                                        │   │
│  │  - anti_patterns (failures to avoid)                 │   │
│  │  - playbooks (successes to replicate)               │   │
│  │  - tool_preferences (learned configurations)        │   │
│  └──────────────────────────────────────────────────────┘   │
│                          │                                   │
│                          ▼                                   │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  RAG MCP Server                                      │   │
│  │  Tools:                                              │   │
│  │  - rag_recall(observation) → warnings                │   │
│  │  - rag_learn(pattern) → store manually              │   │
│  └──────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

## Data Flow

### 1. Session Logging (Implemented ✅)

Each agent step is logged to JSONL format:

**Location**: `logs/sessions/<session_id>.jsonl`

**Format** (SessionStep interface):
```json
{
  "session_id": "session_1738012345_abc123",
  "step_index": 5,
  "timestamp": "2026-02-06T10:30:00Z",
  "role": "agent",
  "observation": {
    "last_tool_output": "Found 3 open ports...",
    "open_ports": [22, 80, 443]
  },
  "thought_process": {
    "analysis": "SSH port 22 is open",
    "reasoning": "Should brute-force SSH",
    "plan": "Run hydra with rockyou.txt"
  },
  "action": {
    "tool_name": "hydra",
    "tool_args": { "target": "192.168.1.10", "port": 22 }
  },
  "result": "Connection blocked by fail2ban",
  "outcome_label": "failed"
}
```

### 2. RAG Memory Recall (Integration Point ✅)

Before each Reasoner decision, query RAG memory:

```typescript
// In PentestAgent.reconnaissance()
const memoryRecall = await this.mcpAgent.executeTool({
  tool: 'rag_recall',
  arguments: {
    observation: 'SSH port 22 found on target',
    top_k: 3
  }
});

// Returns formatted warnings:
// [MEMORY RECALL - WARNINGS FROM PAST EXPERIENCE]
//
// [ANTI-PATTERN WARNING]
// Scenario: SSH, port 22, remote access
// ⛔ AVOID: Immediately brute-forcing SSH with wordlists
// ⚠️ RISK: Fail2ban will block your IP after 3-5 attempts
// ✅ SUGGESTION: Check for SSH key auth, look for exposed keys
```

### 3. ETL Pipeline (Separate Repo)

The RAG Memory System processes session logs:

```bash
# In pentest-rag-memory repo
npm run etl -- --input ../mvp/logs/sessions/session_*.jsonl

# Process:
# 1. Extract failures (outcome_label: "failed")
# 2. Transform with DeepSeek (generalize patterns)
# 3. Load into ChromaDB (vector embeddings)
```

## Pre-Seeded Anti-Patterns

The RAG system comes with 7 initial anti-patterns:

1. **Login brute-force** — Check logic flaws, default creds first
2. **Noisy initial scans** — Start quiet, expand based on findings
3. **SSH brute-force** — Fail2ban blocks after 3-5 attempts
4. **SQL injection noise** — Confirm manually before sqlmap
5. **SMB null session** — Always try guest access first
6. **Web directory overload** — Use small wordlists, check robots.txt
7. **Privilege escalation rush** — Manual enum before automated tools

## RAG MCP Server Interface

### Tool: rag_recall

Query relevant memories before decision-making:

```typescript
{
  name: 'rag_recall',
  inputSchema: {
    observation: 'Current scenario description',
    thought: 'Current reasoning (optional)',
    top_k: 3  // Number of memories to recall
  }
}
```

### Tool: rag_learn

Manually teach new patterns (human-in-the-loop):

```typescript
{
  name: 'rag_learn',
  inputSchema: {
    scenario: 'Trigger scenario',
    anti_pattern: 'What NOT to do',
    consequence: 'Bad outcome',
    suggestion: 'What to do instead'
  }
}
```

## Setup Instructions

### Main Agent (Already Configured ✅)

Session logging is ready to use:

```bash
# Environment variables (optional)
export RAG_MEMORY_SERVER_PATH="/path/to/pentest-rag-memory/dist/server/index.js"
```

### RAG Memory System (Separate Repo)

```bash
# Clone the RAG memory system repository
cd ..
git clone <pentest-rag-memory-repo-url>
cd pentest-rag-memory

# Install dependencies
npm install

# Set up environment
export DEEPSEEK_API_KEY="sk-xxx"  # For ETL transformation
export CHROMADB_PATH="./data/chromadb"  # Vector database location

# Seed initial anti-patterns (7 pre-built patterns)
npm run seed

# Build MCP server
npm run build

# Start MCP server (for rag_recall tool)
npm start
```

## Cost Analysis

**Runtime Costs**:
- RAG Memory Recall: Free (local ChromaDB query, <100ms)
- Session Logging: Free (local JSONL write)

**ETL Costs**:
- DeepSeek Transformer: ~$0.01-0.05 per session
- ChromaDB: Free (local storage)

---

# Part III: Tactical Planning with Intelligence

**Version**: 1.0 (Phase 5)
**Date**: 2026-02-06
**Status**: ✅ Complete

## Overview

Phase 5 enhances the ReasonerAgent with intelligence-driven tactical planning capabilities. The Reasoner now:
- Consumes intelligence context (profiles, vulnerabilities)
- Generates structured tactical plans with attack vectors
- Includes prediction metrics for evaluation
- Integrates RAG memory warnings to avoid past mistakes

## Intelligence Context Flow

```
Services Discovery → DataCleaner (Enrichment)
                          ↓
                    DiscoveredService[]
                          ↓
        ┌─────────────────┴─────────────────┐
        ▼                                   ▼
  ProfilerAgent                      VulnLookupAgent
  (OS, tech stack,                  (CVEs, exploits via
   security posture)                 SearchSploit MCP)
        │                                   │
        └─────────────────┬─────────────────┘
                          ▼
                  IntelligenceContext
                          ↓
              ReasonerAgent.setIntelligenceContext()
                          ↓
                  System Prompt Injection
                          ↓
              Tactical Plan Generation
```

## Enhanced Reasoner Capabilities

### 1. Intelligence Context Injection

**New Methods**:
```typescript
// Set intelligence context for informed decisions
setIntelligenceContext(intelligence: IntelligenceContext | null): void

// Inject RAG memory warnings from past failures
injectMemoryContext(memoryRecall: string): void
```

**Injected Intelligence Format**:
```markdown
# Current Intelligence Context

## Target Profile
- OS: Linux (Ubuntu 20.04)
- Tech Stack: Apache, MySQL, PHP
- Security Posture: standard
- Risk Level: medium
- Evidence: OpenSSH 8.2 indicates Ubuntu 20.04

## Discovered Services (5 total)
**High Criticality:**
- 192.168.1.10:22 - ssh (OpenSSH 8.2p1) [remote-access]
- 192.168.1.10:3306 - mysql (MySQL 8.0.23) [database]

## Known Vulnerabilities (3 found)
**CVE-2021-41773** (critical):
- Apache 2.4.49 Path Traversal RCE
- PoC Available: /usr/share/exploitdb/exploits/linux/webapps/50383.py
- ExploitDB ID: 50383
```

### 2. Tactical Plan Output

**Example Response**:
```json
{
  "thought": "Apache 2.4.49 vulnerable to CVE-2021-41773 path traversal RCE",
  "action": "Exploit Apache vulnerability with available PoC",
  "tool": "exploit_runner",
  "arguments": { "target": "192.168.1.10", "port": 80 },

  "tactical_plan": {
    "plan_id": "plan_1738012345_abc123",
    "target_ip": "192.168.1.10",
    "context_hash": "sha256_of_intelligence_context",
    "attack_vectors": [
      {
        "vector_id": "vec_01",
        "priority": 1,
        "action": {
          "tool_name": "exploit_runner",
          "command_template": "python3 exploits/cve-2021-41773.py --target {target}",
          "parameters": { "target": "192.168.1.10", "port": 80 },
          "timeout_seconds": 30
        },
        "prediction_metrics": {
          "classification": {
            "attack_type": "RCE",
            "mitre_id": "T1190",
            "cve_id": "CVE-2021-41773"
          },
          "hypothesis": {
            "confidence_score": 0.85,
            "rationale_tags": ["apache_2.4.49", "path_traversal", "linux_target"],
            "expected_success": true
          },
          "success_criteria": {
            "match_type": "regex_match",
            "match_pattern": "(root:|uid=0|vulnerable)",
            "negative_pattern": "(404 Not Found|Connection refused)"
          }
        }
      }
    ],
    "created_at": "2026-02-06T10:30:00Z"
  }
}
```

### 3. Adaptive Tactics

The Reasoner adjusts approach based on intelligence:

**Hardened Target** (security_posture: "hardened"):
- Avoid noisy scans
- Use passive techniques
- Focus on stealth

**Weak Target** (security_posture: "weak"):
- Aggressive enumeration safe
- Can try multiple exploits
- Higher confidence in success

**High-Value Target** (risk_level: "high-value"):
- Priority targeting
- Database servers, domain controllers
- More thorough exploitation

### 4. Prediction Metrics

Tactical plans include metrics for automated evaluation:

**Classification**:
- `attack_type`: RCE, SQLi, XSS, LFI, etc.
- `mitre_id`: MITRE ATT&CK technique ID
- `cve_id`: Associated CVE if applicable

**Hypothesis**:
- `confidence_score`: 0-1 score for expected success
- `rationale_tags`: Keywords explaining prediction
- `expected_success`: Boolean prediction

**Success Criteria**:
- `match_type`: How to detect success (regex, contains, status_code)
- `match_pattern`: Pattern indicating success
- `negative_pattern`: Pattern indicating failure

**Purpose**: Enable Phase 6 Evaluator to label outcomes as TP/FP/FN/TN.

## Integration Example

```typescript
// Intelligence Layer execution
const intelligence = {
  discoveredServices: await dataCleaner.clean(nmapOutput),
  targetProfile: await profiler.profile(services),
  vulnerabilities: await vulnLookup.findVulnerabilities(services, profile)
};

// Inject into Reasoner
reasoner.setIntelligenceContext(intelligence);

// Optional: RAG memory recall
const memoryWarnings = await ragMcpServer.recall(observation);
reasoner.injectMemoryContext(memoryWarnings);

// Make decision with full context
const decision = await reasoner.reason(observation);

// decision.tactical_plan contains attack vectors with predictions
```

## Backward Compatibility

**Maintained**: Standard reconnaissance flow (no tactical plan required)

**Simple Response** (reconnaissance phase):
```json
{
  "thought": "Need to discover live hosts first",
  "action": "Scan network for alive hosts",
  "tool": "nmap_host_discovery",
  "arguments": { "target": "192.168.1.0/24" },
  "is_complete": false
  // No tactical_plan during reconnaissance
}
```

## Cost Impact

**Token Usage**:
- Base prompt: +300 tokens (cached)
- Intelligence context: +200-500 tokens per iteration
- Response: +200-500 tokens (tactical plans)
- **Total increase**: ~22% (~$0.01 more per iteration)

**Justification**: Intelligence-driven decisions reduce failed attempts, saving overall cost.

---

# Implementation Status

## ✅ Complete (Phase 1-5)

| Phase | Component | Status | Date |
|-------|-----------|--------|------|
| **N/A** | Memory Manager | ✅ Production | 2026-02-05 |
| **1** | Data Schema | ✅ Complete | 2026-02-06 |
| **2** | Enhanced DataCleaner | ✅ Complete | 2026-02-06 |
| **3** | ProfilerAgent | ✅ Complete | 2026-02-06 |
| **4a** | VulnLookupAgent | ✅ Complete | 2026-02-06 |
| **4b** | RAG Integration Points | ✅ Complete | 2026-02-06 |
| **5** | Tactical Planning | ✅ Complete | 2026-02-06 |

## ⏳ Planned (Phase 6-7)

| Phase | Component | Status | Est. Date |
|-------|-----------|--------|-----------|
| **6** | Evaluator Agent | ⏳ Planned | TBD |
| **7** | Orchestrator Integration | ⏳ Planned | TBD |

## 📦 External Dependencies

**pentest-mcp-server**:
- ✅ Nmap MCP Server (Complete)
- ✅ SearchSploit MCP Server (Complete)

**pentest-rag-memory** (Separate Repo):
- ✅ Phase 1: Type definitions, ChromaDB client, seed data (Complete)
- ⏳ Phase 2: ETL pipeline (Planned)
- ⏳ Phase 3: RAG MCP server (Planned)

---

# Future Enhancements

## Memory Manager

1. **Rule Expiration** - Time-based rules (e.g., "use -T4 for this session only")
2. **Rule Priority** - High/medium/low priority for conflicting rules
3. **Rule Conditions** - Conditional rules (e.g., "use -Pn only after host discovery")
4. **Rule Export/Import** - Share rule sets between projects
5. **Natural Language Parsing** - Better detection of memory commands
6. **Rule Templates** - Pre-built rule sets for common scenarios (stealth, speed, CTF)

## RAG Memory System

1. **Automatic ETL**: Run ETL pipeline after each session
2. **Playbook Collection**: Learn from successes, not just failures
3. **Cross-Session Analytics**: Dashboard for pattern effectiveness
4. **PDF Report ETL**: Import knowledge from pentest writeups
5. **Confidence Calibration**: Adjust Reasoner based on memory feedback

## Tactical Planning

1. **Multi-Vector Optimization**: Parallel attack execution
2. **Adaptive Confidence**: Adjust predictions based on historical accuracy
3. **MITRE ATT&CK Mapping**: Full technique coverage and reporting
4. **Exploit Chain Planning**: Multi-stage attack coordination
5. **Resource Management**: CPU/memory limits for exploit execution

---

# References

- **Main Repository**: `mvp` (this repo)
- **RAG Memory Repository**: `pentest-rag-memory` (separate)
- **Architecture Plan**: `docs/Final_Architecture_Plan_with_Evaluation_Loop-0204-from-claude.md`
- **CLAUDE.md**: Development guidelines and architecture overview

---

# Summary

This document describes three memory and intelligence systems working together:

1. **Memory Manager** (✅ Production): User preferences for immediate tool behavior
2. **RAG Memory System** (✅ Integration ready): Long-term learning from failures
3. **Intelligence Layer** (✅ Complete): Real-time target profiling and tactical planning

Together, these systems enable the agent to:
- Remember user preferences across sessions
- Learn from past mistakes automatically
- Make intelligence-driven attack decisions
- Predict outcomes with measurable confidence
- Continuously improve through evaluation feedback

**Status**: Foundation complete (Phase 1-5), ready for evaluation and orchestrator integration (Phase 6-7).
