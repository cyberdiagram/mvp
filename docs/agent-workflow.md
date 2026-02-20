# AI Agent Workflow: Reconnaissance → Tactical Planning → Exploit Execution

This document illustrates the full workflow of the MVP Pentest Agent, from initialization through reconnaissance iterations to tactical plan generation and exploit execution.

---

## Full Workflow Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         INITIALIZATION                                       │
│  SkillManager.loadSkills() → inject into Reasoner + DataCleaner             │
│  DualMCPAgent.initialize() → connect RAG (stdio) + Kali (HTTP)              │
│  mcpAgent.listTools() → discover Kali tools dynamically → build ALLOWED_TOOLS│
│  new ExecutorAgent(allTools) → new AgenticExecutor(mcpAgent, skillManager)  │
└────────────────────────────┬────────────────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│   reconnaissance(target)                                                     │
│   observation = "Starting reconnaissance on: <target>"                       │
│   iteration = 0, maxIterations = 15                                          │
└────────────────────────────┬────────────────────────────────────────────────┘
                             │
                             ▼
                    ╔════════════════╗
                    ║ while loop     ║ ◄──────────────────────────────────────┐
                    ║ iteration < 15 ║                                         │
                    ║ !missionComplete║                                        │
                    ╚═══════╦════════╝                                         │
                            │                                                  │
                            ▼                                                  │
        ┌───────────────────────────────────┐                                  │
        │  PHASE 0: RAG Memory Recall       │  (only if ENABLE_RAG_MEMORY)     │
        │                                   │                                  │
        │  ragMemory.recallInternalWarnings(│                                  │
        │    observation)                   │                                  │
        │                                   │                                  │
        │  → antiPatterns[] found?          │                                  │
        │    YES → reasoner.injectMemory    │                                  │
        │          Context(formattedText)   │                                  │
        │    NO  → continue                 │                                  │
        └───────────────┬───────────────────┘                                  │
                        │                                                       │
                        ▼                                                       │
        ┌───────────────────────────────────┐                                  │
        │  PHASE 1: Strategic Reasoning     │                                  │
        │  Model: Claude Sonnet 4           │                                  │
        │                                   │                                  │
        │  System prompt includes:          │                                  │
        │  ├── Base strategy prompt         │                                  │
        │  ├── Skill context (cached)       │                                  │
        │  ├── Intelligence context         │                                  │
        │  │   (services, profile, CVEs)    │                                  │
        │  └── RAG memory warnings          │                                  │
        │                                   │                                  │
        │  reasoner.reason(observation)     │                                  │
        │  → ReasonerOutput {               │                                  │
        │      thought: "...",              │                                  │
        │      action: "...",               │                                  │
        │      is_complete: bool,           │                                  │
        │      tactical_plan?: {...}        │                                  │
        │    }                              │                                  │
        └───────────────┬───────────────────┘                                  │
                        │                                                       │
                        ▼                                                       │
        ┌───────────────────────────────────┐                                  │
        │  GENERATE TACTICAL PLAN           │                                  │
        │                                   │                                  │
        │  if (reasoning.tactical_plan) {   │                                  │
        │    allTacticalPlans.push(plan)    │                                  │
        │  }                                │                                  │
        │                                   │                                  │
        │  Conditions met when:             │                                  │
        │  ✓ Intel context set (Phase 4     │                                  │
        │    has run at least once)         │                                  │
        │  ✓ CVEs found (vulns.length > 0)  │                                  │
        │  ✓ Services have product+version  │                                  │
        │  ✓ RAG playbooks injected         │                                  │
        │    (boosts quality, optional)     │                                  │
        │                                   │                                  │
        │  tactical_plan structure:         │                                  │
        │  { plan_id, target_ip,            │                                  │
        │    attack_vectors[] {             │                                  │
        │      priority, action {           │                                  │
        │        tool_name,                 │                                  │
        │        command_template,          │                                  │
        │        parameters },              │                                  │
        │      prediction_metrics {         │                                  │
        │        classification,            │                                  │
        │        hypothesis,                │                                  │
        │        success_criteria },        │                                  │
        │      rag_context {                │                                  │
        │        payload_snippet,           │                                  │
        │        insight,                   │                                  │
        │        exploitation_logic }       │                                  │
        │    }, created_at }                │                                  │
        └───────────────┬───────────────────┘                                  │
                        │                                                       │
                        ▼                                                       │
              ┌─────────────────┐                                               │
              │ is_complete?    │                                               │
              │ true ──────────►│─────────────────────────────────────────────►┤
              │ false ──────────┘                                              ││
              └────────┬────────┘                           EXIT LOOP          ││
                       │                              (is_complete OR          ││
                       │                               maxIterations=15)       ││
                       │                                                       ││
                       │                    ┌──────────────────────────────────┘│
                       │                    │                                   │
                       │                    ▼                                   │
                       │    ┌───────────────────────────────────┐              │
                       │    │  POST-LOOP: Save Tactical Plans   │              │
                       │    │                                   │              │
                       │    │  if (allTacticalPlans.length > 0) │              │
                       │    │    displayTacticalPlan(plan)       │              │
                       │    │    saveTacticalPlans(plans,target) │              │
                       │    │    → Tactical/<sessionId>_         │              │
                       │    │        <plan_id>.json              │              │
                       │    │                                   │              │
                       │    │  Used by: plan <json-file> CLI    │              │
                       │    │  → 4 AgenticExecutor strategies   │              │
                       │    └───────────────────────────────────┘              │
                       │                                                        │
                       ▼                                                        │
        ┌───────────────────────────────────────────────────────┐              │
        │  PHASE 2: Tactical Execution Planning                  │              │
        │  Model: Claude Haiku 4.5  (or bypassed)               │              │
        │                                                        │              │
        │  ┌─── Does ReasonerOutput have tactical_plan? ──────┐ │              │
        │  │                                                   │ │              │
        │  │  YES (attack phase, services + CVEs known)        │ │              │
        │  │  └─► BYPASS LLM CALL — use plan directly         │ │              │
        │  │       attack_vectors.sort(priority)               │ │              │
        │  │       → map to ExecutorSteps                      │ │              │
        │  │       → validate each tool against ALLOWED_TOOLS  │ │              │
        │  │       → reject hallucinated tool names            │ │              │
        │  │                                                   │ │              │
        │  │  NO (recon phase, no attack vectors yet)          │ │              │
        │  │  └─► LLM CALL (Haiku 4.5)                        │ │              │
        │  │       input: thought + action + context           │ │              │
        │  │       → parsePlan() → ExecutorSteps               │ │              │
        │  │       → validate each tool against ALLOWED_TOOLS  │ │              │
        │  │       → reject hallucinated tool names            │ │              │
        │  └───────────────────────────────────────────────────┘ │              │
        │                                                        │              │
        │  Returns: ExecutorPlan { steps[], current_step: 0 }   │              │
        └───────────────────┬───────────────────────────────────┘              │
                            │                                                   │
                            ▼                                                   │
              ┌─────────────────────┐                                           │
              │ steps.length == 0?  │                                           │
              │ YES ───────────────►│──────► observation = "No executable steps"│
              │ NO ─────────────────┘                 └────────────────────────┘
              └──────┬──────────────┘                                           │
                     │                                                          │
                     ▼                                                          │
        ┌───────────────────────────────────────────────────────────┐          │
        │  PHASE 3: Tool Execution Loop                             │          │
        │                                                           │          │
        │  for each step in ExecutorPlan:                           │          │
        │                                                           │          │
        │  ① Duplicate Detection                                    │          │
        │    commandSignature = tool + JSON(args)                   │          │
        │    if seen before → log WARN, add to repeatedCommands[]   │          │
        │                                                           │          │
        │  ② MCP Agent executes tool                                │          │
        │    ┌─ rag_* tools ──────► RAG Memory server (stdio)       │          │
        │    └─ other tools ──────► Kali container (HTTP :3001)     │          │
        │                                                           │          │
        │  ③ DataCleaner (Haiku 4.5) parses raw output             │          │
        │    → CleanedData { type, summary, data[], ... }          │          │
        │                                                           │          │
        │  ④ Service Deduplication                                  │          │
        │    key = host:port                                         │          │
        │    if duplicate → keep entry with more detail             │          │
        │    if new      → push to allDiscoveredServices[]          │          │
        │                                                           │          │
        │  Returns: { results[], failures[], repeatedCommands[] }   │          │
        └──────────────────────┬────────────────────────────────────┘          │
                               │                                                │
                               ▼                                                │
        ┌───────────────────────────────────────────────────────────┐          │
        │  PHASE 4: Intelligence Analysis (Incremental)             │          │
        │                                                           │          │
        │  ① Fingerprint Check                                      │          │
        │    for each service → host:port:service:product:version   │          │
        │    filter to newServices (not in analyzedFingerprints Set) │          │
        │    if newServices.length == 0 → SKIP (return cached intel) │          │
        │                                                           │          │
        │  ② Run in PARALLEL (with retryWithBackoff, max 2 retries):│          │
        │                                                           │          │
        │    ┌─────────────────────┐  ┌───────────────────────────┐ │          │
        │    │ Profiler (Haiku 3.5)│  │ VulnLookup (SearchSploit) │ │          │
        │    │                     │  │                           │ │          │
        │    │ newServices →       │  │ newServices →             │ │          │
        │    │ TargetProfile {     │  │ searchsploit_search MCP   │ │          │
        │    │   os_family,        │  │ → VulnerabilityInfo[] {   │ │          │
        │    │   tech_stack,       │  │   cve_id, severity,       │ │          │
        │    │   security_posture, │  │   poc_available,          │ │          │
        │    │   risk_level        │  │   exploitdb_id            │ │          │
        │    │ }                   │  │ }                         │ │          │
        │    └──────────┬──────────┘  └────────────┬──────────────┘ │          │
        │               └─────────────┬─────────────┘               │          │
        │                             ▼                              │          │
        │  ③ Mark newServices as analyzed (add to fingerprint Set)  │          │
        │                                                           │          │
        │  ④ Merge with existing IntelligenceContext:               │          │
        │    Profile  → prefer newer/more detailed                  │          │
        │    CVEs     → deduplicate by cve_id (Map merge)           │          │
        │                                                           │          │
        │  ⑤ reasoner.setIntelligenceContext(merged)               │          │
        │                                                           │          │
        │  ⑥ Phase 4b: RAG Memory for Playbooks                    │          │
        │    ragMemory.searchHandbook(services, os_family)          │          │
        │    → playbooks found?                                      │          │
        │      YES → reasoner.injectMemoryContext(formattedText)    │          │
        │      NO  → continue                                        │          │
        └──────────────────────┬────────────────────────────────────┘          │
                               │                                                │
                               ▼                                                │
        ┌───────────────────────────────────────────────────────────┐          │
        │  PHASE 5: Evaluation & Logging  (if ENABLE_EVALUATION)    │          │
        │                                                           │          │
        │  if reasoning.tactical_plan exists:                       │          │
        │    for each attack_vector:                                │          │
        │      → execute via mcpAgent                               │          │
        │      → evaluator.evaluate(vector_id, prediction_metrics,  │          │
        │                           actual_output)                  │          │
        │      → label: TP | FP | FN | TN                          │          │
        │      → create TrainingPair → save to JSON                 │          │
        │                                                           │          │
        │  logSessionStep() → append to JSONL file                 │          │
        └──────────────────────┬────────────────────────────────────┘          │
                               │                                                │
                               ▼                                                │
        ┌───────────────────────────────────────────────────────────┐          │
        │  PHASE 6: Prepare Next Observation                        │          │
        │                                                           │          │
        │  Build observation string from:                           │          │
        │  - Step summaries (all results this iteration)            │          │
        │  - Services discovered count                              │          │
        │  - Target profile (OS, posture, risk)                     │          │
        │  - Top CVEs found                                         │          │
        │  - failures[] → "WARNING: X tools FAILED"                 │          │
        │                                                           │          │
        │  LOOP DETECTION INJECTIONS:                               │          │
        │  ├─ repeatedCommands > 0 → "[SYSTEM INTERVENTION]"        │          │
        │  └─ all results negative → "[DATABASE EXHAUSTION]"        │          │
        │                                                           │          │
        │  reasoner.addObservation(observation)                     │          │
        └──────────────────────┬────────────────────────────────────┘          │
                               │                                                │
                               └────────────────────────────────────────────────┘
                                          (next iteration)
