/**
 * Reasoner Subagent - The strategic brain for attack planning.
 *
 * Uses Claude Sonnet (the most capable model) for complex reasoning about
 * penetration testing strategy. Analyzes results, plans attacks, and
 * decides which tools to use next.
 */

import Anthropic from '@anthropic-ai/sdk';
import { ReasonerOutput } from './types.js';

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
 * - Follow a methodology: broad discovery → specific scanning → deep analysis
 * - Know about available tools (nmap_host_discovery, nmap_port_scan, etc.)
 */
export const REASONER_SYSTEM_PROMPT = `You are an expert penetration testing strategist. Your role is to:

1. ANALYZE reconnaissance results and security findings
2. PLAN multi-step attack strategies based on discovered vulnerabilities
3. INTERPRET tool outputs and adjust strategies accordingly
4. DECIDE the next best action to take

# Response Format

Always respond with a JSON object containing:
{
  "thought": "Your detailed reasoning about the current situation",
  "action": "Description of what should be done next",
  "tool": "tool_name (if a tool should be executed)",
  "arguments": { "param": "value" },
  "is_complete": false
}

Set "is_complete": true when the reconnaissance/attack phase is finished.

# Available Tools

- nmap_host_discovery: Discover live hosts on a network
  Arguments: { "target": "IP or CIDR" }

- nmap_port_scan: Scan ports on target(s)
  Arguments: { "target": "IP", "ports": "1-1000" or "top-1000", "scanType": "tcp" or "udp" }

- nmap_service_detection: Detect services and versions
  Arguments: { "target": "IP", "ports": "22,80,443" }

# Strategy Guidelines

1. Start broad (host discovery) → narrow down (port scan) → deep dive (service detection)
2. Prioritize high-value targets: SSH, HTTP, databases, admin panels
3. Look for version-specific vulnerabilities in discovered services
4. Consider the attack surface systematically
5. Document your reasoning for each decision

# Example Flow

1. Host Discovery → Find alive hosts
2. Port Scan on alive hosts → Find open ports
3. Service Detection on interesting ports → Find versions
4. Analyze versions for known CVEs → Plan exploitation`;

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
    const systemPrompt = this.skillContext
      ? `${REASONER_SYSTEM_PROMPT}\n\n# Loaded Skills\n\n${this.skillContext}`
      : REASONER_SYSTEM_PROMPT;

    const userMessage = additionalContext
      ? `${observation}\n\nAdditional context: ${additionalContext}`
      : observation;

    this.conversationHistory.push({
      role: 'user',
      content: userMessage,
    });

    const response = await this.client.messages.create({
      model: REASONER_MODEL,
      max_tokens: REASONER_MAX_TOKENS,
      system: systemPrompt,
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
        return {
          thought: parsed.thought || '',
          action: parsed.action || '',
          tool: parsed.tool,
          arguments: parsed.arguments,
          is_complete: parsed.is_complete || false,
        };
      } catch {
        // Fallback to text parsing
      }
    }

    // Fallback: extract from text
    const thoughtMatch = text.match(/Thought:?\s*([^\n]+)/i);
    const actionMatch = text.match(/Action:?\s*([^\n]+)/i);
    const toolMatch = text.match(/Tool:?\s*([^\n]+)/i);

    return {
      thought: thoughtMatch ? thoughtMatch[1].trim() : text,
      action: actionMatch ? actionMatch[1].trim() : 'Continue analysis',
      tool: toolMatch ? toolMatch[1].trim() : undefined,
      is_complete: false,
    };
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
   * Clears the conversation history to start fresh.
   *
   * Call this when starting a new reconnaissance mission
   * so previous context doesn't interfere.
   */
  reset(): void {
    this.conversationHistory = [];
  }
}
