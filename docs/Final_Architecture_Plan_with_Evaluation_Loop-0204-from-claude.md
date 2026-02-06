# Complete AI Penetration Testing Architecture: Intelligence + Evaluation Loop

**Generated:** 2026-02-04
**Updated:** 2026-02-06
**Version:** 1.2
**Status:** Implementation Plan

---

## Executive Summary

This document combines three architectural upgrades to transform the MVP pentest agent into a production-grade intelligent system with self-improving capabilities:

1. **Intelligence Layer** - Target profiling and exploit lookup via SearchSploit MCP (Profiler + VulnLookup)
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
         │  ┌──────────────────────────────────────────────────────┐
         │  │          INTELLIGENCE LAYER (Parallel)               │
         │  ├──────────────┬──────────────────┬────────────────────┤
         │  │  PROFILER    │  VULN LOOKUP     │  RAG MEMORY        │
         │  │  (Haiku)     │  (SearchSploit   │  (ChromaDB MCP)    │
         │  │              │   MCP Server)    │                    │
         │  │ • OS detect  │ • searchsploit   │ • Anti-patterns    │
         │  │ • Tech stack │   _search        │ • Past failures    │
         │  │ • Security   │ • searchsploit   │ • Human lessons    │
         │  │   posture    │   _examine       │ • Playbooks        │
         │  └──────────────┴──────────────────┴────────────────────┘
         │                             │
         │                             ▼
         │              ┌──────────────────────────────────────┐
         │              │   REASONER (Sonnet)                  │
         │              │                                      │
         │              │ Input: Profile + Exploits + Services  │
         │              │      + RAG Memory Warnings           │
         │              │ Output: TacticalPlanObject           │
         │              │  ├── attack_vectors[]                │
         │              │  ├── action (for Executor)           │
         │              │  └── prediction_metrics              │
         │              └──────────────────────────────────────┘
         │                             │
         ▼                             ▼
    ┌─────────────────────────────────────────────┐
    │      EXECUTION + EVALUATION LOOP            │
    ├─────────────────────────────────────────────┤
    │  1. Executor runs attack vector             │
    │  2. MCP Agent captures raw output           │
    │  3. Evaluator analyzes success/failure      │
    │  4. Orchestrator saves training pair        │
    │  5. Session logger records step (JSONL)     │
    └─────────────────────────────────────────────┘
                        │
           ┌────────────┴────────────┐
           ▼                         ▼
  ┌──────────────────┐     ┌──────────────────────┐
  │  EVALUATOR       │     │  SESSION LOGGER      │
  │  (Haiku)         │     │                      │
  │                  │     │  Logs each step to   │
  │ Compares:        │     │  JSONL for ETL       │
  │ • Predicted      │     │  processing          │
  │ • Actual         │     │                      │
  │                  │     │  logs/sessions/       │
  │ Labels:          │     │  ├── session_01.jsonl │
  │ • True Positive  │     │  └── session_02.jsonl │
  │ • False Positive │     └──────────┬───────────┘
  │ • False Negative │                │
  └──────────────────┘                ▼
           │               ┌──────────────────────┐
           ▼               │  ETL PIPELINE        │
  ┌──────────────────┐     │  (pentest-rag-memory)│
  │ TRAINING DATA    │     │                      │
  │ STORAGE          │     │  Extract → Transform │
  │                  │     │  (DeepSeek) → Load   │
  │ • JSON files     │     │  (ChromaDB)          │
  │ • Metrics DB     │     └──────────┬───────────┘
  └──────────────────┘                │
                                      ▼
                           ┌──────────────────────┐
                           │  ChromaDB            │
                           │  (Vector Store)      │
                           │                      │
                           │  • anti_patterns     │
                           │  • playbooks         │
                           │  • tool_preferences  │
                           └──────────────────────┘
                                      │
                           Feeds back via RAG MCP Server
                                      │
                                      ▼
                           (back to Intelligence Layer)
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

### Phase 4: Intelligence Layer — VulnLookup Agent + RAG Memory System

The Intelligence Layer consists of three parallel subsystems that enrich the Reasoner's context before each decision. The **Profiler** (Phase 3) handles target profiling. This phase covers the remaining two:

- **Phase 4a: VulnLookupAgent** — Exploit/CVE lookup via SearchSploit MCP Server (local ExploitDB)
- **Phase 4b: RAG Memory System** — Long-term anti-pattern memory via ChromaDB (separate repo: `pentest-rag-memory`)

#### Phase 4a: VulnLookup Agent (Exploit Lookup via SearchSploit MCP)

**Goal:** Vulnerability and exploit research using the SearchSploit MCP Server (local ExploitDB)

**Architecture Change:** Instead of making HTTP requests to NVD and ExploitDB web APIs, the VulnLookupAgent now connects to the **SearchSploit MCP Server** from the `pentest-mcp-server` repository. This provides:

- **Offline-capable** lookups against the local ExploitDB database
- **No rate limits** (local CLI tool, no external API dependency)
- **Structured JSON output** with exploit metadata, CVE codes, and local file paths
- **PoC access** — can examine exploit code and get local paths directly
- **Consistent MCP interface** — same protocol as nmap and RAG memory servers

**SearchSploit MCP Server Tools (from `pentest-mcp-server/searchsploit-server-ts`):**

