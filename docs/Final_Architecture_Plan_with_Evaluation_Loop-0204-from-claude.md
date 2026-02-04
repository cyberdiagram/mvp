# Complete AI Penetration Testing Architecture: Intelligence + Evaluation Loop

**Generated:** 2026-02-04
**Version:** 1.0
**Status:** Implementation Plan

---

## Executive Summary

This document combines three architectural upgrades to transform the MVP pentest agent into a production-grade intelligent system with self-improving capabilities:

1. **Intelligence Layer** - Target profiling and CVE lookup (Profiler + RAG Agent)
2. **Tactical Planning** - Structured attack vectors with predictive metrics
3. **Evaluation Loop** - Automated learning from execution results (Evaluator Agent)

**Result:** A closed-loop system where every attack serves as a training data point for continuous improvement.

---

## Final Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                        ORCHESTRATOR                             │
│                   (src/agent/index.ts)                          │
└─────────────────────────────────────────────────────────────────┘
                              │
         ┌────────────────────┼────────────────────────┐
         ▼                    ▼                        ▼
    ┌─────────┐         ┌─────────┐            ┌───────────┐
    │ EXECUTOR│         │ MCP     │            │ DATA      │
    │ (Haiku) │         │ AGENT   │            │ CLEANER   │
    └─────────┘         └─────────┘            │ (Haiku)   │
         │                    │                 └───────────┘
         │                    ▼                        │
         │             ┌─────────────┐                 │
         │             │ NMAP Tools  │                 │
         │             └─────────────┘                 │
         │                                             ▼
         │              ┌────────────────────────────────────┐
         │              │   INTELLIGENCE LAYER (Parallel)    │
         │              ├────────────────┬───────────────────┤
         │              │   PROFILER     │   RAG AGENT       │
         │              │   (Haiku)      │   (Haiku+APIs)    │
         │              │                │                   │
         │              │ • OS detection │ • NVD API         │
         │              │ • Tech stack   │ • ExploitDB       │
         │              │ • Security     │ • CVE scoring     │
         │              │   posture      │ • PoC mapping     │
         │              └────────────────┴───────────────────┘
         │                             │
         │                             ▼
         │              ┌─────────────────────────────────┐
         │              │   REASONER (Sonnet)             │
         │              │                                 │
         │              │ Input: Profile + CVEs + Services│
         │              │ Output: TacticalPlanObject      │
         │              │  ├── attack_vectors[]           │
         │              │  ├── action (for Executor)      │
         │              │  └── prediction_metrics         │
         │              └─────────────────────────────────┘
         │                             │
         ▼                             ▼
    ┌─────────────────────────────────────────────┐
    │      EXECUTION + EVALUATION LOOP            │
    ├─────────────────────────────────────────────┤
    │  1. Executor runs attack vector             │
    │  2. MCP Agent captures raw output           │
    │  3. Evaluator analyzes success/failure      │
    │  4. Orchestrator saves training pair        │
    └─────────────────────────────────────────────┘
                        │
                        ▼
              ┌──────────────────┐
              │  EVALUATOR       │
              │  (Haiku)         │
              │                  │
              │ Compares:        │
              │ • Predicted      │
              │ • Actual         │
              │                  │
              │ Labels:          │
              │ • True Positive  │
              │ • False Positive │
              │ • False Negative │
              └──────────────────┘
                        │
                        ▼
              ┌──────────────────┐
              │ TRAINING DATA    │
              │ STORAGE          │
              │                  │
              │ • PostgreSQL     │
              │ • JSON files     │
              │ • Metrics DB     │
              └──────────────────┘
```

---

## Phase-by-Phase Implementation

### Phase 1: Data Schema Enhancement

**Goal:** Define interfaces for intelligence context and tactical planning

**New Interfaces in `src/agent/definitions/types.ts`:**

```typescript
// ==================== INTELLIGENCE LAYER ====================

/**
 * Discovered service with enriched metadata
 */
export interface DiscoveredService {
  host: string
  port: number
  protocol: string
  service: string
  product?: string
  version?: string
  banner?: string
  category?: string          // "web", "database", "remote-access", etc.
  criticality?: string       // "high", "medium", "low"
  confidence?: number        // 0-1 score
}

/**
 * Target profile from Profiler Agent
 */
export interface TargetProfile {
  os_family?: string         // "Linux", "Windows", "BSD"
  os_version?: string        // "Ubuntu 20.04"
  tech_stack?: string[]      // ["LAMP", "Apache", "MySQL"]
  security_posture: string   // "hardened", "standard", "weak"
  risk_level: string         // "high-value", "medium", "low"
  evidence: string[]         // Supporting observations
}

/**
 * Vulnerability information from RAG Agent
 */
export interface VulnerabilityInfo {
  cve_id: string             // "CVE-2021-41773"
  severity: string           // "critical", "high", "medium", "low"
  cvss_score?: number        // 9.8
  description: string
  affected_service: string   // Link to service
  poc_available: boolean
  poc_url?: string
  exploitdb_id?: string
}

/**
 * Combined intelligence context
 */
export interface IntelligenceContext {
  discoveredServices: DiscoveredService[]
  targetProfile?: TargetProfile
  vulnerabilities: VulnerabilityInfo[]
  pocFindings: Array<{tool: string, url: string}>
}

// ==================== TACTICAL PLANNING ====================

/**
 * Action instructions for Executor
 */
export interface AttackAction {
  tool_name: string
  command_template: string
  parameters: Record<string, unknown>
  timeout_seconds: number
}

/**
 * Prediction metrics for ML Evaluator
 */
export interface PredictionMetrics {
  classification: {
    attack_type: string      // "RCE", "SQLi", "XSS", etc.
    mitre_id: string         // "T1190"
    cve_id?: string          // "CVE-2021-41773"
  }
  hypothesis: {
    confidence_score: number // 0-1
    rationale_tags: string[] // ["apache_2.4.49", "path_traversal"]
    expected_success: boolean
  }
  success_criteria: {
    match_type: string       // "regex_match", "status_code", "contains"
    match_pattern: string    // Regex or string to match
    negative_pattern?: string // Patterns indicating failure
  }
}

/**
 * Single attack vector with action + prediction
 */
