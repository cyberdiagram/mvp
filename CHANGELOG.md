# Changelog

All notable changes to this project are documented in this file.

---

### 2026-02-14 - Legacy Cleanup & Restructure (v3.1)

**Dead Code Removal:**
- Deleted `skills-loader.ts` (519 lines) — replaced by unified `SkillManager`
- Deleted `token-monitor.ts` (196 lines) — never imported or used
- Deleted `session-logger.ts` (127 lines) — never imported or used
- Removed `NmapHostResult` type — never imported anywhere
- Removed `DualMCPConfig` re-export from execution barrel

**Structural Changes:**
- Moved `EvaluatorAgent` from `definitions/` → `intelligence/` layer
- Moved `instrumentation.ts` from `src/` → `src/agent/utils/`
- Deleted `definitions/` directory entirely
- Replaced all `skillsLoader` references with `skillManager`
- Updated all barrel exports and import paths

**Net Result:** -911 lines of dead code removed

---

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
- Merged skills-loader + pentest-executor's `skills.ts` into `skill-manager.ts`
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
- **OpenTelemetry Integration**: `src/agent/utils/instrumentation.ts` initializes `NodeSDK` with `LangfuseSpanProcessor`, conditional on `LANGFUSE_SECRET_KEY` and `LANGFUSE_PUBLIC_KEY` environment variables
- **Reconnaissance Tracing**: `reconnaissance()` wrapped in `startActiveObservation` with nested spans per iteration and phase (Phase 0–4)
- **Graceful Shutdown**: `shutdownTracing()` flushes all pending spans to Langfuse before process exit
- **Session Metadata**: Traces include `sessionId`, target IP, and phase-specific input/output metadata

**Duplicate Operation Detection:**
- **Command Signature Tracking**: `executionHistory: Map<string, number>` tracks tool+args combinations across iterations
- **Loop Intervention**: When repeated commands detected, injects `[SYSTEM INTERVENTION - LOOP DETECTED]` warning with 4-step behavioral instructions into Reasoner context
- **Generic Behavioral Pattern**: Warnings are tool-agnostic, focusing on strategic redirection rather than hard-coded rules

**Database Exhaustion Detection:**
- **Negative Keyword Analysis**: Detects when all tool results contain failure indicators (`no results`, `not found`, `0 matches`, etc.)
- **Advisory Injection**: `[SYSTEM ADVICE - DATABASE EXHAUSTION]` warning redirects Reasoner to broader search strategies or mission completion

**Dynamic Tool Whitelist:**
- **JSON Configuration**: `src/config/allowed_tools.json` as single source of truth for 8 allowed MCP tools
- **Dynamic Loading**: `loadAllowedTools()` with multi-path resolution (works from both `src/` and `dist/`)
- **System Prompt Generation**: `TOOL_DESCRIPTIONS` map + `buildToolListing()` dynamically generates Executor's tool section
- **Tactical Plan Validation**: Both LLM-generated and Reasoner tactical plan steps validated against whitelist

**RAG Memory Agent Refactoring:**
- **`recallInternalWarnings()`**: Phase 0 method querying `anti_patterns` collection, returns formatted `[WARNING N]` text
- **`searchHandbook()`**: Phase 4b method querying `playbooks` collection with `session_playbook` vs industry categorization
- **Metadata Preservation**: `parseRAGOutput()` preserves server metadata (type, service, category, tags, source, cve)
- **Parameter Fix**: `top_k` → `n_results` for `rag_query_playbooks` (was silently returning default 3 results)

**OS Detection (nmap_os_detection):**
- **Server**: Added `OSDetectionSchema`, tool definition, and handler (`nmap -Pn -O --osscan-guess`) to `nmap-server-ts`
- **Client SDK**: Added `osDetection(target, ports?)` method to `nmap-client-ts`
- **Agent**: Added `case 'nmap_os_detection'` routing in `mcp-agent.ts`

**MCP Agent Cleanup:**
- **`rag_recall`**: `recall()` → `recallMyExperience()` (SDK primary method name)
- **`rag_query_playbooks`**: Removed `(this.ragMemoryClient as any).callTool(...)` hack → `searchSecurityHandbook(query, nResults)`