| Tool | Purpose | Key Parameters |
|------|---------|----------------|
| `searchsploit_search` | Search ExploitDB by keyword/CVE/product | query, exact, title, exclude, cve |
| `searchsploit_examine` | Get full exploit details + code by EDB-ID | edbId |
| `searchsploit_path` | Get local filesystem path for exploit | edbId |

**Dependencies:**

No additional npm packages needed — the VulnLookupAgent communicates via the MCP protocol through the existing `MCPAgent` infrastructure. The SearchSploit MCP Server is a separate process from `pentest-mcp-server`.

```bash
# Ensure searchsploit CLI is installed (ExploitDB's official tool)
sudo apt install exploitdb  # or: git clone https://gitlab.com/exploit-database/exploitdb.git

# Build the SearchSploit MCP server
cd ../pentest-mcp-server/searchsploit-server-ts && npm run build
```

**New file: `src/agent/definitions/vuln-lookup.ts`**

```typescript
import { DiscoveredService, TargetProfile, VulnerabilityInfo } from './types.js'

/**
 * SearchSploit search result from MCP server
 */
interface SearchSploitResult {
  success: boolean
  search: string
  summary: string
  exploits: SearchSploitExploit[]
  shellcodes: SearchSploitExploit[]
  papers: SearchSploitExploit[]
  command: string
  error?: string
}

/**
 * Individual exploit from SearchSploit
 */
interface SearchSploitExploit {
  Title: string
  'EDB-ID': string
  Date_Published: string
  Author: string
  Type: string
  Platform: string
  Port: string
  Verified: string
  Codes: string         // CVE codes, comma-separated
  Path: string          // Local file path
}

/**
 * VulnLookupAgent performs vulnerability research via the SearchSploit MCP Server.
 *
 * Data Source:
 * - SearchSploit MCP Server (pentest-mcp-server/searchsploit-server-ts)
 *   → wraps the searchsploit CLI → queries local ExploitDB database
 *
 * Features:
 * - Offline-capable: No external API calls, uses local ExploitDB database
 * - No rate limits: Local CLI tool, unlimited queries
 * - PoC access: Can examine full exploit code via searchsploit_examine
 * - OS/platform-aware filtering
 * - Severity inference from exploit type and platform
 *
 * Connection Flow:
 *   VulnLookupAgent → MCPAgent → SearchSploit MCP Server → searchsploit CLI → ExploitDB (local)
 *
 * Note: This is NOT the RAG memory system. This agent performs exploit lookups.
 * For learned anti-patterns from past sessions, see the RAG Memory System (Phase 4b).
 */
export class VulnLookupAgent {
  private mcpAgent: MCPAgent  // Shared MCP agent for tool execution

  constructor(mcpAgent: MCPAgent) {
    this.mcpAgent = mcpAgent
  }

  /**
   * Find vulnerabilities for discovered services using SearchSploit MCP
   *
   * @param services - Services to research
   * @param profile - Optional target profile for OS/platform filtering
   * @returns Array of vulnerabilities sorted by severity
   */
  async findVulnerabilities(
    services: DiscoveredService[],
    profile?: TargetProfile
  ): Promise<VulnerabilityInfo[]> {
    const allVulnerabilities: VulnerabilityInfo[] = []

    for (const service of services) {
      // Skip if no product info (can't search without product name)
      if (!service.product) {
        console.debug(`[VulnLookup] Skipping ${service.service} - no product info`)
        continue
      }

      // Build search query: "product version" (e.g., "apache 2.4.49")
      const query = service.version
        ? `${service.product} ${service.version}`
        : service.product

      console.debug(`[VulnLookup] Searching SearchSploit for: ${query}`)

      try {
        // Call searchsploit_search via MCP
        const result = await this.mcpAgent.executeTool({
          tool: 'searchsploit_search',
          arguments: {
            query,
            exclude: ['dos', 'Denial of Service'],  // Skip DoS by default
          },
          description: `Search exploits for ${query}`
        })

        if (result.success && result.output) {
          const searchResult: SearchSploitResult = JSON.parse(result.output)

          if (searchResult.success) {
            // Transform SearchSploit results to VulnerabilityInfo
            const vulns = this.transformResults(searchResult, service)

            // Filter by OS/platform if profile available
            const filtered = profile
              ? this.filterByPlatform(vulns, profile.os_family)
              : vulns

            allVulnerabilities.push(...filtered)

            console.debug(
              `[VulnLookup] Found ${searchResult.exploits.length} exploits, ` +
              `${searchResult.shellcodes.length} shellcodes for ${query}`
            )
          }
        }
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error)
        console.error(`[VulnLookup] SearchSploit query failed for ${query}: ${message}`)
      }
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
   * Examine a specific exploit by EDB-ID to get full details and code
   */
  async examineExploit(edbId: string): Promise<string | null> {
    try {
      const result = await this.mcpAgent.executeTool({
        tool: 'searchsploit_examine',
        arguments: { edbId },
        description: `Examine exploit EDB-${edbId}`
      })

      if (result.success && result.output) {
        const examineResult = JSON.parse(result.output)
        return examineResult.output || null
      }
      return null
    } catch {
      return null
    }
  }

  /**
   * Get local file path for an exploit by EDB-ID
   */
  async getExploitPath(edbId: string): Promise<string | null> {
    try {
      const result = await this.mcpAgent.executeTool({
        tool: 'searchsploit_path',
        arguments: { edbId },
        description: `Get path for exploit EDB-${edbId}`
      })

      if (result.success && result.output) {
        const pathResult = JSON.parse(result.output)
        return pathResult.path || null
      }
      return null
    } catch {
      return null
    }
  }

  /**
   * Transform SearchSploit results into VulnerabilityInfo format
   */
  private transformResults(
    searchResult: SearchSploitResult,
    service: DiscoveredService
  ): VulnerabilityInfo[] {
    const vulns: VulnerabilityInfo[] = []

    for (const exploit of searchResult.exploits) {
      // Extract CVE IDs from the Codes field (e.g., "CVE-2021-41773;CVE-2021-42013")
      const cveIds = this.extractCVEs(exploit.Codes)

      // Infer severity from exploit type
      const severity = this.inferSeverity(exploit.Type, exploit.Verified)

      if (cveIds.length > 0) {
        // Create one entry per CVE
        for (const cveId of cveIds) {
          vulns.push({
            cve_id: cveId,
            severity,
            description: exploit.Title,
            affected_service: `${service.product} ${service.version || ''}`.trim(),
            poc_available: true,  // SearchSploit entries ARE PoCs
            poc_url: exploit.Path,
            exploitdb_id: exploit['EDB-ID']
          })
        }
      } else {
        // No CVE — still valuable as an exploit finding
        vulns.push({
          cve_id: `EDB-${exploit['EDB-ID']}`,
          severity,
          description: exploit.Title,
          affected_service: `${service.product} ${service.version || ''}`.trim(),
          poc_available: true,
          poc_url: exploit.Path,
          exploitdb_id: exploit['EDB-ID']
        })
      }
    }

    return vulns
  }

  /**
   * Extract CVE IDs from SearchSploit Codes field
   * Input: "CVE-2021-41773;CVE-2021-42013" or "OSVDB-12345" or ""
   */
  private extractCVEs(codes: string): string[] {
    if (!codes) return []
    const matches = codes.match(/CVE-\d{4}-\d+/g)
    return matches || []
  }

  /**
   * Infer severity from exploit type
   * SearchSploit types: "local", "remote", "webapps", "dos", "shellcode"
   */
  private inferSeverity(type: string, verified: string): string {
    const isVerified = verified === '1'

    switch (type.toLowerCase()) {
      case 'remote':
        return isVerified ? 'critical' : 'high'
      case 'webapps':
        return isVerified ? 'high' : 'medium'
      case 'local':
        return 'medium'
      case 'shellcode':
        return 'high'
      default:
        return 'medium'
    }
  }

  /**
   * Filter vulnerabilities by target OS/platform
   */
  private filterByPlatform(
    vulns: VulnerabilityInfo[],
    osFamily?: string
  ): VulnerabilityInfo[] {
    if (!osFamily) return vulns

    const os = osFamily.toLowerCase()

    return vulns.filter(vuln => {
      const desc = vuln.description.toLowerCase()

      // Basic heuristic: skip obviously wrong platform
      if (os.includes('linux') && desc.includes('windows') && !desc.includes('linux')) {
        return false
      }
      if (os.includes('windows') && desc.includes('linux') && !desc.includes('windows')) {
        return false
      }

      return true
    })
  }
}
```