export interface AttackVector {
  vector_id: string
  priority: number
  action: AttackAction
  prediction_metrics: PredictionMetrics
}

/**
 * Complete tactical plan from Reasoner
 */
export interface TacticalPlanObject {
  plan_id: string
  target_ip: string
  context_hash: string       // Hash of intelligence context used
  attack_vectors: AttackVector[]
  created_at: string         // ISO timestamp
}

// ==================== EVALUATION LOOP ====================

/**
 * Evaluation result from Evaluator Agent
 */
export interface EvaluationResult {
  vector_id: string
  prediction: PredictionMetrics
  actual_output: string
  label: 'true_positive' | 'false_positive' | 'false_negative' | 'true_negative'
  reasoning: string          // Evaluator's analysis
  confidence: number         // Evaluator's confidence in the label
  timestamp: string
}

/**
 * Training data pair for model improvement
 */
export interface TrainingPair {
  session_id: string
  iteration: number

  // Input context
  intelligence: IntelligenceContext
  reasoner_prompt: string

  // Reasoner's prediction
  tactical_plan: TacticalPlanObject

  // Execution result
  execution_output: string
  execution_success: boolean

  // Evaluation
  evaluation: EvaluationResult

  // Metadata
  created_at: string
  model_version: string      // Track which Reasoner version made this prediction
}

/**
 * Update ReasonerOutput to include tactical plan
 */
export interface ReasonerOutput {
  thought: string
  action: string
  tool?: string
  arguments?: Record<string, unknown>
  is_complete?: boolean

  // NEW: Tactical planning
  tactical_plan?: TacticalPlanObject
  attack_rationale?: string
  expected_success?: string
}

/**
 * Update CleanedData to support intelligence
 */
export interface CleanedData {
  type: string
  data: DiscoveredService[] | NmapScanResult | unknown
  summary: string
  intelligence?: IntelligenceContext  // NEW
}
```

---

### Phase 2: Enhanced Data Cleaner

**Goal:** Output discoveredServices with categorization and confidence scoring

**Modifications to `src/agent/definitions/data-cleaner.ts`:**

```typescript
// Add service categorization function
private categorizeService(serviceName: string): string {
  const categories: Record<string, string[]> = {
    'web': ['http', 'https', 'apache', 'nginx', 'iis', 'tomcat'],
    'database': ['mysql', 'postgresql', 'mongodb', 'redis', 'mssql', 'oracle'],
    'remote-access': ['ssh', 'rdp', 'telnet', 'vnc'],
    'file-sharing': ['smb', 'ftp', 'nfs', 'sftp'],
    'email': ['smtp', 'imap', 'pop3'],
    'domain': ['ldap', 'kerberos', 'domain']
  }

  for (const [category, services] of Object.entries(categories)) {
    if (services.some(s => serviceName.toLowerCase().includes(s))) {
      return category
    }
  }
  return 'other'
}

// Add confidence scoring
private calculateConfidence(port: NmapPortResult): number {
  let score = 0.5  // baseline for open port detection
  if (port.version) score += 0.3  // version detected
  if (port.service) score += 0.2  // service identified
  return Math.min(score, 1.0)
}

// Add criticality assessment
private assessCriticality(category: string, port: number): string {
  // High criticality services
  if (['database', 'remote-access', 'domain'].includes(category)) return 'high'

  // Well-known high-risk ports
  if ([22, 23, 3389, 445, 3306, 5432].includes(port)) return 'high'

  // Web services are medium
  if (category === 'web') return 'medium'

  return 'low'
}

// Transform to discoveredServices schema
private transformToDiscoveredServices(
  hosts: Array<{ip: string, ports?: NmapPortResult[]}>
): DiscoveredService[] {
  const services: DiscoveredService[] = []

  for (const host of hosts) {
    if (!host.ports) continue

    for (const port of host.ports) {
      if (port.state !== 'open') continue

      const category = this.categorizeService(port.service || '')

      services.push({
        host: host.ip,
        port: port.port,
        protocol: port.protocol,
        service: port.service || 'unknown',
        product: this.extractProduct(port.version),
        version: this.extractVersion(port.version),
        banner: port.version,
        category,
        criticality: this.assessCriticality(category, port.port),
        confidence: this.calculateConfidence(port)
      })
    }
  }

  return services
}

// Helper to extract product name from banner
private extractProduct(banner?: string): string | undefined {
  if (!banner) return undefined
  // Extract product name before version number
  const match = banner.match(/^([A-Za-z0-9\-_]+)/)
  return match ? match[1] : undefined
}

// Helper to extract version from banner
private extractVersion(banner?: string): string | undefined {
  if (!banner) return undefined
  // Extract version numbers (e.g., "2.4.41", "8.0.23")
  const match = banner.match(/(\d+\.[\d.]+)/)
  return match ? match[1] : undefined
}
```

---

### Phase 3: Profiler Agent

**Goal:** Analyze services to generate target profile

**New file: `src/agent/definitions/profiler.ts`**

```typescript
import Anthropic from '@anthropic-ai/sdk'
import { DiscoveredService, TargetProfile } from './types.js'

/**
 * ProfilerAgent analyzes discovered services to create a comprehensive target profile.
 *
 * Capabilities:
 * - OS fingerprinting from service banners and versions
 * - Technology stack inference (LAMP, MEAN, Windows Server, etc.)
 * - Security posture assessment (hardened, standard, weak)
 * - Risk level classification (high-value, medium, low)
 */
