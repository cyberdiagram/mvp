/**
 * VulnLookup Agent - Vulnerability and exploit research.
 *
 * Performs vulnerability research via the SearchSploit MCP Server,
 * which provides offline-capable access to the local ExploitDB database.
 *
 * Features:
 * - Offline-capable: No external API calls, uses local ExploitDB
 * - No rate limits: Local CLI tool, unlimited queries
 * - PoC access: Can examine full exploit code via searchsploit_examine
 * - OS/platform-aware filtering
 * - Severity inference from exploit type and platform
 */

import { DiscoveredService, TargetProfile, VulnerabilityInfo } from '../core/types.js';
import { MCPAgent } from '../execution/mcp-agent.js';

/**
 * SearchSploit search result from MCP server.
 *
 * Returned by the searchsploit_search tool.
 */
interface SearchSploitResult {
  /** Whether the search succeeded */
  success: boolean;
  /** Search query that was executed */
  search: string;
  /** Human-readable summary of results */
  summary: string;
  /** Array of exploit results */
  exploits: SearchSploitExploit[];
  /** Array of shellcode results */
  shellcodes: SearchSploitExploit[];
  /** Array of paper results */
  papers: SearchSploitExploit[];
  /** Command that was executed */
  command: string;
  /** Error message if search failed */
  error?: string;
}

/**
 * Individual exploit from SearchSploit.
 *
 * Represents one entry in the ExploitDB database.
 */
interface SearchSploitExploit {
  /** Exploit title/description */
  Title: string;
  /** ExploitDB ID (e.g., "50383") */
  'EDB-ID': string;
  /** Publication date */
  Date_Published: string;
  /** Exploit author */
  Author: string;
  /** Type (remote, local, webapps, dos, shellcode) */
  Type: string;
  /** Target platform (linux, windows, multiple, etc.) */
  Platform: string;
  /** Associated port if applicable */
  Port: string;
  /** Verification status (0 or 1) */
  Verified: string;
  /** CVE codes, comma-separated (e.g., "CVE-2021-41773,CVE-2021-42013") */
  Codes: string;
  /** Local file path to exploit */
  Path: string;
}

/**
 * VulnLookupAgent performs vulnerability research via the SearchSploit MCP Server.
 *
 * Data Source:
 * - SearchSploit MCP Server (pentest-mcp-server/searchsploit-server-ts)
 *   → wraps the searchsploit CLI → queries local ExploitDB database
 *
 * Features:
 * - Offline-capable: No external API calls, uses local ExploitDB database
 * - No rate limits: Local CLI tool, unlimited queries
 * - PoC access: Can examine full exploit code via searchsploit_examine
 * - OS/platform-aware filtering
 * - Severity inference from exploit type and platform
 *
 * Connection Flow:
 *   VulnLookupAgent → MCPAgent → SearchSploit MCP Server → searchsploit CLI → ExploitDB (local)
 *
 * Note: This is NOT the RAG memory system. This agent performs exploit lookups.
 * For learned anti-patterns from past sessions, see the RAG Memory System (Phase 4b).
 */
export class VulnLookupAgent {
  /** Shared MCP agent for tool execution */
  private mcpAgent: MCPAgent;

  /**
   * Creates a new VulnLookupAgent.
   *
   * @param mcpAgent - Shared MCPAgent instance for executing SearchSploit tools
   */
  constructor(mcpAgent: MCPAgent) {
    this.mcpAgent = mcpAgent;
  }

