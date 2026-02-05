# MVP - AI-Powered Penetration Testing Agent

> Last Updated: 2026-02-05

An AI-powered penetration testing agent using Claude AI with a multi-agent architecture for automated security reconnaissance.

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                     ORCHESTRATOR                         │
│                  (src/agent/index.ts)                    │
└─────────────────────────────────────────────────────────┘
         │           │           │           │
         ▼           ▼           ▼           ▼
   ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐
   │ REASONER │ │ EXECUTOR │ │  DATA    │ │  SKILLS  │
   │ (sonnet) │ │ (haiku)  │ │ CLEANER  │ │  LOADER  │
   │          │ │          │ │ (haiku)  │ │ +Memory  │
   └──────────┘ └──────────┘ └──────────┘ └──────────┘
                     │                          │
                     ▼                          ▼
              ┌──────────┐              ┌──────────────┐
              │MCP AGENT │              │agent_rules   │
              │  (nmap)  │              │   .json      │
              └──────────┘              └──────────────┘
```

### Subagents

| Agent            | Model            | Purpose                                       |
| ---------------- | ---------------- | --------------------------------------------- |
| **Reasoner**     | claude-sonnet-4  | Strategic attack planning, interprets results |
| **Executor**     | claude-haiku-4.5 | Breaks plans into executable steps            |
| **MCP Agent**    | -                | Executes nmap tools via MCP protocol          |
| **Data Cleaner** | claude-haiku-4.5 | Parses raw output into structured JSON        |
| **Skills Loader**| -                | Loads skills + Memory Manager rules           |

## Project Structure

```
src/
├── index.ts                        # Interactive entry point
├── config/
│   └── agent_rules.json            # Memory Manager rules (persistent)
├── skills/
│   └── nmap_skill.md               # Skill document
└── agent/
    ├── index.ts                    # Orchestrator
    ├── skillsLoader.ts             # Skills + Memory Manager
    └── definitions/
        ├── index.ts                # Exports
        ├── types.ts                # Shared types
        ├── reasoner.ts             # Reasoner (sonnet)
        ├── executor.ts             # Executor (haiku)
        ├── mcp-agent.ts            # MCP tool executor
        └── data-cleaner.ts         # Data cleaner (haiku)
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
export ANTHROPIC_API_KEY="your-api-key"
export NMAP_SERVER_PATH="/path/to/nmap-server-ts/dist/index.js"  # Optional
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
                    AI-Powered Penetration Testing Agent v1.0

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
- Added Reasoner (sonnet) for strategic planning
- Added Executor (haiku) for workflow orchestration
- Added MCP Agent for tool execution
- Added Data Cleaner (haiku) for parsing raw output
- Removed legacy single-agent implementation
- Environment variable for API key (removed hardcoded key)

Target → Reasoner (decides action) → Executor (creates steps) → MCP Agent (runs tools) → DataCleaner (parses output) → back to Reasoner
