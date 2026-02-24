# Plan: Report Phase — Huawei-Style Structure

## Context

The report phase is fully stubbed (`worker.ts:306-309` throws, `results.ts:633` has no handler,
`reporting.tsx` renders hardcoded mock). The original plan defined a simplistic single-section
executive summary + 3 DB tables. After reviewing the Huawei Cloud pentest report
(`docs/Penetration_Test_Report.md`), the output needs to follow a professional 5-section
structure with per-vulnerability technical detail.

**Changes from the previous plan:**
1. **Report structure** — 5-section Huawei-style markdown instead of one-shot summary
2. **Per-vulnerability entries** — Section 4 with Test Address / Test Procedure / Vulnerability Risk / Fix Suggestion
3. **New UI panel** — `ExecutiveSummary` markdown renderer prepended to the reporting page
4. **Status field corrected** — `'compliant' | 'at_risk' | 'non_compliant'` (matches `compliance_status` DB ENUM)

---

## Huawei 5-Section Report Structure

The `executive_summary` markdown Claude produces must follow this structure:

```
## 1. Overview
### 1.1 Target Profile        ← OS, tech_stack, security_posture, risk_level
### 1.2 Test Scope             ← target IP, services count
### 1.3 Test Timeline          ← completed_at

## 2. Test Policy
### 2.1 Test Method            ← "Automated gray-box via Claude AI + Kali MCP"
### 2.2 Tools Used             ← nmap, searchsploit, custom MCP tools
### 2.3 Vulnerability Level Definition   ← CVSS: Critical 9-10 / High 7-8.9 / Med 4-6.9 / Low 0-3.9

## 3. Test Result Summary
| No. | Target:Port | Vulnerability | Severity | CVSS |
...

## 4. Test Result Description
### 4.N. [Vulnerability Title] ([Severity])
**Test Address:** {affected_ip}:{affected_port}/{affected_service}
**Test Procedure:** {evidence field from vulnerabilities table}
**Vulnerability Risk:** {description field}
**Vulnerability Fix Suggestion:** {remediation field — brief text}

## 5. Security Suggestions
### 5.1 Vulnerability Fixing Suggestions
### 5.2 Security Protection Recommendations
### 5.3 Compliance & Audit Overview
```

The three DB tables (`remediation_snippets`, `compliance_findings`, `anti_patterns`) serve as the
**interactive complement** to the markdown narrative — IaC code, per-regulation audit, and anti-pattern cards.

---

## Files to Change (12 changes, 4 repos)

### 1. NEW `/home/leo/mvp/src/phases/report.ts`

Create the `phases/` directory (does not exist yet) and put report logic here.

```typescript
export async function generateReport(
  opts: Record<string, unknown>,
  onLog: (line: string) => void,
): Promise<ReportPayload>
```

