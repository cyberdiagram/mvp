# Plan: Multi-Agent Architecture for Pentest Agent

## Overview

Build a hierarchical multi-agent system with specialized roles:

1. **Reasoner** (sonnet) - Strategic brain for attack planning
2. **Executor** (haiku) - Lightweight workflow executor
3. **MCP Agent** (haiku) - Tool execution subagent
4. **Data Cleaner** (haiku) - Clean and structure raw tool output
5. **RAG Agent** (future) - Knowledge retrieval for skills/techniques

## Proposed Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    ORCHESTRATOR (main)                      │
│                 Coordinates all subagents                   │
└─────────────────────────────────────────────────────────────┘
                              │
     ┌────────────────────────┼────────────────────────┐
     ▼                        ▼                        ▼
┌───────────────┐    ┌───────────────┐    ┌───────────────┐
│   REASONER    │    │   EXECUTOR    │    │   RAG AGENT   │
│   (sonnet)    │    │   (haiku)     │    │   (haiku)     │
│               │    │               │    │   [FUTURE]    │
│ • Analyze     │    │ • Run steps   │    │               │
│ • Plan attack │    │ • Sequence    │    │ • Query skills│
│ • Interpret   │    │   tools       │    │ • Retrieve    │
│   results     │    │ • Report      │    │   techniques  │
└───────────────┘    └───────────────┘    └───────────────┘
        ▲                     │
        │                     ▼
        │            ┌───────────────┐
        │            │   MCP AGENT   │
        │            │   (haiku)     │
        │            │               │
        │            │ • nmap tools  │
        │            │ • gobuster    │
        │            │ • sqlmap      │
        │            └───────────────┘
        │                     │
        │                     ▼
        │            ┌───────────────┐
        │            │ DATA CLEANER  │
        └────────────│   (haiku)     │
   cleaned data      │               │
                     │ • Parse raw   │
                     │ • Structure   │
                     │ • Normalize   │
                     └───────────────┘
```

## Agent Responsibilities

### Reasoner (Brain) - `sonnet`
- **Input**: Target info, scan results, context
- **Output**: Attack plan, next phase recommendations, result interpretation
- **Role**: Strategic decision-making
  - Analyze reconnaissance results
  - Identify vulnerabilities and attack vectors
  - Plan multi-step attack sequences
  - Interpret tool outputs and adjust strategy

### Executor (Workflow) - `haiku`
- **Input**: Plan/instructions from Reasoner
- **Output**: Execution status, aggregated results
- **Role**: Workflow orchestration
  - Break down plans into executable steps
  - Invoke MCP Agent for each tool call
  - Handle sequencing and dependencies
  - Aggregate and format results for Reasoner

### MCP Agent (Tools) - `haiku`
- **Input**: Single tool command
- **Output**: Raw tool output
- **Role**: Tool execution
  - Execute nmap, gobuster, sqlmap via MCP
  - Return raw results without interpretation
  - Handle tool errors gracefully
  - Minimal reasoning, maximum speed

### Data Cleaner - `haiku`
- **Input**: Raw tool output from MCP Agent
- **Output**: Cleaned, structured data (JSON)
- **Role**: Data transformation
  - Parse raw nmap/gobuster/sqlmap output
  - Extract key information (hosts, ports, services, versions)
  - Normalize data into consistent schema
  - Remove noise and irrelevant lines
  - Structure for easy consumption by Reasoner

**Example transformation:**
```
INPUT (raw nmap):
  "Starting Nmap 7.94...\nHost: 192.168.1.1 ()\nPorts: 22/open/tcp//ssh//OpenSSH 8.2/..."

OUTPUT (cleaned):
  {
    "hosts": [{
      "ip": "192.168.1.1",
      "status": "up",
      "ports": [{
        "port": 22,
        "state": "open",
        "protocol": "tcp",
        "service": "ssh",
        "version": "OpenSSH 8.2"
      }]
    }]
  }
```

### RAG Agent (Knowledge) - `haiku` [FUTURE]
- **Input**: Query about techniques/skills
- **Output**: Relevant knowledge snippets
- **Role**: Knowledge retrieval
  - Vector search over skill documents
  - Retrieve relevant attack techniques
  - Provide context for Reasoner decisions

## Data Flow

```
1. User: "recon 192.168.1.0/24"
              │
              ▼
2. Orchestrator → Reasoner: "Plan reconnaissance for this target"
              │
              ▼