```

---

## Tactical Plan: Trigger Conditions

```
┌─────────────────────────────────────────────────────────────────────────────┐
│           WHEN DOES THE REASONER GENERATE A tactical_plan?                   │
│                                                                              │
│  The Reasoner OMITS tactical_plan during reconnaissance phases:             │
│    Phase: Host Discovery    → standard JSON only                             │
│    Phase: Port Scanning     → standard JSON only                             │
│    Phase: Service Detection → standard JSON only                             │
│                                                                              │
│  The Reasoner GENERATES tactical_plan when ALL of these are true:           │
│                                                                              │
│  ✓ CONDITION 1: Intelligence Context is set in system prompt                │
│    → Phase 4 has completed at least once                                     │
│    → reasoner.setIntelligenceContext() was called                            │
│                                                                              │
│  ✓ CONDITION 2: Known Vulnerabilities exist                                  │
│    → VulnLookup found CVEs with exploitdb_id or poc_available               │
│    → intel.vulnerabilities.length > 0                                        │
│                                                                              │
│  ✓ CONDITION 3: Discovered Services with version data                        │
│    → DataCleaner extracted services with product + version                   │
│    → Profiler identified OS family and tech stack                            │
│                                                                              │
│  ✓ CONDITION 4: RAG Playbooks available (optional but boosts quality)        │
│    → RAG Memory returned relevant playbooks                                  │
│    → rag_context fields populated with payload_snippet, exploitation_logic   │
│                                                                              │
│  Result: Reasoner returns JSON with tactical_plan block containing:          │
│    plan_id, target_ip, attack_vectors[] each with:                           │
│      ├── action { tool_name, command_template, parameters }                  │
│      ├── prediction_metrics { confidence_score, expected_success,            │
│      │                        success_criteria.match_pattern }               │
│      └── rag_context { payload_snippet, insight, exploitation_logic }        │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Executor Path: How tactical_plan Changes Phase 2