---

#### Phase 4b: RAG Memory System (Long-Term Anti-Pattern Learning)

**Goal:** Enable the agent to learn from past failures and human interventions, preventing repeated mistakes across sessions

**Separate Repository:** `pentest-rag-memory` (already created, Phase 1 foundation complete)

**Key Difference from VulnLookup:**
| Aspect | VulnLookupAgent (Phase 4a) | RAG Memory System (Phase 4b) |
|--------|---------------------------|------------------------------|
| **Data Source** | SearchSploit MCP Server (local ExploitDB) | Internal experience (past sessions) |
| **Knowledge Type** | Known exploits/CVEs for specific products | Anti-patterns, playbooks, tool preferences |
| **When Queried** | After service discovery | Before every Reasoner decision |
| **Storage** | No caching needed (local CLI, fast) | ChromaDB vector store (persistent) |
| **Learning** | No learning (static lookups) | Continuously learns from failures |
| **Network** | Offline-capable (local database) | Offline (local ChromaDB) |

**Architecture:**

```
┌───────────────────────────────────────────────────────────────────────┐
│                  RAG LONG-TERM FEEDBACK SYSTEM                        │
│                  (pentest-rag-memory repository)                      │
├───────────────────────────────────────────────────────────────────────┤
│                                                                       │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────────────┐    │
│  │  Data         │    │  ETL         │    │  Vector Database     │    │
│  │  Collection   │───▶│  Pipeline    │───▶│  (ChromaDB)          │    │
│  │  (JSONL Logs) │    │  (DeepSeek)  │    │                      │    │
│  └──────────────┘    └──────────────┘    └──────────────────────┘    │
│                                                   │                   │
│                                                   ▼                   │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────────────┐    │
│  │  Pentest     │◀───│  Dynamic     │◀───│  RAG MCP Server      │    │
│  │  Agent       │    │  Prompting   │    │  (rag_recall tool)   │    │
│  └──────────────┘    └──────────────┘    └──────────────────────┘    │
│                                                                       │
└───────────────────────────────────────────────────────────────────────┘
```

**Core Concept — Anti-Pattern Injection:**

The RAG system injects learned warnings into the Reasoner's system prompt before each decision. For example, if the agent previously got locked out by brute-forcing SSH, the system recalls:

