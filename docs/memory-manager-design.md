# Memory Manager Design Document

**Date:** 2026-02-05
**Version:** 1.1
**Author:** Leo

---

## Overview

The Memory Manager is a CLAUDE.md-style context injection system that allows the pentest agent to learn and persist user preferences for tool usage. This follows Anthropic's Claude Code architecture pattern of "soft prompts" over "hard code".

## Problem

When users want to customize tool behavior (e.g., "always use `-Pn` with nmap after host discovery"), there was no way to persist this preference without modifying source code. This required:
- Editing MCP server code for each new parameter
- Rebuilding and redeploying
- No user visibility into what rules exist

## Solution

Implement a memory injection system with three components:

1. **agent_rules.json** - Persistent storage for tool preferences
2. **SkillsLoader** - Extended to load rules and inject them into LLM context
3. **Memory Manager API** - Methods to add/remove/list rules dynamically

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                      User Command                             │
│         "Remember to use -Pn after host discovery"           │
└──────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────────┐
│                    Memory Manager API                         │
│                                                              │
│  addRule(tool: string, rule: string): void                  │
│  removeRule(tool: string, index: number): boolean           │
│  listRules(tool?: string): Record<string, string[]>         │
└──────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────────┐
│                    agent_rules.json                           │
│                                                              │
│  {                                                           │
│    "nmap": [                                                 │
│      "After host discovery, use -Pn in all subsequent scans" │
│    ],                                                        │
│    "gobuster": [                                             │
│      "Use -t 50 for faster directory enumeration"           │
│    ]                                                         │
│  }                                                           │
└──────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────────┐
│                 SkillsLoader.buildSkillContext()              │
│                                                              │
│  Combines:                                                   │
│  - Skill documents (*_skill.md)                             │
│  - Tool preferences (agent_rules.json)                      │
│                                                              │
│  Returns formatted context for LLM injection                │
└──────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────────┐
│                  Reasoner System Prompt                       │
│                                                              │
│  # Loaded Skills                                             │
│  [nmap_skill.md content...]                                  │
│                                                              │
│  # Tool Preferences (IMPORTANT - Follow these rules)        │
│  ## nmap                                                     │
│  - After host discovery, use -Pn in all subsequent scans    │
│  ## gobuster                                                 │
│  - Use -t 50 for faster directory enumeration               │
└──────────────────────────────────────────────────────────────┘
```

## Data Flow

### Adding a Rule

```
1. User: "Remember to always use -T4 for nmap"
2. Agent recognizes memory command
3. Agent calls: skillsLoader.addRule("nmap", "Use -T4 timing template")
4. SkillsLoader writes to agent_rules.json
5. Agent confirms: "I'll remember to use -T4 for nmap scans"
```

### Rule Injection (Every Session)

```
1. Agent starts, loads skills via skillsLoader.loadSkills()
2. Before each Reasoner call, buildSkillContext() is called
3. buildSkillContext() reads agent_rules.json
4. Rules are formatted and appended to skill context
5. Context injected into Reasoner's system prompt
6. LLM sees rules and follows them when generating commands
```

## API Reference

### SkillsLoader.addRule(toolName, rule)

Adds a new preference rule for a tool.

**Parameters:**
- `toolName` (string) - Tool identifier (e.g., "nmap", "gobuster")
- `rule` (string) - Rule description

**Example:**
```typescript
skillsLoader.addRule("nmap", "Use -Pn after host discovery");
```

**Behavior:**
- Creates tool entry if doesn't exist
- Skips duplicate rules
- Persists to agent_rules.json immediately

### SkillsLoader.removeRule(toolName, index)

Removes a rule by index.

**Parameters:**
- `toolName` (string) - Tool identifier
- `index` (number) - Zero-based index of rule to remove

**Returns:** `boolean` - true if removed, false if not found

**Example:**
```typescript
skillsLoader.removeRule("nmap", 0); // Remove first rule
```

### SkillsLoader.listRules(toolName?)

Lists rules for a tool or all tools.

**Parameters:**
- `toolName` (string, optional) - Tool to list rules for

**Returns:** `Record<string, string[]>` - Map of tool names to rule arrays

**Example:**
```typescript
// List all rules
const allRules = skillsLoader.listRules();

// List nmap rules only
const nmapRules = skillsLoader.listRules("nmap");
```

### SkillsLoader.buildSkillContext(query)

Builds context string including both skills and rules.

**Parameters:**
- `query` (string) - Query for finding relevant skills

**Returns:** `string` - Formatted markdown context for LLM

**Example Output:**
```markdown
# Available Skills

## nmap

[nmap_skill.md content...]

---

# Tool Preferences (IMPORTANT - Follow these rules)

## nmap
- After host discovery, use -Pn in all subsequent scans
- Use -T4 timing template for faster scans

