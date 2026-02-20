/**
 * Profiler Agent - Target reconnaissance and profiling.
 *
 * Analyzes discovered services to generate comprehensive target profiles
 * including OS detection, technology stack inference, security posture
 * assessment, and risk classification.
 *
 * Uses Claude Haiku for fast, cost-effective analysis.
 */

import Anthropic from '@anthropic-ai/sdk';
import { DiscoveredService, TargetProfile } from '../core/types.js';

/** Model used for profiling - Haiku for speed and cost efficiency */
export const PROFILER_MODEL = 'claude-haiku-4-5-20251001';

/** Max tokens for Profiler responses */
export const PROFILER_MAX_TOKENS = 1500;

/**
 * ProfilerAgent analyzes discovered services to create a comprehensive target profile.
 *
 * Capabilities:
 * - OS fingerprinting from service banners and versions
 * - Technology stack inference (LAMP, MEAN, Windows Server, etc.)
 * - Security posture assessment (hardened, standard, weak)
 * - Risk level classification (high-value, medium, low)
 *
 * Uses evidence-based reasoning to provide accurate assessments with
 * supporting evidence for each conclusion.
 *
 * Performance optimizations:
 * - Prompt caching enabled for system prompt (~90% token cost reduction on repeated calls)
 * - Claude Haiku 3.5 for fast, cost-effective analysis
 */
export class ProfilerAgent {
  /** Anthropic API client */
  private client: Anthropic;

  /**
   * Creates a new ProfilerAgent.
   *
   * @param apiKey - Anthropic API key for Claude API calls
   */
  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey });
  }

  /**
   * Generate a target profile from discovered services.
   *
   * Analyzes service information to infer:
   * - Operating system family and version
   * - Technology stack (LAMP, LEMP, Windows, etc.)
   * - Security posture (hardened, standard, weak)
   * - Risk level (high-value, medium, low)
   *
   * Returns evidence-based assessment with supporting observations.
   *
   * @param services - Array of discovered services with metadata
   * @returns Target profile with OS, tech stack, security posture, and risk assessment
   *
   * @example
   * const profile = await profiler.profile(discoveredServices);
   * // Returns: { os_family: "Linux", security_posture: "hardened", ... }
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

Be concise and evidence-based. If uncertain, state "Unknown" rather than guessing.`;

    const userMessage = `Analyze these discovered services:\n\n${JSON.stringify(
      services,
      null,
      2
    )}\n\nGenerate target profile.`;

    try {
      // Use cache_control to cache static system prompt (~90% token savings on repeated calls)
      const response = await this.client.messages.create({
        model: PROFILER_MODEL,
        max_tokens: PROFILER_MAX_TOKENS,
        system: [
          {
            type: 'text',
            text: systemPrompt,
            cache_control: { type: 'ephemeral' },
          },
        ],
        messages: [{ role: 'user', content: userMessage }],
      });

      const content = response.content[0];
      if (content.type === 'text') {
        const jsonText = this.extractJSON(content.text);
        return JSON.parse(jsonText) as TargetProfile;
      }

      throw new Error('No text content in response');
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Profiler failed: ${message}`);
    }
  }

  /**
   * Extract JSON from LLM response text.
   *
   * Looks for JSON object in response. If not found, assumes entire text is JSON.
   *
   * @param text - Raw text response from Claude
   * @returns Extracted JSON string
   */
  private extractJSON(text: string): string {
    // Try to find JSON object in response
    const match = text.match(/\{[\s\S]*\}/);
    if (match) return match[0];

    // If no JSON found, assume entire text is JSON
    return text;
  }
}