export class ProfilerAgent {
  private client: Anthropic
  private model = 'claude-3-5-haiku-20241022'
  private maxTokens = 1500

  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey })
  }

  /**
   * Generate a target profile from discovered services
   *
   * @param services - Array of discovered services with metadata
   * @returns Target profile with OS, tech stack, security posture, and risk assessment
   */
  async profile(services: DiscoveredService[]): Promise<TargetProfile> {
    const systemPrompt = `You are a cybersecurity profiling expert specializing in target reconnaissance analysis.

Your task is to analyze discovered network services and infer:

1. **OS Family & Version**:
   - Examine service banners, version numbers, and port patterns
   - Example: "OpenSSH 8.2p1 Ubuntu-4ubuntu0.1" → Ubuntu 20.04
   - Example: Multiple Windows services (SMB, RDP, IIS) → Windows Server

2. **Technology Stack**:
   - Identify common stacks: LAMP, LEMP, MEAN, Windows Server, etc.
   - Look for complementary services (Apache + MySQL + PHP = LAMP)

3. **Security Posture** (choose one):
   - "hardened": Only essential ports open, modern versions, no legacy protocols
   - "standard": Common services, reasonably up-to-date
   - "weak": Legacy services (Telnet, FTP), outdated versions, unnecessary ports exposed

4. **Risk Level** (choose one):
   - "high-value": Database servers, domain controllers, management interfaces
   - "medium": Web servers, application servers
   - "low": Test systems, non-critical services

5. **Evidence**: List specific observations supporting your assessment

Return JSON format:
{
  "os_family": "Linux|Windows|BSD|Unknown",
  "os_version": "Ubuntu 20.04" (if determinable),
  "tech_stack": ["LAMP", "Apache", "MySQL"],
  "security_posture": "hardened|standard|weak",
  "risk_level": "high-value|medium|low",
  "evidence": ["OpenSSH 8.2 indicates Ubuntu 20.04", "Only ports 22,80,443 open - minimal attack surface"]
}

Be concise and evidence-based. If uncertain, state "Unknown" rather than guessing.`

    const userMessage = `Analyze these discovered services:\n\n${JSON.stringify(services, null, 2)}\n\nGenerate target profile.`

    try {
      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: this.maxTokens,
        system: systemPrompt,
        messages: [{ role: 'user', content: userMessage }]
      })

      const content = response.content[0]
      if (content.type === 'text') {
        const jsonText = this.extractJSON(content.text)
        return JSON.parse(jsonText) as TargetProfile
      }

      throw new Error('No text content in response')
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error)
      throw new Error(`Profiler failed: ${message}`)
    }
  }

  /**
   * Extract JSON from LLM response text
   */
  private extractJSON(text: string): string {
    // Try to find JSON object in response
    const match = text.match(/\{[\s\S]*\}/)
    if (match) return match[0]

    // If no JSON found, assume entire text is JSON
    return text
  }
}
```

---

### Phase 4: RAG Agent with External APIs

**Goal:** Real-time CVE lookup from NVD and ExploitDB

**Dependencies:**
```bash
npm install axios node-cache
```

**New file: `src/agent/definitions/rag-agent.ts`**

```typescript
import axios from 'axios'
import NodeCache from 'node-cache'
import { DiscoveredService, TargetProfile, VulnerabilityInfo } from './types.js'

/**
 * RAGAgent performs real-time vulnerability research using external APIs.
 *
 * Data Sources:
 * - NVD (National Vulnerability Database) - CVE data with CVSS scores
 * - ExploitDB - Public exploit/PoC availability
 *
 * Features:
 * - Caching to avoid rate limits (1-hour TTL)
 * - OS-aware filtering (skip Windows CVEs for Linux targets)
 * - Severity-based prioritization
 */
export class RAGAgent {
  private cache: NodeCache
  private nvdApiKey?: string

  constructor(nvdApiKey?: string) {
    this.nvdApiKey = nvdApiKey
    // Cache CVE results for 1 hour (3600 seconds)
    this.cache = new NodeCache({ stdTTL: 3600 })
  }

  /**
   * Find vulnerabilities for discovered services
   *
   * @param services - Services to research
   * @param profile - Optional target profile for OS filtering
   * @returns Array of vulnerabilities sorted by severity
   */
  async findVulnerabilities(
    services: DiscoveredService[],
    profile?: TargetProfile
  ): Promise<VulnerabilityInfo[]> {
    const allVulnerabilities: VulnerabilityInfo[] = []

    for (const service of services) {
      // Skip if no version info (can't search CVEs without version)
      if (!service.product || !service.version) {
        console.debug(`[RAG] Skipping ${service.service} - no version info`)
        continue
      }

      // Check cache first
      const cacheKey = `${service.product}:${service.version}`
      const cached = this.cache.get<VulnerabilityInfo[]>(cacheKey)
      if (cached) {
        console.debug(`[RAG] Cache hit for ${cacheKey}`)
        allVulnerabilities.push(...cached)
        continue
      }

      console.debug(`[RAG] Querying NVD for ${cacheKey}`)

      // Query NVD API
      const cves = await this.queryNVD(service.product, service.version)

      // Query ExploitDB for PoCs
      const enrichedCves = await this.enrichWithPoCs(cves)

      // Filter by OS if profile available
      const filtered = profile
        ? this.filterByOS(enrichedCves, profile.os_family)
        : enrichedCves

      // Cache results
      this.cache.set(cacheKey, filtered)
      allVulnerabilities.push(...filtered)

      // Rate limiting: small delay between requests
      await this.sleep(200)
    }

    // Sort by severity (critical/high first)
    return allVulnerabilities.sort((a, b) => {
      const severityOrder: Record<string, number> = {
        critical: 0, high: 1, medium: 2, low: 3
      }
      return (severityOrder[a.severity] || 4) - (severityOrder[b.severity] || 4)
    })
  }

