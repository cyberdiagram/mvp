# MVP - AI-Powered Penetration Testing Agent

![Visitors](https://api.visitorbadge.io/api/visitors?path=flashoop/mvp&label=VISITORS&countColor=%23263238)

> **Last Updated:** 2026-02-13
> **Architecture Version:** 3.0 (Dual MCP + Docker Architecture)
> **Latest Feature:** Docker deployment (Brain + Kali containers), Dual MCP Agent (RAG stdio + Kali HTTP), AgenticExecutor OODA loop, 6 new CLI commands, dynamic tool discovery (2026-02-13)

An AI-powered penetration testing agent using Claude AI with a hierarchical multi-agent architecture, Intelligence Layer for target profiling, Evaluation Loop for continuous improvement, and RAG Memory System that queries security playbooks (successful techniques) and anti-patterns (failed exploits) from past experiences.

## Architecture

**Version**: 3.0 (Dual MCP + Docker Architecture)
**Last Updated**: 2026-02-13

### Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         ORCHESTRATOR (v3.0)                              │
│                   (src/agent/core/orchestrator.ts)                       │
│       Dual MCP + Docker + OODA Loop + Intelligence + Evaluation          │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
        ┌───────────────────────────┼───────────────────────────┐
        │                           │                           │
        ▼                           ▼                           ▼
┌──────────────────┐    ┌──────────────────┐      ┌──────────────────┐
│ INTELLIGENCE     │    │   KNOWLEDGE      │      │   EXECUTION      │
│ (Brains)         │    │   (Memory)       │      │   (Hands)        │
├──────────────────┤    ├──────────────────┤      ├──────────────────┤
│ • Reasoner       │    │ • VulnLookup     │      │ • Executor       │
│   (Sonnet 4)     │◄───┤   (SearchSploit  │      │   (Haiku 4.5)    │
│   Strategic      │    │    via Kali MCP)  │      │   Tactical Recon │
│   Planning       │    │   CVE Research   │      │                  │
│                  │    │                  │      │ • AgenticExecutor│
│ • Profiler       │    │ • RAG Memory     │      │   (Sonnet 4)     │
│   (Haiku 3.5)    │    │   (ChromaDB)     │      │   OODA Loop      │
│   Target         │    │   Playbooks +    │      │   Exploit Exec   │
│   Analysis       │    │   Anti-Patterns  │      │                  │
│                  │    │                  │      │ • DualMCPAgent   │
└──────────────────┘    └──────────────────┘      │   RAG (stdio) +  │
                                                   │   Kali (HTTP)    │
                                                   │                  │
                                                   │ • Data Cleaner   │
                                                   │   (Haiku 4.5)    │
                                                   └──────────────────┘
        │                           │                           │
        └───────────────────────────┼───────────────────────────┘
                                    │
                                    ▼
                    ┌──────────────────────────────┐
                    │   UTILITIES & MONITORING     │
                    ├──────────────────────────────┤
                    │ • Skill Manager (unified)    │
                    │ • Token Monitor (Cost Track) │
                    │ • Session Logger (JSONL ETL) │
                    │ • Evaluator (TP/FP/FN/TN)    │
                    └──────────────────────────────┘
                                    │
                                    ▼
          ┌──────────────────────────────────────────────────┐
          │            DUAL MCP ARCHITECTURE                  │
          ├──────────────────────────────────────────────────┤
          │ • Kali MCP Server (HTTP, Docker container)       │
          │   └─ execute_shell_cmd, write_file,              │
          │      execute_script, manage_packages,            │
          │      searchsploit_search, searchsploit_examine   │
          │                                                   │
          │ • RAG Memory MCP Server (stdio, host)            │
          │   └─ rag_recall, rag_query_playbooks, rag_store  │
          └──────────────────────────────────────────────────┘
```

**Key Features (v3.0)**:
- ✅ **Docker Deployment**: Brain (Node.js) + Kali (Python FastMCP) containers on bridge network
- ✅ **Dual MCP Architecture**: RAG Memory (stdio on host) + Kali (HTTP in Docker) replacing 3 stdio servers
- ✅ **AgenticExecutor**: OODA loop engine for autonomous exploit execution (generate, execute, plan-based, agentic)
- ✅ **6 New CLI Commands**: `generate`, `execute`, `interactive`, `autorun`, `plan`, `autonomous`
- ✅ **Dynamic Tool Discovery**: Tools discovered at runtime via `kaliClient.listTools()` — no static whitelist
- ✅ **Unified SkillManager**: Merged skills-loader + pentest-executor skill system with tool-callable methods
- ✅ **Layered Architecture**: 5 layers (core, intelligence, knowledge, execution, utils)
- ✅ **Langfuse Observability**: OpenTelemetry-based tracing for all phases
- ✅ **Incremental Intelligence**: Only analyzes NEW services, merges results intelligently
- ✅ **Retry Mechanism**: Exponential backoff (max 2 retries) for transient failures
- ✅ **Tactical Plan Passthrough**: Executor uses Reasoner's tactical plan directly
- ✅ **Explicit Failure Feedback**: Failed tool executions reported to Reasoner with context
- ✅ **Service Deduplication**: `host:port` dedup prevents context bloat

### Layered Architecture Components

| Layer | Agent | Model | Purpose |
|-------|-------|-------|---------|
| **Core** | Orchestrator | - | Main coordinator (8 phases + 2 utilities) |
| **Intelligence** | Reasoner | Sonnet 4 | **STRATEGIC** planning - decides WHAT to do and WHY |
| **Intelligence** | Profiler | Haiku 3.5 | Target profiling (OS, tech stack, security posture) |
| **Knowledge** | VulnLookup | - | Exploit research via SearchSploit (Kali container) |
| **Knowledge** | RAG Memory | - | Retrieves playbooks & anti-patterns from past penetration tests |
| **Execution** | Executor | Haiku 4.5 | **TACTICAL** recon execution - breaks down strategic actions into tool calls |
| **Execution** | AgenticExecutor | Sonnet 4 | **OODA LOOP** - autonomous exploit generation, execution, and learning |
| **Execution** | DualMCPAgent | - | Routes tools to RAG (stdio) or Kali (HTTP) MCP servers |
| **Execution** | Data Cleaner | Haiku 4.5 | Parses & enriches output (skill-injected fingerprinting + confidence) |
| **Utilities** | Skill Manager | - | Unified skill loading + memory + tool-callable skill methods |
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
      "tool": "execute_shell_cmd",
      "arguments": { "command": "nmap -sV -p 80,443 10.0.0.1" },
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

**Architecture Version**: 3.0 (Dual MCP + Docker)

The project uses a layered architecture following the "Brains-Knowledge-Hands" metaphor, with Docker deployment and dual MCP transport:

```
docker/
├── docker-compose.yml              # Brain + Kali pod on bridge network
├── brain/
│   └── Dockerfile                  # Node 20 container for MVP agent
└── kali/
    ├── Dockerfile                  # Kali rolling + exploitdb + pentest tools
    ├── server.py                   # FastMCP server (6 tools, port 3001)
    └── requirements.txt            # Python dependencies

src/
├── index.ts                        # Interactive CLI (recon + 6 exploit commands)
├── instrumentation.ts              # Langfuse/OpenTelemetry tracing setup
├── config/
│   ├── agent-config.ts            # Environment configuration
│   └── agent_rules.json            # Memory Manager rules (persistent)
├── skills/
│   ├── nmap_skill.md               # Nmap reconnaissance skill
│   ├── fingerprint_parsing_skill.md # Technology fingerprinting rules
│   ├── wpscan.md                   # WordPress scanning skill
│   └── github-search.md           # GitHub PoC search skill
└── agent/
    ├── index.ts                    # Main agent barrel export
    │
    ├── core/                       # ORCHESTRATION LAYER
    │   ├── orchestrator.ts        # PentestAgent class (main coordinator)
    │   ├── types.ts               # Global type definitions
    │   └── index.ts               # Barrel export
    │
    ├── intelligence/               # DECISION & ANALYSIS (Brains)
    │   ├── reasoner.ts            # ReasonerAgent (Sonnet 4) - Strategic planning
    │   ├── profiler.ts            # ProfilerAgent (Haiku 3.5) - Target profiling
    │   └── index.ts               # Barrel export
    │
    ├── knowledge/                  # RETRIEVAL & MEMORY (Memory)
    │   ├── vuln-lookup.ts         # VulnLookupAgent (SearchSploit via Kali)
    │   ├── rag-memory-agent.ts    # RAGMemoryAgent (ChromaDB MCP)
    │   └── index.ts               # Barrel export
    │
    ├── execution/                  # TASK EXECUTION (Hands)
    │   ├── executor.ts            # ExecutorAgent (Haiku 4.5) - Recon tactical breakdown
    │   ├── agentic-executor.ts    # AgenticExecutor - OODA loop for exploit execution
    │   ├── mcp-agent.ts           # DualMCPAgent - RAG (stdio) + Kali (HTTP)
    │   ├── data-cleaner.ts        # DataCleanerAgent (Haiku 4.5) - Output parsing
    │   └── index.ts               # Barrel export
    │
    ├── utils/                      # SUPPORT & INFRASTRUCTURE
    │   ├── skill-manager.ts       # Unified SkillManager (skills + memory + tools)
    │   ├── skills-loader.ts       # Legacy SkillsLoader (backward compat)
    │   ├── token-monitor.ts       # Token consumption tracking
    │   ├── session-logger.ts      # JSONL session logger
    │   └── index.ts               # Barrel export
    │
    └── definitions/                # LEGACY (Phase 6 migration pending)
        ├── evaluator.ts           # EvaluatorAgent (Haiku 3.5)
        └── index.ts               # Exports

logs/
├── sessions/                       # JSONL session logs for RAG ETL
└── training_data/                  # Training pairs (JSON) for RLHF
```

**Layer Responsibilities:**

- **Core**: Orchestration and shared type system
- **Intelligence**: Strategic decision-making and target analysis
- **Knowledge**: Vulnerability research and memory retrieval
- **Execution**: Tactical breakdown and tool execution
- **Utils**: Infrastructure (skills, logging, monitoring)

## Setup

### Prerequisites

- Node.js 20+
- Docker & Docker Compose (for Kali container)
- Anthropic API key

### Install Dependencies

```bash
npm install
```

### MCP Client Setup (yalc)

```bash
# Install yalc globally
npm install -g yalc

# RAG Memory MCP client (only remaining yalc dependency):
cd ../pentest-mcp-server/rag-memory-server-ts
npm run build && yalc publish

# In this repo:
yalc add @cyber/mcp-rag-memory-client
npm install
```

### Docker Setup

```bash
# Build and start both containers
cd docker && docker compose up --build

# Or start just the Kali container (for local development)
cd docker && docker compose up kali -d
```

The Kali container runs a FastMCP server on port 3001 with 6 tools:
- **Dynamic Execution**: `execute_shell_cmd`, `write_file`, `execute_script`, `manage_packages`
- **Information Retrieval**: `searchsploit_search`, `searchsploit_examine`

### Environment Variables

```bash
# Required
export ANTHROPIC_API_KEY="your-api-key"

# Kali MCP Server (HTTP, Docker container)
export KALI_MCP_URL="http://localhost:3001"  # Default

# RAG Memory MCP Server (stdio, host)
export RAG_MEMORY_SERVER_PATH="../pentest-mcp-server/rag-memory-server-ts/dist/index.js"

# Evaluation & Training (optional)
export ENABLE_EVALUATION="true"
export TRAINING_DATA_PATH="./logs/training_data"

# RAG Memory System (optional)
export ENABLE_RAG_MEMORY="true"

# Langfuse Observability (optional)
export LANGFUSE_SECRET_KEY="sk-lf-xxx"
export LANGFUSE_PUBLIC_KEY="pk-lf-xxx"
export LANGFUSE_BASE_URL="https://cloud.langfuse.com"
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

**Reconnaissance:**

| Command | Description | Example |
|---------|-------------|---------|
| `recon <target>` | Run automated reconnaissance | `recon 192.168.1.0/24` |
| `<IP or hostname>` | Auto-run recon on target | `192.168.1.10` |

**Exploit Execution (NEW in v3.0):**

| Command | Description | Example |
|---------|-------------|---------|
| `generate <task>` | Generate a PoC script with Claude | `generate "port scanner for 10.0.0.1"` |
| `execute <filename>` | Run an existing script in Kali container | `execute exploit.py` |
| `interactive <task>` | Generate, review/edit, then execute | `interactive "SQLi test"` |
| `autorun <task>` | Generate + write + execute automatically | `autorun "nmap scan 10.0.0.1"` |
| `plan <json-file>` | Load Tactical Plan and choose strategy | `plan ./TacticalPlan.json` |
| `autonomous <task>` | Full agentic OODA loop | `autonomous "exploit CVE-2021-41773"` |

**Memory & System:**

| Command | Description | Example |
|---------|-------------|---------|
| `remember <tool> <rule>` | Save a tool preference | `remember nmap use -Pn` |
| `forget <tool>` | Clear all preferences for a tool | `forget nmap` |
| `rules [tool]` | List saved preferences | `rules` or `rules nmap` |
| `help` | Show help message | `help` |
| `exit` | Quit the application | `exit` |

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

### Kali MCP Server (Docker)

The Kali container includes `exploitdb` and all pentest tools. SearchSploit runs inside the container — no separate server needed.

```bash
# Build and start Kali container
cd docker && docker compose up kali -d

# Verify MCP server is running
curl http://localhost:3001/mcp
```

**Tools available in Kali container:**
- `execute_shell_cmd` — Run any shell command (nmap, hydra, sqlmap, etc.)
- `write_file` — Write files to the container filesystem
- `execute_script` — Execute Python/Bash scripts
- `manage_packages` — Install/remove apt packages at runtime
- `searchsploit_search` — Search ExploitDB for CVEs and exploits
- `searchsploit_examine` — Read full exploit source code by EDB-ID

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

# Build RAG Memory MCP server
cd ../pentest-mcp-server/rag-memory-server-ts
npm run build && yalc publish

# In MVP repo:
yalc add @cyber/mcp-rag-memory-client && npm install
```

**Main Agent Integration:**
Session logs are automatically written to `logs/sessions/<session_id>.jsonl` for RAG ETL processing.

## Testing MCP Integrations

### Testing Kali MCP Server

**Step 1: Start Kali Container**
```bash
cd /home/leo/mvp/docker && docker compose up kali -d
```

**Step 2: Test Connection**
```bash
npm run dev

# In REPL:
> autonomous "run nmap --version to verify"
```

**Expected Output:**
```
[DualMCPAgent] ✓ Kali MCP connected (6 tools discovered)
[DualMCPAgent] Available tools: execute_shell_cmd, write_file, execute_script, manage_packages, searchsploit_search, searchsploit_examine
```

### Testing RAG Memory Integration

**Step 1: Ensure RAG Memory MCP server is configured**
```bash
export RAG_MEMORY_SERVER_PATH="../pentest-mcp-server/rag-memory-server-ts/dist/index.js"
export ENABLE_RAG_MEMORY="true"
```

**Step 2: Start Agent and Test**
```bash
npm run dev

> recon <target-with-known-services>
```

**Expected Output:**
```
[DualMCPAgent] ✓ RAG Memory connected
[RAG Memory] ✓ Found 2 playbooks, 1 anti-patterns
```

### Testing Exploit Execution (New in v3.0)

```bash
# Start Kali container
cd docker && docker compose up kali -d

# Start agent
cd /home/leo/mvp && npm run dev

# Test generate command
> generate "create a port scanner for 192.168.1.1"

# Test autonomous OODA loop
> autonomous "scan 192.168.1.1 for web vulnerabilities"

# Test plan-based execution
> plan ./TacticalPlan.json
```

### Full Docker Pod Test

```bash
cd /home/leo/mvp/docker && docker compose up --build
# Brain container connects to Kali container automatically
# REPL starts in brain container
```

### Troubleshooting

**Issue: "Kali MCP connection failed"**
- Verify Kali container is running: `docker ps | grep pentest-kali`
- Check Kali MCP server: `curl http://localhost:3001/mcp`
- Verify `KALI_MCP_URL` environment variable

**Issue: "RAG Memory client not initialized"**
- Ensure `ENABLE_RAG_MEMORY="true"` is set
- Verify `RAG_MEMORY_SERVER_PATH` points to `../pentest-mcp-server/rag-memory-server-ts/dist/index.js`
- NOT `../pentest-rag-memory/...` (that's the database, not the MCP server)

**Issue: No RAG results found**
- Check ChromaDB has documents: `npm run seed` in pentest-rag-memory
- Verify query matches seeded service names (e.g., "pfsense", "apache")

## MCP Architecture

### Dual MCP Transport

```
┌─────────────┐    stdio     ┌──────────────────────┐
│  DualMCP    │──────────────│  RAG Memory Server   │
│  Agent      │              │  (host, yalc client)  │
│             │    HTTP      ┌──────────────────────┐
│             │──────────────│  Kali MCP Server     │
└─────────────┘   :3001      │  (Docker, FastMCP)    │
                              └──────────────────────┘
```

- **RAG Memory**: stdio transport via `@cyber/mcp-rag-memory-client` (yalc). Tools: `rag_recall`, `rag_query_playbooks`, `rag_store`
- **Kali**: HTTP transport via `@modelcontextprotocol/sdk` StreamableHTTPClientTransport. Tools discovered dynamically at connection time.

## Changelog

### 2026-02-13 - Dual MCP + Docker Architecture (v3.0)

**Docker Deployment:**
- **Brain Container**: Node 20 image running compiled TypeScript agent
- **Kali Container**: Kali rolling image with FastMCP Python server (6 tools), exploitdb, nmap, and pentest tools
- **Docker Compose**: Bridge network (`pentest-net`) for brain↔kali communication, named volumes for apt cache and scripts

**Dual MCP Architecture:**
- **DualMCPAgent**: Replaced 3 stdio MCP clients (Nmap, SearchSploit, RAG) with 2 clients:
  - RAG Memory: stdio transport via `@cyber/mcp-rag-memory-client` (yalc, on host)
  - Kali: HTTP transport via `@modelcontextprotocol/sdk` `StreamableHTTPClientTransport` (Docker container)
- **Dynamic Tool Discovery**: Tools discovered at runtime via `kaliClient.listTools()` — replaces static `allowed_tools.json` whitelist
- **Tool Routing**: `rag_*` tools → RAG client, all other tools → Kali client

**AgenticExecutor (OODA Loop):**
- Ported from `pentest-executor` project with full Langfuse tracing
- Autonomous tool discovery, package installation, script generation, and execution
- Methods: `generateScript()`, `autoExecute()`, `executeFinal()`, `runAgentLoop()`, `runAgentWithTacticalPlan()`
- Dynamic `TOOL_DEFINITIONS` built from `mcpAgent.getKaliToolNames()` + host-local skill tools

**6 New CLI Commands:**
- `generate <task>` — Generate PoC script with Claude
- `execute <filename>` — Run script in Kali container
- `interactive <task>` — Generate, review/edit, execute
- `autorun <task>` — Generate + write + execute automatically
- `plan <json-file>` — Load Tactical Plan with 4 strategy options (tool-based, GitHub PoC, manual, interactive)
- `autonomous <task>` — Full agentic OODA loop

**Unified SkillManager:**
- Merged MVP's `skills-loader.ts` + pentest-executor's `skills.ts`
- Tool-callable methods: `listSkills()`, `readSkillFile()`, `saveNewSkill()`, `buildSkillsPromptSection()`
- Reasoner context: `buildSkillContext()` with keyword matching
- Memory: `addRule()`, `removeRule()`, `listRules()`, `buildRulesPromptSection()`

**Dependency Changes:**
- Added: `@modelcontextprotocol/sdk` (^1.26.0) for HTTP MCP transport
- Removed: `@cyber/mcp-nmap-client`, `@cyber/mcp-searchsploit-client` (replaced by Kali container)
- Kept: `@cyber/mcp-rag-memory-client` (stdio transport for RAG)

---

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

**Architecture Version**: 3.0 (Dual MCP + Docker Architecture)
**Completion**: Phase 1-7 ✅ + Agent Loop Hardening ✅ + Observability ✅ + Docker + Dual MCP + OODA Loop ✅

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

### Recent Enhancements (2026-02-13)

**Dual MCP + Docker Architecture (v3.0)**:
- ✅ **Docker Deployment**: Brain + Kali containers on bridge network with Docker Compose
- ✅ **DualMCPAgent**: RAG (stdio, host) + Kali (HTTP, Docker) replacing 3 stdio servers
- ✅ **AgenticExecutor**: OODA loop engine for autonomous exploit execution
- ✅ **6 New CLI Commands**: generate, execute, interactive, autorun, plan, autonomous
- ✅ **Dynamic Tool Discovery**: Runtime tool list via `kaliClient.listTools()`
- ✅ **Unified SkillManager**: Merged skill loading + memory + tool-callable methods

**Previous Enhancements**:
- ✅ **Langfuse Tracing**: OpenTelemetry + Langfuse span processor for observability
- ✅ **Duplicate Operation Detection**: Command signature tracking with loop intervention
- ✅ **Tactical Plan Passthrough**: Executor uses Reasoner's plan directly
- ✅ **Incremental Intelligence**: Fingerprint tracking, CVE dedup, retry with backoff
- ✅ **5-Layer Architecture**: Core, intelligence, knowledge, execution, utils

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

1. **Docker Pod Testing**: Verify full brain↔kali communication
   - Build and start Docker Compose pod
   - Test all 6 CLI commands against Kali container
   - Verify RAG Memory stdio works inside brain container

2. **OODA Loop Validation**: Test AgenticExecutor against real targets
   - Test `autonomous` command with CVE exploitation tasks
   - Test `plan` command with tactical plan files
   - Verify Langfuse tracing captures all OODA turns

3. **RAG Memory ETL Pipeline**: Complete learning loop
   - Process session JSONL logs into anti-patterns
   - Extract successful techniques as new playbooks
   - Test memory injection improves future sessions

4. **Training Data Pipeline**: Set up RLHF/fine-tuning workflow
   - Process collected training pairs from evaluation loop
   - Build preference datasets from TP/FP/FN/TN labels
   - Measure model improvement over time

5. **Multi-Tenant Deployment**: Scale to parallel engagements
   - Multiple Kali containers per engagement
   - Shared RAG Memory across sessions
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