3. Reasoner returns attack plan:
   {
     "phase": "discovery",
     "steps": [
       {"tool": "nmap_host_discovery", "target": "192.168.1.0/24"},
       {"tool": "nmap_port_scan", "targets": "<alive hosts>"},
       {"tool": "nmap_service_detection", "ports": "<open ports>"}
     ],
     "reasoning": "Start broad, then narrow down..."
   }
              │
              ▼
4. Orchestrator → Executor: "Execute this plan"
              │
              ▼
5. Executor → MCP Agent: "nmap_host_discovery 192.168.1.0/24"
              │
              ▼
6. MCP Agent executes tool, returns RAW output
              │
              ▼
7. Executor → Data Cleaner: "Clean this nmap output"
              │
              ▼
8. Data Cleaner parses and structures data, returns CLEAN JSON
              │
              ▼
9. Executor aggregates cleaned results, returns to Orchestrator
              │
              ▼
10. Orchestrator → Reasoner: "Interpret these results, plan next phase"
               │
               ▼
11. Loop continues...
```

## Why This Architecture?

| Design Choice | Rationale |
|---------------|-----------|
| Reasoner = sonnet | Complex reasoning needs best model |
| Executor = haiku | Simple sequencing, cost-efficient |
| MCP Agent = haiku | Tool execution needs no reasoning |
| Separate MCP Agent | Isolates tool failures, easier to add new tools |
| Data Cleaner layer | Reasoner receives structured data, not raw text |
| RAG as subagent | Decouples knowledge retrieval, can swap implementations |

## File Structure

```
src/
├── agent/
│   ├── index.ts                    # Main orchestrator
│   ├── definitions/
│   │   ├── index.ts                # Export all definitions
│   │   ├── reasoner.ts             # Reasoner subagent (sonnet) + reflection prompt
│   │   ├── executor.ts             # Executor subagent (haiku)
│   │   ├── mcp-agent.ts            # MCP tool agent (haiku)
│   │   ├── data-cleaner.ts         # Data cleaner subagent (haiku)
│   │   └── rag-agent.ts            # [FUTURE] RAG agent
│   ├── session/
│   │   ├── index.ts                # SessionManager class
│   │   ├── types.ts                # ReasonerSession, RoleEntry interfaces
│   │   ├── formatter.ts            # Format responses to session JSON
│   │   └── storage.ts              # Save sessions to training_data/
│   └── utils/
│       └── skill-loader.ts         # Load skills for RAG indexing
├── skills/
│   └── nmap_skill.md               # Skill documents
├── training_data/                  # Collected sessions for distillation
│   └── .gitkeep
└── index.ts                        # Entry point
```

## Subagent Definitions Summary

| Agent | Model | Max Turns | MCP Servers | Purpose |
|-------|-------|-----------|-------------|---------|
| reasoner | sonnet | 10 | none | Strategic planning |
| executor | haiku | 20 | none | Workflow sequencing |
| mcp-agent | haiku | 3 | nmap, gobuster, sqlmap | Tool execution |
| data-cleaner | haiku | 3 | none | Parse & structure raw output |
| rag-agent | haiku | 5 | none | Knowledge retrieval |

## Future RAG Integration

When adding RAG:
1. Index skill documents with embeddings
2. RAG Agent queries vector store
3. Reasoner consults RAG before planning
4. Flow: Reasoner → RAG Agent → Reasoner (enriched) → Executor

## Implementation Order

1. Create orchestrator with basic subagent definitions
2. Implement session types (`src/agent/session/types.ts`)
3. Implement SessionManager (`src/agent/session/index.ts`)
4. Implement Reasoner subagent with reflection prompt
5. Implement Executor subagent (workflow prompts)
6. Implement MCP Agent (tool execution)
7. Implement Data Cleaner subagent (parsing prompts)
8. Integrate SessionManager into orchestrator loop
9. Implement session storage for training data
10. Test end-to-end flow with reflection capture
11. [Future] Add RAG Agent with vector store
12. [Future] Add human intervention interface

---

## Reasoner Response Format & Reflection Training

### Structured Session Output

Every Reasoner turn outputs a structured JSON for training data collection:

```typescript
interface ReasonerSession {
  session_id: string;           // e.g., "recon_task_001"
  step: number;                 // Current step in session
  role_sequence: RoleEntry[];   // Full conversation chain
  is_distill_ready: boolean;    // Ready for model distillation
  metadata: {
    target: string;
    start_time: string;
    total_tokens: number;
  };
}

