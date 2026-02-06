# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

MVP is an AI-powered penetration testing agent using a hierarchical multi-agent architecture. The system combines Claude AI (Sonnet 4 and Haiku 4.5 models) with Model Context Protocol (MCP) servers for automated security reconnaissance.

## Build and Run Commands

```bash
npm run build      # Compile TypeScript to dist/
npm start          # Run interactive agent (node dist/index.js)
npm run dev        # Build and run in one command
```

The application starts in **interactive mode** with a REPL interface. Available commands:

| Command | Description | Example |
|---------|-------------|---------|
| `recon <target>` | Run reconnaissance on target | `recon 192.168.1.0/24` |
| `remember <tool> <rule>` | Save a tool preference | `remember nmap use -Pn` |
| `forget <tool>` | Clear all preferences for a tool | `forget nmap` |
| `rules [tool]` | List saved preferences | `rules` or `rules nmap` |
| `help` | Show help message | `help` |
| `exit` | Quit the application | `exit` |
| `<IP or hostname>` | Auto-run recon on target | `192.168.1.10` |

## Multi-Agent Architecture

The system uses a **5-agent hierarchy** coordinated by an orchestrator:

```
ORCHESTRATOR (src/agent/index.ts)
├── Reasoner (Sonnet 4) - STRATEGIC: Decides WHAT to do and WHY (no tool selection)
├── Executor (Haiku 4.5) - TACTICAL: Decides HOW with specific tool calls (1-N steps)
├── MCP Agent - Executes security tools via MCP protocol
├── Data Cleaner (Haiku 4.5) - Parses raw output into structured JSON
└── Profiler (Haiku 3.5) - Target profiling and intelligence analysis
```

**Agent Flow**: Target → Reasoner (strategic action: "scan for vulnerabilities") → Executor (tactical breakdown: "nmap_port_scan + nmap_service_detection") → MCP Agent (runs tools) → DataCleaner (parses & enriches) → Profiler (analyzes profile) → back to Reasoner with intelligence context

**Key Architectural Principle**: Reasoner outputs HIGH-LEVEL strategic actions without tool names or parameters. Executor breaks these down into 1-N concrete tool calls. This separation allows proper multi-step decomposition.

### Key Components

**Orchestrator** ([src/agent/index.ts](src/agent/index.ts)):
- `PentestAgent` class coordinates all subagents
- `initialize()` - Loads skills and connects to MCP servers
- `reconnaissance(target)` - Automated recon mode (max 15 iterations)
- `interactive()` - REPL mode for manual queries
- `skillsLoader` - Exposed publicly for Memory Manager access

**Subagent Definitions** ([src/agent/definitions/](src/agent/definitions/)):
- [reasoner.ts](src/agent/definitions/reasoner.ts) - `ReasonerAgent` (Sonnet 4) outputs strategic actions (WHAT/WHY, no tools)
- [executor.ts](src/agent/definitions/executor.ts) - `ExecutorAgent` (Haiku 4.5) breaks down actions into tool steps (HOW)
- [mcp-agent.ts](src/agent/definitions/mcp-agent.ts) - `MCPAgent` for tool execution via MCP
- [data-cleaner.ts](src/agent/definitions/data-cleaner.ts) - `DataCleanerAgent` (Haiku 4.5) for parsing and service categorization
- [profiler.ts](src/agent/definitions/profiler.ts) - `ProfilerAgent` (Haiku 3.5) for target profiling
- [types.ts](src/agent/definitions/types.ts) - Shared interfaces and Intelligence Layer types

**Reasoner Output (Strategic)**: `{ thought, action, is_complete }` - No tool/arguments fields
**Executor Output (Tactical)**: `{ steps: [{ tool, arguments, description }], current_step, status }`

**Skills & Memory Manager** ([src/agent/skillsLoader.ts](src/agent/skillsLoader.ts)):
- Loads skill documents from [src/skills/](src/skills/)*.md files
- `buildSkillContext(keywords)` matches skills by keyword relevance
- **Memory Manager**: Persists tool preferences to [src/config/agent_rules.json](src/config/agent_rules.json)
- Rules are automatically injected into Reasoner's system prompt
- Follows CLAUDE.md-style "soft prompts over hard code" pattern
- Methods: `addRule(tool, rule)`, `removeRule(tool)`, `listRules(tool?)`

**Entry Point** ([src/index.ts](src/index.ts)):
- Loads configuration from environment variables
- Initializes PentestAgent with MCP server paths
- Starts interactive REPL with command parsing

**Intelligence Layer** (Phase 1-5 implemented):
The system now includes an Intelligence Layer with tactical planning:

