# Core Orchestration Layer

**Purpose**: Central coordination and shared type definitions for the multi-agent system.

## Components

- **`orchestrator.ts`** - `PentestAgent` class that coordinates all subagents
  - Manages the main reconnaissance loop
  - Handles agent initialization and configuration
  - Coordinates data flow between intelligence, knowledge, and execution layers

- **`types.ts`** - Global type definitions
  - Agent output types (ReasonerOutput, ExecutorPlan, etc.)
  - Intelligence types (TargetProfile, VulnerabilityInfo, etc.)
  - Data structures (CleanedData, ToolResult, etc.)
  - Tactical planning types (TacticalPlanObject, PredictionMetrics, etc.)

## Dependencies

**Reads from**:
- Intelligence Layer (strategic decisions and profiles)
- Knowledge Layer (vulnerabilities and playbooks)
- Execution Layer (tool results and parsed data)

**Writes to**:
- All layers (provides coordination and type system)

## Data Flow

```
User Input → Orchestrator → Intelligence → Knowledge → Execution → Orchestrator → User Output
```

## Design Principles

- **Single Source of Truth**: All types defined in one location
- **Layered Architecture**: Enforces clean separation between decision-making, knowledge retrieval, and execution
- **Minimal Coupling**: Layers communicate through well-defined interfaces
