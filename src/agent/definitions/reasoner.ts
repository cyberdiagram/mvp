// Reasoner Subagent - Strategic brain for attack planning (sonnet)

import Anthropic from '@anthropic-ai/sdk';
import { ReasonerOutput } from './types.js';

export const REASONER_MODEL = 'claude-sonnet-4-20250514';
export const REASONER_MAX_TOKENS = 2000;

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

export class ReasonerAgent {
  private client: Anthropic;
  private conversationHistory: Anthropic.MessageParam[] = [];
  private skillContext: string = '';

  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey });
  }

  setSkillContext(context: string): void {
    this.skillContext = context;
  }

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

  addObservation(result: string): void {
    this.conversationHistory.push({
      role: 'user',
      content: `Observation from tool execution:\n${result}`,
    });
  }

  reset(): void {
    this.conversationHistory = [];
  }
}
