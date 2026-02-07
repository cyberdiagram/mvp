# Knowledge Layer

**Purpose**: Knowledge retrieval and memory systems (The "Memory")

## Components

- **`vuln-lookup.ts`** - `VulnLookupAgent`
  - Vulnerability research via SearchSploit MCP Server
  - Offline-capable local ExploitDB queries
  - CVE mapping and severity inference
  - PoC code examination and platform filtering
  - **Output**: `VulnerabilityInfo[] { cve, title, severity, exploit_path }`

- **`rag-memory-agent.ts`** - `RAGMemoryAgent`
  - Retrieves security playbooks from ChromaDB
  - Fetches anti-pattern warnings from past failures
  - Context-aware semantic search
  - Injects historical knowledge into Reasoner context
  - **Output**: `RAGContext { playbooks, anti_patterns }`

## Dependencies

**Reads from**:
- Execution Layer (MCPAgent for tool calls)
- Core Layer (Types)
- External: SearchSploit MCP Server, ChromaDB/RAG Memory MCP Server

**Writes to**:
- Intelligence Layer (Provides context to ReasonerAgent)

**Read-Only Operations**: Knowledge agents retrieve information but never modify external state.

## Data Flow

```
DiscoveredService → VulnLookupAgent → SearchSploit MCP → VulnerabilityInfo
TargetProfile → RAGMemoryAgent → ChromaDB MCP → Playbooks/Anti-Patterns
                                              ↓
                          Both feed into ReasonerAgent's IntelligenceContext
```

## Design Principles

- **Separation of Retrieval from Decision**: Knowledge agents fetch data, Intelligence agents decide what to do with it
- **Offline-First**: VulnLookup works without internet (local ExploitDB)
- **Learning Loop**: RAG Memory enables the system to learn from past experiences
- **No Tool Selection**: Knowledge agents provide context but don't decide actions
