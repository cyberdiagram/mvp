// Shared types for subagent definitions

/**
 * Output from the ReasonerAgent's strategic decision-making.
 *
 * The Reasoner analyzes the current situation and decides what to do next.
 * It returns structured output that the Executor can turn into tool calls.
 */
export interface ReasonerOutput {
  /** The Reasoner's analysis of the current situation */
  thought: string;
  /** Description of the recommended action to take */
  action: string;
  /** Name of the tool to execute (e.g., "nmap_port_scan") - optional if just analyzing */
  tool?: string;
  /** Arguments to pass to the tool (e.g., { target: "192.168.1.1", ports: "1-1000" }) */
  arguments?: Record<string, unknown>;
  /** Set to true when the reconnaissance mission is complete */
  is_complete?: boolean;
}

/**
 * A single executable step in an execution plan.
 *
 * Represents one atomic tool call that the MCP Agent will execute.
 */
export interface ExecutorStep {
  /** Name of the tool to execute (e.g., "nmap_host_discovery") */
  tool: string;
  /** Arguments to pass to the tool */
  arguments: Record<string, unknown>;
  /** Human-readable description of what this step does */
  description: string;
}

/**
 * An execution plan containing multiple steps.
 *
 * The Executor breaks down the Reasoner's high-level actions into
 * a sequence of atomic tool calls that can be executed one by one.
 */
export interface ExecutorPlan {
  /** Ordered list of steps to execute */
  steps: ExecutorStep[];
  /** Index of the current step being executed (0-based) */
  current_step: number;
  /** Current status of the plan */
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
}

/**
 * Result from executing a tool via the MCP Agent.
 *
 * Contains the raw output from the security tool (Nmap, etc.)
 * before it gets parsed by the DataCleaner.
 */
export interface ToolResult {
  /** Whether the tool executed successfully */
  success: boolean;
  /** Raw text output from the tool (e.g., Nmap scan results) */
  output: string;
  /** Error message if the tool failed */
  error?: string;
}

/**
 * Structured data after the DataCleaner parses raw tool output.
 *
 * The DataCleaner converts messy tool output into clean JSON
 * that the Reasoner can easily understand and analyze.
 */
export interface CleanedData {
  /** Type of data (e.g., "nmap_scan", "nmap_hosts", "gobuster") */
  type: string;
  /** Structured data extracted from the tool output */
  data: unknown;
  /** Human-readable summary of the findings */
  summary: string;
}

/**
 * Result for a single host from Nmap host discovery.
 *
 * Used when scanning a network to find which hosts are alive.
 */
export interface NmapHostResult {
  /** IP address of the host (e.g., "192.168.1.1") */
  ip: string;
  /** Whether the host responded to probes */
  status: 'up' | 'down';
  /** Hostname if resolved via DNS */
  hostname?: string;
}

/**
 * Result for a single port from an Nmap port scan.
 *
 * Contains information about port state and any detected service.
 */
export interface NmapPortResult {
  /** Port number (e.g., 22, 80, 443) */
  port: number;
  /** Port state - open, closed, or filtered by firewall */
  state: 'open' | 'closed' | 'filtered';
  /** Protocol (tcp or udp) */
  protocol: string;
  /** Detected service name (e.g., "ssh", "http", "mysql") */
  service?: string;
  /** Service version if detected (e.g., "OpenSSH 8.2p1") */
  version?: string;
}

/**
 * Complete Nmap scan result with all discovered hosts and ports.
 *
 * This is the main data structure returned by the DataCleaner
 * after parsing Nmap output.
 */
export interface NmapScanResult {
  /** Array of discovered hosts with their port information */
  hosts: Array<{
    ip: string;
    status: string;
    ports?: NmapPortResult[];
  }>;
  /** Type of scan performed (tcp, udp, syn) */
  scan_type: string;
  /** Original target that was scanned */
  target: string;
  /** ISO timestamp when the scan was performed */
  timestamp: string;
}
