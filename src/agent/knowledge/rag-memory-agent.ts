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

import { DualMCPAgent } from '../execution/mcp-agent.js';

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
    type: 'playbook' | 'anti_pattern' | 'session_playbook';
    service: string;
    port?: number;
    category: string;
    tags?: string;
    source?: string;
    cve?: string;
    exploitation_logic?: string;
    vulnerability_context?: string;
    is_core_instruction?: boolean;
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
  private mcpAgent: DualMCPAgent;

  /**
   * Creates a new RAG Memory Agent.
   *
   * @param mcpAgent - MCP agent for tool execution
   */
  constructor(mcpAgent: DualMCPAgent) {
    this.mcpAgent = mcpAgent;
  }

  /**
   * Phase 0: Reactive Warnings (Learning from Mistakes)
   *
   * Retrieves "pitfalls I've fallen into" from the anti_patterns collection.
   * Returns formatted warnings ready for direct injection into the Reasoner's
   * context before strategic reasoning begins.
   *
   * Unlike searchHandbook() which retrieves proactive strategies from the
   * playbooks collection, this method focuses strictly on what NOT to do.
   *
   * @param observation - Current observation or scenario description
   * @param topK - Number of anti-pattern results (default: 3)
   * @returns Object with antiPatterns array and formatted warning text
   */
  async recallInternalWarnings(
    observation: string,
    topK: number = 3
  ): Promise<{ antiPatterns: RAGMemoryDocument[]; formattedText: string }> {
    console.log(`[RAG Memory] Recalling internal warnings...`);

    try {
      const antiPatterns = await this.queryAntiPatterns(observation, topK);

      const sections: string[] = [];
      if (antiPatterns.length > 0) {
        sections.push('[MEMORY RECALL - WARNINGS FROM PAST EXPERIENCE]');
        sections.push(
          'The following are warnings based on past failures. Ensure you avoid these in upcoming decisions:\n'
        );
        antiPatterns.forEach((p, i) => {
          sections.push(`[WARNING ${i + 1}] ${p.document}`);
        });
        sections.push('[END MEMORY RECALL]');

        console.log(`[RAG Memory] ✓ Found ${antiPatterns.length} warning(s)`);
        antiPatterns.forEach((p, i) => {
          console.log(`[RAG Memory]   ${i + 1}. [${p.id}] tags="${p.metadata.tags || ''}"`);
        });
      } else {
        console.log('[RAG Memory] No relevant warnings found');
      }

      return { antiPatterns, formattedText: sections.join('\n') };
    } catch (error) {
      console.error('[RAG Memory] Failed to recall warnings:', error);
      return { antiPatterns: [], formattedText: '' };
    }
  }

  /**
   * Phase 4b: Proactive Handbook Retrieval (Searching Playbooks)
   *
   * Retrieves "successful paths" from the playbooks collection, categorizing
   * results into internal past successes (session_playbook) and external
   * industry reports/standard playbooks.
   *
   * The Reasoner receives hierarchical context where internal experience
   * is presented with higher confidence than external reports.
   *
   * @param context - Intelligence context with services and profile
   * @param topK - Number of playbook results (default: 5)
   * @returns Object with playbooks array and formatted strategy text
   */
  async searchHandbook(
    context: { services?: string[]; profile?: string },
    topK: number = 5
  ): Promise<{ playbooks: RAGMemoryDocument[]; formattedText: string }> {
    const queryText = this.buildSemanticQuery(context);
    console.log(`[RAG Memory] Searching handbook: ${queryText}`);

    try {
      const allPlaybooks = await this.queryPlaybooks(queryText, topK);

      // Categorize based on metadata type
      const myPastSuccesses = allPlaybooks.filter((p) => p.metadata.type === 'session_playbook');
      const industryReports = allPlaybooks.filter((p) => p.metadata.type !== 'session_playbook');

      const sections: string[] = [];
      if (allPlaybooks.length > 0) {
        sections.push('[KNOWLEDGE RETRIEVAL - ATTACK STRATEGIES]');

        if (myPastSuccesses.length > 0) {
          sections.push('\n>>> MY PAST SUCCESSES (High Confidence):');
          myPastSuccesses.forEach((p) => sections.push(`- ${p.document}`));
        }

        if (industryReports.length > 0) {
          sections.push('\n>>> INDUSTRY STANDARD PLAYBOOKS & REPORTS:');
          industryReports.forEach((p) => sections.push(`- ${p.document}`));
        }

        sections.push('\n[END KNOWLEDGE RETRIEVAL]');

        console.log(
          `[RAG Memory] ✓ Found ${myPastSuccesses.length} internal successes, ${industryReports.length} industry playbooks`
        );
      } else {
        console.log('[RAG Memory] No relevant playbooks found');
      }

      return { playbooks: allPlaybooks, formattedText: sections.join('\n') };
    } catch (error) {
      console.error('[RAG Memory] Failed to search handbook:', error);
      return { playbooks: [], formattedText: '' };
    }
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
    // Build a natural-language query for ChromaDB vector similarity search.
    // Anti-patterns are indexed with descriptions like:
    //   "Web server found. HTTP directory enumeration needed."
    //   "SSH service found. Port 22 open. Remote shell access."
    // The query must read like natural language to match these embeddings.
    const queryText = this.buildSemanticQuery(context);

    console.log(`[RAG Memory] Query: ${queryText}`);

    // Query playbooks and anti-patterns in parallel (independent collections)
    const [playbooks, antiPatterns] = await Promise.all([
      this.queryPlaybooks(queryText, topK),
      this.queryAntiPatterns(queryText, topK),
    ]);

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
   * Uses the rag_query_playbooks MCP tool which queries the playbooks
   * collection in ChromaDB via semantic similarity search.
   *
   * @param queryText - Query string (semantic, e.g., "lighttpd web server Linux")
   * @param topK - Number of results
   * @returns Array of playbook documents
   */
  private async queryPlaybooks(queryText: string, topK: number): Promise<RAGMemoryDocument[]> {
    try {
      const result = await this.mcpAgent.executeTool({
        tool: 'rag_query_playbooks',
        arguments: {
          query: queryText,
          n_results: topK,
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
   * Uses the rag_recall MCP tool which queries the anti_patterns collection
   * in ChromaDB via semantic similarity search.
   *
   * @param queryText - Query string (semantic, e.g., "HTTP web server lighttpd")
   * @param topK - Number of results
   * @returns Array of anti-pattern documents
   */
  private async queryAntiPatterns(queryText: string, topK: number): Promise<RAGMemoryDocument[]> {
    try {
      const result = await this.mcpAgent.executeTool({
        tool: 'rag_recall',
        arguments: {
          observation: queryText,
          top_k: topK,
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
        // Preserve metadata.type from server if available (e.g., 'session_playbook')
        return recallResult.patterns.map((pattern: any) => ({
          id: pattern.id || `${type}_${Date.now()}`,
          document: pattern.prompt_text || pattern.document || '',
          metadata: {
            type: pattern.metadata?.type || type,
            service: pattern.metadata?.service || 'unknown',
            category: pattern.metadata?.category || 'general',
            tags: pattern.trigger_keywords || pattern.metadata?.tags || '',
            source: pattern.metadata?.source,
            cve: pattern.metadata?.cve,
            exploitation_logic: pattern.metadata?.exploitation_logic,
            vulnerability_context: pattern.metadata?.vulnerability_context,
            is_core_instruction: pattern.metadata?.is_core_instruction,
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

  /**
   * Build a natural-language query from intelligence context.
   *
   * Converts raw service names and profile data into a sentence-like query
   * that matches how anti-patterns are embedded in ChromaDB.
   *
   * Examples:
   *   Input:  services=["http","lighttpd"], profile="Linux"
   *   Output: "Web server found. HTTP service detected. lighttpd web server on Linux target."
   *
   *   Input:  services=["ssh"], profile="Linux OpenSSH"
   *   Output: "SSH service found. Port 22 remote access. Linux OpenSSH target."
   *
   * @param context - Intelligence context with services and profile
   * @returns Natural-language query string for semantic search
   */
  private buildSemanticQuery(context: {
    services?: string[];
    cves?: string[];
    profile?: string;
  }): string {
    const parts: string[] = [];

    if (context.services && context.services.length > 0) {
      // Map service names to natural-language descriptions that match seed embeddings
      const serviceDescriptions: Record<string, string> = {
        http: 'Web server found. HTTP service detected.',
        https: 'HTTPS web server with SSL/TLS.',
        ssh: 'SSH service found. Port 22 open. Remote shell access available.',
        ftp: 'FTP file transfer service found.',
        smb: 'SMB service found. Windows file sharing. CIFS detected.',
        'microsoft-ds': 'SMB service found. Port 445 open. Windows file sharing.',
        mysql: 'MySQL database service found.',
        postgresql: 'PostgreSQL database service found.',
        redis: 'Redis cache service found.',
        smtp: 'SMTP email service found.',
        rdp: 'RDP remote desktop service found. Port 3389 open.',
        telnet: 'Telnet service found. Unencrypted remote access.',
        ldap: 'LDAP directory service found. Active Directory possible.',
        kerberos: 'Kerberos authentication service found. Domain controller possible.',
        domain: 'DNS domain service found.',
        vnc: 'VNC remote desktop service found.',
      };

      for (const svc of context.services) {
        const svcLower = svc.toLowerCase();
        // Check for known descriptions
        const desc = serviceDescriptions[svcLower];
        if (desc) {
          parts.push(desc);
        } else if (svcLower.includes('http') || svcLower.includes('web')) {
          parts.push(`Web server found. ${svc} service detected.`);
        } else if (!svcLower.includes('ssl') && !svcLower.includes('?')) {
          // Skip noise like "ssl/https?" — add product names directly
          parts.push(`${svc} service detected.`);
        }
      }
    }

    if (context.profile) {
      parts.push(`${context.profile} target.`);
    }

    if (parts.length === 0) {
      return 'Network reconnaissance. Initial target discovery. Unknown services.';
    }

    return parts.join(' ');
  }
}
