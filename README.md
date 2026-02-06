# MVP - AI-Powered Penetration Testing Agent

> **Last Updated:** 2026-02-06
> **Architecture Version:** 1.3+ (Intelligence Layer + Evaluation Loop + RAG Memory Integration)
> **Latest Feature:** RAG Memory System with Playbooks + Anti-Patterns (2026-02-06)

An AI-powered penetration testing agent using Claude AI with a hierarchical multi-agent architecture, Intelligence Layer for target profiling, Evaluation Loop for continuous improvement, and RAG Memory System that queries security playbooks (successful techniques) and anti-patterns (failed exploits) from past experiences.

## Architecture

### Overview

```
┌──────────────────────────────────────────────────────────────────┐
│                        ORCHESTRATOR                              │
│                    (src/agent/index.ts)                          │
│     Intelligence Layer + Evaluation Loop + RAG Memory           │
└──────────────────────────────────────────────────────────────────┘
         │           │           │           │           │           │
         ▼           ▼           ▼           ▼           ▼           ▼
   ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐
   │REASONER │ │EXECUTOR │ │  DATA   │ │ SKILLS  │ │EVALUATOR│ │   RAG   │
   │(Sonnet4)│ │(Haiku45)│ │ CLEANER │ │ LOADER  │ │(Haiku35)│ │ MEMORY  │
   │Tactical │ │         │ │(Haiku45)│ │+Memory  │ │Labeling │ │Playbooks│
   │Planning │ │         │ │Enriched │ │Manager  │ │TP/FP/FN │ │Anti-Patt│
   └─────────┘ └─────────┘ └─────────┘ └─────────┘ └─────────┘ └─────────┘
                     │              │                      │           │
                     ▼              ▼                      ▼           ▼
              ┌──────────┐   ┌─────────────────────┐  Training  ┌──────────┐
              │MCP AGENT │   │ INTELLIGENCE LAYER  │  Data      │ RAG MCP  │
              └──────────┘   └─────────────────────┘  (JSON)    │  Server  │
                     │              │         │                  └──────────┘
                     ▼              ▼         ▼                       │
          ┌──────────────┐  ┌──────────┐ ┌──────────┐               │
          │ MCP SERVERS  │  │ PROFILER │ │  VULN    │               │
          ├──────────────┤  │ (Haiku35)│ │ LOOKUP   │               │
          │ • Nmap       │  │ Target   │ │SearchSploit               │
          │ • SearchSploit│ │ Profile  │ │ (Local)  │               │
          │ • RAG Memory │  └──────────┘ └──────────┘               │
          └──────────────┘      │              │                     │
                     │          ▼              ▼                     │
                     └─> Intelligence Context <─┘                   │
                         (OS + Tech + CVEs)                         │
                                  │                                  │
                                  ▼                                  │
                         ┌──────────────────┐                       │
                         │  RAG Memory Query│←──────────────────────┘
                         │  • Playbooks     │  (Successful Techniques)
                         │  • Anti-Patterns │  (Failed Exploits)
                         └──────────────────┘
                                  │
                                  ▼
                         Enhanced Reasoner Context
                     (Profile + CVEs + Playbooks + Warnings)
```

### Subagents

| Agent              | Model              | Purpose                                                |
| ------------------ | ------------------ | ------------------------------------------------------ |
| **Reasoner**       | Claude Sonnet 4    | **STRATEGIC** planning - decides WHAT to do and WHY    |
| **Executor**       | Claude Haiku 4.5   | **TACTICAL** execution - decides HOW (tool selection)  |
| **MCP Agent**      | -                  | Executes security tools via MCP protocol               |
| **Data Cleaner**   | Claude Haiku 4.5   | Parses & enriches output (service categorization)      |
| **Profiler**       | Claude Haiku 3.5   | Target profiling (OS, tech stack, security posture)    |
| **VulnLookup**     | -                  | Exploit research via SearchSploit MCP (offline)        |
| **RAG Memory**     | -                  | Retrieves playbooks & anti-patterns from past tests    |
| **Evaluator**      | Claude Haiku 3.5   | Post-execution evaluation and ground truth labeling    |
| **Skills Loader**  | -                  | Loads skills + Memory Manager rules                    |
| **Session Logger** | -                  | JSONL logging for RAG Memory ETL pipeline              |

