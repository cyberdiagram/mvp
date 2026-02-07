# Utility Layer

**Purpose**: Support infrastructure and cross-cutting concerns

## Components

- **`skills-loader.ts`** - `SkillsLoader` class
  - **Skills Loading**: Loads domain knowledge from `src/skills/*.md` files
  - **Memory Manager**: Persists user tool preferences to `agent_rules.json`
  - Keyword-based skill matching for context injection
  - CLAUDE.md-style "soft prompts over hard code" pattern
  - Methods: `loadSkills()`, `buildSkillContext()`, `addRule()`, `removeRule()`, `listRules()`

## Future Components (Phase 6 Preparation)

- **`token-monitor.ts`** - Token consumption tracking
  - Track usage per agent (Sonnet 4 vs Haiku)
  - Cost calculation and budget management
  - Session-level statistics export

- **`session-logger.ts`** - JSONL session logger
  - Records agent steps with timestamps and metadata
  - Writes newline-delimited JSON for batch processing
  - Critical for Phase 6 (evaluation pipeline integration)
  - Enables offline analysis in `pentest-data-refinery` project

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

src/skills/*.md → SkillsLoader → buildSkillContext() → Agent Prompts
```

## Design Principles

- **Infrastructure Not Domain Logic**: Utils support agents but don't make decisions
- **Persistence**: Rules and logs survive across sessions
- **Loose Coupling**: Can be used by any layer without creating dependencies
