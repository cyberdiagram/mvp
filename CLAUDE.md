# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

MVP is an AI-powered penetration testing agent using a hierarchical multi-agent architecture. The system combines Claude AI (Sonnet and Haiku models) with Model Context Protocol (MCP) servers for automated security reconnaissance.

## Build and Run Commands

```bash
npm run build      # Compile TypeScript to dist/
npm start          # Run compiled agent (node dist/index.js)
npm run dev        # Build and run in one command

# CLI Usage
npm start recon <target>    # Run reconnaissance on specific target
npm start interactive       # Interactive REPL mode
```

## Multi-Agent Architecture

The system uses four specialized subagents coordinated by an orchestrator:

```
ORCHESTRATOR (src/agent/index.ts)
├── Reasoner (Sonnet) - Strategic brain for attack planning
├── Executor (Haiku) - Breaks plans into executable tool steps
├── MCP Agent - Executes security tools via MCP protocol
└── Data Cleaner (Haiku) - Parses raw output into structured JSON
```

### Agent Flow

```
Target → Reasoner (decides action)
      → Executor (creates steps)
      → MCP Agent (runs tools)
      → DataCleaner (parses output)
      → back to Reasoner with results
```

### Key Components

**Orchestrator** ([src/agent/index.ts](src/agent/index.ts)):
- `PentestAgent` class coordinates all subagents
- Runs main reconnaissance loop (max 15 iterations)
- Aggregates results and handles agent communication
- `reconnaissance(target)` - automated recon mode
- `interactive()` - REPL mode for manual queries

**Subagent Definitions** ([src/agent/definitions/](src/agent/definitions/)):
- [reasoner.ts](src/agent/definitions/reasoner.ts) - `ReasonerAgent` (Sonnet) for strategic decisions
- [executor.ts](src/agent/definitions/executor.ts) - `ExecutorAgent` (Haiku) for workflow sequencing
- [mcp-agent.ts](src/agent/definitions/mcp-agent.ts) - `MCPAgent` for tool execution via MCP
- [data-cleaner.ts](src/agent/definitions/data-cleaner.ts) - `DataCleanerAgent` (Haiku) for parsing
- [types.ts](src/agent/definitions/types.ts) - Shared interfaces (ReasonerOutput, ExecutorPlan, ToolResult, CleanedData, NmapScanResult)

**Skills System** ([src/agent/skillsLoader.ts](src/agent/skillsLoader.ts)):
- Loads skill documents from [src/skills/](src/skills/) markdown files
- `buildSkillContext(keywords)` matches skills by keyword relevance
- Skills injected into Reasoner's system prompt for decision-making

**Entry Point** ([src/index.ts](src/index.ts)):
- Loads configuration from environment variables
- Initializes PentestAgent with MCP server paths
- Parses CLI arguments and routes to recon/interactive mode

## Data Structures

Key interfaces defined in [src/agent/definitions/types.ts](src/agent/definitions/types.ts):

- `ReasonerOutput` - Strategic decisions from Reasoner (thought, action, tool, arguments, is_complete)
- `ExecutorPlan` - Execution plan with ordered steps and status tracking
- `ExecutorStep` - Single atomic tool call (tool name, arguments, description)
- `ToolResult` - Raw output from MCP tool execution (success, output, error)
- `CleanedData` - Structured data after DataCleaner parsing (type, data, summary)
- `NmapScanResult` - Parsed Nmap results (hosts, ports, services, versions)

## Environment Setup

**Required Environment Variables**:
- `ANTHROPIC_API_KEY` - Claude API key (required, application exits if missing)
- `NMAP_SERVER_PATH` - Path to nmap MCP server (optional, defaults to `../pentest-mcp-server/nmap-server-ts/dist/index.js`)

**MCP Client (yalc)**:

The `@cyber/mcp-nmap-client` package is linked locally via yalc:

```bash
# In the mcp-nmap-client repo:
npm run build && yalc publish

# In this repo:
yalc add @cyber/mcp-nmap-client
npm install
```

## TypeScript Configuration

- Target: ES2022, CommonJS modules
- Strict mode enabled
- Output: [dist/](dist/) directory
- Source maps and declarations generated
- [tsconfig.json](tsconfig.json) - Full TypeScript configuration

## Code Style

Prettier configuration ([.prettierrc](.prettierrc)):
- Semicolons required
- Single quotes
- ES5 trailing commas
- 100 character line width
- 2-space indentation (spaces, not tabs)
