# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

MVP is an AI-powered penetration testing agent that uses Claude AI with Model Context Protocol (MCP) servers for automated security reconnaissance. The agent reasons about attack strategies, executes security tools (Nmap, etc.), and interprets results to guide penetration testing workflows.

## Build and Run Commands

```bash
npm run build      # Compile TypeScript to dist/
npm run start      # Run compiled agent (node dist/index.js)
npm run dev        # Build and run in one command

# CLI Usage
npm start recon <target>    # Run reconnaissance on specific target
npm start interactive       # Interactive mode for extended testing
```

## Architecture

### Core Components

**Agent System** (`src/agent/`):
- `reasoner.ts` - LLM reasoning engine that interfaces with Claude API, maintains conversation history, and parses responses into structured actions (tool, arguments, reasoning)
- `executor.ts` - MCP tool execution layer that routes tool calls (nmap_*, gobuster_*, sqlmap_*) to appropriate MCP clients
- `skillsLoader.ts` - Dynamic skill management that loads skill definitions from markdown files (`*_skill.md`), matches skills to context via keyword relevance

**Utilities** (`src/utils/`):
- `parser.ts` - Parses Nmap output into structured Host/Port objects
- `logger.ts` - Structured file logging with timestamp, level, message, data
- `rateLimiter.ts` - Token bucket rate limiting

**Configuration**:
- `src/config.ts` - Model configuration (claude-sonnet-4-20250514, max tokens)
- `src/index.ts` - Main entry point, initializes PentestAgent

**Skills** (`src/skills/`):
- Markdown files containing tool-specific decision frameworks and prompts
- Currently includes `nmap_skill.md` for reconnaissance guidance

### Data Flow

1. Target input → Reasoner consults skill documents → Claude API decides next action
2. Executor routes tool calls to MCP clients → Tool execution
3. Results parsed and fed back to reasoner → Adaptive strategy loop

## Dependencies

- `@anthropic-ai/sdk` - Claude API client
- `@anthropic-ai/claude-agent-sdk` - Agent framework
- `@cyber/mcp-nmap-client` - Custom MCP client for Nmap (linked via yalc)

## Code Style

Prettier configured: semicolons, ES5 trailing commas, single quotes, 100 char width, 2-space tabs
