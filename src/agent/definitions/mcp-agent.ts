/**
 * MCP Agent - Tool execution layer.
 *
 * Connects to MCP (Model Context Protocol) servers and executes security tools.
 * Currently supports Nmap for network reconnaissance. Routes tool calls from
 * the Executor to the appropriate MCP client.
 *
 * MCP is a protocol that allows AI agents to safely interact with external tools.
 */

import { NmapMCPClient } from '@cyber/mcp-nmap-client';
import { ToolResult, ExecutorStep } from './types.js';

/**
 * MCPAgent - Routes tool execution to MCP servers.
 *
 * Acts as a bridge between the Executor's planned steps and actual
 * security tool execution. Manages connections to MCP servers and
 * handles tool-specific argument mapping.
 *
 * Supported tools:
 * - nmap_host_discovery: Find live hosts on a network
 * - nmap_port_scan: Scan ports on a target
 * - nmap_service_detection: Detect services and versions
 */
export class MCPAgent {
  /** Client for Nmap MCP server */
  private nmapClient: NmapMCPClient;
  /** Whether the agent has been initialized */
  private isInitialized: boolean = false;

  /**
   * Creates a new MCPAgent.
   *
   * Does not connect to servers - call initialize() first.
   */
  constructor() {
    this.nmapClient = new NmapMCPClient();
  }

  /**
   * Initializes connections to MCP servers.
   *
   * Connects to each configured server (currently just Nmap).
   * Must be called before executeTool().
   *
   * @param config - Server configuration with paths to MCP server executables
   *
   * @example
   * await mcpAgent.initialize({
   *   servers: { nmap: { path: './nmap-server/dist/index.js' } }
   * });
   */
  async initialize(config: { servers: { nmap?: { path: string } } }): Promise<void> {
    if (config.servers.nmap) {
      await this.nmapClient.connect(config.servers.nmap.path);
      console.log('[MCPAgent] Nmap server connected');
    }
    this.isInitialized = true;
  }

  /**
   * Executes a tool call from an execution step.
   *
   * Routes the tool call to the appropriate MCP client based on the
   * tool name prefix (e.g., "nmap_" goes to the Nmap client).
   *
   * @param step - The ExecutorStep containing tool name and arguments
   * @returns ToolResult with success status and raw output or error
   *
   * @example
   * const result = await mcpAgent.executeTool({
   *   tool: 'nmap_port_scan',
   *   arguments: { target: '192.168.1.1', ports: '1-1000' },
   *   description: 'Scan common ports'
   * });
   */
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

  /**
   * Executes an Nmap-specific tool via the MCP client.
   *
   * Maps tool names to NmapMCPClient methods:
   * - nmap_host_discovery → nmapClient.hostDiscovery()
   * - nmap_port_scan → nmapClient.portScan()
   * - nmap_service_detection → nmapClient.serviceDetection()
   *
   * @param tool - The Nmap tool name (e.g., "nmap_port_scan")
   * @param args - Tool arguments (target, ports, scanType, etc.)
   * @returns ToolResult with raw Nmap output
   */
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

  /**
   * Disconnects from all MCP servers and releases resources.
   *
   * Should be called when done using the agent to ensure clean shutdown.
   */
  async shutdown(): Promise<void> {
    if (this.isInitialized) {
      await this.nmapClient.disconnect();
      console.log('[MCPAgent] Disconnected');
    }
  }
}