  /**
   * Query NVD API for CVEs affecting a specific product/version
   */
  private async queryNVD(
    product: string,
    version: string
  ): Promise<VulnerabilityInfo[]> {
    try {
      const headers = this.nvdApiKey
        ? { 'apiKey': this.nvdApiKey }
        : {}

      // NVD API v2.0 endpoint
      const response = await axios.get(
        'https://services.nvd.nist.gov/rest/json/cves/2.0',
        {
          params: {
            keywordSearch: `${product} ${version}`,
            resultsPerPage: 20
          },
          headers,
          timeout: 10000
        }
      )

      const vulnerabilities: VulnerabilityInfo[] = []

      for (const cve of response.data.vulnerabilities || []) {
        const cveData = cve.cve
        const metrics = cveData.metrics?.cvssMetricV31?.[0] || cveData.metrics?.cvssMetricV2?.[0]

        vulnerabilities.push({
          cve_id: cveData.id,
          severity: this.mapCVSSSeverity(metrics?.cvssData?.baseScore || 0),
          cvss_score: metrics?.cvssData?.baseScore,
          description: cveData.descriptions?.[0]?.value || 'No description',
          affected_service: `${product} ${version}`,
          poc_available: false,  // Will be enriched by ExploitDB
          poc_url: undefined,
          exploitdb_id: undefined
        })
      }

      console.debug(`[RAG] NVD returned ${vulnerabilities.length} CVEs for ${product} ${version}`)
      return vulnerabilities

    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error)
      console.error(`[RAG] NVD API error: ${message}`)
      return []
    }
  }

  /**
   * Enrich CVEs with PoC information from ExploitDB
   */
  private async enrichWithPoCs(
    cves: VulnerabilityInfo[]
  ): Promise<VulnerabilityInfo[]> {
    for (const cve of cves) {
      try {
        // ExploitDB search by CVE ID
        const response = await axios.get(
          `https://www.exploit-db.com/search`,
          {
            params: { cve: cve.cve_id },
            timeout: 5000
          }
        )

        // Parse HTML response to find exploit links
        // Note: In production, use proper HTML parser or ExploitDB's official API
        const hasExploit = response.data.includes('exploit/download')

        if (hasExploit) {
          cve.poc_available = true
          cve.poc_url = `https://www.exploit-db.com/exploits/?cve=${cve.cve_id}`
          console.debug(`[RAG] Found PoC for ${cve.cve_id}`)
        }

      } catch (error: unknown) {
        // Non-critical, continue without PoC info
        console.debug(`[RAG] ExploitDB lookup failed for ${cve.cve_id}`)
      }
    }

    return cves
  }

  /**
   * Filter CVEs by target OS family
   */
  private filterByOS(
    cves: VulnerabilityInfo[],
    osFamily?: string
  ): VulnerabilityInfo[] {
    if (!osFamily) return cves

    return cves.filter(cve => {
      const desc = cve.description.toLowerCase()
      const os = osFamily.toLowerCase()

      // Basic heuristic filtering
      if (os.includes('linux') && desc.includes('windows') && !desc.includes('linux')) {
        return false
      }
      if (os.includes('windows') && desc.includes('linux') && !desc.includes('windows')) {
        return false
      }

      return true
    })
  }

  /**
   * Map CVSS score to severity level
   */
  private mapCVSSSeverity(score: number): string {
    if (score >= 9.0) return 'critical'
    if (score >= 7.0) return 'high'
    if (score >= 4.0) return 'medium'
    return 'low'
  }

  /**
   * Sleep utility for rate limiting
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
  }
}
```

---

### Phase 5: Reasoner Enhancement - Tactical Planning

**Goal:** Update Reasoner to output TacticalPlanObject with prediction metrics

**Modifications to `src/agent/definitions/reasoner.ts`:**

```typescript
// Update system prompt to include tactical planning instructions
const REASONER_SYSTEM_PROMPT = `You are an expert penetration testing strategist with advanced threat intelligence capabilities.

... (existing prompt content) ...

# Intelligence-Driven Strategy

You receive enriched intelligence including:
- **Target Profile**: OS type, tech stack, security posture, risk level
- **Vulnerabilities**: Known CVEs with severity scores and PoC availability
- **Service Metadata**: Categorized services with confidence scores

Use this intelligence to:
1. Prioritize high-severity CVEs with available PoCs
2. Adjust tactics based on security posture:
   - **Hardened targets**: Avoid noisy attacks, use stealth techniques
   - **Weak targets**: Safe to use aggressive enumeration
3. Focus on high-value targets first
4. Match exploits to confirmed OS/service versions

# Tactical Planning Output

When planning attacks, output a TacticalPlanObject with this structure:

{
  "plan_id": "plan_<timestamp>_<sequential>",
  "target_ip": "192.168.1.50",
  "context_hash": "<hash of intelligence context>",
  "attack_vectors": [
    {
      "vector_id": "vec_01",
      "priority": 1,

      "action": {
        "tool_name": "exploit_runner",
        "command_template": "python3 exploits/cve-2021-41773.py --target {target}",
        "parameters": {
          "target": "192.168.1.50",
          "port": 80
        },
        "timeout_seconds": 30
      },

      "prediction_metrics": {
        "classification": {
          "attack_type": "RCE",
          "mitre_id": "T1190",
          "cve_id": "CVE-2021-41773"
        },
        "hypothesis": {
          "confidence_score": 0.85,
          "rationale_tags": ["apache_2.4.49", "path_traversal", "linux_target"],
          "expected_success": true
        },
        "success_criteria": {
          "match_type": "regex_match",
          "match_pattern": "(root:|uid=0|vulnerable)",
          "negative_pattern": "(404 Not Found|Connection refused)"
        }
      }
    }
  ]
}

**Critical**: The prediction_metrics section is used by the Evaluator Agent to measure your accuracy. Be honest about your confidence scores and provide clear success criteria.

... (rest of existing prompt) ...`

// Add method to parse tactical plan from response
private parseTacticalPlan(responseText: string): TacticalPlanObject | null {
  try {
    // Look for JSON in response
    const jsonMatch = responseText.match(/\{[\s\S]*"attack_vectors"[\s\S]*\}/)
    if (!jsonMatch) return null

    const plan = JSON.parse(jsonMatch[0])

    // Validate structure
    if (!plan.attack_vectors || !Array.isArray(plan.attack_vectors)) {
      return null
    }

    return plan as TacticalPlanObject
  } catch {
    return null
  }
}

// Update reason() method to include tactical plan in output
async reason(observation: string): Promise<ReasonerOutput> {
  // ... existing code ...

  // Parse tactical plan if present
  const tacticalPlan = this.parseTacticalPlan(content.text)

  return {
    thought,
    action,
    tool,
    arguments: args,
    is_complete,
    tactical_plan: tacticalPlan || undefined,
    attack_rationale: tacticalPlan ? 'See tactical plan for detailed rationale' : undefined
  }
}
```

---

### Phase 6: Evaluator Agent - The Learning Loop

**Goal:** Create Evaluator Agent to label attack outcomes and generate training data

**New file: `src/agent/definitions/evaluator.ts`**

```typescript
import Anthropic from '@anthropic-ai/sdk'
import { PredictionMetrics, EvaluationResult } from './types.js'

/**
 * EvaluatorAgent performs post-execution analysis to label attack outcomes.
 *
 * Role: "The Referee" - Provides ground truth labels for ML training
 *
 * Responsibilities:
 * - Compare predicted success criteria against actual tool output
 * - Label outcomes: true_positive, false_positive, false_negative, true_negative
 * - Generate reasoning for the label
 * - Calculate calibration metrics for Reasoner confidence scores
 */
