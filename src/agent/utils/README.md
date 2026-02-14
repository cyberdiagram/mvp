# Utility Layer

**Purpose**: Support infrastructure and cross-cutting concerns

## Components

- **`skill-manager.ts`** - `SkillManager` class
  - **Skills Loading**: Loads domain knowledge from `src/skills/*.md` files
  - **Memory Manager**: Persists user tool preferences to `agent_rules.json`
  - Keyword-based skill matching for context injection
  - Tool-callable functions for the agentic loop (listSkills, readSkillFile, saveNewSkill)
  - Methods: `loadSkills()`, `buildSkillContext()`, `addRule()`, `removeRule()`, `listRules()`

- **`instrumentation.ts`** - Langfuse/OpenTelemetry setup
  - Initializes tracing with Langfuse span processor
  - Must be imported before other application modules
  - Provides `shutdownTracing()` for clean process exit

## Dependencies

**Reads from**:
- File system (`src/skills/*.md`, `src/config/agent_rules.json`)

**Writes to**:
- All layers (Skills and rules injected into agent contexts)
- File system (Persists rules to `agent_rules.json`)

## Data Flow

```
User Command → MemoryManager → agent_rules.json
                                    ↓
                          Reasoner Context Injection

src/skills/*.md → SkillManager → buildSkillContext() → Agent Prompts
```

## Design Principles

- **Infrastructure Not Domain Logic**: Utils support agents but don't make decisions
- **Persistence**: Rules and logs survive across sessions
- **Loose Coupling**: Can be used by any layer without creating dependencies
