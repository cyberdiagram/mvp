// Data Cleaner Subagent - Parse and structure raw tool output (haiku)

import Anthropic from '@anthropic-ai/sdk';
import { CleanedData, NmapScanResult } from './types.js';

export const DATA_CLEANER_MODEL = 'claude-3-5-haiku-20241022';
export const DATA_CLEANER_MAX_TOKENS = 2000;

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

export class DataCleanerAgent {
  private client: Anthropic;

  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey });
  }

  async clean(rawOutput: string, toolType: string): Promise<CleanedData> {
    // First try rule-based parsing for known formats
    const ruleBased = this.tryRuleBasedParsing(rawOutput, toolType);
    if (ruleBased) {
      return ruleBased;
    }

    // Fall back to LLM-based parsing
    return this.llmBasedParsing(rawOutput, toolType);
  }

  private tryRuleBasedParsing(rawOutput: string, toolType: string): CleanedData | null {
    if (toolType.startsWith('nmap_')) {
      return this.parseNmapOutput(rawOutput, toolType);
    }
    return null;
  }

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