export class EvaluatorAgent {
  private client: Anthropic
  private model = 'claude-3-5-haiku-20241022'
  private maxTokens = 1000

  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey })
  }

  /**
   * Evaluate an attack vector execution result
   *
   * @param vectorId - ID of the attack vector
   * @param prediction - The Reasoner's prediction metrics
   * @param actualOutput - Raw output from tool execution
   * @returns Evaluation with label and reasoning
   */
  async evaluate(
    vectorId: string,
    prediction: PredictionMetrics,
    actualOutput: string
  ): Promise<EvaluationResult> {
    const systemPrompt = `You are an impartial penetration testing result evaluator.

Your task is to compare the PREDICTED outcome against the ACTUAL tool output and assign a ground truth label.

**Labels:**
- **true_positive**: Attack was predicted to succeed AND actually succeeded
- **false_positive**: Attack was predicted to succeed BUT actually failed
- **false_negative**: Attack was predicted to fail BUT actually succeeded (rare)
- **true_negative**: Attack was predicted to fail AND actually failed

**Evaluation Process:**

1. Review the success criteria:
   - match_type: How to detect success (regex, status_code, contains)
   - match_pattern: Pattern indicating success
   - negative_pattern: Pattern indicating failure

2. Analyze the actual output:
   - Search for match_pattern in output
   - Check for negative_pattern (failures)
   - Consider context (errors, timeouts, partial success)

3. Compare with prediction:
   - Was expected_success = true?
   - What was the confidence_score?
   - Does actual outcome match prediction?

4. Assign label and provide reasoning

**Output JSON:**
{
  "label": "true_positive|false_positive|false_negative|true_negative",
  "reasoning": "The output contains 'root:x:0:0' matching the success pattern...",
  "confidence": 0.95
}

Be objective. A partial success is still a success. A timeout or error is a failure.`

    const userMessage = `**Prediction:**
${JSON.stringify(prediction, null, 2)}

**Actual Tool Output:**
\`\`\`
${actualOutput.substring(0, 5000)}
\`\`\`

Evaluate this result.`

    try {
      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: this.maxTokens,
        system: systemPrompt,
        messages: [{ role: 'user', content: userMessage }]
      })

      const content = response.content[0]
      if (content.type === 'text') {
        const result = JSON.parse(this.extractJSON(content.text))

        return {
          vector_id: vectorId,
          prediction,
          actual_output: actualOutput,
          label: result.label,
          reasoning: result.reasoning,
          confidence: result.confidence,
          timestamp: new Date().toISOString()
        }
      }

      throw new Error('No text content in response')

    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error)

      // Fallback: simple regex-based evaluation
      return this.fallbackEvaluation(vectorId, prediction, actualOutput, message)
    }
  }

  /**
   * Fallback evaluation using simple pattern matching (if LLM fails)
   */
  private fallbackEvaluation(
    vectorId: string,
    prediction: PredictionMetrics,
    actualOutput: string,
    error: string
  ): EvaluationResult {
    const { success_criteria, hypothesis } = prediction

    let actualSuccess = false

    // Check for success pattern
    if (success_criteria.match_type === 'regex_match') {
      const successRegex = new RegExp(success_criteria.match_pattern, 'i')
      actualSuccess = successRegex.test(actualOutput)

      // Check for negative pattern (failure indicators)
      if (success_criteria.negative_pattern) {
        const failureRegex = new RegExp(success_criteria.negative_pattern, 'i')
        if (failureRegex.test(actualOutput)) {
          actualSuccess = false
        }
      }
    } else if (success_criteria.match_type === 'contains') {
      actualSuccess = actualOutput.includes(success_criteria.match_pattern)
    }

    // Determine label
    let label: EvaluationResult['label']
    if (hypothesis.expected_success && actualSuccess) {
      label = 'true_positive'
    } else if (hypothesis.expected_success && !actualSuccess) {
      label = 'false_positive'
    } else if (!hypothesis.expected_success && actualSuccess) {
      label = 'false_negative'
    } else {
      label = 'true_negative'
    }

    return {
      vector_id: vectorId,
      prediction,
      actual_output: actualOutput,
      label,
      reasoning: `Fallback evaluation (LLM failed: ${error}). Pattern match result: ${actualSuccess}`,
      confidence: 0.6,  // Lower confidence for fallback
      timestamp: new Date().toISOString()
    }
  }

  /**
   * Extract JSON from LLM response
   */
  private extractJSON(text: string): string {
    const match = text.match(/\{[\s\S]*\}/)
    return match ? match[0] : text
  }
}
```

---

### Phase 7: Orchestrator Integration - Complete Flow

**Goal:** Integrate all agents into the main reconnaissance loop

**Modifications to `src/agent/index.ts`:**

```typescript
import { ProfilerAgent } from './definitions/profiler.js'
import { RAGAgent } from './definitions/rag-agent.js'
import { EvaluatorAgent } from './definitions/evaluator.js'
import {
  IntelligenceContext,
  TacticalPlanObject,
  TrainingPair,
  DiscoveredService
} from './definitions/types.js'

// Update AgentConfig interface
export interface AgentConfig {
  anthropicApiKey: string
  nvdApiKey?: string        // NEW
  skillsDir: string
  mcpServers: {
    nmap: { path: string }
  }
  enableEvaluation?: boolean  // NEW: Enable evaluation loop
  trainingDataPath?: string   // NEW: Path to save training data
}

export class PentestAgent {
  private config: AgentConfig
  private skillsLoader: SkillsLoader
  private reasoner: ReasonerAgent
  private executor: ExecutorAgent
  private mcpAgent: MCPAgent
  private dataCleaner: DataCleanerAgent
  private profiler: ProfilerAgent       // NEW
  private ragAgent: RAGAgent            // NEW
  private evaluator: EvaluatorAgent     // NEW

