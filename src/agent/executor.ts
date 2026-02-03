//MCP tool execution

import { NmapMCPClient } from '@cyber/mcp-nmap-client';
//import { GobusterMCPClient } from '../mcp-clients/gobusterClient.js';
//import { SQLMapMCPClient } from '../mcp-clients/sqlmapClient.js';

export interface ToolCall {
  tool: string;
  arguments: any;
}

export interface ToolResult {
  success: boolean;
  output: string;
  error?: string;
}

export class MCPExecutor {
  private nmapClient: NmapMCPClient;
  // private gobusterClient?: GobusterMCPClient;
  // private sqlmapClient?: SQLMapMCPClient;
  
  private serverPaths: Map<string, string> = new Map();

  constructor() {
    this.nmapClient = new NmapMCPClient();
  }

  /**
   * Initialize MCP clients by connecting to servers
   */
  async initialize(config: any): Promise<void> {
    console.log('[MCPExecutor] Initializing MCP clients...');
    
    // Load server paths from config
    if (config.servers.nmap) {
      await this.nmapClient.connect(config.servers.nmap.path);
      console.log('[MCPExecutor] ✓ Nmap server connected');
    }
    
    // Add other servers as needed
    // if (config.servers.gobuster) { ... }
  }

  /**
   * Execute a tool call
   */
  async executeTool(toolCall: ToolCall): Promise<ToolResult> {
    const { tool, arguments: args } = toolCall;
    
    console.log(`[MCPExecutor] Executing: ${tool}`, args);
    
    try {
      // Route to appropriate MCP client
      if (tool.startsWith('nmap_')) {
        return await this.executeNmapTool(tool, args);
      // } else if (tool.startsWith('gobuster_')) {
      //   return await this.executeGobusterTool(tool, args);
      // } else if (tool.startsWith('sqlmap_')) {
      //   return await this.executeSQLMapTool(tool, args);
      } else {
        throw new Error(`Unknown tool: ${tool}`);
      }
    } catch (error: any) {
      console.error(`[MCPExecutor] Error executing ${tool}:`, error);
      return {
        success: false,
        output: '',
        error: error.message,
      };
    }
  }

  /**
   * Execute Nmap tool
   */
  private async executeNmapTool(tool: string, args: any): Promise<ToolResult> {
    let result;
    
    switch (tool) {
      case 'nmap_host_discovery':
        result = await this.nmapClient.hostDiscovery(args.target);
        break;
      case 'nmap_port_scan':
        result = await this.nmapClient.portScan(
          args.target,
          args.ports || 'top-1000',
          args.scanType || 'tcp'
        );
        break;
      case 'nmap_service_detection':
        result = await this.nmapClient.serviceDetection(
          args.target,
          args.ports || 'top-100'
        );
        break;
      default:
        throw new Error(`Unknown Nmap tool: ${tool}`);
    }
    
    return {
      success: result.success,
      output: result.output,
      error: result.error || undefined,
    };
  }

  /**
   * Execute Gobuster tool (placeholder)
   */
//   private async executeGobusterTool(tool: string, args: any): Promise<ToolResult> {
//     // TODO: Implement when gobuster MCP client is ready
//     throw new Error('Gobuster not yet implemented');
//   }

  /**
   * Execute SQLMap tool (placeholder)
   */
//   private async executeSQLMapTool(tool: string, args: any): Promise<ToolResult> {
//     // TODO: Implement when SQLMap MCP client is ready
//     throw new Error('SQLMap not yet implemented');
//   }

  /**
   * Cleanup and disconnect
   */
  async shutdown(): Promise<void> {
    await this.nmapClient.disconnect();
    console.log('[MCPExecutor] All MCP clients disconnected');
  }
}