### Intelligence Layer + Evaluation Loop + RAG Memory (Phase 1-8 ✅)

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

```
src/
├── index.ts                        # Interactive entry point
├── config/
│   └── agent_rules.json            # Memory Manager rules (persistent)
├── skills/
│   └── nmap_skill.md               # Skill document
└── agent/
    ├── index.ts                    # Orchestrator with Intelligence + Evaluation
    ├── skillsLoader.ts             # Skills + Memory Manager
    └── definitions/
        ├── index.ts                # Exports
        ├── types.ts                # Shared types + Intelligence Layer types
        ├── reasoner.ts             # Reasoner (Sonnet 4) with tactical planning
        ├── executor.ts             # Executor (Haiku 4.5)
        ├── mcp-agent.ts            # MCP tool executor
        ├── data-cleaner.ts         # Data cleaner + service enrichment
        ├── profiler.ts             # Profiler (Haiku 3.5) - Phase 3 ✅
        ├── vuln-lookup.ts          # VulnLookup via SearchSploit - Phase 4a ✅
        └── evaluator.ts            # Evaluator (Haiku 3.5) - Phase 6 ✅

logs/
├── sessions/                       # JSONL session logs for RAG ETL
└── training_data/                  # Training pairs (JSON) for RLHF

docs/
├── Intelligence-and-Memory-Systems.md  # Unified documentation
└── Final_Architecture_Plan_with_Evaluation_Loop-0204-from-claude.md
```

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

- **Memory Manager**: Added CLAUDE.md-style preference injection
  - `remember <tool> <rule>` - Save tool preferences
  - `forget <tool>` - Clear preferences
  - `rules [tool]` - List saved rules
  - Rules persist in `agent_rules.json`
  - Rules auto-injected into Reasoner context
- **Interactive Entry Point**: Changed from CLI args to user-input mode
  - Welcome banner with ASCII art
  - Direct IP/hostname input auto-runs recon
  - Help system with examples
- **Documentation**: Added JSDoc comments to all functions
- **Architecture**: Exposed skillsLoader for Memory Manager access

### 2026-02-03 - Multi-Agent Architecture

- Implemented hierarchical multi-agent system
- Added Reasoner (Sonnet 4) for strategic planning
- Added Executor (Haiku 4.5) for workflow orchestration
- Added MCP Agent for tool execution
- Added Data Cleaner (Haiku 4.5) for parsing raw output
- Removed legacy single-agent implementation
- Environment variable for API key (removed hardcoded key)

**Agent Flow:**
Target → Reasoner (STRATEGIC: "scan for vulnerabilities") → Executor (TACTICAL: "nmap_port_scan + nmap_service_detection") → MCP Agent → DataCleaner → Intelligence Layer (Profiler + VulnLookup) → Tactical Plan → Evaluation Loop → Training Data → back to Reasoner

**Key Architectural Principle:**
- **Reasoner**: Outputs HIGH-LEVEL strategic actions (no tool names or parameters)
- **Executor**: Breaks down strategic actions into 1-N concrete tool calls with specific parameters
- This separation ensures the Executor can properly decompose complex actions into multiple steps

---

## Implementation Status

### ✅ Phase 1: Data Schema Enhancement (Complete)
- Intelligence Layer type definitions
- Service enrichment interfaces
- Tactical planning types
- Evaluation and training data structures

### ✅ Phase 2: Enhanced Data Cleaner (Complete)
- Service categorization (web, database, remote-access, etc.)
- Confidence scoring and criticality assessment
- Product/version extraction from banners
- DiscoveredService output format

### ✅ Phase 3: Profiler Agent (Complete)
- OS fingerprinting from service banners
- Technology stack inference (LAMP, Windows, etc.)
- Security posture assessment (hardened, standard, weak)
- Risk level classification (high-value, medium, low)
- Prompt caching for cost optimization

### ✅ Phase 4a: VulnLookup Agent (Complete)
- SearchSploit MCP integration
- Offline exploit lookup (local ExploitDB)
- CVE extraction and severity inference
- Platform-aware filtering
- PoC examination and path retrieval