---

### 2026-02-08 - Agent Loop Hardening & Fingerprint Parsing Skills (v2.1)

**Executor-Reasoner Feedback Fixes:**
- **Tactical Plan Passthrough**: Executor checks `reasonerOutput.tactical_plan` first; if the Reasoner provided structured attack vectors, they are used directly — bypassing the LLM call entirely. Eliminates hallucinated tool names.
- **Tool Whitelist Enforcement**: New `ALLOWED_TOOLS` Set (9 tools across Nmap/SearchSploit/RAG) with strict system prompt constraint + post-LLM validation in `parsePlan()`. Hallucinated tools like `vulnerability_research` are filtered with warning logs.
- **Explicit Failure Feedback**: `_runToolExecutionLoop` now returns `{ results, failures }`. `_prepareNextObservation` includes failure reports (e.g., "WARNING — 3 tool(s) FAILED") so the Reasoner never misinterprets failed iterations as success.
- **Service Deduplication**: Services are deduplicated by `host:port` during extraction, keeping the entry with more detail (product/version). Prevents context bloat from redundant scans.

**Fingerprint Parsing Skills (DataCleaner Enhancement):**
- **Skill Injection**: `DataCleanerAgent` now supports `setSkillContext()` (mirrors ReasonerAgent pattern). Skill context is appended to the LLM system prompt during fallback parsing.
- **`fingerprint_parsing_skill.md`**: New skill file with identification rules for 15+ technologies:
  - Network appliances: pfSense, FortiGate, MikroTik
  - Middleware: WebLogic, Tomcat, JBoss/WildFly
  - CMS: WordPress, Joomla
  - Databases: Redis, Elasticsearch, MongoDB
  - ICS: Modbus, Siemens S7
  - Remote management: iLO, iDRAC, IPMI, VMware ESXi
- **Orchestrator Wiring**: Skills loaded and injected into both Reasoner and DataCleaner during `initialize()`

**Code Metrics:**
- Orchestrator: 1,117 → 1,360 lines (failure tracking, deduplication, skill wiring)
- Executor: 236 → 311 lines (whitelist, plan passthrough, validation)
- DataCleaner: 453 → 474 lines (skill injection)
- New: `fingerprint_parsing_skill.md` (156 lines)

---

### 2026-02-07 - Intelligence Phase Robustness & Orchestrator Refactoring

**Intelligence Layer Improvements:**
- **Incremental Intelligence Analysis**: Only analyzes NEW services (tracked via fingerprints)
  - Merges results into existing intelligence context
  - Deduplicates vulnerabilities by CVE ID
  - Keeps Reasoner up-to-date throughout entire mission
  - No missed services, no duplicate analysis
- **Retry Mechanism with Exponential Backoff**: Handles transient failures
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
- Added comprehensive testing section to README.md
- Memory system documented for future sessions

---

### 2026-02-07 - Layered Architecture Refactoring (v2.0)

**Major Structural Refactoring**: Migrated from flat directory structure to a layered architecture following the "Brains-Knowledge-Hands" metaphor.

**New Directory Structure:**
- **`core/`** - Orchestration layer with PentestAgent coordinator and global types
- **`intelligence/`** - Decision & analysis layer (ReasonerAgent, ProfilerAgent, EvaluatorAgent)
- **`knowledge/`** - Retrieval & memory layer (VulnLookupAgent, RAGMemoryAgent)
- **`execution/`** - Task execution layer (ExecutorAgent, MCPAgent, DataCleanerAgent)
- **`utils/`** - Support infrastructure (SkillManager, Instrumentation)

**Layer Documentation:**
- Added README.md in each layer explaining purpose, components, and dependencies
- Clear data flow diagrams showing intelligence → knowledge → execution pipeline
- Design principles and architectural constraints documented

**Benefits:**
- Logical separation of concerns (decision-making, retrieval, execution)
- Improved code navigation and onboarding
- Clear dependency flow enforced by directory structure
- Barrel exports for clean imports (`import { ReasonerAgent } from './intelligence'`)

