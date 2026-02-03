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
import { CleanedData, NmapScanResult } from './types.js';

/** Model used for data parsing - Haiku for speed and cost efficiency */
export const DATA_CLEANER_MODEL = 'claude-3-5-haiku-20241022';

/** Max tokens for DataCleaner responses - parsed data can be lengthy */
export const DATA_CLEANER_MAX_TOKENS = 2000;

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

  /**
   * Creates a new DataCleanerAgent.
   *
   * @param apiKey - Anthropic API key for Claude API calls (for LLM fallback)
   */
  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey });
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
    if (toolType.startsWith('nmap_')) {
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

      return {
        type: toolType === 'nmap_host_discovery' ? 'nmap_hosts' : 'nmap_scan',
        data: {
          hosts,
          scan_type: 'tcp',
          target: hosts[0]?.ip || 'unknown',
          timestamp: new Date().toISOString(),
        },
        summary: `Found ${hosts.length} host(s) with ${openPorts} open port(s)`,
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
    const response = await this.client.messages.create({
      model: DATA_CLEANER_MODEL,
      max_tokens: DATA_CLEANER_MAX_TOKENS,
      system: DATA_CLEANER_SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: `Parse this ${toolType} output into structured JSON:\n\n${rawOutput}`,
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
