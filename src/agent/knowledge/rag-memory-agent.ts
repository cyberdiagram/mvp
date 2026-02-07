/**
 * RAG Memory Agent - Queries security playbooks and anti-patterns
 *
 * This agent interfaces with the RAG Memory MCP server to retrieve:
 * 1. Security Playbooks (successful exploitation techniques)
 * 2. Anti-Patterns (failed exploits and warnings)
 *
 * The retrieved knowledge is injected into the Reasoner's context
 * alongside Profiler and VulnLookup intelligence.
 *
 * @module agent/definitions/rag-memory-agent
 */

import { MCPAgent } from '../execution/mcp-agent.js';

/**
 * Playbook/Anti-Pattern document from RAG memory
 */
export interface RAGMemoryDocument {
  /** Document ID */
  id: string;
  /** Formatted content (ready for injection) */
  document: string;
  /** Metadata for filtering */
  metadata: {
    type: 'playbook' | 'anti_pattern';
    service: string;
    port?: number;
    category: string;
    tags?: string;
    source?: string;
    cve?: string;
  };
}

/**
 * RAG Memory query result
 */
export interface RAGMemoryResult {
  /** Playbooks (successful techniques) */
  playbooks: RAGMemoryDocument[];
  /** Anti-patterns (failed exploits) */
  antiPatterns: RAGMemoryDocument[];
  /** Combined formatted text for injection */
  formattedText: string;
}

/**
 * RAG Memory Agent - Retrieves security playbooks and anti-patterns.
 *
 * This agent queries the RAG Memory System's security_playbooks collection
 * to retrieve relevant knowledge based on:
 * - Discovered services (e.g., "pfsense", "apache", "lighttpd")
 * - Vulnerabilities (CVEs from VulnLookup)
 * - Target profile (OS, tech stack from Profiler)
 *
 * The agent queries BOTH types of documents:
 * - Type: playbook → Successful exploitation techniques
 * - Type: anti_pattern → Failed exploits with alternatives
 */
export class RAGMemoryAgent {
  private mcpAgent: MCPAgent;

  /**
   * Creates a new RAG Memory Agent.
   *
   * @param mcpAgent - MCP agent for tool execution
   */
  constructor(mcpAgent: MCPAgent) {
    this.mcpAgent = mcpAgent;
  }

  /**
   * Query RAG memory for relevant playbooks and anti-patterns.
   *
   * This method constructs a query based on the intelligence context
   * and retrieves both successful techniques (playbooks) and warnings
   * (anti-patterns) from past experiences.
   *
   * @param context - Intelligence context from Profiler + VulnLookup
   * @param context.services - Discovered services (e.g., ["pfsense", "apache"])
   * @param context.cves - Known CVEs (e.g., ["CVE-2016-10709"])
   * @param context.profile - Target profile summary
   * @param topK - Number of results per type (default: 3)
   * @returns RAG memory result with playbooks and anti-patterns
   */
  async queryMemory(
    context: {
      services?: string[];
      cves?: string[];
      profile?: string;
    },
    topK: number = 3
  ): Promise<RAGMemoryResult> {
    // Build query text from intelligence context
    const queryParts: string[] = [];

    if (context.services && context.services.length > 0) {
      queryParts.push(`services: ${context.services.join(', ')}`);
    }

    if (context.cves && context.cves.length > 0) {
      queryParts.push(`vulnerabilities: ${context.cves.join(', ')}`);
    }

    if (context.profile) {
      queryParts.push(`target: ${context.profile}`);
    }

    const queryText = queryParts.length > 0 ? queryParts.join(' | ') : 'general exploitation';

    console.log(`[RAG Memory] Query: ${queryText}`);

    // Query for playbooks (successful techniques)
    const playbooks = await this.queryPlaybooks(queryText, topK);

    // Query for anti-patterns (failed exploits)
    const antiPatterns = await this.queryAntiPatterns(queryText, topK);

    // Format for Reasoner injection
    const formattedText = this.formatForInjection(playbooks, antiPatterns);

    console.log(`[RAG Memory] ✓ Found ${playbooks.length} playbooks, ${antiPatterns.length} anti-patterns`);

    return {
      playbooks,
      antiPatterns,
      formattedText,
    };
  }

  /**
   * Query for security playbooks (successful techniques).
   *
   * @param queryText - Query string
   * @param topK - Number of results
   * @returns Array of playbook documents
   */
  private async queryPlaybooks(queryText: string, topK: number): Promise<RAGMemoryDocument[]> {
    try {
      const result = await this.mcpAgent.executeTool({
        tool: 'rag_query_playbooks',
        arguments: {
          query: queryText,
          top_k: topK,
          type: 'playbook',
        },
        description: 'Query RAG memory for successful exploitation playbooks',
      });

      if (result.success && result.output) {
        return this.parseRAGOutput(result.output, 'playbook');
      }

      return [];
    } catch (error) {
      console.error('[RAG Memory] Failed to query playbooks:', error);
      return [];
    }
  }

