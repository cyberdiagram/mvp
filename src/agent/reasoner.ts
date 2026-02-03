import Anthropic from '@anthropic-ai/sdk';
import { SkillsLoader } from './skillsLoader.js';

export interface ReasoningResult {
  thought: string;
  action: string;
  tool?: string;
  arguments?: any;
}

export class Reasoner {
  private client: Anthropic;
  private skillsLoader: SkillsLoader;
  private conversationHistory: any[] = [];

  constructor(apiKey: string, skillsLoader: SkillsLoader) {
    this.client = new Anthropic({ apiKey });
    this.skillsLoader = skillsLoader;
  }

  /**
   * Reason about next action using skills and context
   */
  async reason(observation: string, context: string = ''): Promise<ReasoningResult> {
    // Build system prompt with skills
    const skillContext = this.skillsLoader.buildSkillContext(observation);
    
    const systemPrompt = `You are a penetration testing agent with access to various security tools.

${skillContext}

# Available MCP Tools

You can call these tools by outputting JSON in this format:
{
  "thought": "Your reasoning about what to do",
  "action": "describe the action",
  "tool": "tool_name",
  "arguments": { "param": "value" }
}

Available tools:
- nmap_host_discovery: Check if host is alive
- nmap_port_scan: Scan ports on target
- nmap_service_detection: Detect services and versions
- nmap_script_scan: Run NSE scripts

# Guidelines

1. Think step-by-step using the skills provided
2. Choose appropriate tools based on the situation
3. Always explain your reasoning
4. Follow the decision frameworks from the skills`;

    // Build user message
    const userMessage = `Current situation: ${observation}

${context ? `Additional context: ${context}` : ''}

Based on the skills and available tools, what should I do next?`;

    // Add to conversation history
    this.conversationHistory.push({
      role: 'user',
      content: userMessage,
    });

    // Call Claude
    const response = await this.client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1000,
      system: systemPrompt,
      messages: this.conversationHistory,
    });

    const assistantMessage = response.content[0];
    if (assistantMessage.type !== 'text') {
      throw new Error('Expected text response');
    }

    // Add assistant response to history
    this.conversationHistory.push({
      role: 'assistant',
      content: assistantMessage.text,
    });

    // Parse the response
    return this.parseResponse(assistantMessage.text);
  }

  /**
   * Parse LLM response into structured action
   */
  private parseResponse(text: string): ReasoningResult {
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
        };
      } catch (e) {
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
    };
  }

  /**
   * Reset conversation history
   */
  reset(): void {
    this.conversationHistory = [];
  }
}