  /**
   * Find vulnerabilities for discovered services using SearchSploit MCP.
   *
   * Searches the local ExploitDB database for exploits matching the
   * discovered services (by product name and version). Results are
   * filtered by platform if a target profile is provided.
   *
   * @param services - Services to research
   * @param profile - Optional target profile for OS/platform filtering
   * @returns Array of vulnerabilities sorted by severity (critical/high first)
   *
   * @example
   * const vulns = await vulnLookup.findVulnerabilities(services, profile);
   * // Returns: [{ cve_id: "CVE-2021-41773", severity: "critical", ... }]
   */
  async findVulnerabilities(
    services: DiscoveredService[],
    profile?: TargetProfile
  ): Promise<VulnerabilityInfo[]> {
    const allVulnerabilities: VulnerabilityInfo[] = [];

    for (const service of services) {
      // Skip if no product info (can't search without product name)
      if (!service.product) {
        console.debug(`[VulnLookup] Skipping ${service.service} - no product info`);
        continue;
      }

      // Build search query: "product version" (e.g., "apache 2.4.49")
      const query = service.version ? `${service.product} ${service.version}` : service.product;

      console.debug(`[VulnLookup] Searching SearchSploit for: ${query}`);

      try {
        // Call searchsploit_search via MCP
        const result = await this.mcpAgent.executeTool({
          tool: 'searchsploit_search',
          arguments: {
            query,
            exclude: ['dos', 'Denial of Service'], // Skip DoS by default
          },
          description: `Search exploits for ${query}`,
        });

        if (result.success && result.output) {
          const searchResult: SearchSploitResult = JSON.parse(result.output);

          if (searchResult.success) {
            // Transform SearchSploit results to VulnerabilityInfo
            const vulns = this.transformResults(searchResult, service);

            // Filter by OS/platform if profile available
            const filtered = profile
              ? this.filterByPlatform(vulns, profile.os_family)
              : vulns;

            allVulnerabilities.push(...filtered);

            console.debug(
              `[VulnLookup] Found ${searchResult.exploits.length} exploits, ` +
                `${searchResult.shellcodes.length} shellcodes for ${query}`
            );
          }
        }
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`[VulnLookup] SearchSploit query failed for ${query}: ${message}`);
      }
    }

