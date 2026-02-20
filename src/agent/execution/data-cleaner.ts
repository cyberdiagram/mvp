/**
 * Data Cleaner Subagent - Parses and structures raw tool output.
 *
 * Converts messy, unstructured tool output (like Nmap scan results)
 * into clean, structured JSON that the Reasoner can easily analyze.
 *
 * Uses a two-tier approach:
 * 1. Rule-based parsing for known formats (fast, reliable)
 * 2. LLM-based parsing (Claude Haiku) as fallback for complex output
 */

import Anthropic from '@anthropic-ai/sdk';
import { CleanedData, NmapScanResult, DiscoveredService, NmapPortResult } from '../core/types.js';

/** Model used for data parsing - Haiku for speed and cost efficiency */
export const DATA_CLEANER_MODEL = 'claude-haiku-4-5-20251001';

/** Max tokens for DataCleaner responses - parsed data can be lengthy */
export const DATA_CLEANER_MAX_TOKENS = 2000;

/**
 * Max characters of raw output to send to the LLM.
 * Prevents exceeding the 200k token context window.
 * 80k chars ≈ ~20k tokens, leaving ample room for system prompt + response.
 */
export const MAX_RAW_OUTPUT_CHARS = 80_000;

/**
 * System prompt that defines the DataCleaner's role and output format.
 *
 * Instructs the model to:
 * - Parse various security tool outputs (Nmap, Gobuster, etc.)
 * - Extract key information (IPs, ports, services, versions)
 * - Return structured JSON with type, data, and summary fields
 * - Handle unknown formats gracefully
 */
export const DATA_CLEANER_SYSTEM_PROMPT = `You are a data parsing specialist. Your job is to:
1. Parse raw security tool output (nmap, gobuster, sqlmap, etc.)
2. Extract key information
3. Return clean, structured JSON

# Response Format

Always respond with valid JSON:
{
  "type": "nmap_scan" | "nmap_hosts" | "nmap_services" | "gobuster" | "unknown",
  "data": { ... structured data ... },
  "summary": "Brief human-readable summary"
}

# Nmap Host Discovery Output Format
{
  "type": "nmap_hosts",
  "data": {
    "hosts": [
      { "ip": "192.168.1.1", "status": "up", "hostname": "optional" }
    ],
    "total_up": 5,
    "total_down": 250
  },
  "summary": "5 hosts up out of 255 scanned"
}

# Nmap Port Scan Output Format
{
  "type": "nmap_scan",
  "data": {
    "hosts": [
      {
        "ip": "192.168.1.1",
        "status": "up",
        "ports": [
          { "port": 22, "state": "open", "protocol": "tcp", "service": "ssh", "version": "OpenSSH 8.2" }
        ]
      }
    ],
    "scan_type": "tcp",
    "target": "192.168.1.1"
  },
  "summary": "Found 3 open ports on 192.168.1.1"
}

# Guidelines
- Extract ALL relevant information (IPs, ports, services, versions)
- Normalize data formats
- Remove noise (banners, ASCII art, progress indicators)
- If parsing fails, return type "unknown" with raw data in a "raw" field`;

/**
 * DataCleanerAgent - Transforms raw tool output into structured data.
 *
 * Essential for the agent loop: converts messy tool output into clean
 * JSON that the Reasoner can understand. This enables the AI to make
 * informed decisions based on scan results.
 *
 * Uses Claude Haiku for fast, cost-effective parsing when rule-based
 * parsing isn't sufficient.
 */
export class DataCleanerAgent {
  /** Anthropic API client */
  private client: Anthropic;

  /** Injected skill context for advanced fingerprinting (e.g., pfSense, WebLogic) */
  private skillContext: string = '';

