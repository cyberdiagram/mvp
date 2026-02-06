/**
 * Reasoner Subagent - The strategic brain for attack planning.
 *
 * Uses Claude Sonnet (the most capable model) for complex reasoning about
 * penetration testing strategy. Analyzes results, plans attacks, and
 * decides which tools to use next.
 */

import Anthropic from '@anthropic-ai/sdk';
import { ReasonerOutput, IntelligenceContext, TacticalPlanObject } from './types.js';

/** Model used for strategic reasoning - Sonnet for best decision quality */
export const REASONER_MODEL = 'claude-sonnet-4-20250514';

/** Max tokens for Reasoner responses - enough for detailed analysis */
export const REASONER_MAX_TOKENS = 2000;

/**
 * System prompt that defines the Reasoner's role and behavior.
 *
 * Instructs the model to:
 * - Act as a penetration testing strategist
 * - Return structured JSON responses
 * - Use intelligence context (profiles, vulnerabilities) for informed decisions
 * - Generate tactical plans with prediction metrics
 * - Follow a methodology: broad discovery → specific scanning → deep analysis
 */
export const REASONER_SYSTEM_PROMPT = `You are an expert penetration testing strategist with advanced threat intelligence capabilities. Your role is to:

1. ANALYZE reconnaissance results and security findings
2. INTERPRET intelligence context (target profiles, vulnerabilities, exploit data)
3. PLAN multi-step attack strategies based on discovered vulnerabilities
4. PREDICT attack outcomes with confidence metrics
5. DECIDE HIGH-LEVEL strategic actions (NOT specific tool calls)

# Response Format

Always respond with a JSON object containing:
{
  "thought": "Your detailed reasoning about the current situation",
  "action": "HIGH-LEVEL description of what should be done next",
  "is_complete": false
}

**IMPORTANT**:
- Your "action" should be STRATEGIC and HIGH-LEVEL (e.g., "Scan the target for open ports and services")
- DO NOT specify specific tools, commands, or technical parameters
- The Executor Agent will break down your high-level action into concrete tool calls
- Focus on WHAT needs to be done and WHY, not HOW to do it

Set "is_complete": true when the reconnaissance/attack phase is finished.

# Strategic Examples

❌ BAD (too specific): "Run nmap_port_scan with -p 1-65535 on 192.168.1.1"
✅ GOOD (strategic): "Perform comprehensive port scanning to identify all open services"

❌ BAD (tool-focused): "Execute nmap_service_detection on ports 80,443"
✅ GOOD (goal-focused): "Enumerate web service versions to identify potential vulnerabilities"

❌ BAD (tactical): "Run gobuster with wordlist on http://target/admin"
✅ GOOD (strategic): "Discover hidden web directories and administrative interfaces"

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
3. Focus on high-value targets first (databases, domain controllers)
4. Match exploits to confirmed OS/service versions

# Tactical Planning Output (When Relevant)

When planning attacks after service discovery, you MAY optionally include a "tactical_plan" in your response:

{
  "thought": "...",
  "action": "...",
  "tool": "...",
  "arguments": {...},
  "is_complete": false,

  "tactical_plan": {
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
    ],
    "created_at": "<ISO timestamp>"
  }
}

**Important**: Only include tactical_plan when you have specific attack vectors to execute based on discovered vulnerabilities. For reconnaissance phases (host discovery, port scanning, service detection), omit tactical_plan and just use the standard response format.

The prediction_metrics section is used by the Evaluator Agent to measure your accuracy. Be honest about your confidence scores and provide clear success criteria.

# Strategy Guidelines

1. **Reconnaissance Phase**: Start broad (host discovery) → narrow down (port scan) → deep dive (service detection)
2. **Intelligence Phase**: Wait for target profile and vulnerability data
3. **Attack Phase**: Generate tactical plans with prediction metrics
4. Prioritize high-value targets: databases, domain controllers, SSH, HTTP, admin panels
5. Look for version-specific vulnerabilities in discovered services
6. Consider the attack surface systematically
7. Document your reasoning for each decision

# Example Flow

1. Host Discovery → Find alive hosts
2. Port Scan on alive hosts → Find open ports
3. Service Detection on interesting ports → Find versions
4. Wait for Intelligence Layer → Receive profile + vulnerabilities
5. Analyze intelligence → Generate tactical plan with predictions
6. Execute attack vectors → Evaluate outcomes`;

/**
 * ReasonerAgent - Strategic decision-making subagent.
 *
 * The "brain" of the pentest agent that:
 * - Maintains conversation history to track the reconnaissance progress
 * - Analyzes tool results and determines next steps
 * - Returns structured decisions (thought, action, tool, arguments)
 * - Knows when the mission is complete
 *
 * Uses Claude Sonnet for highest quality reasoning.
 */
export class ReasonerAgent {
  /** Anthropic API client */
  private client: Anthropic;
  /** Conversation history for multi-turn reasoning */
  private conversationHistory: Anthropic.MessageParam[] = [];
  /** Skill context injected into the system prompt */
  private skillContext: string = '';
  /** Intelligence context for informed decision-making */
  private intelligenceContext: IntelligenceContext | null = null;
  /** RAG memory context for anti-pattern warnings */
  private memoryContext: string = '';