```
Phase 1 Output
     │
     ├── tactical_plan present? ─── YES ──► BYPASS LLM
     │                                       │
     │                                       ├─ Sort attack_vectors by priority
     │                                       ├─ Map each to ExecutorStep
     │                                       │    { tool, arguments, description }
     │                                       └─ Validate all tools vs ALLOWED_TOOLS
     │                                            (reject invalid tool names silently)
     │
     └── tactical_plan absent? ─── NO ───► LLM CALL (Haiku 4.5)
                                            │
                                            ├─ Input: thought + action + target + ports
                                            ├─ Output: raw JSON with steps[]
                                            └─ Validate all tools vs ALLOWED_TOOLS
                                                 (reject hallucinated tool names)

ALLOWED_TOOLS = dynamically discovered from Kali MCP at startup
                + ['rag_recall', 'rag_query_playbooks']
```

---

## Tactical Plan Execution: The `plan` Command and 4 Strategies

After recon completes, tactical plans are saved as JSON files to `Tactical/`. The `plan <json-file>` CLI command loads one and presents 4 execution strategies.

```
Tactical/<session>_<plan_id>.json
         │
         │  npm start → plan <json-file>
         ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  Load TacticalPlanObject from file                                           │
│  { plan_id, target_ip, attack_vectors[], created_at }                        │
│                                                                              │
│  Each attack_vector contains:                                                │
│  ├── action { tool_name, command_template, parameters, timeout_seconds }     │
│  ├── prediction_metrics { classification, hypothesis, success_criteria }     │
│  └── rag_context { payload_snippet, insight, exploitation_logic, source }    │
└──────────────────────────────────┬──────────────────────────────────────────┘
                                   │
                                   ▼
                    ┌──────────────────────────┐
                    │  Choose Execution         │
                    │  Strategy (1–4)           │
                    └──────┬───────────────────┘
                           │
          ┌────────────────┼──────────────────┬─────────────────────┐
          │                │                  │                      │
          ▼                ▼                  ▼                      ▼
   ┌─────────────┐  ┌─────────────┐  ┌──────────────┐  ┌───────────────────┐
   │ STRATEGY 1  │  │ STRATEGY 2  │  │  STRATEGY 3  │  │   STRATEGY 4      │
   │ Tool-Based  │  │ GitHub PoC  │  │  Auto-Run    │  │  Generate + Review│
   │             │  │             │  │  from Plan   │  │  + Execute        │
   └──────┬──────┘  └──────┬──────┘  └──────┬───────┘  └────────┬──────────┘
          │                │                 │                    │
          ▼                ▼                 ▼                    ▼
   runAgentWith     runAgentWith      autoExecute          generateScript
   TacticalPlan     TacticalPlan      FromPlan()           FromPlan()
   (plan,"tool")    (plan,"github")        │                    │
          │                │               │               user reviews
          └────────┬────────┘              │               edits script
                   │                       │                    │
                   ▼                       │               executeFinal()
            runAgentLoop()                 │                    │
                   │                       │                    │
                   │         ┌─────────────┘                    │
                   │         │  generateScriptFromPlan()         │
                   │         │    buildPlanContext()             │
                   │         │    → 6-section prompt:           │
                   │         │      TARGET, ENDPOINT, PAYLOAD   │
                   │         │      STRATEGY, CONTEXT, CRITERIA │
                   │         │    → LLM (Sonnet): SYSTEM_PROMPT │
                   │         │    → raw Python script           │
                   │         │         │                        │
                   │         │    write_file (Kali)             │
                   │         │    execute_script (Kali)         │
                   │         │         │                        │
                   │         └─────────┤                        │
                   │                   ▼                        │
                   │           { script, filename, result }     │
                   │                                            │
                   ▼                                            │
   ┌─────────────────────────────────────────────────────┐     │
   │  AgenticExecutor OODA Loop — runAgentLoop()          │     │
   │  Model: Claude Sonnet (multi-turn, tool-use API)     │◄────┘
   │                                                      │
   │  System Prompt:                                      │
   │  ├── Elite Pentester persona                         │
   │  ├── Tool Management Protocol (OODA)                 │
   │  └── Skill Library index (read_skill_file)           │
   │                                                      │
   │  Available Tools (discovered dynamically):           │
   │  ├── Kali MCP tools: execute_shell_cmd, write_file,  │
   │  │                   execute_script, manage_packages, │
   │  │                   searchsploit_search/examine      │
   │  └── Host-local tools: save_new_skill,               │
   │                        read_skill_file, list_skills   │
   │                                                      │
   │  ┌────────────────── TURN LOOP ──────────────────┐   │
   │  │                                               │   │
   │  │  Claude API call (stop_reason?)               │   │
   │  │         │                                     │   │
   │  │         ├── "end_turn" ─────────────────────► DONE
   │  │         │                                     │   │
   │  │         └── "tool_use" → dispatch each block  │   │
   │  │                  │                            │   │
   │  │                  ├─ kaliToolNames.has(name)?  │   │
   │  │                  │   YES → mcpAgent           │   │
   │  │                  │         .callKaliTool()    │   │
   │  │                  │         (HTTP → Docker)    │   │
   │  │                  │                            │   │
   │  │                  └─ host-local tool?          │   │
   │  │                      save_new_skill   →       │   │
   │  │                        skillManager           │   │
   │  │                        .saveNewSkill()        │   │
   │  │                      read_skill_file  →       │   │
   │  │                        skillManager           │   │
   │  │                        .readSkillFile()       │   │
   │  │                      list_skills     →        │   │
   │  │                        skillManager           │   │
   │  │                        .listSkills()          │   │
   │  │                  │                            │   │
   │  │                  └── append tool_result →     │   │
   │  │                      next turn ◄──────────────┘   │
   │  └───────────────────────────────────────────────┘   │
   │                                                      │
   │  max 15 turns — stops with last assistant text       │
   │  Langfuse traces: per-turn + per-tool spans          │
   └─────────────────────────────────────────────────────┘
                          │
                          ▼
               AgentResult {
                 finalText,
                 toolCalls[],
                 turnsUsed
               }
```