- Read `opts.session_data` (injected by cyber-bridge, see changes #4 and #5)
- Call `createAnthropicClient(apiKey)` from `'../agent/utils/llm-recorder.js'`
  (model: `claude-sonnet-4-20250514`, `max_tokens: 8192`)
- System prompt: "You are a senior penetration tester writing a professional report following
  the Huawei Cloud Security Services standard. Produce a complete 5-section markdown report
  (Overview, Test Policy, Test Result Summary, Test Result Description, Security Suggestions)
  plus structured JSON arrays."
- User prompt: JSON-stringified `session_data` + instruction to respond with **exactly**
  the schema in `docs/report-llm-response.json` (4 keys, no extra fields):
  ```json
  {
    "executive_summary":    "<5-section markdown string>",
    "remediation_snippets": [{ "label", "language", "code", "description", "vulnerability_id" }],
    "compliance_findings":  [{ "regulation", "status", "score", "items", "articles" }],
    "anti_patterns":        [{ "type", "title", "detail" }]
  }
  ```
  Constraints to include in the prompt:
  - `compliance_findings.status` ∈ `["compliant", "at_risk", "non_compliant"]`
  - `remediation_snippets.language` ∈ `["hcl", "yaml", "json", "python", "bash", "powershell"]`
  - `anti_patterns.type` ∈ `["positive", "negative"]`
- **Parse with fault tolerance** (see Parsing section below)
- Log: `[INFO][report] Generating pentest report...` before API call
- Log: `[RESULT][report] Report generated: {N} vulns, {M} snippets, {K} compliance findings`
- Return the **worker payload** matching `docs/report-worker-payload.json`:
  ```typescript
  {
    target,
    session_id,
    completed_at: new Date().toISOString(),
    data: {                          // LLM output nested under `data`
      executive_summary,
      remediation_snippets,
      compliance_findings,
      anti_patterns,
    }
  }
  ```

### 1b. Parsing LLM Response (fault tolerance — inside `report.ts`)

The LLM response text must be parsed defensively. This is the only place JSON.parse is called:

```typescript
// 1. Extract text from Anthropic response
const raw = response.content[0]?.type === 'text' ? response.content[0].text : '';

// 2. Strip markdown code fences if Claude wraps output in ```json ... ```
const cleaned = raw.replace(/^```json\s*/i, '').replace(/\s*```$/, '').trim();

// 3. Parse with fallback
let parsed: Record<string, unknown>;
try {
  parsed = JSON.parse(cleaned);
} catch {
  onLog('[ERROR][report] Failed to parse LLM response as JSON — using empty report');
  parsed = {};
}

// 4. Validate and default every field (never let missing keys crash downstream)
const llmOutput = {
  executive_summary:    typeof parsed.executive_summary === 'string'  ? parsed.executive_summary    : '',
  remediation_snippets: Array.isArray(parsed.remediation_snippets)    ? parsed.remediation_snippets : [],
  compliance_findings:  Array.isArray(parsed.compliance_findings)     ? parsed.compliance_findings  : [],
  anti_patterns:        Array.isArray(parsed.anti_patterns)           ? parsed.anti_patterns        : [],
};
```

### 1c. Final Result Assembly (env var injection — inside `report.ts`)

`target` and `session_id` come from `opts` (injected by cyber-bridge), not from the LLM:

```typescript
const apiKey = process.env.ANTHROPIC_API_KEY;
if (!apiKey) throw new Error('[report] ANTHROPIC_API_KEY is not set');

const sessionData = opts.session_data as Record<string, unknown>;
const target      = typeof opts.target     === 'string' ? opts.target     : String(sessionData?.target_profile?.ip ?? 'unknown');
const sessionId   = typeof opts.session_id === 'string' ? opts.session_id : '';

return {
  target,
  session_id:   sessionId,
  completed_at: new Date().toISOString(),
  data:         llmOutput,              // parsed & validated LLM output
};
```

### 2. `/home/leo/mvp/src/worker.ts` — Lines 306-309

Replace the `throw` with:
```typescript
case 'report': {
  const { generateReport } = await import('./phases/report.js');
  const reportResult = await generateReport(opts, onLog);
  // reportResult shape: { target, session_id, completed_at, data: { executive_summary, ... } }
  const pipeline = redis.pipeline();
  pipeline.hset(taskKey, 'state', 'completed');
  pipeline.hset(taskKey, 'session_id', reportResult.session_id);
  pipeline.hset(taskKey, 'result', JSON.stringify(reportResult));
  await pipeline.exec();
  await redis.publish(completeChannel, JSON.stringify(reportResult));
  break;
}
```
Note: `opts` is already parsed from `taskData.options` at line ~266.

### 3. `/home/leo/cyber-bridge/src/db/results.ts` — Two new functions

**`fetchSessionData(supabase, sessionId)`** — add near line 580, after `fetchPlanFilePath`:
```typescript
export async function fetchSessionData(
  supabase: SupabaseClient,
  sessionId: string,
): Promise<Record<string, unknown> | null>
```
Queries in parallel (all filtered by `session_id`):
- `target_profiles` → `select *` → `.limit(1).maybeSingle()` — if missing, return `null`
- `discovered_services` → `select *` → full array
- `vulnerabilities` → `select *` → full array
- `tactical_plans` → `select *` → full array
- `execution_results` → `select final_summary, turns_used, total_tool_calls`
  → `.order("completed_at", {ascending: false}).limit(1).maybeSingle()`

**`persistReportResults(supabase, sessionId, tenantId, result)`** — add after `fetchSessionData`:
```typescript
async function persistReportResults(
  supabase: SupabaseClient,
  sessionId: string,
  tenantId: string,
  result: Record<string, unknown>,
): Promise<void>
```
- Unpack `const { remediation_snippets, compliance_findings, anti_patterns } = (result.data ?? result) as Record<string, unknown>`
  (supports both nested `data` wrapper and flat shape for backwards compatibility)
- Insert `remediation_snippets[]` → `remediation_snippets` table
  (columns: `session_id, tenant_id, vulnerability_id, label, language, code, description`)
- Insert `compliance_findings[]` → `compliance_findings` table
  (columns: `session_id, tenant_id, regulation, status, score, items, articles`)
- Insert `anti_patterns[]` → `anti_patterns` table
  (columns: `session_id, tenant_id, type, title, detail`)
- **No `task_id` column exists** in any of these tables — do not include it
- Use `.insert([...])` for each; log errors, don't throw

Wire into `persistTaskResults()` dispatcher (line ~633):
```typescript
case "report":
  await persistReportResults(supabase, sessionId, tenantId, result);
  break;
```
The `executive_summary` flows to `execution_results.final_summary` automatically via the existing
`persistExecutionSummary()` call that runs for all phases — no change needed there.

### 4. `/home/leo/cyber-bridge/src/ws/handler.ts` — After lines 85-91

Add after the exec injection block:
```typescript
if (phase === "report" && resolvedSessionId && supabase) {
  const sessionData = await fetchSessionData(supabase, resolvedSessionId);
  if (sessionData) effectiveOptions = { ...effectiveOptions, session_data: sessionData };
}
```
Import `fetchSessionData` alongside existing `fetchPlanFilePath` import.

### 5. `/home/leo/cyber-bridge/src/routes/tasks.ts` — After lines 227-236

Identical pattern using `resolvedSessionId`:
```typescript
if (phase === "report" && resolvedSessionId && supabase) {
  const sessionData = await fetchSessionData(supabase, resolvedSessionId);
  if (sessionData) effectiveOptions = { ...effectiveOptions, session_data: sessionData };
}
```
Verify `VALID_PHASES` includes `"report"` (confirmed by error message at line ~8).

### 6. `/home/leo/web-cybersecurity-diagram/lib/types.ts`

Add after `ExecResult`:
```typescript
export interface ReportResult {
  target: string
  session_id: string
  completed_at: string
  data: ReportData                   // LLM output nested under `data`
}

export interface ReportData {
  executive_summary: string          // Full 5-section markdown
  remediation_snippets: RemediationSnippet[]
  compliance_findings: ComplianceFinding[]
  anti_patterns: AntiPattern[]
}

export interface RemediationSnippet {
  label: string
  language: string
  code: string
  description: string
  vulnerability_id?: string
}

export interface ComplianceFinding {
  regulation: string
  status: 'compliant' | 'at_risk' | 'non_compliant'   // matches compliance_status DB ENUM
  score: number          // 0–100
  items: string[]
  articles: string[]
}

export interface AntiPattern {
  type: 'positive' | 'negative'
  title: string
  detail: string
}
```

Update `TaskResult` union to include `ReportResult`.

### 7. `/home/leo/web-cybersecurity-diagram/context/task-context.tsx`

- Update `findingsByPhase` type: `Partial<Record<Phase, ReconResult | ExecResult | ReportResult>>`
- The `TASK_COMPLETE` reducer already keys by `state.phase` — no change needed
- Add `if (phaseRef.current === "report")` block in `task:complete` handler for any
  report-specific post-processing (e.g. toast notification)
- Update `startTask` signature to accept an optional `sessionId` param (needed for `/report` command):
  ```typescript
  startTask: (phase: Phase, target: string, options?: Record<string, unknown>, sessionId?: string) => void
  // socket.emit: { phase, target, user_id: userId, options, session_id: sessionId }
  ```

### 8. `/home/leo/web-cybersecurity-diagram/components/phases/reporting.tsx`

Update props interface:
```typescript
interface ReportingPhaseProps {
  data?: ReportResult
  isLoading?: boolean
}
```

**Install `react-markdown` first** (not currently in package.json):
```bash
npm install react-markdown remark-gfm --legacy-peer-deps
```
(Section 3 uses GFM tables; plain `<pre>` will not render them correctly.)

**New sub-component `ExecutiveSummary`** — add at top, before `RemediationAsCode`:
- Renders `data.executive_summary` using `react-markdown` + `remark-gfm`
- Shows loading skeleton when `isLoading && !data`
- Shows empty placeholder when `!data && !isLoading`

**Update existing sub-components:**
- `RemediationAsCode` → use `data?.remediation_snippets` (map to tabs/copy UI)
- `LearnedAntiPatterns` → use `data?.anti_patterns` (map positive/negative to cards)
- `AuditCertificate` → use `data?.compliance_findings`:
  - Derive overall score: `Math.round(findings.reduce((s,f) => s + f.score, 0) / findings.length)`
  - Derive overall status label: any `non_compliant` → "Non-Compliant", any `at_risk` → "At Risk", else "Compliant"
- `AttackPathReplay` → keep as "Coming Soon" (out of scope)

When `!data && !isLoading`: show empty state, **no mock data**.

### 9. `/home/leo/web-cybersecurity-diagram/app/(dashboard)/workspace/page.tsx`

```typescript
const reportData = findingsByPhase.report as ReportResult | undefined
// ...
<ReportingPhase
  data={reportData}
  isLoading={(taskStatus === "pending" || taskStatus === "running") && taskPhase === "report"}
/>
```

### 10. `/home/leo/web-cybersecurity-diagram/app/api/scans/[session_id]/route.ts`

Extend the parallel `Promise.all` block to also query report tables:
- `remediation_snippets` → `select *` filtered by `session_id`
- `compliance_findings` → `select *` filtered by `session_id`
- `anti_patterns` → `select *` filtered by `session_id`
- `execution_results` for report task IDs → `select final_summary, completed_at`

Extend the `in("phase", ["recon", "exec"])` filter to include `"report"` for task ID collection.

Return `_report_result` in the response (matches `report-worker-payload.json` shape):
```typescript
_report_result: (remediation.length > 0 || compliance.length > 0)
  ? {
      target,
      session_id,
      completed_at: reportExec?.completed_at ?? "",
      data: {
        executive_summary:    reportExec?.final_summary ?? "",
        remediation_snippets: remediation,
        compliance_findings:  compliance,
        anti_patterns:        antiPats,
      }
    }
  : null
```

In `workspace/page.tsx` `useEffect`: extract `data._report_result` and add to `findings.report`.

### 11. `/home/leo/cyber-bridge/scripts/create-task.sh`

Replace the `report` case stub:
```bash
report)
  if [ -z "$SESSION_ID" ]; then
    echo "Error: --session-id required for report phase" >&2; exit 1
  fi
  create_single "report" "$TARGET" "$SESSION_ID"
  ;;
```
Add `--session-id` flag parsing if not already present.

### 12. `/home/leo/web-cybersecurity-diagram/components/chat-panel.tsx`

Add `/report` command alongside `/recon` and `/exec`:
```typescript
if (input.trim() === "/report") {
  const sid = (findingsByPhase.recon as ReconResult | undefined)?.session_id
  task.startTask("report", target ?? "", undefined, sid)
  return
}
```

---

## Supabase Tables — Already Exist, No Migration Needed

All three report tables are **already in production** (confirmed in `/home/leo/schema.sql` —
the authoritative live schema dump).

> ⚠️ **None of these tables have a `task_id` column.** The insert payload must only include
> `session_id` + `tenant_id` as FK fields (not `task_id`).

### `remediation_snippets`

```sql
CREATE TABLE public.remediation_snippets (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id       UUID NOT NULL REFERENCES scan_sessions(id) ON DELETE CASCADE,
  tenant_id        UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  vulnerability_id UUID REFERENCES vulnerabilities(id) ON DELETE SET NULL,  -- nullable
  label            TEXT NOT NULL,          -- e.g. "Terraform - Close Tomcat Manager"
  language         code_language NOT NULL, -- ENUM: 'hcl'|'yaml'|'json'|'python'|'bash'|'powershell'
  code             TEXT NOT NULL,          -- the remediation code
  description      TEXT,                   -- nullable: what the snippet fixes
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

**Insert shape** (per row from `result.remediation_snippets[]`):
```typescript
{ session_id, tenant_id, vulnerability_id: item.vulnerability_id ?? null,
  label: item.label, language: item.language, code: item.code,
  description: item.description ?? null }
```

### `compliance_findings`

```sql
CREATE TABLE public.compliance_findings (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id  UUID NOT NULL REFERENCES scan_sessions(id) ON DELETE CASCADE,
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  regulation  TEXT NOT NULL,               -- e.g. "PDPA (Singapore)", "ISO 27001", "PCI DSS v4.0"
  status      compliance_status NOT NULL,  -- ENUM: 'compliant'|'at_risk'|'non_compliant'
  score       INTEGER CHECK (score BETWEEN 0 AND 100),
  items       TEXT[] DEFAULT '{}',         -- failing items list
  articles    TEXT[] DEFAULT '{}',         -- referenced regulation articles
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

**Insert shape**:
```typescript
{ session_id, tenant_id, regulation: item.regulation, status: item.status,
  score: item.score, items: item.items, articles: item.articles }
```

### `anti_patterns`

```sql
CREATE TABLE public.anti_patterns (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id  UUID NOT NULL REFERENCES scan_sessions(id) ON DELETE CASCADE,
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  type        anti_pattern_type NOT NULL,  -- ENUM: 'positive'|'negative'
  title       TEXT NOT NULL,               -- e.g. "SSH Brute-Force Protection"
  detail      TEXT NOT NULL,               -- explanation
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

**Insert shape**:
```typescript
{ session_id, tenant_id, type: item.type, title: item.title, detail: item.detail }
```

### ENUM Types (already defined in DB)

| ENUM name | Values |
|-----------|--------|
| `compliance_status` | `'compliant'`, `'at_risk'`, `'non_compliant'` |
| `code_language` | `'hcl'`, `'yaml'`, `'json'`, `'python'`, `'bash'`, `'powershell'` |
| `anti_pattern_type` | `'positive'`, `'negative'` |

### RLS Policies (already applied)

All three tables have Row Level Security enabled with `tenant_id`-scoped policies:
```sql
CREATE POLICY remediation_snippets_tenant ON remediation_snippets
  USING (tenant_id = current_setting('app.tenant_id')::uuid);
-- same pattern for compliance_findings and anti_patterns
```

This means the Supabase service-role client (used in cyber-bridge) can insert without restriction,
but the browser client requires the tenant context to be set.

---

## Other Schema Notes

- `phases/` directory does not yet exist in MVP worker — must be created.

---

## Verification

1. `cd /home/leo/mvp && npm run build` — TypeScript compiles
2. `cd /home/leo/cyber-bridge && npm run build` — TypeScript compiles
3. `cd /home/leo/web-cybersecurity-diagram && npm run build` — Next.js builds
4. E2E:
   - Use an existing session with completed recon + exec
   - Trigger via `/report` in ChatPanel or `create-task.sh -p report --session-id <UUID>`
   - Verify streaming `[INFO][report]` and `[RESULT][report]` logs appear in frontend
   - Verify `ExecutiveSummary` panel renders the 5-section Huawei-style markdown
   - Verify `RemediationAsCode` tabs, `AntiPattern` cards, `AuditCertificate` populate from real data
   - Verify Supabase `remediation_snippets`, `compliance_findings`, `anti_patterns` rows created
   - Reload session page — verify report data loads from API (not re-run)
