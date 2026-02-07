# Execution Layer

**Purpose**: Task execution and output processing (The "Hands")

## Components

- **`executor.ts`** - `ExecutorAgent` (Claude Haiku 4.5)
  - Tactical breakdown: Decides HOW to execute actions
  - Converts high-level strategic actions into 1-N concrete tool steps
  - Selects specific tools and parameters
  - Ensures proper step sequencing
  - **Output**: `ExecutorPlan { steps: ExecutorStep[], current_step, status }`

- **`mcp-agent.ts`** - `MCPAgent`
  - Tool execution via Model Context Protocol (MCP)
  - Routes calls to Nmap, SearchSploit, RAG Memory MCP servers
  - Manages MCP client connections
  - Handles tool-specific argument mapping
  - **Output**: `ToolResult { success, output, error }`

- **`data-cleaner.ts`** - `DataCleanerAgent` (Claude Haiku 4.5)
  - Parses raw tool output into structured JSON
  - Service categorization (web, database, remote-access, etc.)
  - Confidence scoring and criticality assessment
  - Product/version extraction from banners
  - **Output**: `CleanedData { type, data, summary, intelligence }`

## Dependencies

**Reads from**:
- Intelligence Layer (ReasonerOutput with strategic actions)
- Core Layer (Types)
- External: MCP Servers (Nmap, SearchSploit, RAG)

**Writes to**:
- Core Orchestrator (ToolResult, CleanedData)
- Intelligence Layer (Feeds DataCleanerAgent output to ProfilerAgent)

**Direct Tool Access**: Only this layer executes actual security tools.

## Data Flow

```
ReasonerOutput → ExecutorAgent → ExecutorPlan
                                      ↓
ExecutorPlan → MCPAgent → MCP Servers → ToolResult
                                            ↓
ToolResult → DataCleanerAgent → CleanedData (DiscoveredService[])
```

## Design Principles

- **Tactical Not Strategic**: Executor breaks down "scan for vulnerabilities" into specific Nmap commands
- **Separation of Execution from Parsing**: MCPAgent runs tools, DataCleanerAgent structures output
- **Tool Abstraction**: MCP protocol allows adding new tools without changing agent logic
- **Fast Models**: Uses Haiku for speed and cost efficiency (simple tasks)
