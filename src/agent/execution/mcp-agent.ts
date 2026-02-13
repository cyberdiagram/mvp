/**
 * DualMCPAgent - Routes tool execution to 2 MCP servers.
 *
 * Connects to:
 * 1. RAG Memory MCP Server (host, stdio transport) — security playbooks & anti-patterns
 * 2. Kali MCP Server (Docker container, HTTP transport) — tool execution & information retrieval
 *
 * Replaces the previous 3-server architecture (Nmap, SearchSploit, RAG).
 * Nmap and SearchSploit are now available inside the Kali container.
 *
 * Tool routing:
 * - rag_* → RAG Memory server (host)
 * - Everything else → Kali server (Docker)
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { RAGMemoryMCPClient } from '@cyber/mcp-rag-memory-client';
import { ToolResult, ExecutorStep } from '../core/types.js';

/**
 * Configuration for DualMCPAgent initialization.
 */
export interface DualMCPConfig {
  /** RAG Memory server config (stdio transport on host) */
  ragMemory?: { path: string };
  /** Kali MCP server config (HTTP transport in Docker) */
  kali?: { url: string };
}

/**
 * DualMCPAgent - Manages two MCP server connections.
 *
 * RAG server provides knowledge (playbooks, anti-patterns).
 * Kali server provides execution (shell commands, scripts, packages, searchsploit).
 */
export class DualMCPAgent {
  /** RAG Memory MCP client (host, stdio transport) */
  private ragClient: RAGMemoryMCPClient | null = null;
  /** Kali MCP client (Docker, HTTP transport) */
  private kaliClient: Client | null = null;
  /** Kali HTTP transport instance */
  private kaliTransport: StreamableHTTPClientTransport | null = null;
  /** Set of tool names available on the Kali server (populated at init) */
  private kaliTools: Set<string> = new Set();
  /** Whether the agent has been initialized */
  private initialized = false;

  /**
   * Initializes connections to both MCP servers.
   *
   * Connects to RAG (stdio) and/or Kali (HTTP) based on provided config.
   * Discovers available tools from the Kali server dynamically.
   *
   * @param config - Server connection configuration
   */
  async initialize(config: DualMCPConfig): Promise<void> {
    // Connect to RAG Memory server (stdio transport, host-local)
    if (config.ragMemory) {
      try {
        this.ragClient = new RAGMemoryMCPClient();
        await this.ragClient.connect(config.ragMemory.path);
        console.log('[DualMCPAgent] RAG Memory server connected');
      } catch (error) {
        console.error('[DualMCPAgent] RAG Memory connection failed:', error);
        this.ragClient = null;
      }
    }

    // Connect to Kali MCP server (HTTP transport, Docker container)
    if (config.kali) {
      try {
        this.kaliClient = new Client({ name: 'mvp-agent', version: '2.0.0' });
        const mcpUrl = new URL('/mcp', config.kali.url);
        this.kaliTransport = new StreamableHTTPClientTransport(mcpUrl);
        await this.kaliClient.connect(this.kaliTransport);

        // Discover available tools dynamically
        const toolList = await this.kaliClient.listTools();
        toolList.tools.forEach((t) => this.kaliTools.add(t.name));
        console.log(
          `[DualMCPAgent] Kali server connected (${this.kaliTools.size} tools: ${[...this.kaliTools].join(', ')})`
        );
      } catch (error) {
        console.error('[DualMCPAgent] Kali MCP connection failed:', error);
        this.kaliClient = null;
      }
    }

    this.initialized = true;
  }

  /**
   * Executes a tool call from an ExecutorStep.
   *
   * Routes based on tool name prefix:
   * - rag_* → RAG Memory server
   * - Everything else → Kali server
   *
   * @param step - The ExecutorStep containing tool name and arguments
   * @returns ToolResult with success status and output
   */
  async executeTool(step: ExecutorStep): Promise<ToolResult> {
    if (!this.initialized) {
      return { success: false, output: '', error: 'DualMCPAgent not initialized' };
    }

    const { tool, arguments: args } = step;
    console.log(`[DualMCPAgent] Executing: ${tool}`);

    try {
      if (tool.startsWith('rag_')) {
        return await this.callRAGTool(tool, args);
      } else {
        const output = await this.callKaliTool(tool, args);
        return { success: true, output };
      }
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`[DualMCPAgent] Error executing ${tool}:`, errorMessage);
      return { success: false, output: '', error: errorMessage };
    }
  }

  /**
   * Calls a tool on the Kali MCP server.
   *
   * Used by both the recon flow (via executeTool) and the agentic loop
   * (via AgenticExecutor.dispatchToolCall).
   *
   * @param name - Tool name (e.g., "execute_shell_cmd", "searchsploit_search")
   * @param args - Tool arguments as key-value pairs
   * @returns Raw text output from the tool
   */
  async callKaliTool(name: string, args: Record<string, unknown>): Promise<string> {
    if (!this.kaliClient) {
      throw new Error('Kali MCP client not connected');
    }

    const result = await this.kaliClient.callTool({ name, arguments: args });

    // Extract text content from MCP response
    if (!result.content || !Array.isArray(result.content)) {
      return String(result);
    }
    return result.content
      .filter((c): c is { type: 'text'; text: string } => c.type === 'text')
      .map((c) => c.text)
      .join('\n');
  }

  /**
   * Calls a tool on the RAG Memory MCP server.
   *
   * Supports rag_recall and rag_query_playbooks.
   *
   * @param tool - RAG tool name
   * @param args - Tool arguments (query, observation, top_k, n_results)
   * @returns ToolResult with JSON output
   */
  async callRAGTool(tool: string, args: Record<string, unknown>): Promise<ToolResult> {
    if (!this.ragClient) {
      return { success: false, output: '', error: 'RAG Memory client not connected' };
    }

    try {
      switch (tool) {
        case 'rag_recall': {
          const observation = (args.query || args.observation) as string;
          const topK = (args.top_k as number) || 3;
          const result = await this.ragClient.recallMyExperience({
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
          const query = (args.query || args.observation) as string;
          const nResults = (args.n_results as number) || (args.top_k as number) || 3;
          const result = await this.ragClient.searchSecurityHandbook(query, nResults);
          return {
            success: result.success,
            output: JSON.stringify(result),
            error: result.message && !result.success ? result.message : undefined,
          };
        }

        default:
          return { success: false, output: '', error: `Unknown RAG tool: ${tool}` };
      }
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return { success: false, output: '', error: errorMessage };
    }
  }

  /**
   * Returns the list of tool names available on the Kali server.
   *
   * Populated dynamically during initialize() via listTools().
   * Used by ExecutorAgent and AgenticExecutor to build tool descriptions.
   */
  getKaliToolNames(): string[] {
    return [...this.kaliTools];
  }

  /**
   * Returns whether the Kali MCP server is connected.
   */
  isKaliConnected(): boolean {
    return this.kaliClient !== null;
  }

  /**
   * Returns whether the RAG Memory server is connected.
   */
  isRAGConnected(): boolean {
    return this.ragClient !== null;
  }

  /**
   * Disconnects from all MCP servers and releases resources.
   */
  async shutdown(): Promise<void> {
    if (this.kaliTransport) {
      await this.kaliTransport.close();
      console.log('[DualMCPAgent] Kali server disconnected');
    }

    if (this.ragClient) {
      await this.ragClient.disconnect();
      console.log('[DualMCPAgent] RAG Memory server disconnected');
    }

    console.log('[DualMCPAgent] All servers disconnected');
  }
}