interface RoleEntry {
  role: "system" | "assistant" | "observation" | "human_intervention" | "reflection";
  thought?: string;             // Assistant's reasoning
  action?: string;              // Tool/command to execute
  content?: string;             // For observation/intervention
  type?: string;                // For human_intervention: "correction" | "guidance" | "abort"
  reflection?: string;          // Learning from observation/intervention
}
```

### Reflection Loop Pattern

```
┌─────────────────────────────────────────────────────────────┐
│                    REASONER TURN FLOW                       │
└─────────────────────────────────────────────────────────────┘

1. THOUGHT (Initial reasoning)
   │  "I will try brute-forcing the login..."
   ▼
2. ACTION (Proposed action)
   │  "hydra -l admin -P pass.txt..."
   ▼
3. OBSERVATION (Tool result or feedback)
   │  "Account locked after 3 attempts"
   ▼
4. HUMAN_INTERVENTION (Optional correction/guidance)
   │  "Don't use brute force, look for forgot password flaw"
   ▼
5. REFLECTION (Learn from observation/intervention)
   │  "Brute force caused lockout. Human suggests password reset
   │   workflow. I should prioritize non-destructive methods first."
   ▼
6. NEW_ACTION (Corrected action based on reflection)
   │  "analyze_reset_page"
   ▼
7. LOOP → back to step 3 (OBSERVATION)
```

### Example Session Output

```json
{
  "session_id": "recon_task_001",
  "step": 5,
  "role_sequence": [
    {
      "role": "system",
      "content": "You are a Pentest Agent. Follow reconnaissance methodology..."
    },
    {
      "role": "assistant",
      "thought": "Target has a login page. I will try brute-forcing with common credentials.",
      "action": "hydra -l admin -P pass.txt ssh://192.168.1.1"
    },
    {
      "role": "observation",
      "content": "Account locked after 3 failed attempts. IP may be blocked."
    },
    {
      "role": "human_intervention",
      "type": "correction",
      "content": "Don't use brute force, look for a 'forgot password' logic flaw instead."
    },
    {
      "role": "reflection",
      "reflection": "Brute force triggered account lockout - this is destructive and alerts defenders. Human supervisor correctly identified that password reset workflows often have logic flaws (token reuse, user enumeration). I should prioritize non-destructive reconnaissance before aggressive attacks."
    },
    {
      "role": "assistant",
      "thought": "I will now analyze the password reset workflow for logic flaws.",
      "action": "analyze_reset_page"
    }
  ],
  "is_distill_ready": true,
  "metadata": {
    "target": "192.168.1.1",
    "start_time": "2024-01-15T10:30:00Z",
    "total_tokens": 2450
  }
}
```

### Reasoner Prompt for Reflection

The Reasoner's system prompt includes reflection instructions:

```
When you receive an OBSERVATION or HUMAN_INTERVENTION:

1. REFLECT on what happened:
   - What did I expect vs what actually happened?
   - Why did the human intervene? What did I miss?
   - What principle should I remember for future actions?

2. Format your response as:
   {
     "reflection": "<your learning from this experience>",
     "thought": "<updated reasoning based on reflection>",
     "action": "<new corrected action>"
   }

Always pause to reflect before taking a new action after receiving feedback.
```

### Session Manager

```typescript
// src/agent/session/index.ts
class SessionManager {
  private session: ReasonerSession;

  startSession(target: string): void;
  addSystemPrompt(content: string): void;
  addAssistantTurn(thought: string, action: string): void;
  addObservation(content: string): void;
  addHumanIntervention(type: string, content: string): void;
  addReflection(reflection: string): void;
  markDistillReady(): void;
  exportSession(): ReasonerSession;
  saveToFile(path: string): void;
}
```

### Data Flow with Session Tracking

```
1. User: "recon 192.168.1.0/24"
              │
              ▼
2. SessionManager.startSession("recon_task_001")
              │
              ▼
3. Orchestrator → Reasoner: "Plan reconnaissance"
              │
              ▼
4. Reasoner returns structured response:
   {
     "thought": "Start with host discovery...",
     "action": "nmap_host_discovery",
     "arguments": {...}
   }
              │
              ▼
5. SessionManager.addAssistantTurn(thought, action)
              │
              ▼
6. Executor runs tool → Data Cleaner cleans result
              │
              ▼
7. SessionManager.addObservation(cleaned_result)
              │
              ▼