### Strategy 1 — Tool Mode: OODA prompt instructs Claude to
1. Search `searchsploit <CVE>` + `msfconsole -q -x 'search <CVE>'`
2. Install missing tools via `manage_packages`
3. Run exploit non-interactively with plan parameters
4. Verify using `success_criteria.match_pattern`

### Strategy 2 — GitHub Mode: OODA prompt instructs Claude to
1. Search GitHub API for PoC repos matching the CVE
2. Clone the top-starred repo, audit the code
3. Adapt target IP/port from the plan, install dependencies
4. Execute and verify against `success_criteria`

### Strategy 3 — Auto-Run from Plan: Single-shot pipeline
`generateScriptFromPlan` → `write_file` → `execute_script` (no human review)

### Strategy 4 — Generate + Review + Execute: Single-shot with pause
`generateScriptFromPlan` → display to user → user edits → `executeFinal`

---

## Script Generation: What `buildPlanContext()` Produces

When generating a script from a plan, the 6-section context is built from the first `attack_vector`:

```
## TARGET
IP: <plan.target_ip>
CVE: <cve_id>
Attack Type: <attack_type>
MITRE ATT&CK: <mitre_id>
Confidence: <confidence_score>
Expected Success: <true|false>

## VULNERABLE ENDPOINT
Command Template: <command_template>
Parameters:
  - target: <ip>
  - port: <port>
Timeout: <timeout_seconds>s

## PAYLOAD
<rag_context.payload_snippet>

## EXPLOITATION STRATEGY
Key Insight: <rag_context.insight>
Exploitation Logic: <rag_context.exploitation_logic>
Source: <rag_context.source>

## VULNERABILITY CONTEXT
<rag_context.vulnerability_context>

## SUCCESS CRITERIA
Match Type: regex_match
Success Pattern: <match_pattern>
Failure Pattern: <negative_pattern>
```

