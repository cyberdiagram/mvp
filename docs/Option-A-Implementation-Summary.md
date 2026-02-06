# Option A Implementation Summary

**Date:** 2026-02-06
**Change:** Architectural refactor to enforce separation between strategic (Reasoner) and tactical (Executor) decision-making

---

## Problem Statement

The Executor was not breaking down actions into multiple steps because:
1. The Reasoner was outputting specific tool names and arguments
2. The Executor had a shortcut: if `tool` and `arguments` were present, it would skip calling Claude and just wrap them in a single-step plan
3. Result: The Executor never performed multi-step decomposition

## Root Cause

**Architectural role confusion:**
- **Intended:** Reasoner decides "scan for services" → Executor breaks down into "1) port scan, 2) service detection"
- **Actual:** Reasoner decides "run nmap_port_scan" → Executor passes through "1) nmap_port_scan"

## Solution: Option A - Strategic/Tactical Separation

### Changes Made

#### 1. Type System (`src/agent/definitions/types.ts`)

**Before:**
```typescript
export interface ReasonerOutput {
  thought: string;
  action: string;
  tool?: string;              // ❌ Removed
  arguments?: Record<...>;    // ❌ Removed
  is_complete?: boolean;
  // ...
}
```

**After:**
```typescript
export interface ReasonerOutput {
  thought: string;
  action: string;             // Now HIGH-LEVEL only
  is_complete?: boolean;
  // tactical_plan, attack_rationale, expected_success remain
}
```

#### 2. Reasoner System Prompt (`src/agent/definitions/reasoner.ts`)

**Changes:**
- ❌ Removed: `"tool": "tool_name"` and `"arguments": {...}` from response format
- ❌ Removed: "Available Tools" section (moved to Executor)
- ✅ Added: Strategic guidance with examples of good vs. bad actions
- ✅ Added: Emphasis on HIGH-LEVEL decision-making

**Example Strategic Actions:**
- ✅ GOOD: "Perform comprehensive port scanning to identify all open services"
- ❌ BAD: "Run nmap_port_scan with -p 1-65535 on 192.168.1.1"

#### 3. Reasoner Parser (`src/agent/definitions/reasoner.ts`)

**Removed extraction of:**
- `parsed.tool`
- `parsed.arguments`

#### 4. Executor System Prompt (`src/agent/definitions/executor.ts`)

**Changes:**
- ✅ Added: "Available Tools" section with tool signatures
- ✅ Added: Guidance on breaking down strategic actions into 1-N steps
- ✅ Added: Example showing multi-step decomposition
- ✅ Updated: Role description to emphasize tactical execution

**Example:**
```
Input: "Perform comprehensive port scanning to identify all open services"
Output:
{
  "steps": [
    { "tool": "nmap_port_scan", "arguments": {...}, "description": "..." },
    { "tool": "nmap_service_detection", "arguments": {...}, "description": "..." }
  ]
}
```

#### 5. Executor Logic (`src/agent/definitions/executor.ts`)

**Before:**
```typescript
async planExecution(reasonerOutput: ReasonerOutput): Promise<ExecutorPlan> {
  // ❌ Shortcut: if tool/arguments present, skip Claude call
  if (reasonerOutput.tool && reasonerOutput.arguments) {
    return { steps: [{ tool: reasonerOutput.tool, ... }], ... };
  }
  // ... call Claude
}
```

**After:**
```typescript
async planExecution(
  reasonerOutput: ReasonerOutput,
  contextInfo?: { target?: string; openPorts?: number[] }
): Promise<ExecutorPlan> {
  // ✅ ALWAYS call Claude to break down the action
  // contextInfo helps Executor choose appropriate parameters
  const response = await this.client.messages.create({...});
  return this.parsePlan(response);
}
```

#### 6. Orchestrator (`src/agent/index.ts`)

**reconnaissance() method:**
```typescript
// Extract context for Executor
const openPorts = allDiscoveredServices.map((s) => s.port);
const uniquePorts = [...new Set(openPorts)];

const plan = await this.executor.planExecution(reasoning, {
  target,
  openPorts: uniquePorts.length > 0 ? uniquePorts : undefined,
});
```