8. [Optional] Human provides correction
   SessionManager.addHumanIntervention("correction", content)
              │
              ▼
9. Reasoner receives observation + intervention
              │
              ▼
10. Reasoner returns REFLECTION + NEW_ACTION:
    {
      "reflection": "I learned that...",
      "thought": "Based on feedback, I should...",
      "action": "new_corrective_action"
    }
              │
              ▼
11. SessionManager.addReflection(reflection)
    SessionManager.addAssistantTurn(thought, action)
              │
              ▼
12. Loop continues... when complete:
    SessionManager.markDistillReady()
    SessionManager.saveToFile("./training_data/recon_task_001.json")
```

### Training Data Collection

Sessions are saved to `./training_data/` for model distillation:

```
training_data/
├── recon_task_001.json
├── recon_task_002.json
├── vuln_scan_001.json
└── index.json              # Manifest of all sessions
```

### Distillation-Ready Criteria

A session is marked `is_distill_ready: true` when:
1. At least one complete Thought → Action → Observation cycle
2. Contains at least one Reflection entry (learning moment)
3. Session ended successfully (not aborted)
4. No sensitive data in output (credentials sanitized)

---

## Token Usage & Cost Tracking

### Token Statistics Interface

```typescript
interface TokenUsage {
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
}

interface ModelCallLog {
  id: string;                      // Unique call ID
  timestamp: string;               // ISO timestamp
  session_id: string;              // Link to session
  agent: string;                   // "reasoner" | "executor" | "mcp-agent" | "data-cleaner"
  model: string;                   // "claude-sonnet-4" | "claude-haiku-3"
  tokens: TokenUsage;
  cost_usd: number;                // Calculated cost
  latency_ms: number;              // Response time
  success: boolean;
}

interface SessionCostSummary {
  session_id: string;
  total_calls: number;
  total_input_tokens: number;
  total_output_tokens: number;
  total_tokens: number;
  total_cost_usd: number;
  breakdown_by_agent: {
    [agent: string]: {
      calls: number;
      tokens: number;
      cost_usd: number;
    };
  };
  breakdown_by_model: {
    [model: string]: {
      calls: number;
      tokens: number;
      cost_usd: number;
    };
  };
}
```

### Pricing Configuration

```typescript
// src/agent/metrics/pricing.ts
const MODEL_PRICING = {
  'claude-sonnet-4': {
    input_per_1k: 0.003,      // $3 per 1M input tokens
    output_per_1k: 0.015,     // $15 per 1M output tokens
  },
  'claude-haiku-3': {
    input_per_1k: 0.00025,    // $0.25 per 1M input tokens
    output_per_1k: 0.00125,   // $1.25 per 1M output tokens
  },
  'claude-opus-4': {
    input_per_1k: 0.015,      // $15 per 1M input tokens
    output_per_1k: 0.075,     // $75 per 1M output tokens
  },
};

function calculateCost(model: string, tokens: TokenUsage): number {
  const pricing = MODEL_PRICING[model];
  const inputCost = (tokens.input_tokens / 1000) * pricing.input_per_1k;
  const outputCost = (tokens.output_tokens / 1000) * pricing.output_per_1k;
  return inputCost + outputCost;
}
```

### Metrics Collector

```typescript
// src/agent/metrics/collector.ts
class MetricsCollector {
  private calls: ModelCallLog[] = [];
  private sessionId: string;

  constructor(sessionId: string);

  // Log a model call
  logCall(params: {
    agent: string;
    model: string;
    tokens: TokenUsage;
    latency_ms: number;
    success: boolean;
  }): void;

  // Get current session stats
  getSessionSummary(): SessionCostSummary;

  // Get all call logs
  getAllCalls(): ModelCallLog[];

  // Save to file
  saveToFile(path: string): void;

  // Display formatted summary to console
  displaySummary(): void;
}
```

### Console Display Format

```
┌─────────────────────────────────────────────────────────────┐
│                    SESSION COST SUMMARY                     │
│                  session: recon_task_001                    │
└─────────────────────────────────────────────────────────────┘

Total API Calls: 12
Total Tokens: 45,230 (input: 38,500 | output: 6,730)
Total Cost: $0.1847