  /**
   * Creates a new DataCleanerAgent.
   *
   * @param apiKey - Anthropic API key for Claude API calls (for LLM fallback)
   */
  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey });
  }

  /**
   * Sets skill context for enhanced parsing and fingerprinting.
   *
   * Injected skill content is appended to the LLM system prompt during
   * llmBasedParsing, enabling the model to identify specific technologies
   * (e.g., pfSense from lighttpd headers, WebLogic from t3 protocol)
   * that rule-based parsing cannot detect.
   *
   * @param context - Formatted skill content from SkillManager.buildSkillContext()
   */
  public setSkillContext(context: string): void {
    this.skillContext = context;
  }

  /**
   * Cleans and structures raw tool output.
   *
   * Main entry point for data cleaning. First attempts rule-based parsing
   * for known formats (faster, cheaper), then falls back to LLM parsing
   * for complex or unknown formats.
   *
   * @param rawOutput - Raw text output from the security tool
   * @param toolType - Type of tool that produced the output (e.g., "nmap_port_scan")
   * @returns Structured CleanedData with type, data, and summary
   *
   * @example
   * const cleaned = await cleaner.clean(nmapOutput, 'nmap_port_scan');
   * // Returns: { type: "nmap_scan", data: { hosts: [...] }, summary: "Found 3 open ports" }
   */
  async clean(rawOutput: string, toolType: string): Promise<CleanedData> {
    // First try rule-based parsing for known formats
    const ruleBased = this.tryRuleBasedParsing(rawOutput, toolType);
    if (ruleBased) {
      // Two-pass enrichment: if nmap output contains NSE script lines and a skill is loaded,
      // run a targeted LLM call to identify specific products (pfSense, FortiGate, etc.)
      // that the regex parser cannot detect from NSE output.
      const isNmapOutput = toolType.startsWith('nmap_') || rawOutput.includes('Nmap scan report for');
      if (isNmapOutput && this.skillContext && this.hasNSELines(rawOutput)) {
        return this.enrichNmapServicesWithSkill(ruleBased, rawOutput);
      }
      return ruleBased;
    }

    // Fall back to LLM-based parsing
    return this.llmBasedParsing(rawOutput, toolType);
  }

  /**
   * Attempts to parse output using predefined rules (no LLM call).
   *
   * Faster and cheaper than LLM parsing. Returns null if the format
   * isn't recognized, triggering fallback to LLM parsing.
   *
   * @param rawOutput - Raw text output from the tool
   * @param toolType - Type of tool (determines which parser to use)
   * @returns CleanedData if parsing succeeds, null otherwise
   */
  private tryRuleBasedParsing(rawOutput: string, toolType: string): CleanedData | null {
    // RAG tools return semantic playbook content, not tool output — pass through as-is.
    // Never send RAG output to LLM parsing: it's already structured and can be enormous.
    if (toolType.startsWith('rag_')) {
      return {
        type: 'unknown',
        data: { raw: rawOutput },
        summary: `RAG result (${toolType})`,
      };
    }

    // Route to nmap parser when the tool is a named nmap tool OR when nmap output
    // is detected inside execute_shell_cmd output (the common case in this system).
    const isNmapOutput = toolType.startsWith('nmap_') || rawOutput.includes('Nmap scan report for');
    if (isNmapOutput) {
      return this.parseNmapOutput(rawOutput, toolType);
    }
    return null;
  }

  /**
   * Parses Nmap output using regex patterns.
   *
   * Extracts:
   * - Host information from "Nmap scan report for X" lines
   * - Host status from "Host is up/down" lines
   * - Port details from "22/tcp open ssh" format lines
   *
   * @param rawOutput - Raw Nmap output text
   * @param toolType - Specific Nmap tool type (affects result type)
   * @returns CleanedData with structured scan results, null if parsing fails
   */
  private parseNmapOutput(rawOutput: string, toolType: string): CleanedData | null {
    try {
      const lines = rawOutput.split('\n');
      const hosts: NmapScanResult['hosts'] = [];
      let currentHost: NmapScanResult['hosts'][0] | null = null;

      for (const line of lines) {
        // Match host discovery: "Nmap scan report for 192.168.1.1"
        const hostMatch = line.match(/Nmap scan report for (\S+)/);
        if (hostMatch) {
          if (currentHost) {
            hosts.push(currentHost);
          }
          currentHost = {
            ip: hostMatch[1],
            status: 'up',
            ports: [],
          };
          continue;
        }

        // Match host status: "Host is up"
        const statusMatch = line.match(/Host is (up|down)/);
        if (statusMatch && currentHost) {
          currentHost.status = statusMatch[1];
          continue;
        }

        // Match port line: "22/tcp   open  ssh     OpenSSH 8.2p1"
        const portMatch = line.match(
          /^(\d+)\/(tcp|udp)\s+(open|closed|filtered)\s+(\S+)(?:\s+(.*))?/
        );
        if (portMatch && currentHost) {
          currentHost.ports = currentHost.ports || [];
          currentHost.ports.push({
            port: parseInt(portMatch[1]),
            state: portMatch[3] as 'open' | 'closed' | 'filtered',
            protocol: portMatch[2],
            service: portMatch[4],
            version: portMatch[5]?.trim(),
          });
        }
      }

      // Don't forget the last host
      if (currentHost) {
        hosts.push(currentHost);
      }

      if (hosts.length === 0) {
        return null; // Fall back to LLM
      }

      const openPorts = hosts.reduce(
        (sum, h) => sum + (h.ports?.filter((p) => p.state === 'open').length || 0),
        0
      );

      // Transform to DiscoveredService format for intelligence layer
      const discoveredServices = this.transformToDiscoveredServices(hosts);

      return {
        type: toolType === 'nmap_host_discovery' ? 'nmap_hosts' : 'nmap_scan',
        data: discoveredServices.length > 0 ? discoveredServices : {
          hosts,
          scan_type: 'tcp',
          target: hosts[0]?.ip || 'unknown',
          timestamp: new Date().toISOString(),
        },
        summary: `Found ${hosts.length} host(s) with ${openPorts} open port(s)${
          discoveredServices.length > 0
            ? ` (${discoveredServices.length} services identified)`
            : ''
        }`,
      };
    } catch {
      return null;
    }
  }

  /**
   * Parses output using Claude Haiku as a fallback.
   *
   * Called when rule-based parsing fails. Sends the raw output to Claude
   * with instructions to extract structured data. More flexible but slower
   * and costs API tokens.
   *
   * @param rawOutput - Raw text output that rule-based parsing couldn't handle
   * @param toolType - Type of tool (included in prompt for context)
   * @returns CleanedData parsed by the LLM
   */
  private async llmBasedParsing(rawOutput: string, toolType: string): Promise<CleanedData> {
    // Truncate oversized raw output to prevent exceeding the 200k token context window.
    // rawOutput from tools like rag_query_playbooks can be enormous (200k+ tokens).
    let truncatedOutput = rawOutput;
    if (rawOutput.length > MAX_RAW_OUTPUT_CHARS) {
      truncatedOutput = rawOutput.slice(0, MAX_RAW_OUTPUT_CHARS);
      console.warn(
        `[Data Cleaner] ⚠ rawOutput truncated: ${rawOutput.length} chars → ${MAX_RAW_OUTPUT_CHARS} chars` +
          ` (~${Math.round(rawOutput.length / 4)} → ~${Math.round(MAX_RAW_OUTPUT_CHARS / 4)} tokens)`
      );
    }

    // Build system prompt: static base + optional skill context for advanced fingerprinting
    const systemPrompt = this.skillContext
      ? `${DATA_CLEANER_SYSTEM_PROMPT}\n\n# ADDITIONAL PARSING SKILLS & FINGERPRINTS\n${this.skillContext}\n\nRemember: Use the provided skills to identify specific technologies (like pfSense, CMS, or Middleware) hidden in the raw output.`
      : DATA_CLEANER_SYSTEM_PROMPT;

    // Diagnostic logging: show estimated token sizes before the API call
    const estSystemTokens = Math.round(systemPrompt.length / 4);
    const estUserTokens = Math.round((`Parse this ${toolType} output into structured JSON:\n\n${truncatedOutput}`).length / 4);
    console.log(
      `[Data Cleaner] Prompt sizes — system: ~${estSystemTokens} tokens, user: ~${estUserTokens} tokens, total: ~${estSystemTokens + estUserTokens} tokens`
    );

    const response = await this.client.messages.create({
      model: DATA_CLEANER_MODEL,
      max_tokens: DATA_CLEANER_MAX_TOKENS,
      system: [
        {
          type: 'text',
          text: systemPrompt,
          cache_control: { type: 'ephemeral' },
        },
      ],
      messages: [
        {
          role: 'user',
          content: `Parse this ${toolType} output into structured JSON:\n\n${truncatedOutput}`,
        },
      ],
    });

    const text = response.content[0];
    if (text.type !== 'text') {
      throw new Error('Expected text response from DataCleaner');
    }

    return this.parseCleanedResponse(text.text, rawOutput);
  }

  /**
   * Returns true if the nmap raw output contains NSE script lines.
   *
   * NSE script lines begin with "| " (pipe-space) for normal output
   * or "|_" (pipe-underscore) for the last line of a script block.
   *
   * @param rawOutput - Raw nmap output text
   */
  private hasNSELines(rawOutput: string): boolean {
    return /^\|[ _]/m.test(rawOutput);
  }

  /**
   * Second-pass LLM enrichment for nmap results that contain NSE script output.
   *
   * Called after the regex parser has already extracted the DiscoveredService[] structure.
   * Sends only the NSE lines + current service list to Claude Haiku with the fingerprint
   * skill context. The LLM returns a sparse list of overrides (only changed services),
   * which are merged back into the base result.
   *
   * Fails gracefully: any error returns the unmodified base result.
   *
   * @param baseResult - Already-parsed CleanedData from parseNmapOutput
   * @param rawOutput  - Full raw nmap output (used to extract NSE lines)
   */
  private async enrichNmapServicesWithSkill(
    baseResult: CleanedData,
    rawOutput: string
  ): Promise<CleanedData> {
    if (!Array.isArray(baseResult.data)) {
      return baseResult;
    }

    const services = baseResult.data as DiscoveredService[];

    // Extract only NSE script lines (start with "| " or "|_")
    const nseLines = rawOutput
      .split('\n')
      .filter((line) => /^\|/.test(line))
      .join('\n');

    // Brief summary of what the regex parser already found
    const serviceSummary = services
      .map((s) => `${s.host}:${s.port} (${s.service}) product=${s.product || 'unknown'}`)
      .join('\n');

    const userPrompt =
      `You are enriching already-parsed nmap service data.\n\n` +
      `Current services (regex-parsed):\n${serviceSummary}\n\n` +
      `NSE script output from the same scan:\n${nseLines}\n\n` +
      `Using the fingerprinting skills in your system prompt, identify services that should be ` +
      `updated with a more specific product, category, or criticality.\n\n` +
      `Return a JSON array of ONLY the services that need updating:\n` +
      `[{ "host": "x.x.x.x", "port": 443, "product": "pfSense Firewall", ` +
      `"category": "network-device", "criticality": "high", "confidence": 0.9 }]\n\n` +
      `If no services need updating, return an empty array: []`;

    try {
      const response = await this.client.messages.create({
        model: DATA_CLEANER_MODEL,
        max_tokens: 800,
        system: `You are a fingerprinting specialist. Apply the following skills to identify specific products from NSE script output.\n\n${this.skillContext}`,
        messages: [{ role: 'user', content: userPrompt }],
      });

      const text = response.content[0];
      if (text.type !== 'text') return baseResult;

      const jsonMatch = text.text.match(/\[[\s\S]*\]/);
      if (!jsonMatch) return baseResult;

      const updates = JSON.parse(jsonMatch[0]) as Array<{
        host: string;
        port: number;
        product?: string;
        category?: string;
        criticality?: string;
        confidence?: number;
      }>;

      if (updates.length === 0) return baseResult;

      // Merge overrides by host:port key
      const updatedServices = services.map((svc) => {
        const update = updates.find((u) => u.host === svc.host && u.port === svc.port);
        if (!update) return svc;
        return {
          ...svc,
          product: update.product ?? svc.product,
          category: update.category ?? svc.category,
          criticality: update.criticality ?? svc.criticality,
          confidence: update.confidence ?? svc.confidence,
        };
      });

      console.log(`[Data Cleaner] ✓ NSE enrichment: ${updates.length} service(s) updated via skill`);
      updates.forEach((u) => {
        console.log(`[Data Cleaner]   ${u.host}:${u.port} → product=${u.product}, category=${u.category}`);
      });

      return {
        ...baseResult,
        data: updatedServices,
        summary:
          baseResult.summary +
          ` [enriched: ${updates.map((u) => u.product).join(', ')}]`,
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[Data Cleaner] NSE enrichment failed, using base result: ${message}`);
      return baseResult;
    }
  }

  /**
   * Categorizes a service into a logical category.
   *
   * Maps service names to categories like web, database, remote-access, etc.
   * Used for intelligence layer analysis and criticality assessment.
   *
   * @param serviceName - Service name (e.g., "http", "mysql", "ssh")
   * @returns Category string (web, database, remote-access, file-sharing, email, domain, other)
   */
  private categorizeService(serviceName: string): string {
    const categories: Record<string, string[]> = {
      web: ['http', 'https', 'apache', 'nginx', 'iis', 'tomcat', 'lighttpd'],
      database: ['mysql', 'postgresql', 'mongodb', 'redis', 'mssql', 'oracle', 'mariadb'],
      'remote-access': ['ssh', 'rdp', 'telnet', 'vnc', 'teamviewer'],
      'file-sharing': ['smb', 'ftp', 'nfs', 'sftp', 'samba'],
      email: ['smtp', 'imap', 'pop3', 'exchange'],
      domain: ['ldap', 'kerberos', 'domain', 'active-directory'],
    };

    const lowerService = serviceName.toLowerCase();
    for (const [category, services] of Object.entries(categories)) {
      if (services.some((s) => lowerService.includes(s))) {
        return category;
      }
    }
    return 'other';
  }

  /**
   * Calculates confidence score for service detection.
   *
   * Higher scores indicate more reliable detection:
   * - Base: 0.5 (port is open)
   * - +0.3 if version detected
   * - +0.2 if service identified
   *
   * @param port - Nmap port result with service information
   * @returns Confidence score (0-1)
   */
  private calculateConfidence(port: NmapPortResult): number {
    let score = 0.5; // baseline for open port detection
    if (port.version) score += 0.3; // version detected
    if (port.service) score += 0.2; // service identified
    return Math.min(score, 1.0);
  }

  /**
   * Assesses criticality level of a service.
   *
   * Criticality is based on service category and well-known risky ports:
   * - High: databases, remote access, domain controllers, risky ports
   * - Medium: web services
   * - Low: other services
   *
   * @param category - Service category from categorizeService()
   * @param port - Port number
   * @returns Criticality level (high, medium, low)
   */
  private assessCriticality(category: string, port: number): string {
    // High criticality services
    if (['database', 'remote-access', 'domain'].includes(category)) return 'high';

    // Well-known high-risk ports
    if ([22, 23, 3389, 445, 3306, 5432, 1433, 389].includes(port)) return 'high';

    // Web services are medium
    if (category === 'web') return 'medium';

    return 'low';
  }

  /**
   * Transforms Nmap scan results to DiscoveredService format.
   *
   * Enriches raw port scan data with categorization, confidence scores,
   * and criticality assessment for intelligence layer analysis.
   *
   * @param hosts - Array of hosts with port information from Nmap
   * @returns Array of DiscoveredService with enriched metadata
   */
  private transformToDiscoveredServices(
    hosts: Array<{ ip: string; ports?: NmapPortResult[] }>
  ): DiscoveredService[] {
    const services: DiscoveredService[] = [];

    for (const host of hosts) {
      if (!host.ports) continue;

      for (const port of host.ports) {
        if (port.state !== 'open') continue;

        const category = this.categorizeService(port.service || '');

        services.push({
          host: host.ip,
          port: port.port,
          protocol: port.protocol,
          service: port.service || 'unknown',
          product: this.extractProduct(port.version),
          version: this.extractVersion(port.version),
          banner: port.version,
          category,
          criticality: this.assessCriticality(category, port.port),
          confidence: this.calculateConfidence(port),
        });
      }
    }

    return services;
  }

  /**
   * Extracts product name from service banner.
   *
   * Example: "Apache httpd 2.4.41" → "Apache"
   *
   * @param banner - Service banner string
   * @returns Product name or undefined
   */
  private extractProduct(banner?: string): string | undefined {
    if (!banner) return undefined;
    // Extract product name before version number
    const match = banner.match(/^([A-Za-z0-9\-_]+)/);
    return match ? match[1] : undefined;
  }

  /**
   * Extracts version number from service banner.
   *
   * Example: "Apache httpd 2.4.41" → "2.4.41"
   *
   * @param banner - Service banner string
   * @returns Version string or undefined
   */
  private extractVersion(banner?: string): string | undefined {
    if (!banner) return undefined;
    // Extract version numbers (e.g., "2.4.41", "8.0.23")
    const match = banner.match(/(\d+\.[\d.]+)/);
    return match ? match[1] : undefined;
  }

  /**
   * Parses the LLM's response into a CleanedData object.
   *
   * Extracts JSON from the response text. If parsing fails, returns
   * an "unknown" type with the raw output preserved.
   *
   * @param text - Raw text response from Claude
   * @param rawOutput - Original raw output (used as fallback if parsing fails)
   * @returns CleanedData with parsed or fallback data
   */
  private parseCleanedResponse(text: string, rawOutput: string): CleanedData {
    const jsonMatch = text.match(/\{[\s\S]*\}/);

    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[0]);
        return {
          type: parsed.type || 'unknown',
          data: parsed.data || {},
          summary: parsed.summary || 'Data cleaned',
        };
      } catch {
        // Fallback
      }
    }

    // If parsing fails, return raw data
    return {
      type: 'unknown',
      data: { raw: rawOutput },
      summary: 'Could not parse output',
    };
  }
}
