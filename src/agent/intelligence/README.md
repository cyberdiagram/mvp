# Intelligence Layer

**Purpose**: Strategic decision-making and target analysis (The "Brains")

## Components

- **`reasoner.ts`** - `ReasonerAgent` (Claude Sonnet 4)
  - Strategic planning: Decides WHAT to do and WHY
  - Generates high-level actions without tool selection
  - Creates tactical plans with attack vectors and predictions
  - Integrates intelligence context (profiles, vulnerabilities, RAG memory)
  - **Output**: `ReasonerOutput { thought, action, is_complete, tactical_plan }`

- **`profiler.ts`** - `ProfilerAgent` (Claude Haiku 3.5)
  - Target profiling and risk assessment
  - OS detection and technology stack inference
  - Security posture analysis (hardened, standard, weak)
  - Evidence-based reasoning with confidence scores
  - **Output**: `TargetProfile { os, tech_stack, security_posture, risk_level }`

## Dependencies

**Reads from**:
- Knowledge Layer (VulnLookupAgent, RAGMemoryAgent)
- Execution Layer (CleanedData from DataCleanerAgent)
- Core Layer (Types)

**Writes to**:
- Core Orchestrator (Strategic decisions and profiles)

**No Direct Tool Execution**: Intelligence agents analyze and decide, but never execute tools directly.

## Data Flow

```
CleanedData → ProfilerAgent → TargetProfile ┐
VulnLookup → VulnerabilityInfo             ├→ IntelligenceContext → ReasonerAgent → ReasonerOutput
RAGMemory → Playbooks/Anti-Patterns        ┘
```

## Design Principles

- **Strategic Not Tactical**: Outputs high-level actions ("scan for vulnerabilities") not tool calls ("nmap -sV")
- **Intelligence-Driven**: Leverages profiles, vulnerabilities, and memory to make informed decisions
- **Model Selection**: Uses powerful Sonnet 4 for complex reasoning, Haiku for fast profiling
