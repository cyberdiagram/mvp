# Architecture Upgrade Plan: Intelligence Layer Implementation

## Overview

Upgrade the current multi-agent pentest system from "Automated Scanner" to "Intelligent Penetration Testing System" by adding:

1. **Profiler Agent** - Target profiling and fingerprinting
2. **RAG Agent** - CVE/vulnerability knowledge retrieval
3. **Enhanced Data Schemas** - discoveredServices with rich metadata
4. **Parallel Intelligence Processing** - Profiler + RAG run simultaneously

This transforms the flow from:
```
Scan → Clean → Reason → Execute
```

To:
```
Scan → Clean → [Profiler + RAG (parallel)] → Reason → Execute
```

---

## Current Architecture Analysis

### Existing Agents (Working)
- **Reasoner** (Sonnet 4) - Strategic decisions, outputs ReasonerOutput
- **Executor** (Haiku 3.5) - Breaks plans into ExecutorStep[]
- **MCP Agent** - Routes to Nmap tools, returns raw ToolResult
- **Data Cleaner** (Haiku 3.5) - Parses to CleanedData (basic NmapScanResult)
- **Skills Loader** - Keyword-based skill matching from markdown files

### Gaps Identified
1. ❌ No service profiling (OS inference, tech stack detection, security posture)
2. ❌ No CVE/vulnerability lookup against discovered services
3. ❌ No PoC/exploit mapping
4. ❌ Data Cleaner outputs basic NmapScanResult, not discoveredServices schema
5. ❌ No parallel agent execution (sequential only)
6. ❌ RAG Agent exists only in docs (marked FUTURE)
7. ❌ Reasoner receives raw scan data, not enriched intelligence

---

## Implementation Plan

### Phase 1: Data Schema Enhancement

**Goal:** Define new interfaces for discoveredServices, targetProfile, vulnerabilities

**Files to Create/Modify:**

1. **src/agent/definitions/types.ts** (MODIFY)
   - Add `DiscoveredService` interface:
     ```typescript
     interface DiscoveredService {
       host: string
       port: number
       protocol: string
       service: string
       product?: string
       version?: string
       banner?: string
       category?: string          // NEW: "web", "database", "remote-access", etc.
       criticality?: string       // NEW: "high", "medium", "low"
       confidence?: number        // NEW: 0-1 score
     }
     ```

   - Add `TargetProfile` interface:
     ```typescript
     interface TargetProfile {
       os_family?: string         // "Linux", "Windows", "BSD"
       os_version?: string        // "Ubuntu 20.04"
       tech_stack?: string[]      // ["LAMP", "Apache", "MySQL"]
       security_posture: string   // "hardened", "standard", "weak"
       risk_level: string         // "high-value", "medium", "low"
       evidence: string[]         // Supporting observations
     }
     ```

   - Add `VulnerabilityInfo` interface:
     ```typescript
     interface VulnerabilityInfo {
       cve_id: string             // "CVE-2021-41773"
       severity: string           // "critical", "high", "medium", "low"
       cvss_score?: number        // 9.8
       description: string
       affected_service: string   // Link to service
       poc_available: boolean
       poc_url?: string
       exploitdb_id?: string
     }
     ```

   - Add `IntelligenceContext` interface:
     ```typescript
     interface IntelligenceContext {
       discoveredServices: DiscoveredService[]
       targetProfile?: TargetProfile
       vulnerabilities: VulnerabilityInfo[]
       pocFindings: Array<{tool: string, url: string}>
     }
     ```

2. **Update CleanedData type** to support new structure:
   ```typescript
   interface CleanedData {
     type: string
     data: DiscoveredService[] | NmapScanResult  // Support both
     summary: string
     intelligence?: IntelligenceContext           // NEW
   }
   ```

---

### Phase 2: Enhanced Data Cleaner

**Goal:** Upgrade Data Cleaner to output discoveredServices schema with enriched metadata

**Files to Modify:**