```
[MEMORY RECALL - WARNINGS FROM PAST EXPERIENCE]

[ANTI-PATTERN WARNING]
Scenario: SSH, port 22, remote access, secure shell
⛔ AVOID: Immediately brute-forcing SSH with common wordlists
⚠️ RISK: Fail2ban will block your IP after 3-5 attempts
✅ SUGGESTION: Check for SSH key authentication, look for exposed private keys, enumerate users first

[END MEMORY RECALL]
```

**Implementation Status & Components:**

| Component | Location | Status |
|-----------|----------|--------|
| Type definitions | `pentest-rag-memory/src/types/index.ts` | ✅ Complete |
| ChromaDB client wrapper | `pentest-rag-memory/src/db/chromaClient.ts` | ✅ Complete |
| Collection schemas | `pentest-rag-memory/src/db/collections.ts` | ✅ Complete |
| Seed anti-patterns (7) | `pentest-rag-memory/scripts/seed-db.ts` | ✅ Complete |
| Case Extractor (ETL) | `pentest-rag-memory/src/etl/extractor.ts` | ⏳ Phase 2 |
| Pattern Transformer | `pentest-rag-memory/src/etl/transformer.ts` | ⏳ Phase 2 |
| Pattern Loader | `pentest-rag-memory/src/etl/loader.ts` | ⏳ Phase 2 |
| RAG MCP Server | `pentest-rag-memory/src/server/index.ts` | ⏳ Phase 3 |
| PDF report ETL | `pentest-rag-memory/src/etl/pdf-extractor.ts` | ⏳ Phase 2 |

**ChromaDB Collections:**

```typescript
// Three vector collections for different knowledge types

// 1. anti_patterns — Learned failures (primary collection)
//    "When encountering X, do NOT do Y because Z happens"
{
  name: 'anti_patterns',
  metadata: { hnsw_space: 'cosine' },
  fields: {
    id: 'string',           // e.g., "ap_htb_legacy_01_step5"
    document: 'string',     // embedding_text (for vector search)
    metadata: {
      type: 'anti_pattern',
      trigger_keywords: 'string',  // comma-separated
      source_case_id: 'string',
      created_at: 'string',
      full_prompt_text: 'string',  // actual text injected into Reasoner
    },
  },
}

// 2. playbooks — Successful attack strategies
//    "When encountering X, this approach worked"
{
  name: 'playbooks',
  metadata: { hnsw_space: 'cosine' },
  fields: {
    id: 'string',
    document: 'string',
    metadata: {
      type: 'playbook',
      service: 'string',       // "apache", "ssh", "smb"
      cve: 'string',           // optional CVE reference
      success_rate: 'number',
      full_prompt_text: 'string',
    },
  },
}

// 3. tool_preferences — Learned tool configurations
//    "For service X, use flags Y because Z"
{
  name: 'tool_preferences',
  metadata: { hnsw_space: 'cosine' },
  fields: {
    id: 'string',
    document: 'string',
    metadata: {
      tool_name: 'string',    // "nmap", "hydra", "gobuster"
      preference: 'string',
      reason: 'string',
    },
  },
}
```

**Pre-Seeded Anti-Patterns (7 patterns, ready on initialization):**

1. **Login brute-force** — Check logic flaws, default creds, IDOR before dictionary attacks
2. **Noisy initial scans** — Start with quiet host discovery, expand based on findings
3. **SSH brute-force** — Fail2ban blocks after 3-5 attempts; enumerate keys first
4. **SQL injection noise** — Confirm manually before sqlmap; use low aggression levels
5. **SMB null session** — Always try guest access before credential attacks
6. **Web directory overload** — Use small wordlists first, check robots.txt/sitemap
7. **Privilege escalation rush** — Manual enum before automated LinPEAS/WinPEAS

**RAG MCP Server Interface (Phase 3 of pentest-rag-memory):**

The MCP server exposes two tools that the main agent calls:

```typescript
// Tool 1: rag_recall — Query memories before making decisions
{
  name: 'rag_recall',
  inputSchema: {
    type: 'object',
    properties: {
      observation: { type: 'string', description: 'Current scenario description' },
      thought: { type: 'string', description: 'Current reasoning (optional)' },
      top_k: { type: 'number', description: 'Number of memories to recall (default: 3)' },
    },
    required: ['observation'],
  },
}

// Tool 2: rag_learn — Manually teach new patterns (human-in-the-loop)
{
  name: 'rag_learn',
  inputSchema: {
    type: 'object',
    properties: {
      scenario: { type: 'string', description: 'Trigger scenario' },
      anti_pattern: { type: 'string', description: 'What NOT to do' },
      consequence: { type: 'string', description: 'What bad outcome this causes' },
      suggestion: { type: 'string', description: 'What to do instead' },
    },
    required: ['scenario', 'anti_pattern', 'consequence', 'suggestion'],
  },
}
```

**ETL Pipeline (Phase 2 of pentest-rag-memory):**

The ETL pipeline processes session logs and PDF reports into generalized patterns:

```
Session JSONL logs ──┐
                     ├──▶ Extractor ──▶ Transformer (DeepSeek) ──▶ Loader ──▶ ChromaDB
PDF/MD reports ──────┘

Extraction criteria:
  1. outcome_label === 'failed'
  2. human_intervention field exists
  3. Consecutive failures (pattern of struggle)

Transformation (DeepSeek de-specification):
  - Replace specific IPs → {{TARGET}}, {{PORT}}
  - Identify root cause (WHY it was wrong)
  - Generate corrective strategy
  - Produce embedding_text for vector search
```