## gobuster
- Use -t 50 for faster directory enumeration
```

## File Formats

### agent_rules.json

```json
{
  "nmap": [
    "After host discovery confirms host is up, ALL subsequent scans MUST include -Pn",
    "Use -T4 timing template for faster scans in lab environments"
  ],
  "gobuster": [
    "Use -t 50 for concurrent threads",
    "Always use -x php,html,txt for common extensions"
  ],
  "hydra": [
    "Use -t 4 to avoid account lockouts"
  ]
}
```

## Design Decisions

### Why JSON over YAML/TOML?

- Native JavaScript support (no dependencies)
- Human-readable and editable
- Easy to parse/serialize

### Why rules in SkillsLoader?

- Single source of truth for LLM context
- Skills and rules are conceptually related (both guide tool usage)
- Avoids creating new module/class

### Why "Tool Preferences" section name?

- Clear distinction from skills (knowledge vs preferences)
- "IMPORTANT" flag signals priority to LLM
- Tool-organized structure makes rules easy to find

### Why not modify MCP server?

- Zero coupling between preference system and tool execution
- Preferences are "soft" (LLM decides how to apply)
- No code changes needed for new preferences
- User can override by explicitly requesting different behavior

## Comparison with Alternatives

| Approach | Files Changed | Flexibility | User Editable |
|----------|---------------|-------------|---------------|
| Hardcode in MCP | 1+ | Low | No |
| Extra_args param | 4-6 | Medium | No |
| **Memory Manager** | **2** | **High** | **Yes** |

## Usage Examples

### Example 1: Speed Optimization

```
User: "I'm in a lab environment, make nmap scans faster"

Agent:
- Calls addRule("nmap", "Use -T4 aggressive timing")
- Calls addRule("nmap", "Use --min-rate=1000 for fast host discovery")
- Confirms preferences saved

Later scans automatically include these flags
```

### Example 2: Stealth Mode

```
User: "I need to be stealthy, remember that"

Agent:
- Calls addRule("nmap", "Use -T2 polite timing to avoid detection")
- Calls addRule("nmap", "Fragment packets with -f")
- Calls addRule("nmap", "Randomize scan order with --randomize-hosts")
- Confirms stealth preferences saved
```

### Example 3: Clearing Preferences

```
User: "Clear all nmap preferences and start fresh"

Agent:
- Calls listRules("nmap") to get current rules
- Calls removeRule("nmap", 0) for each rule
- Confirms: "Cleared all nmap preferences"
```

## Testing Checklist

- [ ] `addRule()` creates tool entry if missing
- [ ] `addRule()` skips duplicate rules
- [ ] `removeRule()` returns false for invalid index
- [ ] `removeRule()` deletes tool key when last rule removed
- [ ] `listRules()` returns empty object when no rules
- [ ] `buildSkillContext()` includes both skills and rules
- [ ] Rules persist across agent restarts
- [ ] Rules appear in Reasoner system prompt
- [ ] Agent follows rules when generating commands

## User-Input Entry Point

The system uses an interactive user-input entry point instead of CLI arguments. This provides a foundation for future prompt injection and dynamic rule management.

### Entry Point Flow

```
┌─────────────────────────────────────────────────────┐
│                  npm start                           │
└─────────────────────────────────────────────────────┘
                        ↓
┌─────────────────────────────────────────────────────┐
│              Welcome Banner                          │
│                                                      │
│  🔒 Pentest Agent v1.0                              │
│  ────────────────────────────────────               │
│  Commands:                                          │
│    recon <target>         - Run reconnaissance      │
│    remember <tool> <rule> - Save preference         │
│    forget <tool>          - Clear preferences       │
│    rules [tool]           - List rules              │
│    exit                   - Quit                    │
└─────────────────────────────────────────────────────┘
                        ↓
┌─────────────────────────────────────────────────────┐
│              Interactive Prompt                      │
│                                                      │
│  > _                                                │
│                                                      │
│  User can enter:                                    │
│  - Commands (recon, remember, forget, rules, exit)  │
│  - Direct IP/hostname (auto-runs recon)            │
└─────────────────────────────────────────────────────┘
```

### Built-in Commands

| Command | Description | Example |
|---------|-------------|---------|
| `recon <target>` | Run reconnaissance | `recon 192.168.1.0/24` |
| `remember <tool> <rule>` | Save a tool preference | `remember nmap use -Pn` |
| `forget <tool>` | Clear all rules for tool | `forget nmap` |
| `rules [tool]` | List saved rules | `rules` or `rules nmap` |
| `exit` | Quit the application | `exit` |
| `<ip/hostname>` | Auto-run recon on target | `192.168.1.10` |

### Interaction Examples

**Adding a Rule:**
```
> remember nmap always use -Pn after host discovery
✓ Rule saved for nmap: "always use -Pn after host discovery"
```

**Viewing Rules:**
```
> rules

📋 Saved Rules:

  nmap:
    0. always use -Pn after host discovery
```

**Running Recon (Direct Input):**
```
> 192.168.1.10
[Starts reconnaissance with rules applied]
```

---

## Future Enhancements

1. **Rule Expiration** - Time-based rules (e.g., "use -T4 for this session only")
2. **Rule Priority** - High/medium/low priority for conflicting rules
3. **Rule Conditions** - Conditional rules (e.g., "use -Pn only after host discovery")
4. **Rule Export/Import** - Share rule sets between projects
5. **Natural Language Parsing** - Better detection of memory commands
6. **Undo Command** - Undo last rule change
7. **Rule Templates** - Pre-built rule sets for common scenarios (stealth, speed, CTF)