1. **src/agent/definitions/data-cleaner.ts** (MODIFY lines 107-200)

   **Changes:**
   - Keep existing rule-based Nmap parsing (lines 107-197)
   - Add service categorization logic:
     ```typescript
     function categorizeService(serviceName: string): string {
       const categories = {
         web: ['http', 'https', 'apache', 'nginx'],
         database: ['mysql', 'postgresql', 'mongodb', 'redis'],
         'remote-access': ['ssh', 'rdp', 'telnet', 'vnc'],
         'file-sharing': ['smb', 'ftp', 'nfs'],
         email: ['smtp', 'imap', 'pop3']
       }
       // Return matching category or "other"
     }
     ```

   - Add confidence scoring based on banner detection:
     ```typescript
     function calculateConfidence(port: NmapPortResult): number {
       let score = 0.5  // baseline
       if (port.version) score += 0.3
       if (port.service) score += 0.2
       return Math.min(score, 1.0)
     }
     ```

   - Transform NmapPortResult[] to DiscoveredService[]:
     ```typescript
     const services: DiscoveredService[] = ports.map(port => ({
       host: ip,
       port: port.port,
       protocol: port.protocol,
       service: port.service || 'unknown',
       product: extractProduct(port.version),
       version: extractVersion(port.version),
       banner: port.version,
       category: categorizeService(port.service || ''),
       confidence: calculateConfidence(port)
     }))
     ```

   - Update CleanedData output format to include discoveredServices

---

### Phase 3: Profiler Agent Implementation

**Goal:** Create new Profiler subagent for target profiling and OS fingerprinting

**Files to Create:**

1. **src/agent/definitions/profiler.ts** (NEW)

   **Implementation:**
   ```typescript
   import Anthropic from '@anthropic-ai/sdk'
   import { DiscoveredService, TargetProfile } from './types.js'

   export class ProfilerAgent {
     private client: Anthropic
     private model = 'claude-3-5-haiku-20241022'
     private maxTokens = 1500

     constructor(apiKey: string) {
       this.client = new Anthropic({ apiKey })
     }

     async profile(services: DiscoveredService[]): Promise<TargetProfile> {
       const systemPrompt = `You are a cybersecurity profiling expert.

       Analyze the discovered services and infer:
       1. OS Family & Version (from banners, service versions, port patterns)
       2. Technology Stack (LAMP, MEAN, Windows Server, etc.)
       3. Security Posture (hardened, standard, weak)
          - Hardened: Only necessary ports, modern versions
          - Weak: Legacy services, outdated versions, Telnet/FTP exposed
       4. Risk Level (high-value target, standard, low-priority)

       Return JSON: { os_family, os_version, tech_stack[], security_posture, risk_level, evidence[] }`

       const userMessage = `Services:\n${JSON.stringify(services, null, 2)}`

       const response = await this.client.messages.create({
         model: this.model,
         max_tokens: this.maxTokens,
         system: systemPrompt,
         messages: [{ role: 'user', content: userMessage }]
       })

       // Parse JSON from response
       const content = response.content[0]
       if (content.type === 'text') {
         return JSON.parse(this.extractJSON(content.text))
       }
       throw new Error('Failed to parse profile')
     }

     private extractJSON(text: string): string {
       const match = text.match(/\{[\s\S]*\}/)
       return match ? match[0] : text
     }
   }
   ```

2. **Update src/agent/definitions/index.ts** (MODIFY)
   - Add export: `export { ProfilerAgent } from './profiler.js'`

---

### Phase 4: RAG Agent Implementation with External APIs

**Goal:** Create RAG Agent for CVE/vulnerability lookup using real NVD and ExploitDB APIs

**Dependencies to Add:**

1. **package.json** (MODIFY)
   ```bash
   npm install axios node-cache
   ```
   - `axios` - HTTP client for API requests
   - `node-cache` - In-memory caching to avoid rate limits

**Files to Create:**