**Integration with Main Agent (see Phase 7 updates):**

```typescript
// MCP server config in main agent
const config = {
  mcpServers: {
    nmap: { path: '../pentest-mcp-server/nmap-server-ts/dist/index.js' },
    rag_memory: { path: '../pentest-rag-memory/dist/server/index.js' },
  },
}

// In Reasoner.reason() — query RAG before each decision
async reason(observation: string): Promise<ReasonerOutput> {
  // Query RAG memory for relevant anti-patterns
  const memoryRecall = await this.ragClient.recall(observation)

  // Inject memories into skill context
  const enhancedContext = this.skillContext + memoryRecall.assembled_prompt

  // Continue with normal reasoning using enriched context...
}
```

**Session Logging (required for ETL data collection):**

```typescript
// Add to PentestAgent class for JSONL session logging
interface SessionStep {
  session_id: string
  step_index: number
  timestamp: string
  role: 'agent' | 'human' | 'mixed'
  observation: { last_tool_output: string; open_ports?: number[]; target_info?: object }
  thought_process: { analysis: string; reasoning: string; plan: string }
  action: { tool_name: string; tool_args: Record<string, unknown> }
  result: string
  outcome_label: 'success' | 'failed' | 'partial'
  human_intervention?: { type: 'stop' | 'correct' | 'guide'; message: string }
}

// Log location: mvp/logs/sessions/<session_id>.jsonl
```

> **Full implementation details:** See `pentest-rag-memory/docs/RAG-Implementation-Plan.md` for the complete specification including ETL pipeline code, MCP server implementation, PDF report processing, and ChromaDB schema definitions.

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
import { VulnLookupAgent } from './definitions/vuln-lookup.js'  // Uses SearchSploit MCP
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
  skillsDir: string
  mcpServers: {
    nmap: { path: string }
    searchsploit: { path: string }  // NEW: SearchSploit MCP server
    rag_memory?: { path: string }   // NEW: RAG Memory MCP server
  }
  enableEvaluation?: boolean  // NEW: Enable evaluation loop
  enableRAGMemory?: boolean   // NEW: Enable RAG memory recall
  trainingDataPath?: string   // NEW: Path to save training data
  sessionLogsPath?: string    // NEW: Path for JSONL session logs
}

export class PentestAgent {
  private config: AgentConfig
  private skillsLoader: SkillsLoader
  private reasoner: ReasonerAgent
  private executor: ExecutorAgent
  private mcpAgent: MCPAgent
  private dataCleaner: DataCleanerAgent
  private profiler: ProfilerAgent           // NEW
  private vulnLookup: VulnLookupAgent       // NEW: Uses SearchSploit MCP
  private evaluator: EvaluatorAgent         // NEW

  private sessionId: string                 // NEW: For tracking
  private trainingPairs: TrainingPair[] = []  // NEW: Collect training data
  private stepIndex: number = 0             // NEW: For session logging

