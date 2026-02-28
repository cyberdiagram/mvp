/**
 * Report Phase — LLM-powered penetration test report generator.
 *
 * Reads session_data injected by Cyber-Bridge (target profile, discovered
 * services, vulnerabilities, tactical plans, execution summary) and calls
 * Claude to produce a structured 5-section professional report plus three
 * interactive arrays (remediation snippets, compliance findings, anti-patterns).
 */

import Anthropic from '@anthropic-ai/sdk';
import { createAnthropicClient } from '../agent/utils/llm-recorder.js';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface RemediationSnippet {
  label: string;
  language: 'hcl' | 'yaml' | 'json' | 'python' | 'bash' | 'powershell';
  code: string;
  description: string;
  vulnerability_id?: string | null;
}

export interface ComplianceFinding {
  regulation: string;
  status: 'compliant' | 'at_risk' | 'non_compliant';
  score: number;
  items: string[];
  articles: string[];
}

export interface AntiPattern {
  type: 'positive' | 'negative';
  title: string;
  detail: string;
}

export interface ReportPayload {
  target: string;
  session_id: string;
  executive_summary: string;
  remediation_snippets: RemediationSnippet[];
  compliance_findings: ComplianceFinding[];
  anti_patterns: AntiPattern[];
  completed_at: string;
}

// ── Prompt ────────────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a senior penetration tester writing a professional penetration test report.

Produce a complete 5-section markdown report plus structured JSON arrays.

Your response MUST be a single valid JSON object (no markdown fences, no extra text) with exactly these four keys:
{
  "executive_summary": "<full 5-section markdown>",
  "remediation_snippets": [ { "label", "language", "code", "description", "vulnerability_id" } ],
  "compliance_findings": [ { "regulation", "status", "score", "items", "articles" } ],
  "anti_patterns": [ { "type", "title", "detail" } ]
}

The executive_summary markdown MUST follow this 5-section structure:

## 1. Overview
### 1.1 Target Profile          ← OS, tech_stack, security_posture, risk_level
### 1.2 Test Scope              ← target IP, services count
### 1.3 Test Timeline           ← completed_at

## 2. Test Policy
### 2.1 Test Method             ← "Automated gray-box via Claude AI + Kali MCP"
### 2.2 Tools Used              ← nmap, searchsploit, custom MCP tools
### 2.3 Vulnerability Level Definition  ← CVSS: Critical 9-10 / High 7-8.9 / Med 4-6.9 / Low 0-3.9

## 3. Test Result Summary
| No. | Target:Port | Vulnerability | Severity | CVSS Score |
...

## 4. Test Result Description
For each vulnerability (numbered 4.1, 4.2, ...):
### 4.N. [Title] ([Severity])
**Test Address:** {affected_ip}:{affected_port}/{affected_service}
**Test Procedure:** {how the vulnerability was discovered}
**Vulnerability Risk:** {impact description}
**Vulnerability Fix Suggestion:** {brief remediation text}

## 5. Security Suggestions
### 5.1 Vulnerability Fixing Suggestions
### 5.2 Security Protection Recommendations
### 5.3 Compliance & Audit Overview (table: Framework | Score | Status | Top Gap)

CONSTRAINTS:
- remediation_snippets[].language MUST be one of: hcl, yaml, json, python, bash, powershell
- compliance_findings[].status MUST be one of: compliant, at_risk, non_compliant
- compliance_findings[].score MUST be an integer 0–100
- anti_patterns[].type MUST be one of: positive, negative
- vulnerability_id may be null`;

// ── Main function ─────────────────────────────────────────────────────────────

export async function generateReport(
  opts: Record<string, unknown>,
  onLog: (line: string) => void,
): Promise<ReportPayload> {
  const apiKey = process.env.ANTHROPIC_API_KEY ?? '';
  const target = typeof opts.target === 'string' ? opts.target : 'unknown';
  const sessionData = opts.session_data as Record<string, unknown> | undefined;
  const sessionId =
    typeof opts.session_id === 'string' ? opts.session_id
    : typeof sessionData?.session_id === 'string' ? sessionData.session_id
    : '';

  onLog('[INFO][report] Generating pentest report...');

  const client = createAnthropicClient(apiKey);

  const userPrompt = [
    'Generate a professional penetration test report for the following session data:',
    '',
    JSON.stringify(sessionData ?? { target }, null, 2),
    '',
    'Respond with a single JSON object as specified in the system prompt.',
    'No markdown fences, no extra text outside the JSON.',
  ].join('\n');

  const message = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 8192,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userPrompt }],
  });

  // Extract text content
  const rawText = message.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('');

  // Fault-tolerant JSON parsing: strip markdown fences if present, then parse
  let parsed: Partial<ReportPayload> = {};
  try {
    const stripped = rawText
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/```\s*$/i, '')
      .trim();
    parsed = JSON.parse(stripped);
  } catch {
    onLog('[WARN][report] Failed to parse LLM response as JSON — using empty defaults');
  }

  const executive_summary =
    typeof parsed.executive_summary === 'string'
      ? parsed.executive_summary
      : '# Report generation failed\n\nThe AI could not produce a structured report. Please retry the report phase.';

  const remediation_snippets = Array.isArray(parsed.remediation_snippets)
    ? (parsed.remediation_snippets as RemediationSnippet[])
    : [];

  const compliance_findings = Array.isArray(parsed.compliance_findings)
    ? (parsed.compliance_findings as ComplianceFinding[])
    : [];

  const anti_patterns = Array.isArray(parsed.anti_patterns)
    ? (parsed.anti_patterns as AntiPattern[])
    : [];

  const vulnCount =
    typeof sessionData?.vulnerabilities === 'number' ? sessionData.vulnerabilities : '?';

  onLog(
    `[RESULT][report] Report generated: ${vulnCount} vulns, ` +
    `${remediation_snippets.length} remediation snippets, ` +
    `${compliance_findings.length} compliance findings`,
  );

  return {
    target,
    session_id: sessionId,
    executive_summary,
    remediation_snippets,
    compliance_findings,
    anti_patterns,
    completed_at: new Date().toISOString(),
  };
}