┌─────────────────────────────────────────────────────────────┐
│                    BY AGENT                                 │
├─────────────────┬────────┬──────────┬──────────────────────┤
│ Agent           │ Calls  │ Tokens   │ Cost                 │
├─────────────────┼────────┼──────────┼──────────────────────┤
│ reasoner        │ 4      │ 28,000   │ $0.1520              │
│ executor        │ 3      │ 8,500    │ $0.0180              │
│ mcp-agent       │ 3      │ 5,200    │ $0.0098              │
│ data-cleaner    │ 2      │ 3,530    │ $0.0049              │
└─────────────────┴────────┴──────────┴──────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│                    BY MODEL                                 │
├─────────────────┬────────┬──────────┬──────────────────────┤
│ Model           │ Calls  │ Tokens   │ Cost                 │
├─────────────────┼────────┼──────────┼──────────────────────┤
│ claude-sonnet-4 │ 4      │ 28,000   │ $0.1520              │
│ claude-haiku-3  │ 8      │ 17,230   │ $0.0327              │
└─────────────────┴────────┴──────────┴──────────────────────┘
```

### Individual Call Log Format

```json
{
  "id": "call_001",
  "timestamp": "2024-01-15T10:30:15.234Z",
  "session_id": "recon_task_001",
  "agent": "reasoner",
  "model": "claude-sonnet-4",
  "tokens": {
    "input_tokens": 8500,
    "output_tokens": 1200,
    "total_tokens": 9700
  },
  "cost_usd": 0.0435,
  "latency_ms": 2340,
  "success": true
}
```

### File Storage Structure

```
logs/
├── metrics/
│   ├── recon_task_001/
│   │   ├── calls.jsonl           # Line-delimited call logs
│   │   ├── summary.json          # Session summary
│   │   └── cost_report.txt       # Human-readable report
│   ├── recon_task_002/
│   │   └── ...
│   └── aggregate/
│       ├── daily_2024-01-15.json # Daily aggregates
│       └── monthly_2024-01.json  # Monthly aggregates
```

### Integration with SessionManager

```typescript
// Updated SessionManager
class SessionManager {
  private metrics: MetricsCollector;

  // After each model call, log metrics
  async callModel(agent: string, model: string, ...): Promise<Response> {
    const startTime = Date.now();

    const response = await anthropic.messages.create({...});

    const latency = Date.now() - startTime;

    this.metrics.logCall({
      agent,
      model,
      tokens: {
        input_tokens: response.usage.input_tokens,
        output_tokens: response.usage.output_tokens,
        total_tokens: response.usage.input_tokens + response.usage.output_tokens,
      },
      latency_ms: latency,
      success: true,
    });

    return response;
  }

  // On session end
  async endSession(): Promise<void> {
    this.metrics.displaySummary();
    await this.metrics.saveToFile(`./logs/metrics/${this.sessionId}/`);
  }
}
```

### Updated ReasonerSession Interface

```typescript
interface ReasonerSession {
  session_id: string;
  step: number;
  role_sequence: RoleEntry[];
  is_distill_ready: boolean;
  metadata: {
    target: string;
    start_time: string;
    end_time?: string;
    total_tokens: number;
    total_cost_usd: number;        // Added
    call_count: number;            // Added
    avg_latency_ms: number;        // Added
  };
  cost_breakdown?: SessionCostSummary;  // Added
}
```

### Metrics File Structure

```
src/
├── agent/
│   ├── metrics/
│   │   ├── index.ts              # MetricsCollector class
│   │   ├── types.ts              # TokenUsage, ModelCallLog interfaces
│   │   ├── pricing.ts            # Model pricing configuration
│   │   ├── calculator.ts         # Cost calculation functions
│   │   └── reporter.ts           # Console display & file output
│   └── ...
├── logs/
│   └── metrics/                  # Token usage logs
└── ...
```

---

## Verification

1. `npm run build` compiles successfully
2. `npm start recon <target>` triggers:
   - Reasoner produces attack plan
   - Executor breaks down into steps
   - MCP Agent executes tools
   - Data Cleaner parses raw output into structured JSON
   - Cleaned results flow back to Reasoner
   - **SessionManager tracks full role_sequence**
3. Verify Data Cleaner output is valid JSON with expected schema
4. **Verify session JSON saved to `./training_data/`**
5. **Verify reflection entries appear after observations/interventions**
6. **Verify token metrics:**
   - Console displays cost summary at session end
   - `logs/metrics/<session_id>/calls.jsonl` contains all model calls
   - `logs/metrics/<session_id>/summary.json` contains aggregated stats
   - Cost breakdown shows per-agent and per-model totals