The LLM system prompt then instructs 5 generation phases:
`Target Analysis → Auth Setup → Exploit Construction → Payload Assembly → Verification`

---

## Agent Role Summary

| Agent | Model | Role | Input | Output |
|-------|-------|------|-------|--------|
| **Reasoner** | Sonnet 4 | Strategy | observation + intel context + RAG memory | thought, action, `tactical_plan?` |
| **Executor** | Haiku 4.5 | Planning | Reasoner action (or tactical_plan bypass) | `ExecutorPlan { steps[] }` |
| **DualMCPAgent** | — | Tool routing | `ExecutorStep { tool, arguments }` | raw tool output |
| **DataCleaner** | Haiku 4.5 | Parsing | raw MCP output | `CleanedData { type, summary, data[] }` |
| **Profiler** | Haiku 3.5 | Analysis | new services[] | `TargetProfile` |
| **VulnLookup** | SearchSploit MCP | Research | new services[] | `VulnerabilityInfo[]` |
| **RAGMemoryAgent** | RAG MCP | Memory | observation / services | anti-patterns, playbooks |
| **Evaluator** | Haiku 3.5 | Labeling | `prediction_metrics` + actual output | TP/FP/FN/TN label |
| **AgenticExecutor** | Sonnet (multi-turn) | Autonomous exploit | task / TacticalPlan | `AgentResult { finalText, toolCalls[] }` |

---

## Key Source Files

| Component | File |
|-----------|------|
| Main recon loop (all 6 phases) | `src/agent/core/orchestrator.ts` |
| Reasoner + tactical_plan schema | `src/agent/intelligence/reasoner.ts` |
| Executor + bypass logic | `src/agent/execution/executor.ts` |
| Tool routing (RAG vs Kali) | `src/agent/execution/mcp-agent.ts` |
| Output parsing | `src/agent/execution/data-cleaner.ts` |
| Profiler | `src/agent/intelligence/profiler.ts` |
| Vulnerability research | `src/agent/knowledge/vuln-lookup.ts` |
| RAG playbooks + anti-patterns | `src/agent/knowledge/rag-memory-agent.ts` |
| Evaluation + training data | `src/agent/intelligence/evaluator.ts` |
| Script generation + OODA loop | `src/agent/execution/agentic-executor.ts` |
| CLI entry point | `src/index.ts` |
