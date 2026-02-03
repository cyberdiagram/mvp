# MVP - AI-Powered Penetration Testing Agent

> Last Updated: 2026-02-03

An AI-powered penetration testing agent using Claude AI with a multi-agent architecture for automated security reconnaissance.

## Architecture

```
┌─────────────────────────────────────────────┐
│              ORCHESTRATOR                   │
│         (src/agent/index.ts)                │
└─────────────────────────────────────────────┘
         │           │           │
         ▼           ▼           ▼
   ┌──────────┐ ┌──────────┐ ┌──────────┐
   │ REASONER │ │ EXECUTOR │ │  DATA    │
   │ (sonnet) │ │ (haiku)  │ │ CLEANER  │
   │          │ │          │ │ (haiku)  │
   └──────────┘ └──────────┘ └──────────┘
                     │
                     ▼
              ┌──────────┐
              │MCP AGENT │
              │  (nmap)  │
              └──────────┘
```

### Subagents

| Agent            | Model            | Purpose                                       |
| ---------------- | ---------------- | --------------------------------------------- |
| **Reasoner**     | claude-sonnet-4  | Strategic attack planning, interprets results |
| **Executor**     | claude-3-5-haiku | Breaks plans into executable steps            |
| **MCP Agent**    | -                | Executes nmap tools via MCP protocol          |
| **Data Cleaner** | claude-3-5-haiku | Parses raw output into structured JSON        |

## Project Structure

```
src/
├── index.ts                        # Entry point
├── skills/
│   └── nmap_skill.md               # Skill document
└── agent/
    ├── index.ts                    # Orchestrator
    ├── skillsLoader.ts             # Skills loader
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

# Run reconnaissance on target
npm start recon <target>

# Interactive mode
npm start interactive
```

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

### 2026-02-03 - Multi-Agent Architecture

- Implemented hierarchical multi-agent system
- Added Reasoner (sonnet) for strategic planning
- Added Executor (haiku) for workflow orchestration
- Added MCP Agent for tool execution
- Added Data Cleaner (haiku) for parsing raw output
- Removed legacy single-agent implementation
- Environment variable for API key (removed hardcoded key)

Target → Reasoner (decides action) → Executor (creates steps) → MCP Agent (runs tools) → DataCleaner (parses output) → back to Reasoner