  constructor(config: AgentConfig) {
    this.config = config
    this.skillsLoader = new SkillsLoader(config.skillsDir)
    this.reasoner = new ReasonerAgent(config.anthropicApiKey)
    this.executor = new ExecutorAgent(config.anthropicApiKey)
    this.mcpAgent = new MCPAgent()
    this.dataCleaner = new DataCleanerAgent(config.anthropicApiKey)
    this.profiler = new ProfilerAgent(config.anthropicApiKey)
    this.vulnLookup = new VulnLookupAgent(this.mcpAgent)  // Shares MCPAgent for SearchSploit tools
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

      // ===== STEP 0: RAG MEMORY RECALL (before reasoning) =====
      if (this.config.enableRAGMemory) {
        console.log('\n[RAG Memory] Querying past experience...')
        try {
          const memoryRecall = await this.mcpAgent.executeTool({
            tool: 'rag_recall',
            arguments: { observation, top_k: 3 },
            description: 'Recall anti-patterns from past sessions'
          })
          if (memoryRecall.success && memoryRecall.output) {
            console.log('[RAG Memory] ✓ Injecting warnings into Reasoner context')
            this.reasoner.injectMemoryContext(memoryRecall.output)
          }
        } catch (err) {
          console.log('[RAG Memory] ⚠ Failed (continuing without memory):', err)
        }
      }

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
              this.vulnLookup.findVulnerabilities(allDiscoveredServices)
                .catch(err => {
                  console.log('[VulnLookup] ⚠ Failed (continuing without CVE data):', err.message)
                  return []
                })
            ])

            if (targetProfile) {
              console.log(`[Profiler] ✓ Profile: ${targetProfile.os_family} - ${targetProfile.security_posture}`)
            }

            if (vulnerabilities.length > 0) {
              console.log(`[VulnLookup] ✓ Found ${vulnerabilities.length} vulnerabilities`)
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

      // ===== STEP 5b: SESSION LOGGING (for RAG ETL pipeline) =====
      if (this.config.sessionLogsPath) {
        await this.logSessionStep(
          observation,
          reasoning,
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

  /**
   * Log a session step to JSONL for the RAG ETL pipeline.
   *
   * These logs are consumed by pentest-rag-memory's ETL pipeline
   * to extract failures and human interventions, transform them
   * into generalized anti-patterns via DeepSeek, and load them
   * into ChromaDB for future recall.
   */
  private async logSessionStep(
    observation: string,
    reasoning: ReasonerOutput,
    result: CleanedData | undefined,
    iteration: number
  ): Promise<void> {
    const fs = await import('fs/promises')
    const logsDir = this.config.sessionLogsPath || './logs/sessions'

    await fs.mkdir(logsDir, { recursive: true })

    const logEntry = {
      session_id: this.sessionId,
      step_index: this.stepIndex++,
      timestamp: new Date().toISOString(),
      role: 'agent' as const,
      observation: {
        last_tool_output: observation,
      },
      thought_process: {
        analysis: reasoning.thought,
        reasoning: reasoning.action,
        plan: reasoning.tool || 'continue_analysis',
      },
      action: {
        tool_name: reasoning.tool || 'none',
        tool_args: reasoning.arguments || {},
      },
      result: result?.summary || 'No result',
      outcome_label: result ? 'success' : 'failed',
    }

    const logFile = `${logsDir}/${this.sessionId}.jsonl`
    await fs.appendFile(logFile, JSON.stringify(logEntry) + '\n', 'utf-8')
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

  // NEW: SearchSploit MCP server path
  const searchsploitPath = process.env.SEARCHSPLOIT_SERVER_PATH ||
    path.resolve('../pentest-mcp-server/searchsploit-server-ts/dist/index.js')

  // NEW: RAG Memory MCP server path
  const ragMemoryPath = process.env.RAG_MEMORY_SERVER_PATH ||
    path.resolve('../pentest-rag-memory/dist/server/index.js')

  // Configuration
  const config = {
    anthropicApiKey,
    skillsDir: path.resolve('./src/skills'),
    mcpServers: {
      nmap: { path: nmapPath },
      searchsploit: { path: searchsploitPath },   // NEW: SearchSploit MCP
      rag_memory: { path: ragMemoryPath },         // NEW: RAG Memory MCP
    },
    enableEvaluation: true,                      // NEW
    enableRAGMemory: true,                       // NEW: Enable RAG memory recall
    trainingDataPath: './training_data',         // NEW
    sessionLogsPath: './logs/sessions',          // NEW: JSONL logs for ETL
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

# Optional
export NMAP_SERVER_PATH="/path/to/nmap-server-ts/dist/index.js"
export SEARCHSPLOIT_SERVER_PATH="/path/to/searchsploit-server-ts/dist/index.js"
export RAG_MEMORY_SERVER_PATH="/path/to/pentest-rag-memory/dist/server/index.js"

# Required by pentest-rag-memory (for ETL pipeline)
export DEEPSEEK_API_KEY="sk-xxx"       # For ETL transformation via DeepSeek
export CHROMADB_PATH="./data/chromadb"  # Vector database location
```

---

## Dependencies Update

**Main agent package.json:**

```json
{
  "dependencies": {
    "@anthropic-ai/claude-agent-sdk": "^0.2.29",
    "@anthropic-ai/sdk": "^0.72.1",
    "@cyber/mcp-nmap-client": "file:.yalc/@cyber/mcp-nmap-client",
    "typescript": "^5.9.3"
  }
}
```

> **Note:** `axios` and `node-cache` are no longer needed — VulnLookupAgent now uses the shared MCPAgent to call SearchSploit tools via MCP protocol instead of making direct HTTP requests.
```

**pentest-rag-memory package.json (separate repo):**

```json
{
  "dependencies": {
    "chromadb": "^1.7.0",
    "openai": "^4.20.0",
    "@modelcontextprotocol/sdk": "^0.5.0",
    "zod": "^3.22.0"
  },
  "devDependencies": {
    "typescript": "^5.3.0",
    "@types/node": "^20.0.0"
  }
}
```

Install:
```bash
# Main agent
npm install

# SearchSploit MCP server (in pentest-mcp-server repo)
cd ../pentest-mcp-server/searchsploit-server-ts && npm install && npm run build

# RAG memory system (separate repo)
cd ../pentest-rag-memory && npm install
```

---

## File Structure Summary

```
mvp/ (main agent repository)
├── src/
│   ├── agent/
│   │   ├── index.ts                          # MODIFIED: Orchestrator with eval loop + RAG recall + session logging
│   │   ├── skillsLoader.ts                   # No changes
│   │   └── definitions/
│   │       ├── index.ts                      # MODIFIED: Export new agents
│   │       ├── types.ts                      # MODIFIED: Add all new interfaces
│   │       ├── reasoner.ts                   # MODIFIED: Tactical planning + memory injection
│   │       ├── executor.ts                   # No changes
│   │       ├── mcp-agent.ts                  # No changes
│   │       ├── data-cleaner.ts               # MODIFIED: discoveredServices schema
│   │       ├── profiler.ts                   # NEW: Target profiling
│   │       ├── vuln-lookup.ts                # NEW: Exploit lookup via SearchSploit MCP
│   │       └── evaluator.ts                  # NEW: Outcome evaluation
│   ├── index.ts                              # MODIFIED: Add SearchSploit MCP, RAG config, session logging
│   └── skills/
│       └── nmap_skill.md                     # No changes
├── training_data/                            # NEW: Training pairs storage
│   ├── session_1738012345_abc123.json
│   └── session_1738023456_def456.json
└── logs/                                     # NEW: Session logs for RAG ETL
    └── sessions/
        ├── session_1738012345_abc123.jsonl
        └── session_1738023456_def456.jsonl

pentest-mcp-server/ (separate repository — MCP tool servers)
├── nmap-server-ts/                              # ✅ COMPLETE: Nmap MCP server
│   ├── index.ts                                 # 5 tools: host_discovery, port_scan, service_detection, script_scan, full_scan
│   └── dist/index.js                            # Compiled server entry point
├── nmap-client-ts/                              # ✅ COMPLETE: Nmap MCP client SDK
│   └── src/client.ts                            # NmapMCPClient class
├── searchsploit-server-ts/                      # ✅ COMPLETE: SearchSploit MCP server
│   ├── index.ts                                 # 3 tools: searchsploit_search, searchsploit_examine, searchsploit_path
│   └── dist/index.js                            # Compiled server entry point
└── searchsploit-client-ts/                      # ✅ COMPLETE: SearchSploit MCP client SDK
    └── src/client.ts                            # SearchSploitMCPClient class

pentest-rag-memory/ (separate repository — RAG memory system)
├── src/
│   ├── types/index.ts                        # ✅ COMPLETE: Full type system
│   ├── db/
│   │   ├── chromaClient.ts                   # ✅ COMPLETE: ChromaDB wrapper
│   │   ├── collections.ts                    # ✅ COMPLETE: Schemas + seed data
│   │   └── index.ts                          # ✅ COMPLETE: DB exports
│   ├── etl/
│   │   ├── extractor.ts                      # ⏳ PLANNED: Extract failures from JSONL
│   │   ├── transformer.ts                    # ⏳ PLANNED: DeepSeek de-specification
│   │   ├── loader.ts                         # ⏳ PLANNED: Load into ChromaDB
│   │   ├── pdf-extractor.ts                  # ⏳ PLANNED: Extract from PDF reports
│   │   └── index.ts                          # ⏳ PLANNED: ETL orchestrator
│   ├── server/
│   │   ├── index.ts                          # ⏳ PLANNED: MCP server (rag_recall + rag_learn)
│   │   ├── handlers/
│   │   │   ├── query.ts                      # ⏳ PLANNED: RAG query handler
│   │   │   └── ingest.ts                     # ⏳ PLANNED: Manual ingestion
│   │   └── prompts/
│   │       └── injection.ts                  # ⏳ PLANNED: Prompt assembly templates
│   └── index.ts                              # ✅ COMPLETE: Package exports
├── scripts/
│   ├── seed-db.ts                            # ✅ COMPLETE: Seed 7 initial anti-patterns
│   └── run-etl.ts                            # ⏳ PLANNED: Manual ETL trigger
├── data/
│   ├── chromadb/                             # Persistent vector storage
│   └── raw_logs/                             # Imported JSONL files
└── pdf/
    └── Sense.md                              # Example pentest report for PDF ETL
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

2. **VulnLookup Agent (SearchSploit MCP):**
   ```bash
   # Test SearchSploit MCP integration
   - searchsploit_search "apache 2.4.49" → finds exploits with CVE-2021-41773
   - searchsploit_search with cve param → finds by CVE ID
   - searchsploit_examine by EDB-ID → returns full exploit code
   - searchsploit_path by EDB-ID → returns local file path
   - CVE extraction from Codes field → parses "CVE-2021-41773;CVE-2021-42013"
   - Platform filtering (Linux exploits only for Linux target)
   - DoS exclusion filter works (--exclude="dos")
   - Severity inference: remote+verified → critical, webapps → high/medium
   ```

3. **RAG Memory System:**
   ```bash
   # Test ChromaDB + MCP integration
   - Seed database with 7 anti-patterns
   - Query "SSH port 22 found" → returns SSH brute-force warning
   - Query "login page" → returns brute-force anti-pattern
   - Relevance threshold filtering (cosine distance < 0.5)
   - Assembled prompt format correct for Reasoner injection
   - rag_recall MCP tool returns formatted warnings
   - rag_learn MCP tool adds new patterns successfully
   ```

4. **Evaluator Agent:**
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
[RAG Memory] Querying past experience...
[RAG Memory] ✓ Injecting warnings into Reasoner context
[Reasoner] Analyzing situation...
[Data Cleaner] ✓ Type: nmap_scan
[Intelligence Layer] Starting parallel analysis...
[Profiler] ✓ Profile: Linux - hardened
[VulnLookup] ✓ Found 3 exploits, 0 shellcodes
  - CVE-2021-XXXX (high) [EDB-50383]
[RAG Memory] Querying past experience...
[RAG Memory] ✓ Injecting warnings into Reasoner context
[Reasoner] Generating tactical plan...
[Executor] Executing attack vectors...
[Evaluation Loop] Analyzing attack outcomes...
[Evaluator] vec_01: true_positive (confidence: 0.92)
[Orchestrator] Training data saved: ./training_data/session_1738012345_abc123.json
[Orchestrator] Session log saved: ./logs/sessions/session_1738012345_abc123.jsonl
```

### End-to-End Scenarios

**Scenario 1: Modern Hardened Target**
- Target: Ubuntu 22.04, only SSH + HTTPS
- Expected:
  - RAG Memory → recalls "noisy scan" + "SSH brute-force" anti-patterns
  - Profiler → "hardened", "low" risk
  - VulnLookup → minimal exploits (modern versions, few SearchSploit hits)
  - Reasoner → stealth tactics, avoids brute-force (guided by memory warnings)
  - Evaluator → mostly true_negatives (attacks fail as expected)
  - Session log → captures steps for future ETL

**Scenario 2: Legacy Vulnerable Target**
- Target: Windows Server 2008, SMB + RDP + Telnet
- Expected:
  - RAG Memory → recalls "SMB null session" anti-pattern, suggests guest access first
  - Profiler → "weak", "high-value" risk
  - VulnLookup → multiple critical exploits from SearchSploit (MS17-010, EternalBlue, etc.)
  - Reasoner → aggressive tactics, but follows memory suggestions for SMB
  - Evaluator → true_positives (attacks succeed)
  - Session log → captures steps for future ETL

**Scenario 3: Repeated Session (Memory Learning)**
- Target: Same as previous failed session
- Expected:
  - RAG Memory → recalls specific anti-patterns from previous failed session
  - Reasoner → avoids previously failed approaches
  - Different attack strategy chosen based on past experience

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
| Agents | 4 (Reasoner, Executor, MCP, Cleaner) | 7 (+Profiler, VulnLookup, Evaluator) + RAG MCP |
| Intelligence | None | Profile + Exploits (SearchSploit) + Anti-Pattern Memory |
| Attack Planning | Generic tool calls | Tactical plan with predictions |
| Learning Loop | None | Evaluation + training data + RAG feedback |
| Memory | None (stateless) | ChromaDB vector store (persistent cross-session) |
| Latency per iteration | ~2-3s | ~5-8s (parallel intelligence + RAG recall) |
| Training data | None | JSON pairs for RLHF + JSONL session logs |

---

## Cost Analysis

**Per reconnaissance session (10 iterations):**

| Agent | Model | Calls | Tokens/Call | Cost |
|-------|-------|-------|-------------|------|
| Reasoner | Sonnet 4 | 10 | 3000 | ~$0.45 |
| Executor | Haiku 3.5 | 10 | 1000 | ~$0.02 |
| Data Cleaner | Haiku 3.5 | 10 | 1500 | ~$0.03 |
| Profiler | Haiku 3.5 | 2-3 | 1500 | ~$0.01 |
| VulnLookup | N/A (SearchSploit MCP) | 5-10 | N/A | Free (local) |
| RAG Memory MCP | N/A (local) | 10 | N/A | Free |
| Evaluator | Haiku 3.5 | 5-10 | 1000 | ~$0.02 |
| **Total (runtime)** | | | | **~$0.53** |

| ETL Component | Model | Cost per run |
|---------------|-------|-------------|
| DeepSeek Transformer | DeepSeek-V3 | ~$0.01-0.05 per session |
| ChromaDB (local) | N/A | Free |
| SearchSploit (local) | N/A | Free (offline, no rate limits) |

---

## Future Enhancements

1. **PostgreSQL Storage**: Replace JSON files with proper database for training data
2. **RLHF Pipeline**: Use training pairs to fine-tune a custom Reasoner model
3. **RAG Memory Expansion**: Import knowledge from PDF writeups, CTF solutions, and technical documentation via PDF ETL pipeline
4. **MITRE ATT&CK Mapping**: Tag attack vectors with ATT&CK techniques
5. **Human-in-the-Loop**: Allow human corrections via `rag_learn` tool + Evaluator label overrides
6. **Confidence Calibration**: Automatically adjust Reasoner confidence based on historical accuracy + RAG memory feedback
7. **Playbook Collection**: Build positive-pattern library alongside anti-patterns for "what worked" guidance
8. **Cross-Session Analytics**: Dashboard showing RAG memory growth, pattern hit rates, and learning velocity

---

## Success Criteria

✅ **Functional:**
- Profiler accurately identifies OS and security posture (>80% accuracy)
- VulnLookup finds relevant exploits/CVEs via SearchSploit MCP Server
- RAG Memory recalls relevant anti-patterns for current scenario (cosine distance < 0.5)
- Reasoner outputs tactical plans with prediction metrics, informed by memory warnings
- Evaluator correctly labels outcomes (>85% agreement with human review)
- Training data saved in structured format
- Session logs written in JSONL format for ETL consumption

✅ **Performance:**
- Intelligence layer adds <5s latency per iteration
- Parallel execution (Profiler + VulnLookup via SearchSploit + RAG recall) ~1.5-2x faster than sequential
- RAG recall adds <100ms latency (local ChromaDB query)
- Evaluation loop adds <2s per attack vector

✅ **Learning:**
- Training pairs capture full context (intelligence → plan → outcome → evaluation)
- Precision/recall metrics calculable from training data
- Confidence calibration error measurable
- RAG memory grows with each processed session (ETL pipeline)
- Anti-pattern recall prevents repeated failures across sessions

---

## Implementation Priority

1. **Week 1**: Data schemas + Enhanced Data Cleaner
2. **Week 2**: Profiler + VulnLookup (SearchSploit MCP integration)
3. **Week 3**: Reasoner tactical planning upgrade
4. **Week 4**: Evaluator + Orchestrator integration
5. **Week 5**: Testing + Training data analysis

---

## Conclusion

This architecture transforms the MVP pentest agent into a production-grade system with:

- **Situational Awareness**: Target profiling and exploit intelligence via SearchSploit MCP
- **Strategic Planning**: Tactical plans with predictive metrics and attack rationale
- **Continuous Learning**: Automated evaluation loop generating training data for RLHF

The closed-loop design ensures every attack becomes a learning opportunity, enabling continuous improvement of the Reasoner's decision-making capabilities.

---

**Document Version:** 1.2
**Last Updated:** 2026-02-06
**Author:** AI Architecture Planning System