1. **src/agent/definitions/rag-agent.ts** (NEW)

   **Implementation with External APIs:**
   ```typescript
   import Anthropic from '@anthropic-ai/sdk'
   import axios from 'axios'
   import NodeCache from 'node-cache'
   import { DiscoveredService, TargetProfile, VulnerabilityInfo } from './types.js'

   export class RAGAgent {
     private cache: NodeCache
     private nvdApiKey?: string
     private model = 'claude-3-5-haiku-20241022'
     private client: Anthropic

     constructor(apiKey: string, nvdApiKey?: string) {
       this.client = new Anthropic({ apiKey })
       this.nvdApiKey = nvdApiKey
       // Cache CVE results for 1 hour (3600 seconds)
       this.cache = new NodeCache({ stdTTL: 3600 })
     }

     /**
      * Find vulnerabilities for discovered services using NVD API
      */
     async findVulnerabilities(
       services: DiscoveredService[],
       profile?: TargetProfile
     ): Promise<VulnerabilityInfo[]> {
       const allVulnerabilities: VulnerabilityInfo[] = []

       for (const service of services) {
         // Skip if no version info
         if (!service.product || !service.version) continue

         // Check cache first
         const cacheKey = `${service.product}:${service.version}`
         const cached = this.cache.get<VulnerabilityInfo[]>(cacheKey)
         if (cached) {
           allVulnerabilities.push(...cached)
           continue
         }

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
       }

       // Sort by severity (critical/high first)
       return allVulnerabilities.sort((a, b) => {
         const severityOrder = { critical: 0, high: 1, medium: 2, low: 3 }
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

         return vulnerabilities
       } catch (error) {
         console.error('[RAG Agent] NVD API error:', error.message)
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
           // ExploitDB API search by CVE ID
           const response = await axios.get(
             `https://www.exploit-db.com/search`,
             {
               params: { cve: cve.cve_id },
               timeout: 5000
             }
           )

           // Parse HTML response to find exploit links (simplified)
           // In production, use proper HTML parser or ExploitDB's official API
           const hasExploit = response.data.includes('exploit/download')

           if (hasExploit) {
             cve.poc_available = true
             cve.poc_url = `https://www.exploit-db.com/exploits/?cve=${cve.cve_id}`
           }
         } catch (error) {
           // Non-critical, continue without PoC info
           console.debug(`[RAG Agent] ExploitDB lookup failed for ${cve.cve_id}`)
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

       // Use LLM to intelligently filter CVEs by OS
       // This is a fallback when API doesn't provide OS-specific metadata
       return cves.filter(cve => {
         const desc = cve.description.toLowerCase()
         const os = osFamily.toLowerCase()

         // Basic heuristic filtering
         if (os.includes('linux') && desc.includes('windows')) return false
         if (os.includes('windows') && desc.includes('linux')) return false

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
   }
   ```

2. **Update src/agent/definitions/index.ts** (MODIFY)
   - Add export: `export { RAGAgent } from './rag-agent.js'`

3. **Environment Variables** (UPDATE CLAUDE.md)
   - Add `NVD_API_KEY` (optional but recommended for higher rate limits)
   - NVD API key can be obtained free at: https://nvd.nist.gov/developers/request-an-api-key

**Rate Limiting Notes:**
- Without API key: 5 requests per 30 seconds
- With API key: 50 requests per 30 seconds
- Cache strategy mitigates rate limit issues

---

### Phase 5: Orchestrator Upgrade - Parallel Intelligence Layer

**Goal:** Modify orchestrator to run Profiler + RAG in parallel after Data Cleaner

**Files to Modify:**

1. **src/agent/index.ts** (MODIFY lines 32-57, 108-205)

   **Changes to PentestAgent class:**

   ```typescript
   // Update AgentConfig interface (lines 12-18)
   export interface AgentConfig {
     anthropicApiKey: string
     nvdApiKey?: string        // NEW: Optional NVD API key
     skillsDir: string
     mcpServers: {
       nmap: { path: string }
     }
   }

   // Add new agent instances (after line 40)
   private profiler: ProfilerAgent
   private ragAgent: RAGAgent

   // Update constructor (after line 56)
   constructor(config: AgentConfig) {
     this.config = config
     this.skillsLoader = new SkillsLoader(config.skillsDir)
     this.reasoner = new ReasonerAgent(config.anthropicApiKey)
     this.executor = new ExecutorAgent(config.anthropicApiKey)
     this.mcpAgent = new MCPAgent()
     this.dataCleaner = new DataCleanerAgent(config.anthropicApiKey)
     this.profiler = new ProfilerAgent(config.anthropicApiKey)                    // NEW
     this.ragAgent = new RAGAgent(config.anthropicApiKey, config.nvdApiKey)      // NEW
   }
   ```

   **Update reconnaissance() loop (lines 120-191):**

   Replace Step 3 (lines 152-178) with parallel intelligence processing:

   ```typescript
   // Step 3: Execute each step via MCP Agent and clean with Data Cleaner
   let currentPlan = { ...plan }
   let allDiscoveredServices: DiscoveredService[] = []

   while (true) {
     const step = this.executor.getNextStep(currentPlan)
     if (!step) break

     // 3a. MCP Agent executes tool
     console.log(`\n[MCP Agent] Executing: ${step.tool}`)
     const rawResult = await this.mcpAgent.executeTool(step)

     if (rawResult.success) {
       console.log('[MCP Agent] ✓ Execution successful')

       // 3b. Data Cleaner processes raw output
       console.log('[Data Cleaner] Parsing output...')
       const cleanedData = await this.dataCleaner.clean(rawResult.output, step.tool)

       // Extract discovered services
       if (Array.isArray(cleanedData.data)) {
         allDiscoveredServices.push(...cleanedData.data)
       }

       // ========== NEW INTELLIGENCE LAYER ==========
       if (allDiscoveredServices.length > 0) {
         console.log('\n[Intelligence Layer] Starting parallel analysis...')

         // Run Profiler and RAG in parallel (graceful degradation on failures)
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

         // Enrich cleaned data with intelligence
         cleanedData.intelligence = {
           discoveredServices: allDiscoveredServices,
           targetProfile: targetProfile || undefined,
           vulnerabilities: vulnerabilities,
           pocFindings: vulnerabilities
             .filter(v => v.poc_url)
             .map(v => ({ tool: v.affected_service, url: v.poc_url! }))
         }
       }
       // ========== END INTELLIGENCE LAYER ==========

       aggregatedResults.push(cleanedData)
     } else {
       console.log(`[MCP Agent] ✗ Execution failed: ${rawResult.error}`)
     }

     currentPlan = this.executor.advancePlan(currentPlan)
   }

   // Step 4: Feed enriched results back to Reasoner
   const lastResult = aggregatedResults[aggregatedResults.length - 1]
   if (lastResult && lastResult.intelligence) {
     const intel = lastResult.intelligence
     observation = `Tool execution completed.

     Discovered Services: ${intel.discoveredServices.length} services found
     ${intel.targetProfile ? `\nTarget Profile:\n- OS: ${intel.targetProfile.os_family}\n- Security: ${intel.targetProfile.security_posture}\n- Risk: ${intel.targetProfile.risk_level}` : ''}
     ${intel.vulnerabilities.length > 0 ? `\nVulnerabilities Found: ${intel.vulnerabilities.length}\nTop CVEs: ${intel.vulnerabilities.slice(0, 3).map(v => v.cve_id).join(', ')}` : ''}

     Summary: ${lastResult.summary}`

     this.reasoner.addObservation(observation)
   } else if (lastResult) {
     observation = `Tool execution completed.\nResult: ${JSON.stringify(lastResult.data, null, 2)}\nSummary: ${lastResult.summary}`
     this.reasoner.addObservation(observation)
   }
   ```

---

### Phase 6: Reasoner Context Enhancement

**Goal:** Update Reasoner to leverage intelligence context for better attack planning

**Files to Modify:**

1. **src/agent/definitions/reasoner.ts** (MODIFY lines 12-80)

   **Update system prompt (lines 12-80):**

   Add intelligence-aware guidance:
   ```typescript
   const REASONER_SYSTEM_PROMPT = `You are an expert penetration testing strategist...

   ... (existing content) ...

   # Intelligence Context

   You will receive enriched intelligence including:
   - **Target Profile**: OS type, tech stack, security posture, risk level
   - **Vulnerabilities**: Known CVEs with severity scores and PoC availability
   - **Service Metadata**: Categorized services with confidence scores

   Use this intelligence to:
   1. Prioritize high-severity CVEs with available PoCs
   2. Adjust tactics based on security posture (avoid noisy attacks on hardened targets)
   3. Focus on high-value targets first
   4. Match exploits to confirmed OS/service versions

   # Tool Strategy

   When vulnerabilities are found:
   - If PoC available → Plan targeted exploitation
   - If no PoC → Continue reconnaissance or manual analysis

   When security posture is "hardened":
   - Avoid brute force attacks (will trigger lockouts)
   - Prioritize stealth and reconnaissance

   When security posture is "weak":
   - Safe to be more aggressive with enumeration

   ... (rest of existing prompt) ...`
   ```

2. **Update ReasonerOutput interface** in types.ts:
   ```typescript
   interface ReasonerOutput {
     thought: string
     action: string
     tool?: string
     arguments?: Record<string, unknown>
     is_complete?: boolean
     attack_rationale?: string     // NEW: Why this attack was chosen
     expected_success?: string     // NEW: "high", "medium", "low"
   }
   ```

---

### Phase 7: Interactive Mode Update

**Goal:** Ensure interactive mode also uses intelligence layer

**Files to Modify:**

1. **src/agent/index.ts** (MODIFY lines 222-277)

   Apply same intelligence processing logic to interactive mode (similar to reconnaissance loop changes)

---

## Critical Files Summary

### Files to Create (2 new)
1. `src/agent/definitions/profiler.ts` - Profiler Agent (Haiku model)
2. `src/agent/definitions/rag-agent.ts` - RAG Agent with NVD/ExploitDB APIs

### Files to Modify (7 existing)
1. `src/agent/definitions/types.ts` - Add new interfaces (DiscoveredService, TargetProfile, VulnerabilityInfo, IntelligenceContext)
2. `src/agent/definitions/data-cleaner.ts` - Enhance output with discoveredServices schema
3. `src/agent/definitions/reasoner.ts` - Update system prompt for intelligence awareness
4. `src/agent/index.ts` - Add parallel intelligence processing in orchestrator + update AgentConfig
5. `src/agent/definitions/index.ts` - Export new agents
6. `package.json` - Add axios and node-cache dependencies
7. `src/index.ts` - Pass NVD_API_KEY from environment to AgentConfig
8. `CLAUDE.md` - Document NVD_API_KEY environment variable

### Files to Reference (existing utilities)
- `src/agent/skillsLoader.ts` - Already functional, no changes needed
- `src/skills/nmap_skill.md` - May add profiling/CVE guidance later

---

## Verification Plan

### Unit Testing
1. **Test Profiler Agent:**
   ```bash
   # Create test file: src/agent/definitions/__tests__/profiler.test.ts
   # Test cases:
   - Empty services array → minimal profile
   - Apache + MySQL services → LAMP stack detection
   - SSH v7 + modern ports only → "hardened" posture
   - Telnet + FTP + old SMB → "weak" posture
   ```

2. **Test RAG Agent:**
   ```bash
   # Test cases:
   - Apache 2.4.49 → finds CVE-2021-41773 from NVD API
   - Cache effectiveness (2nd query should be instant)
   - Rate limit handling (without API key)
   - Filter by OS (Linux CVEs only when profile.os_family = "Linux")
   - PoC detection from ExploitDB
   - Graceful degradation when API is down
   ```

3. **Test Enhanced Data Cleaner:**
   ```bash
   # Test cases:
   - Raw Nmap output → discoveredServices with categories
   - Confidence scoring (with/without version info)
   - Service categorization accuracy
   ```

### Integration Testing
1. **Run full reconnaissance:**
   ```bash
   npm run build
   npm start recon scanme.nmap.org
   ```

   **Expected output:**
   ```
   [Data Cleaner] ✓ Type: nmap_scan
   [Intelligence Layer] Starting parallel analysis...
   [Profiler] ✓ Profile: Linux - hardened
   [RAG Agent] ✓ Found 2 vulnerabilities
     - CVE-2021-XXXX (high)
   [Reasoner] Thought: Based on profile (hardened Linux) and CVEs found...
   [Reasoner] Action: Prioritize CVE-2021-XXXX exploitation (PoC available)
   ```

2. **Test parallel execution:**
   - Add timing logs to verify Profiler + RAG run concurrently
   - Should be ~1.5-2x faster than sequential

3. **Test interactive mode:**
   ```bash
   npm start interactive
   You: Scan 192.168.1.1
   ```
   - Verify intelligence layer activates

### End-to-End Validation
1. **Scenario 1: Modern Hardened Target**
   - Target: Ubuntu 22.04 with only SSH, HTTPS
   - Expected: Profiler → "hardened", RAG → minimal CVEs, Reasoner → stealth tactics

2. **Scenario 2: Legacy Vulnerable Target**
   - Target: Windows Server 2008 with SMB, RDP, Telnet
   - Expected: Profiler → "weak", RAG → multiple critical CVEs, Reasoner → aggressive exploitation

3. **Compare before/after:**
   - Before: Reasoner gets raw Nmap JSON
   - After: Reasoner gets Profile + CVEs + categorized services
   - Measure: Reasoner's action quality improves (targets specific CVEs vs. generic scans)

---

## Implementation Order

1. ✅ Phase 1: Data schemas (types.ts) - Foundation for all other changes
2. ✅ Phase 2: Enhanced Data Cleaner - Outputs discoveredServices
3. ✅ Phase 3: Profiler Agent - Standalone profiling capability
4. ✅ Phase 4: RAG Agent - Vulnerability lookup (LLM-based MVP)
5. ✅ Phase 5: Orchestrator upgrade - Integrate parallel processing
6. ✅ Phase 6: Reasoner enhancement - Intelligence-aware prompts
7. ✅ Phase 7: Interactive mode update - Apply to REPL
8. ✅ Testing: Unit → Integration → E2E

---

## Future Enhancements (Post-MVP)

### Better ExploitDB Integration
- Use official ExploitDB API (currently using web scraping fallback)
- Add MITRE ATT&CK technique mapping
- GitHub PoC repository search

### Vector Store for Skills
- Replace keyword matching with embeddings
- Semantic skill retrieval
- Chroma/Pinecone integration

### Session Tracking & Reflection
- As described in MULTI_AGENT_ARCHITECTURE.md
- Training data collection for distillation
- Token/cost tracking metrics

---

## Risk Mitigation

1. **Parallel execution failures:**
   - Both Profiler and RAG wrapped in try-catch
   - Graceful degradation (continue without intelligence if agents fail)

2. **NVD API rate limits:**
   - Implemented caching to reduce API calls
   - Graceful degradation if rate limited
   - Optional API key increases limits from 5 to 50 req/30s
   - Consider adding exponential backoff for retries

3. **Performance impact:**
   - Two additional LLM calls per iteration (Profiler + RAG)
   - Parallelization offsets latency (~1.5x vs 2x sequential)
   - Use Haiku for cost efficiency

4. **Breaking existing behavior:**
   - All intelligence features are additive
   - Fallback to original flow if intelligence unavailable
   - Existing tests should still pass

---

## Success Criteria

✅ **Functional:**
- Profiler accurately identifies OS and security posture
- RAG finds relevant CVEs for discovered services
- Reasoner's decisions reference CVEs and profile
- Parallel execution completes without errors

✅ **Performance:**
- Intelligence layer adds <3s latency per iteration
- No degradation to existing reconnaissance speed

✅ **Code Quality:**
- All new code has JSDoc comments
- Follows existing TypeScript strict mode
- Prettier formatting maintained
- No breaking changes to existing APIs