    // Sort by severity (critical/high first)
    return allVulnerabilities.sort((a, b) => {
      const severityOrder: Record<string, number> = {
        critical: 0,
        high: 1,
        medium: 2,
        low: 3,
      };
      return (severityOrder[a.severity] || 4) - (severityOrder[b.severity] || 4);
    });
  }

  /**
   * Examine a specific exploit by EDB-ID to get full details and code.
   *
   * Calls searchsploit_examine via MCP to retrieve the full exploit
   * code and details from the local ExploitDB database.
   *
   * @param edbId - ExploitDB ID (e.g., "50383")
   * @returns Exploit code/details or null if not found
   *
   * @example
   * const code = await vulnLookup.examineExploit("50383");
   * // Returns: Full exploit code as string
   */
  async examineExploit(edbId: string): Promise<string | null> {
    try {
      const result = await this.mcpAgent.executeTool({
        tool: 'searchsploit_examine',
        arguments: { edbId },
        description: `Examine exploit EDB-${edbId}`,
      });

      if (result.success && result.output) {
        const examineResult = JSON.parse(result.output);
        return examineResult.output || null;
      }
      return null;
    } catch {
      return null;
    }
  }

  /**
   * Get local file path for an exploit by EDB-ID.
   *
   * Calls searchsploit_path via MCP to get the filesystem path
   * to the exploit file in the local ExploitDB directory.
   *
   * @param edbId - ExploitDB ID (e.g., "50383")
   * @returns Local file path or null if not found
   *
   * @example
   * const path = await vulnLookup.getExploitPath("50383");
   * // Returns: "/usr/share/exploitdb/exploits/linux/webapps/50383.py"
   */
  async getExploitPath(edbId: string): Promise<string | null> {
    try {
      const result = await this.mcpAgent.executeTool({
        tool: 'searchsploit_path',
        arguments: { edbId },
        description: `Get path for exploit EDB-${edbId}`,
      });

      if (result.success && result.output) {
        const pathResult = JSON.parse(result.output);
        return pathResult.path || null;
      }
      return null;
    } catch {
      return null;
    }
  }

  /**
   * Transform SearchSploit results into VulnerabilityInfo format.
   *
   * Converts SearchSploit exploit entries to the standardized
   * VulnerabilityInfo structure with CVE extraction and severity inference.
   *
   * @param searchResult - Raw SearchSploit search result
   * @param service - Service being researched (for affected_service field)
   * @returns Array of VulnerabilityInfo objects
   */
  private transformResults(
    searchResult: SearchSploitResult,
    service: DiscoveredService
  ): VulnerabilityInfo[] {
    const vulns: VulnerabilityInfo[] = [];

    for (const exploit of searchResult.exploits) {
      // Extract CVE IDs from the Codes field (e.g., "CVE-2021-41773;CVE-2021-42013")
      const cveIds = this.extractCVEs(exploit.Codes);

      // Infer severity from exploit type
      const severity = this.inferSeverity(exploit.Type, exploit.Verified);

      if (cveIds.length > 0) {
        // Create one entry per CVE
        for (const cveId of cveIds) {
          vulns.push({
            cve_id: cveId,
            severity,
            description: exploit.Title,
            affected_service: `${service.product} ${service.version || ''}`.trim(),
            poc_available: true, // SearchSploit entries ARE PoCs
            poc_url: exploit.Path,
            exploitdb_id: exploit['EDB-ID'],
          });
        }
      } else {
        // No CVE — still valuable as an exploit finding
        vulns.push({
          cve_id: `EDB-${exploit['EDB-ID']}`,
          severity,
          description: exploit.Title,
          affected_service: `${service.product} ${service.version || ''}`.trim(),
          poc_available: true,
          poc_url: exploit.Path,
          exploitdb_id: exploit['EDB-ID'],
        });
      }
    }

    return vulns;
  }

  /**
   * Extract CVE IDs from SearchSploit Codes field.
   *
   * Parses the Codes field which may contain CVE IDs, OSVDB IDs, or be empty.
   *
   * @param codes - Codes field from SearchSploit (e.g., "CVE-2021-41773;CVE-2021-42013")
   * @returns Array of CVE IDs
   *
   * @example
   * extractCVEs("CVE-2021-41773;CVE-2021-42013") // ["CVE-2021-41773", "CVE-2021-42013"]
   * extractCVEs("OSVDB-12345") // []
   * extractCVEs("") // []
   */
  private extractCVEs(codes: string): string[] {
    if (!codes) return [];
    const matches = codes.match(/CVE-\d{4}-\d+/g);
    return matches || [];
  }

  /**
   * Infer severity from exploit type.
   *
   * Maps SearchSploit exploit types to severity levels:
   * - remote + verified → critical
   * - remote → high
   * - webapps + verified → high
   * - webapps → medium
   * - shellcode → high
   * - local → medium
   *
   * @param type - SearchSploit type (remote, local, webapps, dos, shellcode)
   * @param verified - Verification status ("0" or "1")
   * @returns Severity level (critical, high, medium, low)
   */
  private inferSeverity(type: string, verified: string): string {
    const isVerified = verified === '1';

    switch (type.toLowerCase()) {
      case 'remote':
        return isVerified ? 'critical' : 'high';
      case 'webapps':
        return isVerified ? 'high' : 'medium';
      case 'local':
        return 'medium';
      case 'shellcode':
        return 'high';
      default:
        return 'medium';
    }
  }

  /**
   * Filter vulnerabilities by target OS/platform.
   *
   * Removes obviously mismatched exploits (e.g., Windows exploits for Linux targets).
   * Uses simple heuristics based on description text.
   *
   * @param vulns - Array of vulnerabilities to filter
   * @param osFamily - Target OS family (Linux, Windows, BSD, etc.)
   * @returns Filtered array of vulnerabilities
   */
  private filterByPlatform(vulns: VulnerabilityInfo[], osFamily?: string): VulnerabilityInfo[] {
    if (!osFamily) return vulns;

    const os = osFamily.toLowerCase();

    return vulns.filter((vuln) => {
      const desc = vuln.description.toLowerCase();

      // Basic heuristic: skip obviously wrong platform
      if (os.includes('linux') && desc.includes('windows') && !desc.includes('linux')) {
        return false;
      }
      if (os.includes('windows') && desc.includes('linux') && !desc.includes('windows')) {
        return false;
      }

      return true;
    });
  }

}