**interactive() method:**
- ❌ Removed: `if (reasoning.tool && reasoning.arguments)` check
- ✅ Added: Always call Executor with `planExecution(reasoning)`

---

## Documentation Updates

### README.md

1. **Agent Table** - Updated descriptions:
   - Reasoner: "**STRATEGIC** planning - decides WHAT to do and WHY"
   - Executor: "**TACTICAL** execution - decides HOW (tool selection)"

2. **Agent Flow** - Updated to show strategic→tactical flow:
   ```
   Reasoner (STRATEGIC: "scan for vulnerabilities")
   → Executor (TACTICAL: "nmap_port_scan + nmap_service_detection")
   ```

3. **New Section: "Decision-Making Architecture: Strategic vs. Tactical"**
   - Explains separation of concerns
   - Shows example Reasoner output (strategic)
   - Shows example Executor output (tactical)
   - Explains why this separation matters

### CLAUDE.md

1. **Multi-Agent Architecture** - Updated agent descriptions
2. **Agent Flow** - Shows strategic→tactical transformation
3. **Key Architectural Principle** - Emphasizes no tool selection in Reasoner
4. **Subagent Definitions** - Updated to show output formats
5. **Data Structures** - Updated `ReasonerOutput` to remove tool/arguments

---

## Benefits

1. ✅ **Proper Multi-Step Decomposition**: Executor can now break complex actions into 2-5 steps
2. ✅ **Clear Responsibilities**: Each agent has a well-defined role
3. ✅ **Better Prompt Engineering**: Strategic prompts vs. tactical prompts
4. ✅ **Easier Debugging**: Can identify if failures are strategic or tactical
5. ✅ **More Flexible**: Can change tool implementations without touching Reasoner

---

## Testing

**Build Status:** ✅ Successful (`npm run build` passed)

**Next Steps:**
1. Run a reconnaissance to verify multi-step decomposition
2. Check that Executor creates 2+ steps for complex actions
3. Verify Memory Manager rules still work correctly
4. Test interactive mode

---

## Migration Notes

**Breaking Changes:**
- `ReasonerOutput` no longer has `tool` or `arguments` fields
- Code that directly accessed `reasoning.tool` will fail (already fixed in orchestrator)

**Backward Compatibility:**
- Memory Manager rules still work (injected into Reasoner context)
- Skills system unchanged
- Intelligence Layer unchanged
- Evaluation Loop unchanged
- RAG Memory unchanged

---

## Example Flow (After Implementation)

**User Command:** `recon 10.129.10.185`

**Iteration 1:**
- **Reasoner Output:**
  ```json
  {
    "thought": "New target, need to discover if host is alive",
    "action": "Confirm target is alive and discover initial services",
    "is_complete": false
  }
  ```
- **Executor Output:**
  ```json
  {
    "steps": [
      {
        "tool": "nmap_host_discovery",
        "arguments": { "target": "10.129.10.185" },
        "description": "Check if host is alive and discover open ports"
      }
    ]
  }
  ```

**Iteration 2:**
- **Reasoner Output:**
  ```json
  {
    "thought": "Host is up with HTTP/HTTPS. Need service versions.",
    "action": "Enumerate web service versions to identify potential vulnerabilities",
    "is_complete": false
  }
  ```
- **Executor Output:**
  ```json
  {
    "steps": [
      {
        "tool": "nmap_service_detection",
        "arguments": { "target": "10.129.10.185", "ports": "80,443" },
        "description": "Detect HTTP/HTTPS service versions and banners"
      }
    ]
  }
  ```

Note: Executor now has the **capability** to create multi-step plans. Whether it does depends on the complexity of the Reasoner's action.

---

## Files Modified

- ✅ `src/agent/definitions/types.ts` - Removed tool/arguments from ReasonerOutput
- ✅ `src/agent/definitions/reasoner.ts` - Updated system prompt and parser
- ✅ `src/agent/definitions/executor.ts` - Removed shortcut, added tools list
- ✅ `src/agent/index.ts` - Updated orchestrator to pass context, removed checks
- ✅ `README.md` - Added Decision-Making Architecture section, updated descriptions
- ✅ `CLAUDE.md` - Updated agent descriptions and data structures