- **Enhanced DataCleaner**: Outputs `DiscoveredService` format with:
  - Service categorization (web, database, remote-access, etc.)
  - Confidence scoring (0-1 based on detection reliability)
  - Criticality assessment (high, medium, low)
  - Product/version extraction from banners

- **ProfilerAgent**: Analyzes discovered services to generate `TargetProfile`:
  - OS fingerprinting (family and version)
  - Technology stack inference (LAMP, Windows Server, etc.)
  - Security posture assessment (hardened, standard, weak)
  - Risk level classification (high-value, medium, low)
  - Evidence-based reasoning with supporting observations

- **VulnLookupAgent**: Exploit research via SearchSploit MCP:
  - Offline vulnerability lookup (local ExploitDB)
  - CVE mapping with severity inference
  - PoC availability and examination
  - Platform-aware filtering

- **Enhanced ReasonerAgent** (Phase 5): Intelligence-driven tactical planning:
  - Intelligence context injection (profile, vulnerabilities)
  - RAG memory integration (anti-pattern warnings)
  - Tactical plan generation with attack vectors
  - Prediction metrics (confidence scores, success criteria)
  - MITRE ATT&CK mapping and CVE correlation

- **Type System**: New interfaces in types.ts for intelligence-driven operations:
  - `DiscoveredService` - Enriched service metadata
  - `TargetProfile` - OS, tech stack, security assessment
  - `VulnerabilityInfo` - CVE/exploit data
  - `IntelligenceContext` - Combined intelligence data
  - `TacticalPlanObject` - Attack planning with predictions
  - `EvaluationResult` - Outcome evaluation (for Phase 6)
  - `TrainingPair` - ML training data (for Phase 6)

## Memory Manager System

The Memory Manager allows users to teach the agent their tool preferences. Rules are persisted to `src/config/agent_rules.json` and automatically injected into the Reasoner's context on every query.

**Data Flow**:
```
User Command → Memory Manager → agent_rules.json
                              ↓
                      Reasoner Context Injection
```

**Example Rules Format** (agent_rules.json):
```json
{
  "nmap": [
    "After host discovery confirms host is up, ALL subsequent scans MUST include -Pn to skip redundant ping probes",
    "use -T4 for faster scans"
  ],
  "gobuster": [
    "use -t 50 threads for speed"
  ]
}
```

Rules are injected into the Reasoner's system prompt as:
```
# Tool Preferences (IMPORTANT - Follow these rules)
## nmap
- After host discovery confirms host is up, ALL subsequent scans MUST include -Pn
- use -T4 for faster scans
```

## Data Structures

Key interfaces in [src/agent/definitions/types.ts](src/agent/definitions/types.ts):

**Core Agent Types:**
- `ReasonerOutput` - Strategic decisions (thought, action, is_complete, tactical_plan) - **NO tool/arguments**
- `ExecutorPlan` - Execution plan with ordered steps and status
- `ExecutorStep` - Single atomic tool call (tool, arguments, description)
- `ToolResult` - Raw MCP tool output (success, output, error)
- `CleanedData` - Structured data after parsing (type, data, summary, intelligence)
- `NmapScanResult` - Parsed Nmap results (hosts, ports, services, versions)

**Intelligence Layer Types (Phase 1-3):**
- `DiscoveredService` - Enriched service with category, criticality, confidence
- `TargetProfile` - OS, tech stack, security posture, risk level
- `IntelligenceContext` - Combined intelligence (services, profile, vulnerabilities)

**Tactical Planning Types (Phase 4-6, ready for implementation):**
- `VulnerabilityInfo` - CVE/exploit data from VulnLookup
- `AttackAction`, `PredictionMetrics`, `AttackVector` - Attack planning
- `TacticalPlanObject` - Complete tactical plan from Reasoner
- `EvaluationResult` - Post-execution evaluation
- `TrainingPair` - ML training data for RLHF

## Environment Setup

**Required Environment Variables**:
- `ANTHROPIC_API_KEY` - Claude API key (required, application exits if missing)
- `NMAP_SERVER_PATH` - Path to nmap MCP server (optional, defaults to `../pentest-mcp-server/nmap-server-ts/dist/index.js`)

**MCP Client (yalc)**: The `@cyber/mcp-nmap-client` package is linked locally via yalc:

```bash
# In the mcp-nmap-client repo:
npm run build && yalc publish

# In this repo:
yalc add @cyber/mcp-nmap-client && npm install
```

## Code Style

Prettier configuration ([.prettierrc](.prettierrc)): Semicolons required, single quotes, ES5 trailing commas, 100 char line width, 2-space indentation

TypeScript: Target ES2022, CommonJS modules, strict mode, output to dist/