  /**
   * Creates a new ReasonerAgent.
   *
   * @param apiKey - Anthropic API key for Claude API calls
   */
  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey });
  }

  /**
   * Sets the skill context to inject into the system prompt.
   *
   * Skills provide domain expertise about specific tools (e.g., Nmap usage patterns).
   *
   * @param context - Formatted skill content from SkillsLoader.buildSkillContext()
   */
  setSkillContext(context: string): void {
    this.skillContext = context;
  }

  /**
   * Sets the intelligence context for informed decision-making.
   *
   * Intelligence context includes:
   * - Discovered services with categorization and confidence scores
   * - Target profile (OS, tech stack, security posture)
   * - Known vulnerabilities with CVEs and PoC availability
   *
   * @param intelligence - Intelligence context from Intelligence Layer
   */
  setIntelligenceContext(intelligence: IntelligenceContext | null): void {
    this.intelligenceContext = intelligence;
  }

  /**
   * Injects RAG memory context (anti-pattern warnings).
   *
   * Memory context contains warnings from past failures to prevent
   * repeating mistakes across sessions.
   *
   * @param memoryRecall - Formatted memory warnings from RAG MCP server
   */
  injectMemoryContext(memoryRecall: string): void {
    this.memoryContext = memoryRecall;
  }

  /**
   * Analyzes the current situation and decides what to do next.
   *
   * Sends the observation to Claude Sonnet along with conversation history
   * and skill context. Returns a structured decision about the next action.
   *
   * @param observation - The current situation or tool result to analyze
   * @param additionalContext - Optional extra context to include
   * @returns ReasonerOutput with thought, action, tool, arguments, and is_complete
   *
   * @example
   * const decision = await reasoner.reason('Found open port 22 (SSH) on 192.168.1.1');
   * // Returns: { thought: "SSH is open...", action: "Detect service version", tool: "nmap_service_detection", ... }
   */
  async reason(observation: string, additionalContext?: string): Promise<ReasonerOutput> {
    const userMessage = additionalContext
      ? `${observation}\n\nAdditional context: ${additionalContext}`
      : observation;

    this.conversationHistory.push({
      role: 'user',
      content: userMessage,
    });

    // Build system prompt with cache_control for token optimization
    // Caches static content (base prompt + skills) to reduce token usage by ~85%
    const systemBlocks: Anthropic.TextBlockParam[] = [
      {
        type: 'text',
        text: REASONER_SYSTEM_PROMPT,
        cache_control: { type: 'ephemeral' },
      },
    ];

    // Add skill context as separate cached block if present
    if (this.skillContext) {
      systemBlocks.push({
        type: 'text',
        text: `# Loaded Skills\n\n${this.skillContext}`,
        cache_control: { type: 'ephemeral' },
      });
    }

    // Add intelligence context if available (not cached - changes per iteration)
    if (this.intelligenceContext) {
      const intel = this.intelligenceContext;
      let intelText = '# Current Intelligence Context\n\n';

      // Add target profile if available
      if (intel.targetProfile) {
        intelText += '## Target Profile\n';
        intelText += `- OS: ${intel.targetProfile.os_family || 'Unknown'}`;
        if (intel.targetProfile.os_version) {
          intelText += ` (${intel.targetProfile.os_version})`;
        }
        intelText += '\n';
        intelText += `- Tech Stack: ${intel.targetProfile.tech_stack?.join(', ') || 'Unknown'}\n`;
        intelText += `- Security Posture: ${intel.targetProfile.security_posture}\n`;
        intelText += `- Risk Level: ${intel.targetProfile.risk_level}\n`;
        intelText += `- Evidence: ${intel.targetProfile.evidence.join('; ')}\n\n`;
      }

      // Add discovered services summary
      if (intel.discoveredServices.length > 0) {
        intelText += '## Discovered Services\n';
        intelText += `Total: ${intel.discoveredServices.length} services\n\n`;

        // Group by criticality
        const critical = intel.discoveredServices.filter((s) => s.criticality === 'high');
        const medium = intel.discoveredServices.filter((s) => s.criticality === 'medium');

        if (critical.length > 0) {
          intelText += '**High Criticality Services:**\n';
          critical.forEach((s) => {
            intelText += `- ${s.host}:${s.port} - ${s.service}`;
            if (s.product) intelText += ` (${s.product}`;
            if (s.version) intelText += ` ${s.version}`;
            if (s.product) intelText += ')';
            intelText += ` [${s.category}]\n`;
          });
          intelText += '\n';
        }

        if (medium.length > 0) {
          intelText += '**Medium Criticality Services:**\n';
          medium.slice(0, 5).forEach((s) => {
            intelText += `- ${s.host}:${s.port} - ${s.service}`;
            if (s.product) intelText += ` (${s.product}`;
            if (s.version) intelText += ` ${s.version}`;
            if (s.product) intelText += ')';
            intelText += '\n';
          });
          if (medium.length > 5) {
            intelText += `... and ${medium.length - 5} more\n`;
          }
          intelText += '\n';
        }
      }

      // Add vulnerabilities if available
      if (intel.vulnerabilities.length > 0) {
        intelText += '## Known Vulnerabilities\n';
        intelText += `Found ${intel.vulnerabilities.length} vulnerabilities\n\n`;

        // Show top vulnerabilities (sorted by severity)
        intel.vulnerabilities.slice(0, 10).forEach((v) => {
          intelText += `**${v.cve_id}** (${v.severity}):\n`;
          intelText += `- ${v.description}\n`;
          intelText += `- Affects: ${v.affected_service}\n`;
          if (v.poc_available) {
            intelText += `- PoC Available: ${v.poc_url || 'Yes'}\n`;
          }
          if (v.exploitdb_id) {
            intelText += `- ExploitDB ID: ${v.exploitdb_id}\n`;
          }
          intelText += '\n';
        });

        if (intel.vulnerabilities.length > 10) {
          intelText += `... and ${intel.vulnerabilities.length - 10} more vulnerabilities\n\n`;
        }
      }

      systemBlocks.push({
        type: 'text',
        text: intelText,
      });
    }

    // Add RAG memory context if available (warnings from past failures)
    if (this.memoryContext) {
      systemBlocks.push({
        type: 'text',
        text: this.memoryContext,
      });
    }

    const response = await this.client.messages.create({
      model: REASONER_MODEL,
      max_tokens: REASONER_MAX_TOKENS,
      system: systemBlocks,
      messages: this.conversationHistory,
    });

    const assistantMessage = response.content[0];
    if (assistantMessage.type !== 'text') {
      throw new Error('Expected text response from Reasoner');
    }

    this.conversationHistory.push({
      role: 'assistant',
      content: assistantMessage.text,
    });

    return this.parseResponse(assistantMessage.text);
  }

  /**
   * Parses the LLM response text into a structured ReasonerOutput.
   *
   * First tries to extract a JSON object from the response.
   * Falls back to regex-based text parsing if JSON extraction fails.
   * Also extracts tactical plan if present.
   *
   * @param text - Raw text response from Claude
   * @returns Structured ReasonerOutput object
   */
  private parseResponse(text: string): ReasonerOutput {
    // Try to extract JSON
    const jsonMatch = text.match(/\{[\s\S]*\}/);

    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[0]);

        // Parse tactical plan if present
        const tacticalPlan = parsed.tactical_plan
          ? this.parseTacticalPlan(JSON.stringify(parsed.tactical_plan)) || undefined
          : undefined;

        return {
          thought: parsed.thought || '',
          action: parsed.action || '',
          is_complete: parsed.is_complete || false,
          tactical_plan: tacticalPlan,
          attack_rationale: parsed.attack_rationale,
          expected_success: parsed.expected_success,
        };
      } catch {
        // Fallback to text parsing
      }
    }

    // Fallback: extract from text
    const thoughtMatch = text.match(/Thought:?\s*([^\n]+)/i);
    const actionMatch = text.match(/Action:?\s*([^\n]+)/i);

    return {
      thought: thoughtMatch ? thoughtMatch[1].trim() : text,
      action: actionMatch ? actionMatch[1].trim() : 'Continue analysis',
      is_complete: false,
    };
  }

  /**
   * Parses a tactical plan from JSON text.
   *
   * Extracts and validates the TacticalPlanObject structure from
   * the Reasoner's response. Returns null if parsing fails or
   * the structure is invalid.
   *
   * @param jsonText - JSON string containing the tactical plan
   * @returns TacticalPlanObject or null if parsing fails
   */
  private parseTacticalPlan(jsonText: string): TacticalPlanObject | null {
    try {
      const plan = JSON.parse(jsonText);

      // Validate structure
      if (
        !plan.attack_vectors ||
        !Array.isArray(plan.attack_vectors) ||
        plan.attack_vectors.length === 0
      ) {
        return null;
      }

      // Ensure required fields
      return {
        plan_id: plan.plan_id || `plan_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        target_ip: plan.target_ip || 'unknown',
        context_hash: plan.context_hash || '',
        attack_vectors: plan.attack_vectors,
        created_at: plan.created_at || new Date().toISOString(),
      } as TacticalPlanObject;
    } catch {
      return null;
    }
  }

  /**
   * Adds a tool execution result to the conversation history.
   *
   * This allows the Reasoner to "remember" previous tool results
   * and build upon them in subsequent reasoning calls.
   *
   * @param result - The result/observation to add to history
   */
  addObservation(result: string): void {
    this.conversationHistory.push({
      role: 'user',
      content: `Observation from tool execution:\n${result}`,
    });
  }

  /**
   * Clears the conversation history and intelligence context to start fresh.
   *
   * Call this when starting a new reconnaissance mission
   * so previous context doesn't interfere.
   */
  reset(): void {
    this.conversationHistory = [];
    this.intelligenceContext = null;
    this.memoryContext = '';
  }
}
