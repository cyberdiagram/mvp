# Tactical Plan Console Logging

**Date:** 2026-02-06
**Feature:** Added detailed console logging for TacticalPlan output from Reasoner

---

## What Was Added

### 1. New Method: `displayTacticalPlan()`

**Location:** `src/agent/index.ts` (private method in PentestAgent class)

**Purpose:** Formats and displays tactical plan details in the console with clear visual hierarchy.

**Displays:**
- Plan metadata (plan_id, target_ip, context_hash, created_at)
- Number of attack vectors
- For each attack vector:
  - Vector ID and priority level
  - Tool name and command template
  - Tool parameters (formatted JSON)
  - Execution timeout
  - Classification (attack type, MITRE ATT&CK ID, CVE)
  - Hypothesis (confidence score, expected success, rationale)
  - Success criteria (match type, patterns)

### 2. Integration Point

**Location:** `src/agent/index.ts` line ~221 (after Reasoner output)

```typescript
console.log(`[Reasoner] Thought: ${reasoning.thought}`);
console.log(`[Reasoner] Action: ${reasoning.action}`);

// Display Tactical Plan if present
if (reasoning.tactical_plan) {
  this.displayTacticalPlan(reasoning.tactical_plan);
}
```

**Trigger:** Automatically displays whenever the Reasoner outputs a tactical plan.

### 3. Import Added

```typescript
import {
  // ... existing imports
  TacticalPlanObject,
} from './definitions/index.js';
```

---

## Example Console Output

When the Reasoner generates a tactical plan, you'll see output like this:

```
[Reasoner] Thought: Target has lighttpd 1.4.35 with known CVE-2014-2323 vulnerability...
[Reasoner] Action: Execute path traversal exploit to gain unauthorized access

[Tactical Plan] ═══════════════════════════════════════════════════
[Tactical Plan] Plan ID: plan_1738832400_abc123xyz
[Tactical Plan] Target: 10.129.10.185
[Tactical Plan] Context Hash: 7f3d9a8c2b1e5...
[Tactical Plan] Created: 2/6/2026, 9:00:00 AM
[Tactical Plan] Attack Vectors: 2
[Tactical Plan] ───────────────────────────────────────────────────────

[Tactical Plan] Vector 1/2: vec_01
[Tactical Plan]   Priority: 1 (HIGHEST)
[Tactical Plan]   Tool: exploit_runner
[Tactical Plan]   Command: python3 exploits/cve-2014-2323.py --target {target} --port {port}
[Tactical Plan]   Parameters: {
[Tactical Plan]                     "target": "10.129.10.185",
[Tactical Plan]                     "port": 80,
[Tactical Plan]                     "payload": "../../../../etc/passwd"
[Tactical Plan]                   }
[Tactical Plan]   Timeout: 30s
[Tactical Plan]   Classification:
[Tactical Plan]     - Attack Type: Path Traversal
[Tactical Plan]     - MITRE ATT&CK: T1083
[Tactical Plan]     - CVE: CVE-2014-2323
[Tactical Plan]   Hypothesis:
[Tactical Plan]     - Confidence: 85.0%
[Tactical Plan]     - Expected Success: ✓ YES
[Tactical Plan]     - Rationale: lighttpd_1.4.35, known_vulnerability, poc_available
[Tactical Plan]   Success Criteria:
[Tactical Plan]     - Match Type: regex_match
[Tactical Plan]     - Pattern: (root:|uid=0|/bin/)
[Tactical Plan]     - Negative Pattern: (404 Not Found|403 Forbidden)

[Tactical Plan] Vector 2/2: vec_02
[Tactical Plan]   Priority: 2 (HIGHEST)
[Tactical Plan]   Tool: exploit_runner
[Tactical Plan]   Command: curl http://{target}/cgi-bin/.%2e/.%2e/.%2e/etc/passwd
[Tactical Plan]   Parameters: {
[Tactical Plan]                     "target": "10.129.10.185",
[Tactical Plan]                     "method": "GET"
[Tactical Plan]                   }
[Tactical Plan]   Timeout: 15s
[Tactical Plan]   Classification:
[Tactical Plan]     - Attack Type: Directory Traversal
[Tactical Plan]     - MITRE ATT&CK: T1083
[Tactical Plan]   Hypothesis:
[Tactical Plan]     - Confidence: 75.0%
[Tactical Plan]     - Expected Success: ✓ YES
[Tactical Plan]     - Rationale: alternative_exploit, manual_verification
[Tactical Plan]   Success Criteria:
[Tactical Plan]     - Match Type: contains
[Tactical Plan]     - Pattern: root:x:0:0

[Tactical Plan] ═══════════════════════════════════════════════════
```

---

## When Is Tactical Plan Generated?

The Reasoner generates a tactical plan when:
1. **Service discovery is complete** (host + ports + service versions identified)
2. **Intelligence Layer has run** (Profiler + VulnLookup have analyzed the target)
3. **Vulnerabilities are found** (VulnLookup identified exploits for discovered services)
4. **Reasoner decides to attack** (based on intelligence context and risk assessment)

**Typical Flow:**
```
Iteration 1: Host Discovery → No tactical plan (just reconnaissance)
Iteration 2: Service Detection → No tactical plan (still gathering info)
Iteration 3: Intelligence Analysis → Tactical Plan Generated! ✨
```

---

## Visual Formatting

The logging uses visual separators for clarity:

- **Header/Footer:** `═══════` (double lines)
- **Section Separator:** `───────` (single lines)
- **Indentation:** Consistent spacing for readability
- **Priority Labels:**
  - Priority 1 → `HIGHEST`
  - Priority 2-3 → `HIGH`
  - Priority 4+ → `MEDIUM`
- **Success Indicators:** `✓ YES` / `✗ NO`
- **JSON Formatting:** Proper indentation with aligned prefixes

---

## Configuration

**No configuration needed** - logging is automatic when:
- A tactical plan exists in `reasoning.tactical_plan`
- The method is called during the reconnaissance loop

To disable tactical plan display, simply comment out or remove the display call:
```typescript
// if (reasoning.tactical_plan) {
//   this.displayTacticalPlan(reasoning.tactical_plan);
// }
```

---

## Testing

**Build Status:** ✅ Successful

**To see tactical plan logging:**
1. Run reconnaissance on a target with known vulnerabilities
2. Wait for service discovery + intelligence analysis to complete
3. Tactical plan will be displayed after Reasoner's thought/action output

**Example test:**
```bash
npm start
> recon 10.129.10.185
```

---

## Files Modified

- ✅ `src/agent/index.ts` - Added displayTacticalPlan() method and integration
- ✅ Imports updated to include TacticalPlanObject

**Lines of Code Added:** ~70 lines (formatting + method)

---

## Benefits

1. ✅ **Visibility:** See exactly what the Reasoner is planning before execution
2. ✅ **Debugging:** Understand prediction logic and success criteria
3. ✅ **Learning:** Study how the agent makes attack decisions
4. ✅ **Confidence:** Review confidence scores and rationale before attacks
5. ✅ **Audit Trail:** Console logs show complete attack planning process

---

## Related Features

- **Evaluation Loop:** Uses tactical plan predictions to evaluate execution results
- **Training Data:** Tactical plans are saved in training pairs for RLHF
- **Session Logging:** Plans are logged to JSONL files for RAG memory ETL
- **Intelligence Layer:** Tactical plans are generated from intelligence context
