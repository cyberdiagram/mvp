/**
 * MCP Agent - Tool execution layer.
 *
 * Connects to MCP (Model Context Protocol) servers and executes security tools.
 * Supports multiple MCP servers:
 * - Nmap: Network reconnaissance and port scanning
 * - SearchSploit: Exploit database queries
 * - RAG Memory: Security playbooks and anti-patterns retrieval
 *
 * Routes tool calls from the Executor to the appropriate MCP client.
 *
 * MCP is a protocol that allows AI agents to safely interact with external tools.
 */

import { NmapMCPClient } from '@cyber/mcp-nmap-client';
import { SearchSploitMCPClient } from '@cyber/mcp-searchsploit-client';
import { RAGMemoryMCPClient } from '@cyber/mcp-rag-memory-client';
import { ToolResult, ExecutorStep } from '../core/types.js';

/**
 * MCPAgent - Routes tool execution to MCP servers.
 *
 * Acts as a bridge between the Executor's planned steps and actual
 * security tool execution. Manages connections to MCP servers and
 * handles tool-specific argument mapping.
 *
 * Supported tools:
 * - nmap_*: Network scanning (nmap_host_discovery, nmap_port_scan, nmap_service_detection)
 * - searchsploit_*: Exploit database queries (searchsploit_search, searchsploit_examine)
 * - rag_query_playbooks: Query security playbooks and anti-patterns from RAG memory
 */
export class MCPAgent {
  /** Client for Nmap MCP server */
  private nmapClient: NmapMCPClient;
  /** Client for SearchSploit MCP server */
  private searchSploitClient: SearchSploitMCPClient | null = null;
  /** Client for RAG Memory MCP server */
  private ragMemoryClient: RAGMemoryMCPClient | null = null;
  /** Whether the agent has been initialized */
  private isInitialized: boolean = false;

  /**
   * Creates a new MCPAgent.
   *
   * Does not connect to servers - call initialize() first.
   */
  constructor() {
    this.nmapClient = new NmapMCPClient();
    this.searchSploitClient = new SearchSploitMCPClient();
    this.ragMemoryClient = new RAGMemoryMCPClient();
  }

