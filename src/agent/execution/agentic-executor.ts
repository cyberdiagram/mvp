/**
 * AgenticExecutor — AI Script Generation & Autonomous Execution Engine.
 *
 * Ported from pentest-executor's Executor class, adapted for MVP's
 * DualMCPAgent (RAG stdio + Kali HTTP) and unified SkillManager.
 *
 * Provides methods for all exploit execution modes:
 *
 *   CLI Command → Method Mapping:
 *
 *   generate <task>           → generateScript()
 *   execute <filename>        → (direct Kali MCP call, no method needed)
 *   interactive <task>        → generateScript() → executeFinal()
 *   autorun <task>            → autoExecute()
 *   plan <json> → strategy 1  → runAgentWithTacticalPlan(plan, "tool")
 *   plan <json> → strategy 2  → runAgentWithTacticalPlan(plan, "github")
 *   plan <json> → strategy 3  → autoExecuteFromPlan()
 *   plan <json> → strategy 4  → generateScriptFromPlan() → executeFinal()
 *   autonomous <task>         → runAgentLoop()
 */

import Anthropic from '@anthropic-ai/sdk';
import { startActiveObservation, propagateAttributes } from '@langfuse/tracing';
import { DualMCPAgent } from './mcp-agent.js';
import { SkillManager } from '../utils/skill-manager.js';
import type { TacticalPlanObject, AgentResult, ToolCallRecord } from '../core/types.js';

// ─── System Prompts ──────────────────────────────────────────

/**
 * System prompt for single-shot script generation.
 * Used by: generate, interactive, autorun, plan (strategies 3 & 4)
 */
const SYSTEM_PROMPT = `You are an elite Exploit Developer running inside a Kali Linux environment.
Your input will be either a natural language task or a structured Tactical Plan with labeled sections.
Your goal: Generate a production-ready, self-contained Python 3 exploit script.

When you receive a structured Tactical Plan, follow this generation protocol:

## Phase 1: Target & Endpoint Analysis
- Extract the target IP and vulnerable endpoint from the plan.
- Identify the protocol (HTTP/HTTPS) and attack type (RCE, SQLi, etc.).

## Phase 2: Authentication & Session Setup
- If the target is a web application requiring authentication:
  - Use requests.Session() for cookie persistence across all requests.
  - Implement CSRF token extraction via regex if the target uses CSRF protection.
  - Implement login with the correct form field names and credentials.
  - Verify login success before proceeding to exploitation.
  - ABORT the exploit if login fails.
- Always use verify=False for HTTPS targets and disable SSL warnings with urllib3.disable_warnings().

## Phase 3: Exploit Construction
- The command_template shows the conceptual attack — convert it to proper Python requests code.
- NEVER shell out to curl. Always use the requests library.
- Use the payload_snippet as the exact payload logic to implement.
- Apply the insight as a critical implementation constraint (e.g., base64 encoding to bypass filters).
- Follow the exploitation_logic to understand the vulnerability mechanism and implement it step by step.

## Phase 4: Payload Assembly
- If the plan mentions base64 encoding, implement it programmatically with the base64 module.
- If the plan mentions directory traversal, construct the traversal path in the injection payload.
- If the plan mentions writing a webshell, construct the PHP code and write it via the injection.

## Phase 5: Verification
- After executing the exploit, verify success using the success_criteria:
  - match_pattern: check the response body against this pattern — if it matches, the exploit SUCCEEDED.
  - negative_pattern: if this matches, the exploit FAILED.
- If the payload writes a webshell, make a follow-up request to the webshell to confirm RCE.

## Output Rules
1. Output ONLY the raw Python 3 script. No markdown fences, no explanation, no conversational filler.
2. The script must be completely self-contained and runnable with python3.
3. Use requests library for all HTTP interactions. Use requests.Session() when cookies or authentication are needed.
4. Disable SSL warnings: urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning).
5. Always use verify=False for HTTPS targets.
6. Include clear progress print statements (e.g., "[*] Attempting login...", "[+] Exploit successful!").
7. Handle errors with try/except. Print meaningful failure messages.
8. The script must directly attack the specified target IP. No placeholder values.
9. Save detailed reports to /app/logs/ directory when applicable.`;

// ─── Host-Local Tool Definitions ─────────────────────────────

/**
 * Tool schemas for host-local skill management tools.
 * These are always available regardless of Kali connection.
 */