  /**
   * Query for anti-patterns (failed exploits with alternatives).
   *
   * @param queryText - Query string
   * @param topK - Number of results
   * @returns Array of anti-pattern documents
   */
  private async queryAntiPatterns(queryText: string, topK: number): Promise<RAGMemoryDocument[]> {
    try {
      const result = await this.mcpAgent.executeTool({
        tool: 'rag_query_playbooks',
        arguments: {
          query: queryText,
          top_k: topK,
          type: 'anti_pattern',
        },
        description: 'Query RAG memory for anti-patterns and warnings',
      });

      if (result.success && result.output) {
        return this.parseRAGOutput(result.output, 'anti_pattern');
      }

      return [];
    } catch (error) {
      console.error('[RAG Memory] Failed to query anti-patterns:', error);
      return [];
    }
  }

  /**
   * Parse MCP tool output into RAG documents.
   *
   * The RAG Memory client returns a RecallResult with matches and assembled_prompt.
   * We need to extract the patterns and convert them to RAGMemoryDocuments.
   *
   * @param output - Raw MCP output (JSON string)
   * @param type - Document type filter (not used with new recall API)
   * @returns Parsed documents
   */
  private parseRAGOutput(output: string, type: 'playbook' | 'anti_pattern'): RAGMemoryDocument[] {
    try {
      // Parse the RecallResult from the MCP client
      const recallResult = JSON.parse(output);

      if (recallResult.success && recallResult.patterns && Array.isArray(recallResult.patterns)) {
        // Convert RAGPattern[] to RAGMemoryDocument[]
        return recallResult.patterns.map((pattern: any) => ({
          id: pattern.id || `${type}_${Date.now()}`,
          document: pattern.prompt_text || pattern.document || '',
          metadata: {
            type,
            service: 'unknown',
            category: 'general',
            tags: pattern.trigger_keywords || '',
          },
        }));
      }

      // If no patterns found, return empty array
      if (recallResult.success && recallResult.matches === 0) {
        return [];
      }

      // Fallback: wrap the assembled prompt if available
      if (recallResult.assembled_prompt) {
        return [
          {
            id: `${type}_${Date.now()}`,
            document: recallResult.assembled_prompt,
            metadata: {
              type,
              service: 'unknown',
              category: 'general',
            },
          },
        ];
      }

      return [];
    } catch (error) {
      console.error('[RAG Memory] Failed to parse output:', error);
      return [];
    }
  }

  /**
   * Format playbooks and anti-patterns for Reasoner injection.
   *
   * This method creates a structured prompt block that combines:
   * - Known successful strategies (playbooks)
   * - Warnings from failed attempts (anti-patterns)
   *
   * The formatted text is injected into the Reasoner's system prompt
   * alongside Profiler and VulnLookup intelligence.
   *
   * @param playbooks - Retrieved playbooks
   * @param antiPatterns - Retrieved anti-patterns
   * @returns Formatted text for system prompt injection
   */
  private formatForInjection(
    playbooks: RAGMemoryDocument[],
    antiPatterns: RAGMemoryDocument[]
  ): string {
    const sections: string[] = [];

    // Add anti-patterns section (warnings first)
    if (antiPatterns.length > 0) {
      sections.push('[MEMORY RECALL - WARNINGS FROM PAST EXPERIENCE]');
      sections.push(
        'The following warnings are based on past penetration testing failures.'
      );
      sections.push('Follow these guidelines to avoid repeating past mistakes.\n');

      antiPatterns.forEach((pattern, idx) => {
        sections.push(`[ANTI-PATTERN WARNING ${idx + 1}/${antiPatterns.length}]`);
        sections.push(pattern.document);
        sections.push(''); // Empty line
      });

      sections.push('[END MEMORY RECALL]\n');
    }

    // Add playbooks section (successful strategies)
    if (playbooks.length > 0) {
      sections.push('[KNOWN STRATEGIES - SIMILAR SCENARIOS]');
      sections.push(
        'The following strategies were successfully used in similar scenarios.'
      );
      sections.push('Consider adapting these approaches for the current target.\n');

      playbooks.forEach((playbook, idx) => {
        sections.push(`[STRATEGY ${idx + 1}/${playbooks.length}]`);
        sections.push(playbook.document);
        sections.push(''); // Empty line
      });

      sections.push('[END KNOWN STRATEGIES]\n');
    }

    return sections.join('\n');
  }
}