  private sessionId: string             // NEW: For tracking
  private trainingPairs: TrainingPair[] = []  // NEW: Collect training data

  constructor(config: AgentConfig) {
    this.config = config
    this.skillsLoader = new SkillsLoader(config.skillsDir)
    this.reasoner = new ReasonerAgent(config.anthropicApiKey)
    this.executor = new ExecutorAgent(config.anthropicApiKey)
    this.mcpAgent = new MCPAgent()
    this.dataCleaner = new DataCleanerAgent(config.anthropicApiKey)
    this.profiler = new ProfilerAgent(config.anthropicApiKey)
    this.ragAgent = new RAGAgent(config.nvdApiKey)
    this.evaluator = new EvaluatorAgent(config.anthropicApiKey)

    // Generate session ID
    this.sessionId = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
  }

  async reconnaissance(target: string): Promise<void> {
    console.log(`\n[Orchestrator] Starting reconnaissance on: ${target}`)
    console.log(`[Orchestrator] Session ID: ${this.sessionId}`)
    console.log('='.repeat(60))

    this.reasoner.reset()
    let iteration = 0
    const maxIterations = 15
    let aggregatedResults: CleanedData[] = []
    let allDiscoveredServices: DiscoveredService[] = []
    let currentIntelligence: IntelligenceContext | undefined

    // Initial observation
    let observation = `Starting reconnaissance mission on target: ${target}`

    while (iteration < maxIterations) {
      iteration++
      console.log(`\n[Orchestrator] === Iteration ${iteration} ===`)

      // ===== STEP 1: REASONER - Strategic planning =====
      console.log('\n[Reasoner] Analyzing situation...')
      const reasoning = await this.reasoner.reason(observation)

      console.log(`[Reasoner] Thought: ${reasoning.thought}`)
      console.log(`[Reasoner] Action: ${reasoning.action}`)

      if (reasoning.is_complete) {
        console.log('\n[Orchestrator] Reasoner indicates mission complete')
        break
      }

      // ===== STEP 2: EXECUTOR - Break down into steps =====
      console.log('\n[Executor] Planning execution...')
      const plan = await this.executor.planExecution(reasoning)

      if (plan.steps.length === 0) {
        console.log('[Executor] No executable steps.')
        observation = 'No tools to execute. Continue analysis or indicate completion.'
        continue
      }

      console.log(`[Executor] Plan: ${plan.steps.length} step(s)`)

      // ===== STEP 3: MCP AGENT + DATA CLEANER - Execute and parse =====
      let currentPlan = { ...plan }

      while (true) {
        const step = this.executor.getNextStep(currentPlan)
        if (!step) break

        // 3a. Execute tool
        console.log(`\n[MCP Agent] Executing: ${step.tool}`)
        const rawResult = await this.mcpAgent.executeTool(step)

        if (rawResult.success) {
          console.log('[MCP Agent] ✓ Execution successful')

          // 3b. Clean output
          console.log('[Data Cleaner] Parsing output...')
          const cleanedData = await this.dataCleaner.clean(rawResult.output, step.tool)

          // Extract discovered services
          if (Array.isArray(cleanedData.data)) {
            allDiscoveredServices.push(...cleanedData.data)
          }

          // ===== STEP 4: INTELLIGENCE LAYER (Parallel) =====
          if (allDiscoveredServices.length > 0) {
            console.log('\n[Intelligence Layer] Starting parallel analysis...')

            const [targetProfile, vulnerabilities] = await Promise.all([
              this.profiler.profile(allDiscoveredServices)
                .catch(err => {
                  console.log('[Profiler] ⚠ Failed (continuing without profile):', err.message)
                  return null
                }),
              this.ragAgent.findVulnerabilities(allDiscoveredServices)
                .catch(err => {
                  console.log('[RAG Agent] ⚠ Failed (continuing without CVE data):', err.message)
                  return []
                })
            ])

            if (targetProfile) {
              console.log(`[Profiler] ✓ Profile: ${targetProfile.os_family} - ${targetProfile.security_posture}`)
            }

            if (vulnerabilities.length > 0) {
              console.log(`[RAG Agent] ✓ Found ${vulnerabilities.length} vulnerabilities`)
              vulnerabilities.slice(0, 3).forEach(v => {
                console.log(`  - ${v.cve_id} (${v.severity})`)
              })
            }

            // Build intelligence context
            currentIntelligence = {
              discoveredServices: allDiscoveredServices,
              targetProfile: targetProfile || undefined,
              vulnerabilities: vulnerabilities,
              pocFindings: vulnerabilities
                .filter(v => v.poc_url)
                .map(v => ({ tool: v.affected_service, url: v.poc_url! }))
            }

            // Attach to cleaned data
            cleanedData.intelligence = currentIntelligence
          }

          aggregatedResults.push(cleanedData)
        } else {
          console.log(`[MCP Agent] ✗ Execution failed: ${rawResult.error}`)
        }

        currentPlan = this.executor.advancePlan(currentPlan)
      }

      // ===== STEP 5: EVALUATION LOOP (if tactical plan exists) =====
      if (this.config.enableEvaluation && reasoning.tactical_plan) {
        await this.runEvaluationLoop(
          reasoning.tactical_plan,
          currentIntelligence,
          aggregatedResults[aggregatedResults.length - 1],
          iteration
        )
      }

      // ===== STEP 6: Feed enriched results back to Reasoner =====
      const lastResult = aggregatedResults[aggregatedResults.length - 1]
      if (lastResult && lastResult.intelligence) {
        const intel = lastResult.intelligence
        observation = `Tool execution completed.

Discovered Services: ${intel.discoveredServices.length} services found
${intel.targetProfile ? `
Target Profile:
- OS: ${intel.targetProfile.os_family}
- Security: ${intel.targetProfile.security_posture}
- Risk: ${intel.targetProfile.risk_level}` : ''}
${intel.vulnerabilities.length > 0 ? `
Vulnerabilities Found: ${intel.vulnerabilities.length}
Top CVEs: ${intel.vulnerabilities.slice(0, 3).map(v => v.cve_id).join(', ')}` : ''}

Summary: ${lastResult.summary}`

        this.reasoner.addObservation(observation)
      }

      await new Promise(resolve => setTimeout(resolve, 500))
    }

    // ===== STEP 7: Save training data =====
    if (this.config.enableEvaluation && this.trainingPairs.length > 0) {
      await this.saveTrainingData()
    }

    console.log('\n' + '='.repeat(60))
    console.log('[Orchestrator] Reconnaissance finished')
    console.log(`[Orchestrator] Training pairs collected: ${this.trainingPairs.length}`)
  }