  /**
   * Initializes connections to MCP servers.
   *
   * Connects to each configured server (Nmap, SearchSploit, RAG Memory).
   * Must be called before executeTool().
   *
   * @param config - Server configuration with paths to MCP server executables
   *
   * @example
   * await mcpAgent.initialize({
   *   servers: {
   *     nmap: { path: './nmap-server/dist/index.js' },
   *     searchsploit: { path: './searchsploit-server/dist/index.js' },
   *     rag_memory: { path: './rag-memory-server/dist/index.js' }
   *   }
   * });
   */
  async initialize(config: {
    servers: {
      nmap?: { path: string };
      searchsploit?: { path: string };
      rag_memory?: { path: string };
    };
  }): Promise<void> {
    // Connect to Nmap server
    if (config.servers.nmap) {
      await this.nmapClient.connect(config.servers.nmap.path);
      console.log('[MCPAgent] ✓ Nmap server connected');
    }

    // Connect to SearchSploit server
    if (config.servers.searchsploit && this.searchSploitClient) {
      await this.searchSploitClient.connect(config.servers.searchsploit.path);
      console.log('[MCPAgent] ✓ SearchSploit server connected');
    }

    // Connect to RAG Memory server
    if (config.servers.rag_memory && this.ragMemoryClient) {
      await this.ragMemoryClient.connect(config.servers.rag_memory.path);
      console.log('[MCPAgent] ✓ RAG Memory server connected');
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
      // Route to appropriate MCP client based on tool prefix
      if (tool.startsWith('nmap_')) {
        return await this.executeNmapTool(tool, args);
      } else if (tool.startsWith('searchsploit_')) {
        return await this.executeSearchSploitTool(tool, args);
      } else if (tool.startsWith('rag_')) {
        return await this.executeRAGMemoryTool(tool, args);
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
   * Executes a SearchSploit-specific tool via the MCP client.
   *
   * Maps tool names to SearchSploitMCPClient methods:
   * - searchsploit_search → Search ExploitDB for vulnerabilities
   * - searchsploit_examine → Examine exploit code details
   * - searchsploit_path → Get local file path to exploit
   *
   * @param tool - The SearchSploit tool name
   * @param args - Tool arguments (query, exploit_id, etc.)
   * @returns ToolResult with SearchSploit output
   */
  private async executeSearchSploitTool(
    tool: string,
    args: Record<string, unknown>
  ): Promise<ToolResult> {
    if (!this.searchSploitClient) {
      return {
        success: false,
        output: '',
        error: 'SearchSploit client not initialized',
      };
    }

    try {
      switch (tool) {
        case 'searchsploit_search': {
          const searchOptions = typeof args.query === 'string'
            ? { query: args.query }
            : (args as any);
          const result = await this.searchSploitClient.search(searchOptions);
          return {
            success: result.success,
            output: JSON.stringify(result),
            error: result.error,
          };
        }

        case 'searchsploit_examine': {
          const edbId = (args.edbId || args.exploit_id) as string;
          const result = await this.searchSploitClient.examine(edbId);
          return {
            success: result.success,
            output: result.output,
            error: result.error || undefined,
          };
        }

        case 'searchsploit_path': {
          const edbId = (args.edbId || args.exploit_id) as string;
          const result = await this.searchSploitClient.getPath(edbId);
          return {
            success: result.success,
            output: result.path || '',
            error: result.error || undefined,
          };
        }

        default:
          return {
            success: false,
            output: '',
            error: `Unknown SearchSploit tool: ${tool}`,
          };
      }
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        output: '',
        error: errorMessage,
      };
    }
  }

  /**
   * Executes a RAG Memory-specific tool via the MCP client.
   *
   * Maps tool names to RAGMemoryMCPClient methods:
   * - rag_recall → Recall past lessons and anti-patterns
   * - rag_query_playbooks → Query security playbooks (alias for recall)
   *
   * @param tool - The RAG Memory tool name
   * @param args - Tool arguments (query/observation, top_k)
   * @returns ToolResult with RAG Memory output (JSON)
   */
  private async executeRAGMemoryTool(
    tool: string,
    args: Record<string, unknown>
  ): Promise<ToolResult> {
    if (!this.ragMemoryClient) {
      return {
        success: false,
        output: '',
        error: 'RAG Memory client not initialized',
      };
    }

    try {
      switch (tool) {
        case 'rag_recall': {
          // Queries the anti_patterns collection via SDK
          const observation = (args.query || args.observation) as string;
          const topK = (args.top_k as number) || 3;

          const result = await this.ragMemoryClient.recallMyExperience({
            observation,
            top_k: topK,
          });

          return {
            success: result.success,
            output: JSON.stringify(result),
            error: result.message && !result.success ? result.message : undefined,
          };
        }

        case 'rag_query_playbooks': {
          // Queries the playbooks collection via SDK
          const query = (args.query || args.observation) as string;
          const nResults = (args.n_results as number) || (args.top_k as number) || 3;

          const result = await this.ragMemoryClient.searchSecurityHandbook(query, nResults);

          return {
            success: result.success,
            output: JSON.stringify(result),
            error: result.message && !result.success ? result.message : undefined,
          };
        }

        default:
          return {
            success: false,
            output: '',
            error: `Unknown RAG Memory tool: ${tool}`,
          };
      }
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        output: '',
        error: errorMessage,
      };
    }
  }

  /**
   * Disconnects from all MCP servers and releases resources.
   *
   * Should be called when done using the agent to ensure clean shutdown.
   */
  async shutdown(): Promise<void> {
    if (this.isInitialized) {
      await this.nmapClient.disconnect();

      if (this.searchSploitClient) {
        await this.searchSploitClient.disconnect();
      }

      if (this.ragMemoryClient) {
        await this.ragMemoryClient.disconnect();
      }

      console.log('[MCPAgent] All servers disconnected');
    }
  }
}