### ✅ Phase 4b: RAG Memory Integration Points (Complete)
- SessionStep interface and JSONL logging structure
- Integration documentation and setup guide
- Directory structure for session logs
- Ready for RAG MCP Server deployment

### ✅ Phase 5: Reasoner Tactical Planning (Complete)
- TacticalPlanObject output with attack vectors
- Prediction metrics (confidence, rationale, success criteria)
- Intelligence context injection (target profile, CVEs)
- RAG memory context injection (anti-pattern warnings)
- Tactical plan parsing and validation

### ✅ Phase 6: Evaluator Agent (Complete)
- Post-execution evaluation (TP/FP/FN/TN labeling)
- Prediction vs. actual outcome comparison
- Training data generation (EvaluationResult)
- Confidence calibration and reasoning
- Fallback evaluation using pattern matching

### ✅ Phase 7: Orchestrator Integration (Complete)
- Intelligence Layer parallel execution (Profiler + VulnLookup)
- RAG memory recall before Reasoner decisions
- Evaluation loop for tactical plan attack vectors
- Training data persistence (JSON batches)
- Session logging (JSONL format for RAG ETL)
- Helper methods for data extraction and persistence

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

**Core Agent System** (4,178 lines):
| File | Lines | Purpose |
|------|-------|---------|
| `src/agent/index.ts` | 724 | Main orchestrator with Intelligence + Evaluation |
| `src/agent/skillsLoader.ts` | 519 | Skills loader + Memory Manager |
| `src/agent/definitions/reasoner.ts` | 488 | Reasoner agent (Sonnet 4) with tactical planning |
| `src/agent/definitions/types.ts` | 454 | TypeScript interfaces and type definitions |
| `src/agent/definitions/data-cleaner.ts` | 453 | Data cleaner with service enrichment |
| `src/agent/definitions/vuln-lookup.ts` | 380 | Vulnerability lookup via SearchSploit MCP |
| `src/agent/definitions/evaluator.ts` | 241 | Evaluator agent (Haiku 3.5) for outcome labeling |
| `src/agent/definitions/executor.ts` | 205 | Executor agent (Haiku 4.5) for workflow planning |
| `src/agent/definitions/mcp-agent.ts` | 181 | MCP protocol client for tool execution |
| `src/agent/definitions/profiler.ts` | 155 | Profiler agent (Haiku 3.5) for target profiling |
| `src/agent/definitions/index.ts` | 10 | Module exports |
| `src/index.ts` | 368 | Interactive CLI entry point |

**Skills & Knowledge Base** (805 lines):
| File | Lines | Purpose |
|------|-------|---------|
| `src/skills/nmap_skill.md` | 805 | Nmap expertise and best practices |

**Documentation** (4,470 lines):
| File | Lines | Purpose |
|------|-------|---------|
| `docs/Final_Architecture_Plan_with_Evaluation_Loop-0204-from-claude.md` | 2,178 | Complete architecture specification |
| `docs/Intelligence-and-Memory-Systems.md` | 731 | Intelligence Layer + RAG Memory guide |
| `docs/MULTI_AGENT_ARCHITECTURE-0203-from-claude.md` | 729 | Multi-agent architecture documentation |
| `README.md` | 642 | Project overview and usage guide |
| `CLAUDE.md` | 188 | Claude Code project instructions |

**Configuration** (60 lines):
| File | Lines | Purpose |
|------|-------|---------|
| `package.json` | 33 | NPM dependencies and scripts |
| `tsconfig.json` | 19 | TypeScript compiler configuration |
| `.prettierrc` | 8 | Code formatting rules |

**Total Project Size**: 9,513 lines of code and documentation

**Agent Breakdown**:
- 7 AI agents (Reasoner, Executor, MCP, DataCleaner, Profiler, VulnLookup, Evaluator)
- 3 Claude models (Sonnet 4, Haiku 4.5, Haiku 3.5)
- 4 major systems (Intelligence Layer, Evaluation Loop, RAG Memory, Skills System)
- 12+ TypeScript interfaces for type-safe agent communication

---

## Contributing

See the architecture plan at [docs/Final_Architecture_Plan_with_Evaluation_Loop-0204-from-claude.md](docs/Final_Architecture_Plan_with_Evaluation_Loop-0204-from-claude.md) for implementation details.

## License

ISC