  /**
   * Run evaluation loop for tactical plan execution
   */
  private async runEvaluationLoop(
    tacticalPlan: TacticalPlanObject,
    intelligence: IntelligenceContext | undefined,
    executionResult: CleanedData,
    iteration: number
  ): Promise<void> {
    console.log('\n[Evaluation Loop] Analyzing attack outcomes...')

    for (const vector of tacticalPlan.attack_vectors) {
      // Get actual output (simplified - in production, track per-vector)
      const actualOutput = JSON.stringify(executionResult.data)

      // Evaluate
      const evaluation = await this.evaluator.evaluate(
        vector.vector_id,
        vector.prediction_metrics,
        actualOutput
      )

      console.log(`[Evaluator] ${vector.vector_id}: ${evaluation.label} (confidence: ${evaluation.confidence})`)
      console.log(`[Evaluator] Reasoning: ${evaluation.reasoning}`)

      // Create training pair
      const trainingPair: TrainingPair = {
        session_id: this.sessionId,
        iteration,
        intelligence: intelligence || {
          discoveredServices: [],
          vulnerabilities: [],
          pocFindings: []
        },
        reasoner_prompt: 'See intelligence context',
        tactical_plan: tacticalPlan,
        execution_output: actualOutput,
        execution_success: evaluation.label === 'true_positive',
        evaluation,
        created_at: new Date().toISOString(),
        model_version: 'claude-sonnet-4-20250514'
      }

      this.trainingPairs.push(trainingPair)
    }
  }

  /**
   * Save training data to disk
   */
  private async saveTrainingData(): Promise<void> {
    const outputPath = this.config.trainingDataPath || './training_data'
    const filename = `${outputPath}/${this.sessionId}.json`

    const fs = await import('fs/promises')

    // Ensure directory exists
    await fs.mkdir(outputPath, { recursive: true })

    // Save training pairs
    await fs.writeFile(
      filename,
      JSON.stringify(this.trainingPairs, null, 2),
      'utf-8'
    )

    console.log(`[Orchestrator] Training data saved: ${filename}`)
  }

  // ... rest of existing methods ...
}
```

---

### Phase 8: Update Entry Point

**Modifications to `src/index.ts`:**

```typescript
async function main() {
  const nmapPath = process.env.NMAP_SERVER_PATH ||
    path.resolve('../pentest-mcp-server/nmap-server-ts/dist/index.js')

  const anthropicApiKey = process.env.ANTHROPIC_API_KEY
  if (!anthropicApiKey) {
    console.error('Error: ANTHROPIC_API_KEY environment variable is required')
    process.exit(1)
  }

  // NEW: Optional NVD API key
  const nvdApiKey = process.env.NVD_API_KEY

  // Configuration
  const config = {
    anthropicApiKey,
    nvdApiKey,                                    // NEW
    skillsDir: path.resolve('./src/skills'),
    mcpServers: {
      nmap: { path: nmapPath }
    },
    enableEvaluation: true,                      // NEW
    trainingDataPath: './training_data'          // NEW
  }

  const agent = new PentestAgent(config)
  await agent.initialize()

  // ... rest of CLI handling ...
}
```

---

## Environment Variables

Update `.env` or export these variables:

```bash
# Required
export ANTHROPIC_API_KEY="sk-ant-..."

# Optional but recommended
export NVD_API_KEY="your-nvd-api-key"  # Get from https://nvd.nist.gov/developers/request-an-api-key

# Optional
export NMAP_SERVER_PATH="/path/to/nmap-server-ts/dist/index.js"
```

---

## Dependencies Update

**package.json:**

```json
{
  "dependencies": {
    "@anthropic-ai/claude-agent-sdk": "^0.2.29",
    "@anthropic-ai/sdk": "^0.72.1",
    "@cyber/mcp-nmap-client": "file:.yalc/@cyber/mcp-nmap-client",
    "axios": "^1.6.0",
    "node-cache": "^5.1.2",
    "typescript": "^5.9.3"
  }
}
```

Install:
```bash
npm install
```

---

## File Structure Summary

```
src/
├── agent/
│   ├── index.ts                          # MODIFIED: Orchestrator with evaluation loop
│   ├── skillsLoader.ts                   # No changes
│   └── definitions/
│       ├── index.ts                      # MODIFIED: Export new agents
│       ├── types.ts                      # MODIFIED: Add all new interfaces
│       ├── reasoner.ts                   # MODIFIED: Tactical planning output
│       ├── executor.ts                   # No changes
│       ├── mcp-agent.ts                  # No changes
│       ├── data-cleaner.ts               # MODIFIED: discoveredServices schema
│       ├── profiler.ts                   # NEW: Target profiling
│       ├── rag-agent.ts                  # NEW: CVE/vulnerability lookup
│       └── evaluator.ts                  # NEW: Outcome evaluation
├── index.ts                              # MODIFIED: Add NVD_API_KEY, evaluation config
└── skills/
    └── nmap_skill.md                     # No changes

