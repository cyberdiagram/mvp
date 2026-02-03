// Shared types for subagent definitions

export interface ReasonerOutput {
  thought: string;
  action: string;
  tool?: string;
  arguments?: Record<string, unknown>;
  is_complete?: boolean;
}

export interface ExecutorStep {
  tool: string;
  arguments: Record<string, unknown>;
  description: string;
}

export interface ExecutorPlan {
  steps: ExecutorStep[];
  current_step: number;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
}

export interface ToolResult {
  success: boolean;
  output: string;
  error?: string;
}

export interface CleanedData {
  type: string;
  data: unknown;
  summary: string;
}

export interface NmapHostResult {
  ip: string;
  status: 'up' | 'down';
  hostname?: string;
}

export interface NmapPortResult {
  port: number;
  state: 'open' | 'closed' | 'filtered';
  protocol: string;
  service?: string;
  version?: string;
}

export interface NmapScanResult {
  hosts: Array<{
    ip: string;
    status: string;
    ports?: NmapPortResult[];
  }>;
  scan_type: string;
  target: string;
  timestamp: string;
}
