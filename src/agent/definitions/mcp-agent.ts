// MCP Agent - Tool execution subagent (haiku)

import { NmapMCPClient } from '@cyber/mcp-nmap-client';
import { ToolResult, ExecutorStep } from './types.js';

export class MCPAgent {
  private nmapClient: NmapMCPClient;
  private isInitialized: boolean = false;

  constructor() {
    this.nmapClient = new NmapMCPClient();
  }

  async initialize(config: { servers: { nmap?: { path: string } } }): Promise<void> {
    if (config.servers.nmap) {
      await this.nmapClient.connect(config.servers.nmap.path);
      console.log('[MCPAgent] Nmap server connected');
    }
    this.isInitialized = true;
  }

  async executeTool(step: ExecutorStep): Promise<ToolResult> {
    if (!this.isInitialized) {
      return {
        success: false,
        output: '',
        error: 'MCP Agent not initialized',
      };
    }

    const { tool, arguments: args } = step;
    console.log(`[MCPAgent] Executing: ${tool}`);

    try {
      if (tool.startsWith('nmap_')) {
        return await this.executeNmapTool(tool, args);
      } else {
        return {
          success: false,
          output: '',
          error: `Unknown tool: ${tool}`,
        };
      }
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`[MCPAgent] Error executing ${tool}:`, errorMessage);
      return {
        success: false,
        output: '',
        error: errorMessage,
      };
    }
  }

  private async executeNmapTool(
    tool: string,
    args: Record<string, unknown>
  ): Promise<ToolResult> {
    let result;

    switch (tool) {
      case 'nmap_host_discovery':
        result = await this.nmapClient.hostDiscovery(args.target as string);
        break;

      case 'nmap_port_scan': {
        const scanType = (args.scanType as string) || 'tcp';
        const validScanTypes = ['tcp', 'udp', 'syn'] as const;
        const resolvedScanType = validScanTypes.includes(scanType as typeof validScanTypes[number])
          ? (scanType as 'tcp' | 'udp' | 'syn')
          : 'tcp';
        result = await this.nmapClient.portScan(
          args.target as string,
          (args.ports as string) || 'top-1000',
          resolvedScanType
        );
        break;
      }

      case 'nmap_service_detection':
        result = await this.nmapClient.serviceDetection(
          args.target as string,
          (args.ports as string) || 'top-100'
        );
        break;

      default:
        return {
          success: false,
          output: '',
          error: `Unknown Nmap tool: ${tool}`,
        };
    }

    return {
      success: result.success,
      output: result.output,
      error: result.error || undefined,
    };
  }

  async shutdown(): Promise<void> {
    if (this.isInitialized) {
      await this.nmapClient.disconnect();
      console.log('[MCPAgent] Disconnected');
    }
  }
}