const HOST_TOOL_DEFINITIONS: Anthropic.Tool[] = [
  {
    name: 'save_new_skill',
    description:
      'Save a new skill file to the skill library. Content should be markdown with YAML frontmatter.',
    input_schema: {
      type: 'object' as const,
      properties: {
        tool_name: {
          type: 'string',
          description: 'Tool name (lowercase, e.g., wpscan)',
        },
        content: {
          type: 'string',
          description: 'Full markdown content with YAML frontmatter',
        },
      },
      required: ['tool_name', 'content'],
    },
  },
  {
    name: 'read_skill_file',
    description: 'Read a skill file from the skill library to get best practices and usage guide.',
    input_schema: {
      type: 'object' as const,
      properties: {
        tool_name: {
          type: 'string',
          description: 'Tool name (e.g., wpscan, nmap)',
        },
      },
      required: ['tool_name'],
    },
  },
  {
    name: 'list_skills',
    description: 'List all available skills in the skill library.',
    input_schema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
];

// ─── AgenticExecutor Class ──────────────────────────────────

export class AgenticExecutor {
  private anthropic: Anthropic;
  private mcpAgent: DualMCPAgent;
  private skillManager: SkillManager;
  private model: string;
  private sessionId: string;

  /** Names of tools on the Kali MCP server (populated dynamically) */
  private kaliToolNames: Set<string> = new Set();
  /** Full tool definitions array for Claude API (Kali + host-local) */
  private toolDefinitions: Anthropic.Tool[] = [];

  constructor(mcpAgent: DualMCPAgent, skillManager: SkillManager) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error('ANTHROPIC_API_KEY is not set. Check your .env file.');
    }
    this.anthropic = new Anthropic({ apiKey });
    this.mcpAgent = mcpAgent;
    this.skillManager = skillManager;
    this.model = process.env.CLAUDE_MODEL || 'claude-sonnet-4-5-20250929';
    this.sessionId = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    // Build tool definitions from dynamically discovered Kali tools + host-local tools
    this.buildToolDefinitions();
  }

  /**
   * Builds tool definitions dynamically from Kali MCP server discovery + host-local tools.
   * Called at construction and can be refreshed if Kali reconnects.
   */
  private buildToolDefinitions(): void {
    const kaliNames = this.mcpAgent.getKaliToolNames();
    this.kaliToolNames = new Set(kaliNames);

    // Build Kali tool schemas dynamically
    const kaliToolDefs: Anthropic.Tool[] = this.buildKaliToolSchemas(kaliNames);

    // Combine Kali + host-local tools
    this.toolDefinitions = [...kaliToolDefs, ...HOST_TOOL_DEFINITIONS];

    console.log(
      `[AgenticExecutor] ${this.toolDefinitions.length} tools available ` +
        `(${kaliNames.length} Kali + ${HOST_TOOL_DEFINITIONS.length} host-local)`
    );
  }

  /**
   * Builds Anthropic tool schemas for Kali MCP tools.
   * Uses known schemas for standard tools, generic schema for unknown ones.
   */
  private buildKaliToolSchemas(toolNames: string[]): Anthropic.Tool[] {
    const knownSchemas: Record<string, Anthropic.Tool> = {
      execute_shell_cmd: {
        name: 'execute_shell_cmd',
        description:
          'Execute an arbitrary shell command inside the Kali Linux container. Returns exit code, stdout, and stderr.',
        input_schema: {
          type: 'object' as const,
          properties: {
            command: { type: 'string', description: 'The shell command to execute' },
          },
          required: ['command'],
        },
      },
      write_file: {
        name: 'write_file',
        description: "Write content to a file in the Kali container's /app/scripts/ directory.",
        input_schema: {
          type: 'object' as const,
          properties: {
            filename: { type: 'string', description: 'Name of the file to create' },
            content: { type: 'string', description: 'Full content of the file' },
          },
          required: ['filename', 'content'],
        },
      },
      execute_script: {
        name: 'execute_script',
        description: 'Execute a Python script from /app/scripts/ inside the Kali container.',
        input_schema: {
          type: 'object' as const,
          properties: {
            filename: { type: 'string', description: 'Name of the script file to execute' },
            args: { type: 'string', description: 'Optional space-separated arguments' },
          },
          required: ['filename'],
        },
      },
      manage_packages: {
        name: 'manage_packages',
        description:
          'Manage system packages. action="check" to verify installation, action="install" to install via apt-get.',
        input_schema: {
          type: 'object' as const,
          properties: {
            action: {
              type: 'string',
              enum: ['check', 'install'],
              description: 'check or install',
            },
            package_name: {
              type: 'string',
              description: 'The package name (e.g., wpscan, nmap, gobuster)',
            },
          },
          required: ['action', 'package_name'],
        },
      },
      searchsploit_search: {
        name: 'searchsploit_search',
        description:
          'Search ExploitDB for exploits matching a query. Returns JSON results with titles, paths, and EDB-IDs.',
        input_schema: {
          type: 'object' as const,
          properties: {
            query: { type: 'string', description: 'Search query (e.g., "Apache 2.4.49")' },
            exact: {
              type: 'boolean',
              description: 'Use exact match mode (default: false)',
            },
          },
          required: ['query'],
        },
      },
      searchsploit_examine: {
        name: 'searchsploit_examine',
        description: 'Read the source code of a specific ExploitDB exploit by its EDB-ID.',
        input_schema: {
          type: 'object' as const,
          properties: {
            edb_id: {
              type: 'string',
              description: 'The ExploitDB ID (numeric string, e.g., "51193")',
            },
          },
          required: ['edb_id'],
        },
      },
    };

    return toolNames.map((name) => {
      if (knownSchemas[name]) return knownSchemas[name];
      // Generic schema for unknown Kali tools
      return {
        name,
        description: `Execute the ${name} tool on the Kali MCP server.`,
        input_schema: {
          type: 'object' as const,
          properties: {
            args: { type: 'object', description: 'Tool arguments' },
          },
          required: [],
        },
      };
    });
  }

  /**
   * Builds the system prompt for the multi-turn agentic loop.
   * Dynamically injects the current skill library index.
   */
  private buildAgentSystemPrompt(): string {
    const skillsSection = this.skillManager.buildSkillsPromptSection();

    return `You are an elite Penetration Tester running inside a Kali Linux environment.
You have direct access to a Kali Linux shell via the execute_shell_cmd tool.
Your goal: Complete the penetration testing task using available tools, installing anything you need.

## Execution Protocol
1. Analyze the task and determine which tools are needed.
2. Check if required tools are available (execute_shell_cmd: "which <tool>").
3. If a tool is missing, install it via manage_packages.
4. Learn the tool by reading --help and saving a skill file.
5. Execute the task with the correct flags and options.
6. Analyze results and provide a structured summary.

## Tool Management Protocol (OODA Loop)
If a required tool is missing (command not found):
  a. Verify: manage_packages(action="check", package_name="<tool>")
  b. Install: manage_packages(action="install", package_name="<tool>")
  c. Learn: execute_shell_cmd("<tool> --help | head -80")
  d. Save: save_new_skill(tool_name, content) — write a concise skill file with YAML frontmatter
  e. Execute: run your original objective with the new knowledge

## Skill File Format
When saving a new skill, use this format:
---
tool_name: "<name>"
category: "<category>"
tags: [<comma-separated tags>]
description: "<one-line description>"
---
# <Tool Name>
## Key Commands
<useful command examples>
## Anti-Patterns
<things to avoid>

## Skill Library
Before using a tool, check if a skill file exists (listed below). If so,
call read_skill_file(tool_name) to load best practices before proceeding.

${skillsSection}

## Output Rules
1. Use tools to accomplish the task — do NOT just generate a script.
2. Provide a clear summary of findings when done.
3. If the scan reveals vulnerabilities, list them with severity ratings.
4. Save detailed results to /app/logs/ when applicable.`;
  }

  // ─── Single-Shot Methods ──────────────────────────────────

  /**
   * Wraps a raw task string in a structured instruction envelope.
   * Auto-detects JSON TacticalPlan vs plain text.
   */
  private wrapTaskInstruction(task: string): string {
    try {
      const parsed = JSON.parse(task);
      if (parsed.attack_vectors) {
        return this.buildPlanInstruction(parsed as TacticalPlanObject);
      }
    } catch {
      // Not JSON — fall through to plain-text wrapper
    }

    return `Implement the following penetration testing task as a production-ready Python exploit script.
The script must directly attack the target, handle errors gracefully, and verify success.

Task:
${task}`;
  }

  /**
   * Generates a Python pentest script using Claude AI (single-shot, no execution).
   */
  async generateScript(task: string): Promise<string> {
    return startActiveObservation('generate-script', async (span) => {
      span.update({
        input: { task: task.substring(0, 500), model: this.model },
      });

      const instruction = this.wrapTaskInstruction(task);

      const response = await this.anthropic.messages.create({
        model: this.model,
        max_tokens: 8192,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: instruction }],
      });

      const textBlock = response.content.find((b) => b.type === 'text');
      if (!textBlock || textBlock.type !== 'text') {
        throw new Error('No text response from Claude');
      }

      let script = textBlock.text;
      if (script.startsWith('```')) {
        script = script.replace(/^```(?:python)?\n?/, '').replace(/\n?```$/, '');
      }

      span.update({
        output: { scriptLength: script.length },
        metadata: {
          inputTokens: response.usage.input_tokens,
          outputTokens: response.usage.output_tokens,
          stopReason: response.stop_reason,
        },
      });

      return script;
    });
  }

  /**
   * Fully automated pipeline: generate → write → execute (no human review).
   */
  async autoExecute(task: string): Promise<{ script: string; filename: string; result: string }> {
    return startActiveObservation('auto-execute', async (rootSpan) => {
      rootSpan.update({ input: { task: task.substring(0, 500) } });

      console.log('\n[1/3] Generating script with Claude...');
      const script = await this.generateScript(task);

      const filename = `poc_${Date.now()}.py`;

      console.log('[2/3] Writing script to Kali container...');
      const writeResult = await startActiveObservation('write-file', async (span) => {
        const res = await this.mcpAgent.callKaliTool('write_file', { filename, content: script });
        span.update({ output: { filename, result: res } });
        return res;
      });
      console.log(`  ${writeResult}`);

      console.log('[3/3] Executing script...');
      const result = await startActiveObservation('execute-script', async (span) => {
        const res = await this.mcpAgent.callKaliTool('execute_script', { filename });
        span.update({
          input: { filename },
          output: { resultLength: res.length, preview: res.substring(0, 500) },
        });
        return res;
      });

      rootSpan.update({
        output: { filename, scriptLength: script.length, resultLength: result.length },
      });
      return { script, filename, result };
    });
  }

  /**
   * Executes a pre-reviewed/finalized script on the Kali container.
   */
  async executeFinal(script: string): Promise<{ filename: string; result: string }> {
    return startActiveObservation('execute-final', async (rootSpan) => {
      rootSpan.update({ input: { scriptLength: script.length } });

      const filename = `poc_${Date.now()}.py`;

      console.log('\n[1/2] Writing script to Kali container...');
      const writeResult = await this.mcpAgent.callKaliTool('write_file', {
        filename,
        content: script,
      });
      console.log(`  ${writeResult}`);

      console.log('[2/2] Executing script...');
      const result = await startActiveObservation('execute-script', async (span) => {
        const res = await this.mcpAgent.callKaliTool('execute_script', { filename });
        span.update({
          input: { filename },
          output: { resultLength: res.length, preview: res.substring(0, 500) },
        });
        return res;
      });

      rootSpan.update({ output: { filename, resultLength: result.length } });
      return { filename, result };
    });
  }

  // ─── Plan-Based Methods ───────────────────────────────────

  /**
   * Builds the structured 6-section plan context from a TacticalPlanObject.
   * Extracts the first attack vector and formats all metadata into labeled sections.
   */
  private buildPlanContext(plan: TacticalPlanObject): string {
    const vector = plan.attack_vectors[0];
    const rag = vector.rag_context;
    const metrics = vector.prediction_metrics;

    let ctx = `## TARGET\n`;
    ctx += `IP: ${plan.target_ip}\n`;
    ctx += `CVE: ${metrics.classification.cve_id || 'N/A'}\n`;
    ctx += `Attack Type: ${metrics.classification.attack_type}\n`;
    ctx += `MITRE ATT&CK: ${metrics.classification.mitre_id}\n`;
    ctx += `Confidence: ${metrics.hypothesis.confidence_score}\n`;
    ctx += `Rationale: ${metrics.hypothesis.rationale_tags.join(', ')}\n`;
    ctx += `Expected Success: ${metrics.hypothesis.expected_success}\n\n`;

    ctx += `## VULNERABLE ENDPOINT\n`;
    ctx += `Command Template: ${vector.action.command_template}\n`;
    ctx += `Parameters:\n`;
    for (const [key, value] of Object.entries(vector.action.parameters)) {
      ctx += `  - ${key}: ${value}\n`;
    }
    ctx += `Timeout: ${vector.action.timeout_seconds}s\n\n`;

    if (rag) {
      ctx += `## PAYLOAD\n`;
      ctx += `${rag.payload_snippet || 'N/A'}\n\n`;

      ctx += `## EXPLOITATION STRATEGY\n`;
      ctx += `Key Insight: ${rag.insight || 'N/A'}\n`;
      ctx += `Exploitation Logic: ${rag.exploitation_logic || 'N/A'}\n`;
      ctx += `Source: ${rag.source || 'N/A'}\n\n`;

      ctx += `## VULNERABILITY CONTEXT\n`;
      ctx += `${rag.vulnerability_context || 'N/A'}\n\n`;
    }

    ctx += `## SUCCESS CRITERIA\n`;
    ctx += `Match Type: ${metrics.success_criteria.match_type}\n`;
    ctx += `Success Pattern: ${metrics.success_criteria.match_pattern}\n`;
    ctx += `Failure Pattern: ${metrics.success_criteria.negative_pattern || 'N/A'}\n`;

    return ctx;
  }

  /**
   * Wraps buildPlanContext() with a single-shot generation preamble.
   */
  private buildPlanInstruction(plan: TacticalPlanObject): string {
    return `Generate a Python exploit script for the following Tactical Plan.\n\n` + this.buildPlanContext(plan);
  }

  /**
   * Generates a Python exploit script from a parsed TacticalPlanObject.
   */
  async generateScriptFromPlan(plan: TacticalPlanObject): Promise<string> {
    return startActiveObservation('generate-script-from-plan', async (span) => {
      span.update({
        input: { planId: plan.plan_id, targetIp: plan.target_ip, model: this.model },
      });

      const instruction = this.buildPlanInstruction(plan);

      const response = await this.anthropic.messages.create({
        model: this.model,
        max_tokens: 8192,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: instruction }],
      });

      const textBlock = response.content.find((b) => b.type === 'text');
      if (!textBlock || textBlock.type !== 'text') {
        throw new Error('No text response from Claude');
      }

      let script = textBlock.text;
      if (script.startsWith('```')) {
        script = script.replace(/^```(?:python)?\n?/, '').replace(/\n?```$/, '');
      }

      span.update({
        output: { scriptLength: script.length },
        metadata: {
          inputTokens: response.usage.input_tokens,
          outputTokens: response.usage.output_tokens,
          stopReason: response.stop_reason,
        },
      });

      return script;
    });
  }

  /**
   * Fully automated pipeline from a Tactical Plan: generate → write → execute.
   */
  async autoExecuteFromPlan(
    plan: TacticalPlanObject
  ): Promise<{ script: string; filename: string; result: string }> {
    return startActiveObservation('auto-execute-from-plan', async (rootSpan) => {
      rootSpan.update({ input: { planId: plan.plan_id, targetIp: plan.target_ip } });

      console.log(`\n[1/3] Generating exploit from Tactical Plan (${plan.plan_id})...`);
      const script = await this.generateScriptFromPlan(plan);

      const filename = `poc_${plan.plan_id}_${Date.now()}.py`;

      console.log('[2/3] Writing script to Kali container...');
      const writeResult = await startActiveObservation('write-file', async (span) => {
        const res = await this.mcpAgent.callKaliTool('write_file', { filename, content: script });
        span.update({ output: { filename, result: res } });
        return res;
      });
      console.log(`  ${writeResult}`);

      console.log('[3/3] Executing script...');
      const result = await startActiveObservation('execute-script', async (span) => {
        const res = await this.mcpAgent.callKaliTool('execute_script', { filename });
        span.update({
          input: { filename },
          output: { resultLength: res.length, preview: res.substring(0, 500) },
        });
        return res;
      });

      rootSpan.update({
        output: { filename, scriptLength: script.length, resultLength: result.length },
      });
      return { script, filename, result };
    });
  }

  /**
   * Runs the multi-turn agentic loop with a Tactical Plan, using a specific execution strategy.
   *
   * @param plan - TacticalPlanObject with target and attack vector metadata
   * @param mode - "tool" for existing Kali tools, "github" for PoC search
   * @param maxTurns - Maximum agentic turns (default 15)
   */
  async runAgentWithTacticalPlan(
    plan: TacticalPlanObject,
    mode: 'tool' | 'github',
    maxTurns: number = 15
  ): Promise<AgentResult> {
    const vector = plan.attack_vectors[0];
    const cveId = vector.prediction_metrics.classification.cve_id || 'unknown';
    const attackType = vector.prediction_metrics.classification.attack_type;
    const planContext = this.buildPlanContext(plan);

    const task =
      mode === 'tool'
        ? this.buildToolModePrompt(cveId, attackType, plan.target_ip, planContext)
        : this.buildGithubModePrompt(cveId, attackType, plan.target_ip, planContext);

    return this.runAgentLoop(task, maxTurns);
  }

  // ─── Strategy Prompt Builders ─────────────────────────────

  private buildToolModePrompt(
    cveId: string,
    attackType: string,
    targetIp: string,
    planContext: string
  ): string {
    return `## MISSION
You are a Senior Penetration Tester executing a structured attack plan.
Your objective: Exploit ${cveId} (${attackType}) against ${targetIp} using existing offensive security tools available in the Kali Linux environment.

## TACTICAL PLAN CONTEXT
${planContext}

## EXECUTION STRATEGY: Tool-Based Exploitation

### Step 1: Reconnaissance & Tool Selection
- Search for known exploits: execute_shell_cmd("searchsploit ${cveId}")
- Check Metasploit database: execute_shell_cmd("msfconsole -q -x 'search ${cveId}; exit'")
- If searchsploit finds results, mirror the exploit: execute_shell_cmd("searchsploit -m <exploit-id>")
- Check the skill library for existing usage guides before running any tool

### Step 2: Tool Installation & Verification
- Verify tool availability: manage_packages(action="check", package_name="<tool>")
- Install if missing: manage_packages(action="install", package_name="<tool>")
- Learn usage: execute_shell_cmd("<tool> --help | head -80")

### Step 3: Configuration & Execution
- For Metasploit modules, use non-interactive execution:
  execute_shell_cmd("msfconsole -q -x 'use <module>; set RHOSTS ${targetIp}; set RPORT <port>; <options>; run; exit'")
- For standalone exploits from searchsploit, adapt parameters and run directly
- Use the command_template and parameters from the tactical plan as a guide

### Step 4: Verification & Reporting
- Verify exploitation success using the SUCCESS CRITERIA from the plan
- If the first approach fails, try alternative tools or module variants
- Save detailed results to /app/logs/

## CONSTRAINTS
- Always use non-interactive tool execution (no interactive shells)
- For msfconsole, ALWAYS use: msfconsole -q -x '<commands separated by semicolons>; exit'
- Do not guess parameters — use the tactical plan context above
- Try at least 2-3 different approaches before declaring failure
- Save a new skill file if you learn useful tool patterns`;
  }

  private buildGithubModePrompt(
    cveId: string,
    attackType: string,
    targetIp: string,
    planContext: string
  ): string {
    return `## MISSION
You are a Senior Penetration Tester searching for and adapting public proof-of-concept exploits.
Your objective: Find a working PoC for ${cveId} (${attackType}) on GitHub, adapt it for ${targetIp}, and execute it.

## TACTICAL PLAN CONTEXT
${planContext}

## EXECUTION STRATEGY: GitHub PoC Search & Adaptation

### Step 1: Search GitHub for PoC Repositories
- Check if the github-search skill exists: list_skills, then read_skill_file("github-search")
- Search using the GitHub API via curl:
  execute_shell_cmd("curl -s 'https://api.github.com/search/repositories?q=${cveId}+exploit&sort=stars&order=desc' | python3 -c \\"import sys,json; repos=json.load(sys.stdin).get('items',[])[:5]; [print(f\\\\\\"{r['full_name']} ({r['stargazers_count']}*): {r['html_url']}\\\\\\") for r in repos]\\"")
- Also try keyword variations: "${attackType}", "poc", "exploit"

### Step 2: Clone & Inspect the Most Promising Repository
- Clone the highest-starred or most relevant repo:
  execute_shell_cmd("cd /app/scripts && git clone <repo_url> --depth 1")
- Inspect the repository structure and README:
  execute_shell_cmd("ls -la /app/scripts/<repo> && head -100 /app/scripts/<repo>/README.md")
- SECURITY AUDIT: Review the exploit code before execution:
  execute_shell_cmd("cat /app/scripts/<repo>/<exploit_file>")
  Verify it does not contain malicious backdoors, exfiltration, or unexpected network calls.

### Step 3: Adapt the PoC for the Target
- Modify target IP/port to match: ${targetIp}
- Adapt parameters based on the tactical plan context above
- Install dependencies if needed:
  execute_shell_cmd("pip3 install -r /app/scripts/<repo>/requirements.txt")

### Step 4: Execute & Verify
- Run the adapted PoC against the target
- Verify success using the SUCCESS CRITERIA from the plan
- Save output and findings to /app/logs/

## CONSTRAINTS
- GitHub API rate limit: 60 requests/hour unauthenticated — be efficient with queries
- ALWAYS review PoC code before execution — never run untrusted code blindly
- Prefer Python-based PoCs when multiple options exist
- If no GitHub PoC is found, fall back to searchsploit as a secondary source
- If a PoC needs compilation, use gcc/make inside the Kali container
- Save a new skill file if you discover useful search patterns`;
  }

  // ─── Agentic OODA Loop ───────────────────────────────────

  /**
   * Dispatches a tool call to the appropriate handler.
   * Kali tools → MCP server. Host-local tools → in-process SkillManager.
   */
  private async dispatchToolCall(name: string, input: Record<string, unknown>): Promise<string> {
    // Kali MCP tools
    if (this.kaliToolNames.has(name)) {
      return this.mcpAgent.callKaliTool(name, input);
    }

    // Host-local skill tools
    switch (name) {
      case 'save_new_skill':
        return this.skillManager.saveNewSkill(input.tool_name as string, input.content as string);
      case 'read_skill_file':
        return this.skillManager.readSkillFile(input.tool_name as string);
      case 'list_skills':
        return JSON.stringify(this.skillManager.listSkills(), null, 2);
      default:
        return `Error: Unknown tool '${name}'`;
    }
  }

  /**
   * Multi-turn agentic loop. Claude plans, calls tools, observes results,
   * and iterates until the task is complete or maxTurns is exhausted.
   *
   * @param task - The user's task description or strategy-specific prompt
   * @param maxTurns - Maximum agentic turns before forced stop (default 15)
   */
  async runAgentLoop(task: string, maxTurns: number = 15): Promise<AgentResult> {
    return startActiveObservation('agent-loop', async (rootSpan) => {
      rootSpan.update({
        input: { task: task.substring(0, 500), maxTurns, model: this.model },
        metadata: { sessionId: this.sessionId },
      });

      return propagateAttributes(
        {
          sessionId: this.sessionId,
          traceName: `agent-loop-${this.sessionId}`,
          tags: ['agentic', 'pentest', 'multi-turn'],
          metadata: { model: this.model, maxTurns: String(maxTurns) },
        },
        async () => {
          const systemPrompt = this.buildAgentSystemPrompt();
          const toolCalls: ToolCallRecord[] = [];

          const messages: Anthropic.MessageParam[] = [{ role: 'user', content: task }];

          let turnsUsed = 0;
          let totalInputTokens = 0;
          let totalOutputTokens = 0;
          const startTime = Date.now();
          const toolUsageCounts: Record<string, number> = {};

          for (let turn = 0; turn < maxTurns; turn++) {
            turnsUsed++;
            console.log(`\n--- Agent Turn ${turnsUsed} ---`);

            const turnResult = await startActiveObservation(
              `turn-${turnsUsed}`,
              async (turnSpan) => {
                turnSpan.update({
                  input: { turn: turnsUsed, messageCount: messages.length },
                });

                // ── Claude API Call ──
                const response = await startActiveObservation(
                  'claude-api-call',
                  async (apiSpan) => {
                    apiSpan.update({
                      input: { model: this.model, messageCount: messages.length },
                    });

                    const res = await this.anthropic.messages.create({
                      model: this.model,
                      max_tokens: 4096,
                      system: systemPrompt,
                      tools: this.toolDefinitions,
                      messages,
                    });

                    apiSpan.update({
                      output: { stopReason: res.stop_reason },
                      metadata: {
                        inputTokens: res.usage.input_tokens,
                        outputTokens: res.usage.output_tokens,
                      },
                    });

                    return res;
                  }
                );

                totalInputTokens += response.usage.input_tokens;
                totalOutputTokens += response.usage.output_tokens;
                console.log(
                  `  [tokens] in=${response.usage.input_tokens} out=${response.usage.output_tokens} | cumulative: ${totalInputTokens}+${totalOutputTokens}=${totalInputTokens + totalOutputTokens}`
                );

                // Append assistant response to conversation
                messages.push({ role: 'assistant', content: response.content });

                // If Claude is done (end_turn), extract final text and return
                if (response.stop_reason === 'end_turn') {
                  const textBlock = response.content.find((b) => b.type === 'text');
                  const finalText =
                    textBlock && textBlock.type === 'text' ? textBlock.text : '';
                  console.log('\n--- Agent Complete ---');
                  turnSpan.update({
                    output: { status: 'complete', finalTextLength: finalText.length },
                  });
                  return {
                    done: true as const,
                    result: { finalText, toolCalls, turnsUsed },
                  };
                }

                // If Claude wants to use tools, dispatch each one
                if (response.stop_reason === 'tool_use') {
                  const toolUseBlocks = response.content.filter((b) => b.type === 'tool_use');
                  const toolResults: Anthropic.ToolResultBlockParam[] = [];
                  const turnToolNames: string[] = [];

                  for (const block of toolUseBlocks) {
                    if (block.type !== 'tool_use') continue;

                    console.log(
                      `  [tool] ${block.name}(${JSON.stringify(block.input).substring(0, 120)}...)`
                    );

                    // ── Tool Dispatch (traced) ──
                    const result = await startActiveObservation(
                      `tool-${block.name}`,
                      async (toolSpan) => {
                        toolSpan.update({ input: { tool: block.name, args: block.input } });

                        const res = await this.dispatchToolCall(
                          block.name,
                          block.input as Record<string, unknown>
                        );

                        toolSpan.update({
                          output: { resultLength: res.length, preview: res.substring(0, 500) },
                        });

                        return res;
                      }
                    );

                    // Log for debugging
                    const preview =
                      result.length > 200 ? result.substring(0, 200) + '...' : result;
                    console.log(`  [result] ${preview}`);

                    toolCalls.push({
                      name: block.name,
                      input: block.input as Record<string, unknown>,
                      result,
                    });

                    turnToolNames.push(block.name);
                    toolUsageCounts[block.name] = (toolUsageCounts[block.name] || 0) + 1;

                    toolResults.push({
                      type: 'tool_result',
                      tool_use_id: block.id,
                      content: result,
                    });
                  }

                  // Append tool results as user message (per Anthropic API convention)
                  messages.push({ role: 'user', content: toolResults });

                  turnSpan.update({
                    output: {
                      status: 'tool_use',
                      toolsUsed: turnToolNames,
                      toolCount: turnToolNames.length,
                    },
                  });
                }

                return { done: false as const };
              }
            );

            // If the turn returned a final result, print stats and return
            if (turnResult.done) {
              const durationMs = Date.now() - startTime;
              this.printTraceStatistics(
                'complete',
                turnsUsed,
                maxTurns,
                totalInputTokens,
                totalOutputTokens,
                toolCalls.length,
                toolUsageCounts,
                durationMs
              );
              rootSpan.update({
                output: {
                  status: 'complete',
                  turnsUsed,
                  totalToolCalls: toolCalls.length,
                  totalInputTokens,
                  totalOutputTokens,
                  durationMs,
                  uniqueTools: Object.keys(toolUsageCounts),
                  toolBreakdown: toolUsageCounts,
                },
              });
              return turnResult.result;
            }
          }

          // Max turns exceeded
          const durationMs = Date.now() - startTime;
          console.log(`\n--- Agent stopped: max turns (${maxTurns}) reached ---`);
          const lastAssistant = messages.filter((m) => m.role === 'assistant').pop();
          let finalText = '[Agent stopped — max turns reached]';
          if (lastAssistant && Array.isArray(lastAssistant.content)) {
            const tb = (lastAssistant.content as Anthropic.ContentBlock[]).find(
              (b) => b.type === 'text'
            );
            if (tb && tb.type === 'text') {
              finalText = tb.text + '\n\n[Agent stopped — max turns reached]';
            }
          }

          this.printTraceStatistics(
            'max_turns_reached',
            turnsUsed,
            maxTurns,
            totalInputTokens,
            totalOutputTokens,
            toolCalls.length,
            toolUsageCounts,
            durationMs
          );
          rootSpan.update({
            output: {
              status: 'max_turns_reached',
              turnsUsed,
              totalToolCalls: toolCalls.length,
              totalInputTokens,
              totalOutputTokens,
              durationMs,
              uniqueTools: Object.keys(toolUsageCounts),
              toolBreakdown: toolUsageCounts,
            },
          });

          return { finalText, toolCalls, turnsUsed };
        }
      );
    });
  }

  /**
   * Prints a formatted trace statistics summary to the console.
   */
  private printTraceStatistics(
    status: string,
    turnsUsed: number,
    maxTurns: number,
    totalInputTokens: number,
    totalOutputTokens: number,
    totalToolCalls: number,
    toolUsageCounts: Record<string, number>,
    durationMs: number
  ): void {
    const totalTokens = totalInputTokens + totalOutputTokens;
    const durationSec = (durationMs / 1000).toFixed(1);
    const avgTokensPerTurn = turnsUsed > 0 ? Math.round(totalTokens / turnsUsed) : 0;

    console.log('\n--- Trace Statistics ---');
    console.log(`Status:          ${status}`);
    console.log(`Duration:        ${durationSec}s`);
    console.log(`Turns:           ${turnsUsed} / ${maxTurns}`);
    console.log(
      `Total tokens:    ${totalTokens} (in: ${totalInputTokens}, out: ${totalOutputTokens})`
    );
    console.log(`Avg tokens/turn: ${avgTokensPerTurn}`);
    console.log(`Tool calls:      ${totalToolCalls}`);
    if (Object.keys(toolUsageCounts).length > 0) {
      const breakdown = Object.entries(toolUsageCounts)
        .sort((a, b) => b[1] - a[1])
        .map(([name, count]) => `${name}(${count})`)
        .join(', ');
      console.log(`Tool breakdown:  ${breakdown}`);
    }
    console.log(`Session:         ${this.sessionId}`);
  }
}
