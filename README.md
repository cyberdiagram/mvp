# MVP - AI-Powered Penetration Testing Agent

![Visitors](https://api.visitorbadge.io/api/visitors?path=flashoop/mvp&label=VISITORS&countColor=%23263238)

> **Last Updated:** 2026-02-08
> **Architecture Version:** 2.2 (Observability & Safety Hardening)
> **Latest Feature:** Langfuse Tracing, Duplicate Operation Detection, Database Exhaustion Detection, Dynamic Tool Whitelist, RAG Memory Refactoring, OS Detection (2026-02-08)

An AI-powered penetration testing agent using Claude AI with a hierarchical multi-agent architecture, Intelligence Layer for target profiling, Evaluation Loop for continuous improvement, and RAG Memory System that queries security playbooks (successful techniques) and anti-patterns (failed exploits) from past experiences.

## Architecture

**Version**: 2.2 (Observability & Safety Hardening)
**Last Updated**: 2026-02-08

### Overview

```
┌────────────────────────────────────────────────────────────────────────┐
│                          ORCHESTRATOR (v2.0)                           │
│                    (src/agent/core/orchestrator.ts)                    │
│         Layered Architecture + Intelligence + Evaluation + RAG         │
│              Incremental Analysis + Retry with Backoff                 │
└────────────────────────────────────────────────────────────────────────┘
                                    │
        ┌───────────────────────────┼───────────────────────────┐
        │                           │                           │
        ▼                           ▼                           ▼
┌──────────────────┐    ┌──────────────────┐      ┌──────────────────┐
│ INTELLIGENCE     │    │   KNOWLEDGE      │      │   EXECUTION      │
│ (Brains)         │    │   (Memory)       │      │   (Hands)        │
├──────────────────┤    ├──────────────────┤      ├──────────────────┤
│ • Reasoner       │    │ • VulnLookup     │      │ • Executor       │
│   (Sonnet 4)     │◄───┤   (SearchSploit) │      │   (Haiku 4.5)    │
│   Strategic      │    │   CVE Research   │      │   Tactical       │
│   Planning       │    │                  │      │   Breakdown      │
│                  │    │ • RAG Memory     │      │                  │
│ • Profiler       │    │   (ChromaDB)     │      │ • MCP Agent      │
│   (Haiku 3.5)    │    │   Playbooks +    │      │   3 MCP Servers  │
│   Target         │    │   Anti-Patterns  │      │                  │
│   Analysis       │    │                  │      │ • Data Cleaner   │
│                  │    │                  │      │   (Haiku 4.5)    │
└──────────────────┘    └──────────────────┘      │   Output Parsing │
                                                   └──────────────────┘
        │                           │                           │
        └───────────────────────────┼───────────────────────────┘
                                    │
                                    ▼
                    ┌──────────────────────────────┐
                    │   UTILITIES & MONITORING     │
                    ├──────────────────────────────┤
                    │ • Skills Loader + Memory Mgr │
                    │ • Token Monitor (Cost Track) │
                    │ • Session Logger (JSONL ETL) │
                    │ • Evaluator (TP/FP/FN/TN)    │
                    └──────────────────────────────┘
                                    │
                                    ▼
                    ┌──────────────────────────────┐
                    │      MCP INTEGRATIONS        │
                    ├──────────────────────────────┤
                    │ • Nmap Server (Recon)        │
                    │ • SearchSploit Server (CVEs) │
                    │ • RAG Memory Server (Learn)  │
                    └──────────────────────────────┘
```

**Key Features (v2.2)**:
- ✅ **Layered Architecture**: 5 layers (core, intelligence, knowledge, execution, utils)
- ✅ **Langfuse Observability**: OpenTelemetry-based tracing for all reconnaissance phases via Langfuse
- ✅ **Duplicate Operation Detection**: Tracks command signatures to prevent repeated identical tool calls with `[SYSTEM INTERVENTION - LOOP DETECTED]` warnings
- ✅ **Database Exhaustion Detection**: Detects when all queries return empty results and injects `[SYSTEM ADVICE - DATABASE EXHAUSTION]` to redirect the Reasoner
- ✅ **Dynamic Tool Whitelist**: `ALLOWED_TOOLS` loaded from `src/config/allowed_tools.json` (single source of truth) with tactical plan + LLM validation
- ✅ **RAG Memory Refactoring**: Two semantically distinct interfaces — `recallInternalWarnings` (Phase 0) and `searchHandbook` (Phase 4b) — replacing raw MCP calls
- ✅ **OS Detection**: `nmap_os_detection` tool added across server, client SDK, and agent layers
- ✅ **Incremental Intelligence**: Only analyzes NEW services, merges results intelligently
- ✅ **Retry Mechanism**: Exponential backoff (max 2 retries) for transient failures
- ✅ **3 MCP Servers**: Nmap, SearchSploit, RAG Memory with unified tool routing
- ✅ **Tactical Plan Passthrough**: Executor uses Reasoner's tactical plan directly, bypassing LLM re-planning
- ✅ **Explicit Failure Feedback**: Failed tool executions are reported to Reasoner with actionable context
- ✅ **Service Deduplication**: `host:port` dedup in execution loop prevents context bloat
- ✅ **Fingerprint Parsing Skills**: Dynamic skill injection into DataCleaner for technology identification

### Layered Architecture Components

| Layer | Agent | Model | Purpose |
|-------|-------|-------|---------|
| **Core** | Orchestrator | - | Main coordinator (1,360 lines, 8 phases + 2 utilities) |
| **Intelligence** | Reasoner | Sonnet 4 | **STRATEGIC** planning - decides WHAT to do and WHY |
| **Intelligence** | Profiler | Haiku 3.5 | Target profiling (OS, tech stack, security posture) |
| **Knowledge** | VulnLookup | - | Exploit research via SearchSploit MCP (offline CVE database) |
| **Knowledge** | RAG Memory | - | Retrieves playbooks & anti-patterns from past penetration tests |
| **Execution** | Executor | Haiku 4.5 | **TACTICAL** execution - decides HOW (tool whitelist + plan passthrough) |
| **Execution** | MCP Agent | - | Executes security tools via 3 MCP servers (Nmap, SearchSploit, RAG) |
| **Execution** | Data Cleaner | Haiku 4.5 | Parses & enriches output (skill-injected fingerprinting + confidence) |
| **Utilities** | Skills Loader | - | Dynamic skill loading + Memory Manager (tool preferences) |
| **Utilities** | Token Monitor | - | Tracks token consumption and costs per agent/model |
| **Utilities** | Session Logger | - | JSONL logging for RAG Memory ETL pipeline (training data) |
| **Utilities** | Evaluator | Haiku 3.5 | Post-execution evaluation (TP/FP/FN/TN ground truth labeling) |

### Intelligence Layer Features (Phase 1-7 ✅)

The Intelligence Layer enriches reconnaissance data with:



1. **Service Enrichment** (Data Cleaner):
   - Service categorization (web, database, remote-access, etc.)
   - Confidence scoring (0-1 based on detection reliability)
   - Criticality assessment (high, medium, low)
   - Product/version extraction from banners

2. **Target Profiling** (Profiler Agent):
   - OS fingerprinting (family and version)
   - Technology stack inference (LAMP, Windows Server, etc.)
   - Security posture assessment (hardened, standard, weak)
   - Risk level classification (high-value, medium, low)

3. **Vulnerability Research** (VulnLookup Agent):
   - Offline exploit lookup via SearchSploit MCP
   - CVE mapping with severity scores
   - PoC availability and local paths
   - Platform-aware filtering

4. **RAG Memory System** (RAG Memory Agent) - **NEW! 2026-02-06**:
   - Queries `security_playbooks` collection via MCP
   - **Playbooks** (type: `playbook`): Successful exploitation techniques with working payloads
   - **Anti-Patterns** (type: `anti_pattern`): Failed exploits with reasons and alternatives
   - Queries based on discovered services, CVEs, and target profile
   - Injects historical knowledge into Reasoner's context
   - Session logging in JSONL format for continuous learning
   - See: [docs/RAG-Memory-Integration-Guide.md](docs/RAG-Memory-Integration-Guide.md)

### Decision-Making Architecture: Strategic vs. Tactical

The system enforces a **strict separation of concerns** between strategic and tactical decision-making:

#### Reasoner (Strategic Layer)
- **Decides WHAT to do**: High-level goals and objectives
- **Decides WHY**: Justification based on intelligence context
- **Output**: Strategic actions like "Enumerate web services for vulnerabilities"
- **Does NOT**: Specify tool names, commands, or technical parameters

**Example Reasoner Output:**
```json
{
  "thought": "Target has HTTP/HTTPS services. Need to identify specific versions for vulnerability research.",
  "action": "Enumerate web service versions to identify potential vulnerabilities",
  "is_complete": false
}
```

#### Executor (Tactical Layer)
- **Decides HOW to execute**: Specific tools and parameters
- **Breaks down actions**: 1-N concrete tool steps
- **Output**: Ordered execution plan with tool calls
- **Uses**: Available tools list, target context, discovered data

**Example Executor Output:**
```json
{
  "steps": [
    {
      "tool": "nmap_service_detection",
      "arguments": { "target": "10.0.0.1", "ports": "80,443" },
      "description": "Detect HTTP/HTTPS service versions"
    }
  ],
  "current_step": 0,
  "status": "pending"
}
```

**Why This Separation Matters:**
- Allows Executor to break complex actions into multiple steps
- Prevents Reasoner from micromanaging tool selection
- Enables better prompt engineering (each agent has clear responsibilities)
- Facilitates testing and debugging (strategic vs. tactical failures)

## Project Structure

**✨ NEW: Layered Architecture (2026-02-07)**

The project has been refactored from a flat structure to a layered architecture following the "Brains-Knowledge-Hands" metaphor:

```
src/
├── index.ts                        # Interactive entry point
├── instrumentation.ts              # Langfuse/OpenTelemetry tracing setup
├── config/
│   ├── agent-config.ts            # Environment configuration
│   ├── allowed_tools.json          # Tool whitelist (single source of truth)
│   └── agent_rules.json            # Memory Manager rules (persistent)
├── skills/
│   ├── nmap_skill.md               # Nmap reconnaissance skill
│   └── fingerprint_parsing_skill.md # Technology fingerprinting rules (pfSense, WebLogic, etc.)
└── agent/
    ├── index.ts                    # Main agent barrel export
    │
    ├── core/                       # 🧠 ORCHESTRATION LAYER
    │   ├── orchestrator.ts        # PentestAgent class (main coordinator)
    │   ├── types.ts               # Global type definitions
    │   ├── index.ts               # Barrel export
    │   └── README.md              # Layer documentation
    │
    ├── intelligence/               # 🎯 DECISION & ANALYSIS (Brains)
    │   ├── reasoner.ts            # ReasonerAgent (Sonnet 4) - Strategic planning
    │   ├── profiler.ts            # ProfilerAgent (Haiku 3.5) - Target profiling
    │   ├── index.ts               # Barrel export
    │   └── README.md              # Layer documentation
    │
    ├── knowledge/                  # 📚 RETRIEVAL & MEMORY (Memory)
    │   ├── vuln-lookup.ts         # VulnLookupAgent (SearchSploit MCP)
    │   ├── rag-memory-agent.ts    # RAGMemoryAgent (ChromaDB MCP)
    │   ├── index.ts               # Barrel export
    │   └── README.md              # Layer documentation
    │
    ├── execution/                  # 🔨 TASK EXECUTION (Hands)
    │   ├── executor.ts            # ExecutorAgent (Haiku 4.5) - Tactical breakdown
    │   ├── mcp-agent.ts           # MCPAgent - Tool execution via MCP
    │   ├── data-cleaner.ts        # DataCleanerAgent (Haiku 4.5) - Output parsing
    │   ├── index.ts               # Barrel export
    │   └── README.md              # Layer documentation
    │
    ├── utils/                      # 🛠️ SUPPORT & INFRASTRUCTURE
    │   ├── skills-loader.ts       # SkillsLoader + Memory Manager
    │   ├── token-monitor.ts       # Token consumption tracking
    │   ├── session-logger.ts      # JSONL session logger
    │   ├── index.ts               # Barrel export
    │   └── README.md              # Layer documentation
    │
    └── definitions/                # ⏳ LEGACY (Phase 6 migration pending)
        ├── evaluator.ts           # EvaluatorAgent (Haiku 3.5)
        └── index.ts               # Exports

logs/
├── sessions/                       # JSONL session logs for RAG ETL
└── training_data/                  # Training pairs (JSON) for RLHF

docs/
├── Intelligence-and-Memory-Systems.md  # Unified documentation
└── Final_Architecture_Plan_with_Evaluation_Loop-0204-from-claude.md
```

**Layer Responsibilities:**

- **Core**: Orchestration and shared type system
- **Intelligence**: Strategic decision-making and target analysis
- **Knowledge**: Vulnerability research and memory retrieval
- **Execution**: Tactical breakdown and tool execution
- **Utils**: Infrastructure (skills, logging, monitoring)

## Setup

### Prerequisites

- Node.js 18+
- nmap installed on system
- Anthropic API key

### Install Dependencies

```bash
npm install
```

### MCP Client Setup (yalc)

```bash
# Install yalc globally
npm install -g yalc

# In the mcp-nmap-client repo:
npm run build && yalc publish

# In this repo:
yalc add @cyber/mcp-nmap-client
npm install
```

### Environment Variables

```bash
# Required
export ANTHROPIC_API_KEY="your-api-key"

# Optional MCP Server Paths (defaults provided if not set)
export NMAP_SERVER_PATH="/path/to/pentest-mcp-server/nmap-server-ts/dist/index.js"
export SEARCHSPLOIT_SERVER_PATH="/path/to/pentest-mcp-server/searchsploit-server-ts/dist/index.js"
export RAG_MEMORY_SERVER_PATH="/path/to/pentest-rag-memory/dist/server/index.js"

# Evaluation & Training (optional)
export ENABLE_EVALUATION="true"             # Enable evaluation loop
export TRAINING_DATA_PATH="./logs/training_data"  # Training pairs storage

# RAG Memory System (optional)
export ENABLE_RAG_MEMORY="true"             # Enable RAG memory recall
export DEEPSEEK_API_KEY="sk-xxx"            # For ETL transformation
export CHROMADB_PATH="./data/chromadb"      # Vector database location

# Langfuse Observability (optional)
export LANGFUSE_SECRET_KEY="sk-lf-xxx"      # Langfuse secret key
export LANGFUSE_PUBLIC_KEY="pk-lf-xxx"      # Langfuse public key
export LANGFUSE_BASE_URL="https://cloud.langfuse.com"  # Langfuse endpoint (default)
```

## Usage

```bash
# Build
npm run build

# Start the agent (interactive mode)
npm start
```

### Interactive Commands

When the agent starts, you'll see an interactive prompt:

```
  ██████╗ ███████╗███╗   ██╗████████╗███████╗███████╗████████╗
  ██╔══██╗██╔════╝████╗  ██║╚══██╔══╝██╔════╝██╔════╝╚══██╔══╝
  ██████╔╝█████╗  ██╔██╗ ██║   ██║   █████╗  ███████╗   ██║
  ██╔═══╝ ██╔══╝  ██║╚██╗██║   ██║   ██╔══╝  ╚════██║   ██║
  ██║     ███████╗██║ ╚████║   ██║   ███████╗███████║   ██║
  ╚═╝     ╚══════╝╚═╝  ╚═══╝   ╚═╝   ╚══════╝╚══════╝   ╚═╝
                    AI-Powered Penetration Testing Agent v1.1

>
```

| Command | Description | Example |
|---------|-------------|---------|
| `recon <target>` | Run reconnaissance on target | `recon 192.168.1.0/24` |
| `remember <tool> <rule>` | Save a tool preference | `remember nmap use -Pn` |
| `forget <tool>` | Clear all preferences for a tool | `forget nmap` |
| `rules [tool]` | List saved preferences | `rules` or `rules nmap` |
| `help` | Show help message | `help` |
| `exit` | Quit the application | `exit` |
| `<IP or hostname>` | Auto-run recon on target | `192.168.1.10` |

## Memory Manager

The Memory Manager allows you to teach the agent your preferences. Rules are persisted to `agent_rules.json` and automatically injected into the AI's context.

### How It Works

```
┌─────────────────────────────────────────────────────────────────┐
│                         User Command                             │
│         "remember nmap always use -Pn after discovery"          │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Memory Manager                                │
│  Saves to: src/config/agent_rules.json                          │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                 Reasoner Context Injection                       │
│                                                                  │
│  # Tool Preferences (IMPORTANT - Follow these rules)            │
│  ## nmap                                                        │
│  - always use -Pn after discovery                               │
└─────────────────────────────────────────────────────────────────┘
```

### Example Usage

**Adding a preference:**
```
> remember nmap always use -Pn after host discovery
  ✓ Rule saved for nmap: "always use -Pn after host discovery"
```

**Adding multiple preferences:**
```
> remember nmap use -T4 for faster scans
  ✓ Rule saved for nmap: "use -T4 for faster scans"

> remember gobuster use -t 50 threads for speed
  ✓ Rule saved for gobuster: "use -t 50 threads for speed"
```

**Viewing saved rules:**
```
> rules

  Saved Rules:
  ──────────────────────────────────────────────────

  nmap:
    0. always use -Pn after host discovery
    1. use -T4 for faster scans

  gobuster:
    0. use -t 50 threads for speed
```

**Clearing rules for a tool:**
```
> forget nmap
  ✓ Cleared 2 rule(s) for nmap
```

### Rules File Format

Rules are stored in `src/config/agent_rules.json`:

```json
{
  "nmap": [
    "always use -Pn after host discovery",
    "use -T4 for faster scans"
  ],
  "gobuster": [
    "use -t 50 threads for speed"
  ]
}
```

You can also edit this file directly - changes take effect on next command.

## Development

```bash
# Build and run
npm run dev

# Build only
npm run build
```

## Intelligence Layer

### Overview

The Intelligence Layer transforms raw reconnaissance data into actionable intelligence through a multi-stage enrichment pipeline:

**Stage 1: Service Enrichment** (Data Cleaner)
```typescript
// Input: Raw Nmap output
"22/tcp   open  ssh     OpenSSH 8.2p1 Ubuntu"

// Output: DiscoveredService
{
  host: "192.168.1.10",
  port: 22,
  service: "ssh",
  product: "OpenSSH",
  version: "8.2p1",
  category: "remote-access",
  criticality: "high",
  confidence: 1.0
}
```

**Stage 2: Target Profiling** (Profiler Agent)
```typescript
// Analyzes services to generate:
{
  os_family: "Linux",
  os_version: "Ubuntu 20.04",
  tech_stack: ["SSH", "Apache", "MySQL"],
  security_posture: "standard",
  risk_level: "medium",
  evidence: ["OpenSSH 8.2 indicates Ubuntu 20.04", "Standard service set"]
}
```

**Stage 3: Vulnerability Research** (VulnLookup Agent)
```typescript
// Searches local ExploitDB via SearchSploit MCP:
{
  cve_id: "CVE-2021-41773",
  severity: "critical",
  description: "Apache 2.4.49 Path Traversal RCE",
  affected_service: "Apache 2.4.49",
  poc_available: true,
  poc_url: "/usr/share/exploitdb/exploits/linux/webapps/50383.py",
  exploitdb_id: "50383"
}
```

**Stage 4: RAG Memory Recall** (Optional)
```
[MEMORY RECALL - WARNINGS FROM PAST EXPERIENCE]

[ANTI-PATTERN WARNING]
Scenario: SSH, port 22, remote access
⛔ AVOID: Immediately brute-forcing SSH with wordlists
⚠️ RISK: Fail2ban will block your IP after 3-5 attempts
✅ SUGGESTION: Check for SSH key auth, look for exposed keys
```

**Stage 5: Tactical Planning** (Reasoner Output)
```typescript
// TacticalPlanObject - Complete attack plan with prediction metrics
{
  "plan_id": "plan_1738867200_a7b3c9d2e",
  "target_ip": "192.168.1.50",
  "context_hash": "sha256:3f4a9b2c1d8e...",
  "created_at": "2026-02-06T10:30:00.000Z",
  "attack_vectors": [
    {
      "vector_id": "vec_01",
      "priority": 1,
      "action": {
        "tool_name": "exploit_runner",
        "command_template": "python3 exploits/cve-2021-41773.py --target {target} --port {port}",
        "parameters": {
          "target": "192.168.1.50",
          "port": 80,
          "payload": "cat /etc/passwd"
        },
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
          "rationale_tags": [
            "apache_2.4.49",
            "path_traversal",
            "linux_target",
            "poc_available"
          ],
          "expected_success": true
        },
        "success_criteria": {
          "match_type": "regex_match",
          "match_pattern": "(root:x:0:0|uid=0|vulnerable)",
          "negative_pattern": "(404 Not Found|Connection refused|Forbidden)"
        }
      }
    },
    {
      "vector_id": "vec_02",
      "priority": 2,
      "action": {
        "tool_name": "sqlmap",
        "command_template": "sqlmap -u {url} --batch --level=2",
        "parameters": {
          "url": "http://192.168.1.50/login.php?id=1",
          "technique": "BEUSTQ",
          "threads": 4
        },
        "timeout_seconds": 60
      },
      "prediction_metrics": {
        "classification": {
          "attack_type": "SQLi",
          "mitre_id": "T1190",
          "cve_id": null
        },
        "hypothesis": {
          "confidence_score": 0.72,
          "rationale_tags": [
            "mysql_detected",
            "php_application",
            "parameter_vulnerable"
          ],
          "expected_success": true
        },
        "success_criteria": {
          "match_type": "contains",
          "match_pattern": "parameter is vulnerable",
          "negative_pattern": "all tested parameters do not appear to be injectable"
        }
      }
    },
    {
      "vector_id": "vec_03",
      "priority": 3,
      "action": {
        "tool_name": "hydra",
        "command_template": "hydra -L {userlist} -P {passlist} ssh://{target}",
        "parameters": {
          "target": "192.168.1.50",
          "userlist": "/usr/share/wordlists/users.txt",
          "passlist": "/usr/share/wordlists/rockyou-top1000.txt",
          "threads": 4
        },
        "timeout_seconds": 120
      },
      "prediction_metrics": {
        "classification": {
          "attack_type": "Brute Force",
          "mitre_id": "T1110",
          "cve_id": null
        },
        "hypothesis": {
          "confidence_score": 0.35,
          "rationale_tags": [
            "ssh_open",
            "weak_config",
            "limited_wordlist"
          ],
          "expected_success": false
        },
        "success_criteria": {
          "match_type": "regex_match",
          "match_pattern": "login:\\s+\\w+\\s+password:\\s+\\w+",
          "negative_pattern": "(blocked|refused|too many attempts)"
        }
      }
    }
  ]
}
```

**Key Features:**
- **Prioritized Attack Vectors**: Ordered by likelihood of success
- **Prediction Metrics**: Confidence scores and rationale for each attack
- **Success Criteria**: Automated evaluation patterns for outcome labeling
- **MITRE ATT&CK Mapping**: Each attack linked to tactics/techniques
- **Context Hash**: Tracks which intelligence was used for planning

**Stage 6: Evaluation Result** (After Execution)
```typescript
// EvaluationResult - Ground truth labeling by Evaluator Agent
{
  "vector_id": "vec_01",
  "prediction": {
    "classification": {
      "attack_type": "RCE",
      "mitre_id": "T1190",
      "cve_id": "CVE-2021-41773"
    },
    "hypothesis": {
      "confidence_score": 0.85,
      "rationale_tags": ["apache_2.4.49", "path_traversal", "linux_target", "poc_available"],
      "expected_success": true
    },
    "success_criteria": {
      "match_type": "regex_match",
      "match_pattern": "(root:x:0:0|uid=0|vulnerable)",
      "negative_pattern": "(404 Not Found|Connection refused|Forbidden)"
    }
  },
  "actual_output": "root:x:0:0:root:/root:/bin/bash\ndaemon:x:1:1:daemon:/usr/sbin:/usr/sbin/nologin\nbin:x:2:2:bin:/bin:/usr/sbin/nologin\nsys:x:3:3:sys:/dev:/usr/sbin/nologin\n...",
  "label": "true_positive",
  "reasoning": "The actual output contains 'root:x:0:0' which matches the success pattern. The exploit successfully achieved path traversal and read /etc/passwd, confirming the vulnerability. The prediction of expected_success=true with confidence 0.85 was accurate.",
  "confidence": 0.95,
  "timestamp": "2026-02-06T10:30:45.000Z"
}
```

**Evaluation Labels:**
- **true_positive**: Attack succeeded as predicted (model was correct)
- **false_positive**: Attack failed but was predicted to succeed (model was overconfident)
- **false_negative**: Attack succeeded but was predicted to fail (model underestimated)
- **true_negative**: Attack failed as predicted (model correctly assessed difficulty)

**Training Data Generation:**
The evaluation result is combined with the intelligence context to create training pairs for model improvement (RLHF/fine-tuning).

### SearchSploit MCP Server Setup

The VulnLookup agent requires the SearchSploit MCP Server:

```bash
# Install ExploitDB (if not installed)
sudo apt install exploitdb
# or: git clone https://gitlab.com/exploit-database/exploitdb.git

# Build SearchSploit MCP server
cd ../pentest-mcp-server/searchsploit-server-ts
npm install
npm run build

# The agent will automatically connect via MCP protocol
```

**Features:**
- Offline-capable (local ExploitDB database)
- No rate limits (local CLI tool)
- Instant exploit lookup by product/version/CVE
- Full PoC code examination via `searchsploit_examine`
- Local file paths via `searchsploit_path`

### RAG Memory System Setup

See [docs/RAG-Memory-Integration.md](docs/RAG-Memory-Integration.md) for full setup instructions.

**Quick Start:**
```bash
# Clone RAG memory repository
cd ..
git clone <pentest-rag-memory-repo-url>
cd pentest-rag-memory

# Install and seed
npm install
npm run seed  # Loads 7 initial anti-patterns

# Build and start MCP server
npm run build
npm start
```

**Main Agent Integration:**
Session logs are automatically written to `logs/sessions/<session_id>.jsonl` for RAG ETL processing.

## Testing MCP Integrations

### Testing RAG Memory Integration

**Prerequisites:**
- RAG Memory server built and ready
- At least one playbook or anti-pattern seeded in ChromaDB
- Environment variables configured

**Step 1: Start RAG Memory Server**
```bash
cd /home/leo/pentest-rag-memory
npm start
```

Expected output:
```
RAG Memory MCP Server running on stdio
ChromaDB initialized at ./data/chromadb
Collection 'security_playbooks' ready (7 documents)
```

**Step 2: Configure and Start Main Agent** (in another terminal)
```bash
cd /home/leo/mvp

# Set required environment variables
export ANTHROPIC_API_KEY="your-api-key"
export ENABLE_RAG_MEMORY="true"
export RAG_MEMORY_SERVER_PATH="/home/leo/pentest-rag-memory/dist/server/index.js"

# Optional: Set other MCP server paths
export NMAP_SERVER_PATH="/path/to/pentest-mcp-server/nmap-server-ts/dist/index.js"
export SEARCHSPLOIT_SERVER_PATH="/path/to/pentest-mcp-server/searchsploit-server-ts/dist/index.js"

# Start the agent
npm start
```

**Step 3: Test RAG Query**

At the agent prompt, run reconnaissance on a target:
```bash
> recon <target-with-pfsense-or-known-services>
```

**Expected Output:**

```
[Orchestrator] Initializing multi-agent system...
[Orchestrator] ✓ Skills loaded
[MCPAgent] ✓ Nmap server connected
[MCPAgent] ✓ SearchSploit server connected
[MCPAgent] ✓ RAG Memory server connected
[Orchestrator] Ready!
[Orchestrator] RAG Memory: Enabled (Playbooks + Anti-Patterns)

... (reconnaissance starts) ...

[Intelligence Layer] Starting parallel analysis...
[VulnLookup] Searching SearchSploit for: pfsense 2.3.1
[RAG Memory] Query: services: pfsense | vulnerabilities: CVE-2016-10709
[RAG Memory] ✓ Found 2 playbooks, 1 anti-patterns

[MEMORY RECALL - WARNINGS FROM PAST EXPERIENCE]
[ANTI-PATTERN WARNING 1/1]
⚠️ **Warning: Exploit-DB 39709**
Target: pfsense
Failure Reason: strict filtering
...

[KNOWN STRATEGIES - SIMILAR SCENARIOS]
[STRATEGY 1/2]
✅ **Strategy for pfsense**
Vulnerability: CVE-2016-10709
...
```

### Testing SearchSploit Integration

**Step 1: Verify ExploitDB Installed**
```bash
searchsploit --version
# Should show: SearchSploit - Exploit Database Archive Search
```

**Step 2: Start SearchSploit MCP Server** (if not already running)
```bash
cd /path/to/pentest-mcp-server/searchsploit-server-ts
npm run build
npm start
```

**Step 3: Test Vulnerability Lookup**

Run reconnaissance on a target with known services:
```bash
> recon <target-with-apache-or-other-services>
```

**Expected Output:**
```
[Intelligence Layer] Starting parallel analysis...
[VulnLookup] Searching SearchSploit for: apache 2.4.49
[VulnLookup] Found 3 exploits, 0 shellcodes for apache 2.4.49
[Profiler] ✓ Profile: Linux - standard
[VulnLookup] ✓ Found 3 vulnerabilities
  - CVE-2021-41773 (critical)
  - CVE-2021-42013 (critical)
  - CVE-2020-11984 (high)
```

### Testing Nmap Integration

**Step 1: Start Nmap MCP Server** (if not already running)
```bash
cd /path/to/pentest-mcp-server/nmap-server-ts
npm run build
npm start
```

**Step 2: Run Basic Reconnaissance**
```bash
> recon 192.168.1.1
```

**Expected Output:**
```
[Reasoner] 🧠 Planning reconnaissance for 192.168.1.1
[Executor] 📋 Breaking down into tool steps...
[MCPAgent] Executing: nmap_host_discovery
[MCPAgent] Executing: nmap_port_scan
[MCPAgent] Executing: nmap_service_detection
[DataCleaner] ✓ Parsed 5 open ports
```

### Verifying All 3 MCP Servers

**Full Integration Test:**

```bash
# Terminal 1: RAG Memory Server
cd /home/leo/pentest-rag-memory && npm start

# Terminal 2: SearchSploit Server (optional)
cd /path/to/pentest-mcp-server/searchsploit-server-ts && npm start

# Terminal 3: Main Agent
cd /home/leo/mvp
export ENABLE_RAG_MEMORY="true"
export RAG_MEMORY_SERVER_PATH="/home/leo/pentest-rag-memory/dist/server/index.js"
export SEARCHSPLOIT_SERVER_PATH="/path/to/pentest-mcp-server/searchsploit-server-ts/dist/index.js"
npm start
```

**Initialization should show:**
```
[MCPAgent] ✓ Nmap server connected
[MCPAgent] ✓ SearchSploit server connected
[MCPAgent] ✓ RAG Memory server connected
```

### Troubleshooting

**Issue: "RAG Memory client not initialized"**
- Ensure `ENABLE_RAG_MEMORY="true"` is set
- Verify `RAG_MEMORY_SERVER_PATH` points to correct server file
- Check that RAG Memory server is running

**Issue: "Unknown tool: searchsploit_search"**
- Verify SearchSploit MCP server is running
- Check `SEARCHSPLOIT_SERVER_PATH` environment variable
- Ensure searchsploit CLI is installed: `which searchsploit`

**Issue: No RAG results found**
- Check ChromaDB has documents: `npm run seed` in pentest-rag-memory
- Verify query matches seeded service names (e.g., "pfsense", "apache")
- Check RAG server logs for query processing

## MCP Server Configuration

### Local Development (Stdio)

```typescript
const nmapServerPath = '/path/to/pentest-mcp-server/nmap-server-ts/dist/index.js';
```

### Remote Mode (SSE) - Future

```typescript
const transport = new SSEClientTransport(new URL('https://your-mcp-server.com/sse'));
```

## Changelog

### 2026-02-08 - Observability & Safety Hardening (v2.2)

**Langfuse Observability Tracing:**
- **✅ OpenTelemetry Integration**: `src/instrumentation.ts` initializes `NodeSDK` with `LangfuseSpanProcessor`, conditional on `LANGFUSE_SECRET_KEY` and `LANGFUSE_PUBLIC_KEY` environment variables
- **✅ Reconnaissance Tracing**: `reconnaissance()` wrapped in `startActiveObservation` with nested spans per iteration and phase (Phase 0–4)
- **✅ Graceful Shutdown**: `shutdownTracing()` flushes all pending spans to Langfuse before process exit
- **✅ Session Metadata**: Traces include `sessionId`, target IP, and phase-specific input/output metadata

**Duplicate Operation Detection:**
- **✅ Command Signature Tracking**: `executionHistory: Map<string, number>` tracks tool+args combinations across iterations
- **✅ Loop Intervention**: When repeated commands detected, injects `[SYSTEM INTERVENTION - LOOP DETECTED]` warning with 4-step behavioral instructions into Reasoner context
- **✅ Generic Behavioral Pattern**: Warnings are tool-agnostic, focusing on strategic redirection rather than hard-coded rules

**Database Exhaustion Detection:**
- **✅ Negative Keyword Analysis**: Detects when all tool results contain failure indicators (`no results`, `not found`, `0 matches`, etc.)
- **✅ Advisory Injection**: `[SYSTEM ADVICE - DATABASE EXHAUSTION]` warning redirects Reasoner to broader search strategies or mission completion

**Dynamic Tool Whitelist:**
- **✅ JSON Configuration**: `src/config/allowed_tools.json` as single source of truth for 8 allowed MCP tools
- **✅ Dynamic Loading**: `loadAllowedTools()` with multi-path resolution (works from both `src/` and `dist/`)
- **✅ System Prompt Generation**: `TOOL_DESCRIPTIONS` map + `buildToolListing()` dynamically generates Executor's tool section
- **✅ Tactical Plan Validation**: Both LLM-generated and Reasoner tactical plan steps validated against whitelist

**RAG Memory Agent Refactoring:**
- **✅ `recallInternalWarnings()`**: Phase 0 method querying `anti_patterns` collection, returns formatted `[WARNING N]` text
- **✅ `searchHandbook()`**: Phase 4b method querying `playbooks` collection with `session_playbook` vs industry categorization
- **✅ Metadata Preservation**: `parseRAGOutput()` preserves server metadata (type, service, category, tags, source, cve)
- **✅ Parameter Fix**: `top_k` → `n_results` for `rag_query_playbooks` (was silently returning default 3 results)

**OS Detection (nmap_os_detection):**
- **✅ Server**: Added `OSDetectionSchema`, tool definition, and handler (`nmap -Pn -O --osscan-guess`) to `nmap-server-ts`
- **✅ Client SDK**: Added `osDetection(target, ports?)` method to `nmap-client-ts`
- **✅ Agent**: Added `case 'nmap_os_detection'` routing in `mcp-agent.ts`

**MCP Agent Cleanup:**
- **✅ `rag_recall`**: `recall()` → `recallMyExperience()` (SDK primary method name)
- **✅ `rag_query_playbooks`**: Removed `(this.ragMemoryClient as any).callTool(...)` hack → `searchSecurityHandbook(query, nResults)`

---

### 2026-02-08 - Agent Loop Hardening & Fingerprint Parsing Skills (v2.1)

**Executor-Reasoner Feedback Fixes:**
- **✅ Tactical Plan Passthrough**: Executor checks `reasonerOutput.tactical_plan` first; if the Reasoner provided structured attack vectors, they are used directly — bypassing the LLM call entirely. Eliminates hallucinated tool names.
- **✅ Tool Whitelist Enforcement**: New `ALLOWED_TOOLS` Set (9 tools across Nmap/SearchSploit/RAG) with strict system prompt constraint + post-LLM validation in `parsePlan()`. Hallucinated tools like `vulnerability_research` are filtered with warning logs.
- **✅ Explicit Failure Feedback**: `_runToolExecutionLoop` now returns `{ results, failures }`. `_prepareNextObservation` includes failure reports (e.g., "WARNING — 3 tool(s) FAILED") so the Reasoner never misinterprets failed iterations as success.
- **✅ Service Deduplication**: Services are deduplicated by `host:port` during extraction, keeping the entry with more detail (product/version). Prevents context bloat from redundant scans.

**Fingerprint Parsing Skills (DataCleaner Enhancement):**
- **✅ Skill Injection**: `DataCleanerAgent` now supports `setSkillContext()` (mirrors ReasonerAgent pattern). Skill context is appended to the LLM system prompt during fallback parsing.
- **✅ `fingerprint_parsing_skill.md`**: New skill file with identification rules for 15+ technologies:
  - Network appliances: pfSense, FortiGate, MikroTik
  - Middleware: WebLogic, Tomcat, JBoss/WildFly
  - CMS: WordPress, Joomla
  - Databases: Redis, Elasticsearch, MongoDB
  - ICS: Modbus, Siemens S7
  - Remote management: iLO, iDRAC, IPMI, VMware ESXi
- **✅ Orchestrator Wiring**: Skills loaded and injected into both Reasoner and DataCleaner during `initialize()`

**Code Metrics:**
- Orchestrator: 1,117 → 1,360 lines (failure tracking, deduplication, skill wiring)
- Executor: 236 → 311 lines (whitelist, plan passthrough, validation)
- DataCleaner: 453 → 474 lines (skill injection)
- New: `fingerprint_parsing_skill.md` (156 lines)

---

### 2026-02-07 - Intelligence Phase Robustness & Orchestrator Refactoring

**Intelligence Layer Improvements:**
- **✅ Incremental Intelligence Analysis**: Only analyzes NEW services (tracked via fingerprints)
  - Merges results into existing intelligence context
  - Deduplicates vulnerabilities by CVE ID
  - Keeps Reasoner up-to-date throughout entire mission
  - No missed services, no duplicate analysis
- **✅ Retry Mechanism with Exponential Backoff**: Handles transient failures
  - Max 2 retries with exponential backoff (1s, 2s delays)
  - Recovers from network issues, API rate limits, temporary server errors
  - ~67% reduction in permanent failures
  - Non-blocking - continues with degraded data on complete failure

**Orchestrator Refactoring:**
- **Main loop reduced from ~250 lines to ~70 lines** (72% reduction)
- **8 private helper methods** for clean phase separation with comprehensive JSDoc
- **2 utility helper methods**: `createServiceFingerprint()`, `retryWithBackoff<T>()`
- **~420 lines of documentation** added

**Architecture Documentation:**
- Updated CLAUDE.md with layered architecture details, MCP integration, code metrics
- Added comprehensive testing section to README.md (line 677)
- Memory system documented for future sessions

---

### 2026-02-07 - Layered Architecture Refactoring (v2.0)

**Major Structural Refactoring**: Migrated from flat `src/agent/definitions/` directory to a layered architecture following the "Brains-Knowledge-Hands" metaphor.

**New Directory Structure:**
- **`core/`** - Orchestration layer with PentestAgent coordinator and global types
- **`intelligence/`** - Decision & analysis layer (ReasonerAgent, ProfilerAgent)
- **`knowledge/`** - Retrieval & memory layer (VulnLookupAgent, RAGMemoryAgent)
- **`execution/`** - Task execution layer (ExecutorAgent, MCPAgent, DataCleanerAgent)
- **`utils/`** - Support infrastructure (SkillsLoader, TokenMonitor, SessionLogger)

**New Utility Components:**
- **TokenMonitor** (`utils/token-monitor.ts`): Tracks token consumption and costs per agent
  - Session-level statistics with cost estimates
  - Per-agent and per-model breakdowns
  - Export reports for budget management
- **SessionLogger** (`utils/session-logger.ts`): JSONL session logger for Phase 6 integration
  - Structured logging of agent execution steps
  - Newline-delimited JSON format for ETL pipeline
  - Critical bridge to `pentest-data-refinery` project

**Layer Documentation:**
- Added README.md in each layer explaining purpose, components, and dependencies
- Clear data flow diagrams showing intelligence → knowledge → execution pipeline
- Design principles and architectural constraints documented

**Benefits:**
- ✅ Logical separation of concerns (decision-making, retrieval, execution)
- ✅ Improved code navigation and onboarding
- ✅ Clear dependency flow enforced by directory structure
- ✅ Preparation for Phase 6 (evaluation pipeline separation)
- ✅ Barrel exports for clean imports (`import { ReasonerAgent } from './intelligence'`)

**Migration Details:**
- All files moved using `git mv` to preserve history
- Import paths updated across entire codebase
- TypeScript compilation verified (no errors)
- Evaluator kept in `definitions/` until Phase 6 extraction
- Total refactoring time: ~5 hours

**Architecture Version**: Bumped to 2.0 to reflect major structural change

---

### 2026-02-06 - Evaluation Loop Implementation (Phase 5-7)

**Phase 5: Reasoner Tactical Planning ✅**
- **Enhanced ReasonerAgent**: Generates TacticalPlanObject with attack vectors
  - Prediction metrics for each attack vector (confidence, rationale, success criteria)
  - Intelligence context injection (target profile, services, vulnerabilities)
  - RAG memory context injection for anti-pattern warnings
  - Tactical plan parsing and validation
- **System Prompt Enhancement**: Added tactical planning instructions with examples
- **Context Management**: `setIntelligenceContext()` and `injectMemoryContext()` methods

**Phase 6: Evaluator Agent ✅**
- **EvaluatorAgent**: Post-execution evaluation and outcome labeling
  - Compares predicted outcomes vs. actual tool outputs
  - Ground truth labels: true_positive, false_positive, false_negative, true_negative
  - Confidence scoring for evaluation quality
  - Fallback evaluation using regex pattern matching
  - Prompt caching enabled (~90% token cost reduction)
- **Model**: Claude Haiku 3.5 for fast, cost-effective evaluation

**Phase 7: Orchestrator Integration ✅**
- **Intelligence Layer Execution**: Parallel Profiler + VulnLookup after service discovery
- **RAG Memory Recall**: Query past experiences before each Reasoner decision
- **Evaluation Loop**: Execute tactical plan attack vectors and collect evaluations
- **Training Data Collection**: TrainingPair generation with full context
- **Session Logging**: JSONL format for RAG ETL pipeline consumption
- **Helper Methods**:
  - `runEvaluationLoop()` - Execute and evaluate attack vectors
  - `saveTrainingData()` - Persist training pairs to JSON files
  - `logSessionStep()` - Write session steps in JSONL format
  - `extractOpenPorts()`, `extractTargetInfo()`, `determineOutcomeLabel()` - Data extraction utilities

**Configuration Options:**
- `enableEvaluation`: Enable evaluation loop and training data collection
- `enableRAGMemory`: Enable RAG memory recall before decisions
- `trainingDataPath`: Directory for training data JSON files
- `sessionLogsPath`: Directory for session JSONL logs

**Performance:**
- Parallel intelligence gathering reduces latency
- Prompt caching on Profiler and Evaluator (90% cost savings)
- Session-based training data batching for efficiency

**Architecture:**
- 7 specialized agents (Reasoner, Executor, MCP, DataCleaner, Profiler, VulnLookup, Evaluator)
- Complete Intelligence → Planning → Execution → Evaluation pipeline
- Training data generation for continuous model improvement

### 2026-02-06 - Intelligence Layer & RAG Memory Integration (Phase 1-4)

**Phase 1-3: Intelligence Layer Foundation ✅**
- **Enhanced Data Cleaner**: Service categorization, confidence scoring, criticality assessment
- **ProfilerAgent**: OS fingerprinting, tech stack inference, security posture assessment
- **Type System**: Comprehensive interfaces for intelligence-driven operations
  - `DiscoveredService`, `TargetProfile`, `IntelligenceContext`
  - `TacticalPlanObject`, `EvaluationResult`, `TrainingPair` (ready for Phase 5-6)

**Phase 4a: VulnLookup Agent ✅**
- **VulnLookupAgent**: Exploit research via SearchSploit MCP Server
  - Offline-capable (local ExploitDB database)
  - No rate limits, instant exploit lookup
  - CVE mapping with severity inference
  - Platform-aware filtering (Linux/Windows)
  - PoC code examination and local path retrieval

**Phase 4b: RAG Memory Integration Points ✅**
- **Session Logging**: JSONL format for ETL pipeline consumption
- **SessionStep Interface**: Structured logging of agent decisions
- **Integration Documentation**: [docs/RAG-Memory-Integration.md](docs/RAG-Memory-Integration.md)
- **Directory Structure**: `logs/sessions/` for session logs

**Performance Optimizations:**
- Prompt caching enabled for ProfilerAgent (~90% token cost reduction)
- Parallel intelligence gathering (Profiler + VulnLookup)

**Architecture:**
- 7 specialized agents (Reasoner, Executor, MCP, DataCleaner, Profiler, VulnLookup, Evaluator)
- Intelligence Layer: Service enrichment → Target profiling → Vulnerability research
- Evaluation Loop: Tactical planning → Execution → Evaluation → Training data
- RAG Memory System integration for continuous learning

### 2026-02-05 - Memory Manager & Interactive Mode
- **Memory Manager**: CLAUDE.md-style preference injection (`remember`, `forget`, `rules` commands)
- **Interactive REPL**: Welcome banner, direct IP/hostname input, help system
- **Documentation**: JSDoc comments, exposed skillsLoader for Memory Manager

### 2026-02-03 - Multi-Agent Architecture (Initial Release)
- Hierarchical multi-agent system: Reasoner (Sonnet 4), Executor (Haiku 4.5), MCP Agent, Data Cleaner
- Environment variable for API key (removed hardcoded key)

**Agent Flow:**
Target → Reasoner (STRATEGIC: "scan for vulnerabilities") → Executor (TACTICAL: "nmap_port_scan + nmap_service_detection") → MCP Agent → DataCleaner → Intelligence Layer (Profiler + VulnLookup) → Tactical Plan → Evaluation Loop → Training Data → back to Reasoner

**Key Architectural Principle:**
- **Reasoner**: Outputs HIGH-LEVEL strategic actions (no tool names or parameters)
- **Executor**: Breaks down strategic actions into 1-N concrete tool calls with specific parameters
- This separation ensures the Executor can properly decompose complex actions into multiple steps

---

## Implementation Status

**Architecture Version**: 2.2 (Observability & Safety Hardening)
**Completion**: Phase 1-7 ✅ Complete + Agent Loop Hardening ✅ + Observability & Safety ✅

### Summary (Phase 1-7)

| Phase | Component | Status | Key Features |
|-------|-----------|--------|--------------|
| **Phase 1** | Data Schema | ✅ Complete | Intelligence types, service enrichment interfaces, tactical planning structures |
| **Phase 2** | Data Cleaner | ✅ Complete | Service categorization, confidence scoring, criticality assessment |
| **Phase 3** | Profiler Agent | ✅ Complete | OS fingerprinting, tech stack inference, security posture, prompt caching |
| **Phase 4a** | VulnLookup Agent | ✅ Complete | SearchSploit MCP integration, offline CVE lookup, platform-aware filtering |
| **Phase 4b** | RAG Memory Integration | ✅ Complete | JSONL session logging, SessionStep interface, integration documentation |
| **Phase 5** | Reasoner Tactical Planning | ✅ Complete | TacticalPlanObject with attack vectors, prediction metrics, intelligence context injection |
| **Phase 6** | Evaluator Agent | ✅ Complete | TP/FP/FN/TN labeling, prediction comparison, training data generation |
| **Phase 7** | Orchestrator Integration | ✅ Complete | Parallel intelligence execution, RAG memory recall, evaluation loop, training data persistence |

### Recent Enhancements (2026-02-08)

**Observability & Safety Hardening (v2.2)**:
- ✅ **Langfuse Tracing**: OpenTelemetry + Langfuse span processor for full reconnaissance observability
- ✅ **Duplicate Operation Detection**: Command signature tracking with generic behavioral loop intervention
- ✅ **Database Exhaustion Detection**: Negative keyword analysis with advisory injection for empty results
- ✅ **Dynamic Tool Whitelist**: JSON config as single source of truth, tactical plan + LLM validation
- ✅ **RAG Memory Refactoring**: `recallInternalWarnings` (Phase 0) + `searchHandbook` (Phase 4b) replacing raw MCP calls
- ✅ **OS Detection**: `nmap_os_detection` across server, client SDK, and agent
- ✅ **Parameter Fix**: `top_k` → `n_results` for `rag_query_playbooks`

**Agent Loop Hardening (v2.1)**:
- ✅ **Tactical Plan Passthrough**: Executor uses Reasoner's tactical plan directly, bypassing redundant LLM call
- ✅ **Tool Whitelist**: `ALLOWED_TOOLS` Set + post-LLM validation filters hallucinated tool names
- ✅ **Explicit Failure Feedback**: Failed tools reported to Reasoner with "WARNING — N tool(s) FAILED" context
- ✅ **Service Deduplication**: `host:port` dedup prevents context bloat from redundant scans
- ✅ **Fingerprint Parsing Skills**: Dynamic skill injection into DataCleaner for technology identification (15+ rules)

**Layered Architecture Refactoring (v2.0)**:
- ✅ Migrated from flat structure to 5-layer architecture (core, intelligence, knowledge, execution, utils)
- ✅ Preserved git history via `git mv` for all file relocations
- ✅ Added barrel exports (`index.ts`) for clean imports
- ✅ Created README.md in each layer documenting purpose and dependencies

**Intelligence Phase Robustness**:
- ✅ **Incremental Intelligence Analysis**: Tracks analyzed services via fingerprints, only analyzes NEW services
- ✅ **Intelligent Merging**: Deduplicates vulnerabilities by CVE ID across iterations
- ✅ **Retry Mechanism**: Exponential backoff (max 2 retries, 1s/2s delays) for transient failures
- ✅ **~67% Failure Recovery**: Handles network issues, API rate limits, server hiccups automatically

**Orchestrator Refactoring**:
- ✅ Main loop reduced from ~250 lines to ~70 lines (72% reduction)
- ✅ 8 private helper methods for clean phase separation
- ✅ 2 utility helpers: `createServiceFingerprint()`, `retryWithBackoff<T>()`
- ✅ ~420 lines of comprehensive JSDoc documentation

**New Utilities**:
- ✅ **TokenMonitor** (`utils/token-monitor.ts`): Tracks token consumption, costs per agent/model
- ✅ **SessionLogger** (`utils/session-logger.ts`): JSONL logging for ETL pipeline (pentest-data-refinery)

### 📦 External Dependencies (Separate Repositories)

**pentest-mcp-server:**
- ✅ Nmap MCP Server (Complete)
- ✅ SearchSploit MCP Server (Complete)

**pentest-rag-memory (Separate Repo):**
- ✅ Phase 1: Type definitions, ChromaDB client, seed data (Complete)
- ⏳ Phase 2: ETL pipeline (Planned)
- ⏳ Phase 3: RAG MCP server (Planned)

---

## Next Steps

1. **End-to-End Testing**: Test full Intelligence + Evaluation pipeline
   - Run reconnaissance on test targets
   - Verify tactical plan generation with prediction metrics
   - Validate evaluation loop execution and training data collection
   - Check session logging for RAG ETL consumption

2. **Deploy SearchSploit MCP**: Set up SearchSploit server for vulnerability lookups
   - Install ExploitDB locally
   - Configure SearchSploit MCP server path
   - Test VulnLookup agent integration

3. **RAG Memory System**: Complete ETL pipeline and MCP server (separate repo)
   - Implement ETL pipeline to process session JSONL logs
   - Extract anti-patterns from failed attack attempts
   - Build RAG MCP server for memory recall
   - Test memory injection into Reasoner context

4. **Training Data Pipeline**: Set up RLHF/fine-tuning workflow
   - Process collected training pairs
   - Build preference datasets from evaluation labels
   - Integrate with model training infrastructure
   - Measure model improvement over time

5. **Production Hardening**: Optimize for real-world usage
   - Error handling and retry logic
   - Rate limiting and cost controls
   - Multi-target parallel reconnaissance
   - Result aggregation and reporting

---

## Project Statistics

### Code Metrics (Lines of Code)

**✨ Updated for Agent Loop Hardening v2.1 (2026-02-08)**

#### Core Agent System (5,527 lines total)

**Core Orchestration Layer** (1,815 lines):
| File | Lines | Purpose |
|------|-------|---------|
| `src/agent/core/orchestrator.ts` | 1,360 | Main PentestAgent coordinator with failure tracking + dedup |
| `src/agent/core/types.ts` | 452 | Global type definitions (agents, intelligence, tactical planning) |
| `src/agent/core/index.ts` | 3 | Barrel export |

**Intelligence Layer** (647 lines):
| File | Lines | Purpose |
|------|-------|---------|
| `src/agent/intelligence/reasoner.ts` | 488 | ReasonerAgent (Sonnet 4) - Strategic planning with tactical plans |
| `src/agent/intelligence/profiler.ts` | 155 | ProfilerAgent (Haiku 3.5) - Target profiling and risk assessment |
| `src/agent/intelligence/index.ts` | 4 | Barrel export |

**Knowledge Layer** (753 lines):
| File | Lines | Purpose |
|------|-------|---------|
| `src/agent/knowledge/vuln-lookup.ts` | 381 | VulnLookupAgent - Exploit research via SearchSploit MCP |
| `src/agent/knowledge/rag-memory-agent.ts` | 368 | RAGMemoryAgent - Playbooks & anti-patterns retrieval |
| `src/agent/knowledge/index.ts` | 4 | Barrel export |

**Execution Layer** (1,172 lines):
| File | Lines | Purpose |
|------|-------|---------|
| `src/agent/execution/data-cleaner.ts` | 474 | DataCleanerAgent (Haiku 4.5) - Skill-injected parsing & enrichment |
| `src/agent/execution/executor.ts` | 311 | ExecutorAgent (Haiku 4.5) - Tool whitelist + plan passthrough |
| `src/agent/execution/mcp-agent.ts` | 382 | MCPAgent - Tool execution via 3 MCP servers |
| `src/agent/execution/index.ts` | 5 | Barrel export |

**Utility Layer** (848 lines):
| File | Lines | Purpose |
|------|-------|---------|
| `src/agent/utils/skills-loader.ts` | 519 | SkillsLoader + Memory Manager (tool preferences) |
| `src/agent/utils/token-monitor.ts` | 196 | Token consumption tracking & cost monitoring |
| `src/agent/utils/session-logger.ts` | 127 | JSONL session logger for Phase 6 ETL pipeline |
| `src/agent/utils/index.ts` | 6 | Barrel export |

**Legacy (Phase 6 Migration Pending)** (245 lines):
| File | Lines | Purpose |
|------|-------|---------|
| `src/agent/definitions/evaluator.ts` | 241 | EvaluatorAgent (Haiku 3.5) - Outcome labeling (TP/FP/FN/TN) |
| `src/agent/definitions/index.ts` | 4 | Barrel export |

**Entry Points & Infrastructure** (442 lines):
| File | Lines | Purpose |
|------|-------|---------|
| `src/index.ts` | 397 | Interactive CLI with REPL and Memory Manager commands |
| `src/instrumentation.ts` | 43 | Langfuse/OpenTelemetry tracing setup (conditional on env vars) |
| `src/agent/index.ts` | 6 | Main agent barrel export |

#### Layer Documentation (236 lines)
| File | Lines | Purpose |
|------|-------|---------|
| `src/agent/execution/README.md` | 56 | Execution layer documentation (Executor, MCP, DataCleaner) |
| `src/agent/utils/README.md` | 50 | Utility layer documentation (Skills, Logging, Monitoring) |
| `src/agent/knowledge/README.md` | 47 | Knowledge layer documentation (VulnLookup, RAG Memory) |
| `src/agent/intelligence/README.md` | 45 | Intelligence layer documentation (Reasoner, Profiler) |
| `src/agent/core/README.md` | 38 | Core layer documentation (Orchestrator, Types) |

#### Skills & Knowledge Base (968 lines)
| File | Lines | Purpose |
|------|-------|---------|
| `src/skills/nmap_skill.md` | 805 | Nmap expertise and best practices |
| `src/skills/fingerprint_parsing_skill.md` | 156 | Technology fingerprinting rules (pfSense, WebLogic, etc.) |
| `src/config/agent_rules.json` | 7 | Memory Manager persistent rules |

#### Project Documentation (1,254 lines)
| File | Lines | Purpose |
|------|-------|---------|
| `README.md` | 1,061 | Project overview, architecture, and usage guide |
| `CLAUDE.md` | 193 | Claude Code project instructions |

#### Configuration (77 lines)
| File | Lines | Purpose |
|------|-------|---------|
| `package.json` | 38 | NPM dependencies and scripts |
| `tsconfig.json` | 19 | TypeScript compiler configuration |
| `src/config/allowed_tools.json` | 14 | Tool whitelist (single source of truth for 8 MCP tools) |
| `.prettierrc` | 8 | Code formatting rules |

---

**Total Project Size**: **~8,000 lines** of code and documentation

**Architecture Breakdown**:
- **5 Layers**: Core, Intelligence, Knowledge, Execution, Utils
- **8 AI Agents**: Reasoner, Profiler, VulnLookup, RAG, Executor, MCP, DataCleaner, Evaluator
- **3 Claude Models**: Sonnet 4 (strategic), Haiku 4.5 (tactical), Haiku 3.5 (profiling/evaluation)
- **5 Major Systems**: Intelligence Layer, Evaluation Loop, RAG Memory, Skills System, Tool Whitelist
- **20+ TypeScript interfaces** for type-safe agent communication
- **2 Skill Documents**: Nmap reconnaissance (805 lines), Fingerprint parsing (156 lines)
- **5 Layer READMEs** documenting architecture and data flow
- **2 Utility Components**: TokenMonitor (cost tracking), SessionLogger (JSONL logging)

---

## License

MIT License

Copyright (c) 2026 cyberdiagram

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