**Migration Details:**
- All files moved using `git mv` to preserve history
- Import paths updated across entire codebase
- TypeScript compilation verified (no errors)
- Total refactoring time: ~5 hours

**Architecture Version**: Bumped to 2.0 to reflect major structural change

---

### 2026-02-06 - Evaluation Loop Implementation (Phase 5-7)

**Phase 5: Reasoner Tactical Planning**
- **Enhanced ReasonerAgent**: Generates TacticalPlanObject with attack vectors
  - Prediction metrics for each attack vector (confidence, rationale, success criteria)
  - Intelligence context injection (target profile, services, vulnerabilities)
  - RAG memory context injection for anti-pattern warnings
  - Tactical plan parsing and validation
- **System Prompt Enhancement**: Added tactical planning instructions with examples
- **Context Management**: `setIntelligenceContext()` and `injectMemoryContext()` methods

**Phase 6: Evaluator Agent**
- **EvaluatorAgent**: Post-execution evaluation and outcome labeling
  - Compares predicted outcomes vs. actual tool outputs
  - Ground truth labels: true_positive, false_positive, false_negative, true_negative
  - Confidence scoring for evaluation quality
  - Fallback evaluation using regex pattern matching
  - Prompt caching enabled (~90% token cost reduction)
- **Model**: Claude Haiku 3.5 for fast, cost-effective evaluation

**Phase 7: Orchestrator Integration**
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

### 2026-02-06 - Intelligence Layer & RAG Memory Integration (Phase 1-4)

**Phase 1-3: Intelligence Layer Foundation**
- **Enhanced Data Cleaner**: Service categorization, confidence scoring, criticality assessment
- **ProfilerAgent**: OS fingerprinting, tech stack inference, security posture assessment
- **Type System**: Comprehensive interfaces for intelligence-driven operations
  - `DiscoveredService`, `TargetProfile`, `IntelligenceContext`
  - `TacticalPlanObject`, `EvaluationResult`, `TrainingPair`

**Phase 4a: VulnLookup Agent**
- **VulnLookupAgent**: Exploit research via SearchSploit MCP Server
  - Offline-capable (local ExploitDB database)
  - No rate limits, instant exploit lookup
  - CVE mapping with severity inference
  - Platform-aware filtering (Linux/Windows)
  - PoC code examination and local path retrieval

**Phase 4b: RAG Memory Integration Points**
- **Session Logging**: JSONL format for ETL pipeline consumption
- **SessionStep Interface**: Structured logging of agent decisions
- **Integration Documentation**: [docs/RAG-Memory-Integration.md](docs/RAG-Memory-Integration.md)
- **Directory Structure**: `logs/sessions/` for session logs

**Performance Optimizations:**
- Prompt caching enabled for ProfilerAgent (~90% token cost reduction)
- Parallel intelligence gathering (Profiler + VulnLookup)

### 2026-02-05 - Memory Manager & Interactive Mode
- **Memory Manager**: CLAUDE.md-style preference injection (`remember`, `forget`, `rules` commands)
- **Interactive REPL**: Welcome banner, direct IP/hostname input, help system
- **Documentation**: JSDoc comments, exposed SkillManager for Memory Manager

### 2026-02-03 - Multi-Agent Architecture (Initial Release)
- Hierarchical multi-agent system: Reasoner (Sonnet 4), Executor (Haiku 4.5), MCP Agent, Data Cleaner
- Environment variable for API key (removed hardcoded key)

**Agent Flow:**
Target → Reasoner (STRATEGIC: "scan for vulnerabilities") → Executor (TACTICAL: "nmap_port_scan + nmap_service_detection") → MCP Agent → DataCleaner → Intelligence Layer (Profiler + VulnLookup) → Tactical Plan → Evaluation Loop → Training Data → back to Reasoner

**Key Architectural Principle:**
- **Reasoner**: Outputs HIGH-LEVEL strategic actions (no tool names or parameters)
- **Executor**: Breaks down strategic actions into 1-N concrete tool calls with specific parameters
- This separation ensures the Executor can properly decompose complex actions into multiple steps