training_data/                            # NEW: Training pairs storage
├── session_1738012345_abc123.json
└── session_1738023456_def456.json
```

---

## Verification & Testing

### Unit Tests

1. **Profiler Agent:**
   ```bash
   # Test OS detection
   - Apache 2.4.41 + MySQL 8.0 → LAMP stack, Linux
   - IIS + MSSQL → Windows Server
   - SSH 8.2p1 Ubuntu banner → Ubuntu 20.04
   - Only ports 22,80,443 → "hardened" posture
   - Telnet + FTP + old SMB → "weak" posture
   ```

2. **RAG Agent:**
   ```bash
   # Test NVD API integration
   - Apache 2.4.49 → finds CVE-2021-41773
   - Caching works (2nd query instant)
   - Rate limiting handled gracefully
   - OS filtering (Linux CVEs only for Linux target)
   ```

3. **Evaluator Agent:**
   ```bash
   # Test labeling accuracy
   - Predicted success + actual success → true_positive
   - Predicted success + actual failure → false_positive
   - Success pattern matching (regex, contains)
   - Negative pattern detection
   ```

### Integration Tests

**Full reconnaissance with evaluation:**

```bash
npm run build
npm start recon scanme.nmap.org
```

**Expected output:**
```
[Orchestrator] Session ID: session_1738012345_abc123
[Data Cleaner] ✓ Type: nmap_scan
[Intelligence Layer] Starting parallel analysis...
[Profiler] ✓ Profile: Linux - hardened
[RAG Agent] ✓ Found 2 vulnerabilities
  - CVE-2021-XXXX (high)
[Reasoner] Generating tactical plan...
[Executor] Executing attack vectors...
[Evaluation Loop] Analyzing attack outcomes...
[Evaluator] vec_01: true_positive (confidence: 0.92)
[Orchestrator] Training data saved: ./training_data/session_1738012345_abc123.json
```

### End-to-End Scenarios

**Scenario 1: Modern Hardened Target**
- Target: Ubuntu 22.04, only SSH + HTTPS
- Expected:
  - Profiler → "hardened", "low" risk
  - RAG → minimal CVEs (modern versions)
  - Reasoner → stealth tactics, low confidence scores
  - Evaluator → mostly true_negatives (attacks fail as expected)

**Scenario 2: Legacy Vulnerable Target**
- Target: Windows Server 2008, SMB + RDP + Telnet
- Expected:
  - Profiler → "weak", "high-value" risk
  - RAG → multiple critical CVEs (MS17-010, etc.)
  - Reasoner → aggressive tactics, high confidence
  - Evaluator → true_positives (attacks succeed)

---

## Training Data Analysis

After collecting training data, analyze Reasoner performance:

```python
import json

# Load training pairs
with open('training_data/session_xxx.json') as f:
    pairs = json.load(f)

# Calculate precision
true_positives = sum(1 for p in pairs if p['evaluation']['label'] == 'true_positive')
false_positives = sum(1 for p in pairs if p['evaluation']['label'] == 'false_positive')
precision = true_positives / (true_positives + false_positives)

print(f"Reasoner Precision: {precision:.2%}")

# Analyze confidence calibration
for pair in pairs:
    predicted_conf = pair['tactical_plan']['attack_vectors'][0]['prediction_metrics']['hypothesis']['confidence_score']
    actual_success = pair['execution_success']
    print(f"Predicted: {predicted_conf:.2f}, Actual: {actual_success}")
```

---

## Performance Metrics

| Metric | Before Upgrade | After Upgrade |
|--------|---------------|---------------|
| Agents | 4 (Reasoner, Executor, MCP, Cleaner) | 7 (+Profiler, RAG, Evaluator) |
| Intelligence | None | Profile + CVEs |
| Attack Planning | Generic tool calls | Tactical plan with predictions |
| Learning Loop | None | Automated evaluation + training data |
| Latency per iteration | ~2-3s | ~5-7s (parallel intelligence) |
| Training data | None | JSON pairs for RLHF |

---

## Cost Analysis

**Per reconnaissance session (10 iterations):**

| Agent | Model | Calls | Tokens/Call | Cost |
|-------|-------|-------|-------------|------|
| Reasoner | Sonnet 4 | 10 | 3000 | ~$0.45 |
| Executor | Haiku 3.5 | 10 | 1000 | ~$0.02 |
| Data Cleaner | Haiku 3.5 | 10 | 1500 | ~$0.03 |
| Profiler | Haiku 3.5 | 2-3 | 1500 | ~$0.01 |
| RAG Agent | N/A (API) | 5-10 | N/A | Free |
| Evaluator | Haiku 3.5 | 5-10 | 1000 | ~$0.02 |
| **Total** | | | | **~$0.53** |

NVD API: Free (with rate limits)

---

## Future Enhancements

1. **PostgreSQL Storage**: Replace JSON files with proper database for training data
2. **RLHF Pipeline**: Use training pairs to fine-tune a custom Reasoner model
3. **Vector Store for RAG**: Add semantic search over CVE database
4. **MITRE ATT&CK Mapping**: Tag attack vectors with ATT&CK techniques
5. **Human-in-the-Loop**: Allow human corrections to Evaluator labels
6. **Confidence Calibration**: Automatically adjust Reasoner confidence based on historical accuracy

---

## Success Criteria

✅ **Functional:**
- Profiler accurately identifies OS and security posture (>80% accuracy)
- RAG finds relevant CVEs from NVD API
- Reasoner outputs tactical plans with prediction metrics
- Evaluator correctly labels outcomes (>85% agreement with human review)
- Training data saved in structured format

✅ **Performance:**
- Intelligence layer adds <5s latency per iteration
- Parallel execution (Profiler + RAG) ~1.5-2x faster than sequential
- Evaluation loop adds <2s per attack vector

✅ **Learning:**
- Training pairs capture full context (intelligence → plan → outcome → evaluation)
- Precision/recall metrics calculable from training data
- Confidence calibration error measurable

---

## Implementation Priority

1. **Week 1**: Data schemas + Enhanced Data Cleaner
2. **Week 2**: Profiler + RAG Agent (with APIs)
3. **Week 3**: Reasoner tactical planning upgrade
4. **Week 4**: Evaluator + Orchestrator integration
5. **Week 5**: Testing + Training data analysis

---

## Conclusion

This architecture transforms the MVP pentest agent into a production-grade system with:

- **Situational Awareness**: Target profiling and real-time CVE intelligence
- **Strategic Planning**: Tactical plans with predictive metrics and attack rationale
- **Continuous Learning**: Automated evaluation loop generating training data for RLHF

The closed-loop design ensures every attack becomes a learning opportunity, enabling continuous improvement of the Reasoner's decision-making capabilities.

---

**Document Version:** 1.0
**Last Updated:** 2026-02-04
**Author:** AI Architecture Planning System
