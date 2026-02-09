// Shared types for subagent definitions

/**
 * Output from the ReasonerAgent's strategic decision-making.
 *
 * The Reasoner analyzes the current situation and decides what HIGH-LEVEL
 * action to take. It does NOT specify tools or arguments - that's the
 * Executor's job. This separation allows the Executor to break down
 * strategic actions into multiple tactical steps.
 */
export interface ReasonerOutput {
  /** The Reasoner's analysis of the current situation */
  thought: string;
  /** HIGH-LEVEL description of what should be done next (e.g., "Enumerate web services for vulnerabilities") */
  action: string;
  /** Set to true when the reconnaissance mission is complete */
  is_complete?: boolean;

  // Tactical planning (optional, for intelligence-driven attacks)
  /** Tactical plan with attack vectors and predictions */
  tactical_plan?: TacticalPlanObject;
  /** Rationale for attack strategy */
  attack_rationale?: string;
  /** Expected success description */
  expected_success?: string;
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
  /** Intelligence context from Intelligence Layer (optional) */
  intelligence?: IntelligenceContext;
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

// ==================== INTELLIGENCE LAYER ====================

/**
 * Discovered service with enriched metadata.
 *
 * Enhanced version of NmapPortResult with categorization, confidence
 * scoring, and criticality assessment for intelligence analysis.
 */
export interface DiscoveredService {
  /** Host IP address */
  host: string;
  /** Port number */
  port: number;
  /** Protocol (tcp or udp) */
  protocol: string;
  /** Service name (e.g., "ssh", "http") */
  service: string;
  /** Product name (e.g., "Apache", "OpenSSH") */
  product?: string;
  /** Version string (e.g., "2.4.41", "8.2p1") */
  version?: string;
  /** Full service banner */
  banner?: string;
  /** Service category (web, database, remote-access, etc.) */
  category?: string;
  /** Criticality level (high, medium, low) */
  criticality?: string;
  /** Confidence score for service detection (0-1) */
  confidence?: number;
}

/**
 * Target profile from Profiler Agent.
 *
 * High-level assessment of the target system including OS, technology
 * stack, security posture, and risk classification.
 */
export interface TargetProfile {
  /** Operating system family (Linux, Windows, BSD, Unknown) */
  os_family?: string;
  /** Specific OS version if detectable (e.g., "Ubuntu 20.04") */
  os_version?: string;
  /** Technology stack identifiers (e.g., ["LAMP", "Apache", "MySQL"]) */
  tech_stack?: string[];
  /** Security posture assessment (hardened, standard, weak) */
  security_posture: string;
  /** Risk level classification (high-value, medium, low) */
  risk_level: string;
  /** Supporting evidence for the assessment */
  evidence: string[];
}

/**
 * Vulnerability information from VulnLookup Agent.
 *
 * Details about a specific CVE or exploit found for a service,
 * including severity, description, and PoC availability.
 */
export interface VulnerabilityInfo {
  /** CVE identifier (e.g., "CVE-2021-41773") or EDB-ID */
  cve_id: string;
  /** Severity level (critical, high, medium, low) */
  severity: string;
  /** CVSS score if available */
  cvss_score?: number;
  /** Vulnerability description */
  description: string;
  /** Affected service identifier */
  affected_service: string;
  /** Whether a Proof-of-Concept exploit is available */
  poc_available: boolean;
  /** URL or path to PoC exploit */
  poc_url?: string;
  /** ExploitDB ID if applicable */
  exploitdb_id?: string;
}

/**
 * Combined intelligence context from Intelligence Layer.
 *
 * Aggregates all intelligence data (services, profile, vulnerabilities)
 * gathered during reconnaissance for informed decision-making.
 */
export interface IntelligenceContext {
  /** All discovered services with enriched metadata */
  discoveredServices: DiscoveredService[];
  /** Target system profile (optional, generated after service discovery) */
  targetProfile?: TargetProfile;
  /** Known vulnerabilities for discovered services */
  vulnerabilities: VulnerabilityInfo[];
  /** PoC findings with tool and URL information */
  pocFindings: Array<{ tool: string; url: string }>;
}

// ==================== TACTICAL PLANNING ====================

/**
 * Action instructions for Executor Agent.
 *
 * Defines a specific tool execution with parameters and timeout.
 */
export interface AttackAction {
  /** Name of the tool to execute */
  tool_name: string;
  /** Command template (for reference/logging) */
  command_template: string;
  /** Tool parameters as key-value pairs */
  parameters: Record<string, unknown>;
  /** Execution timeout in seconds */
  timeout_seconds: number;
}

/**
 * Prediction metrics for Evaluator Agent.
 *
 * Structured prediction about attack outcome including classification,
 * confidence, and success criteria for automated evaluation.
 */
export interface PredictionMetrics {
  /** Attack classification metadata */
  classification: {
    /** Attack type (RCE, SQLi, XSS, etc.) */
    attack_type: string;
    /** MITRE ATT&CK technique ID */
    mitre_id: string;
    /** Associated CVE if applicable */
    cve_id?: string;
  };
  /** Hypothesis about attack outcome */
  hypothesis: {
    /** Confidence score (0-1) for success prediction */
    confidence_score: number;
    /** Rationale tags explaining the prediction */
    rationale_tags: string[];
    /** Whether success is expected */
    expected_success: boolean;
  };
  /** Criteria for determining success from tool output */
  success_criteria: {
    /** Type of matching (regex_match, status_code, contains) */
    match_type: string;
    /** Pattern indicating success */
    match_pattern: string;
    /** Pattern indicating failure (optional) */
    negative_pattern?: string;
  };
}

/**
 * Single attack vector with action and prediction.
 *
 * Represents one complete attack attempt including the action to execute
 * and the predicted outcome for evaluation.
 */
export interface AttackVector {
  /** Unique identifier for this vector */
  vector_id: string;
  /** Execution priority (lower number = higher priority) */
  priority: number;
  /** Action to execute */
  action: AttackAction;
  /** Prediction metrics for evaluation */
  prediction_metrics: PredictionMetrics;
  /** RAG-sourced knowledge that informed this attack vector */
  rag_context?: {
    /** Exact exploit payload from playbook (syntax-preserved) */
    payload_snippet?: string;
    /** Critical operational insight */
    insight?: string;
    /** Bypass technique / exploitation logic */
    exploitation_logic?: string;
    /** Version/config prerequisites */
    vulnerability_context?: string;
    /** Source reference (e.g., "htb_sense_writeup") */
    source?: string;
  };
}

/**
 * Complete tactical plan from Reasoner Agent.
 *
 * Structured attack plan with multiple vectors, metadata, and context hash
 * for tracking and evaluation purposes.
 */
export interface TacticalPlanObject {
  /** Unique plan identifier */
  plan_id: string;
  /** Target IP address */
  target_ip: string;
  /** Hash of intelligence context used for planning */
  context_hash: string;
  /** Ordered list of attack vectors to execute */
  attack_vectors: AttackVector[];
  /** ISO timestamp of plan creation */
  created_at: string;
}

// ==================== EVALUATION LOOP ====================

/**
 * Evaluation result from Evaluator Agent.
 *
 * Ground truth label and analysis of an attack vector's outcome,
 * comparing prediction against actual results.
 */
export interface EvaluationResult {
  /** Attack vector ID being evaluated */
  vector_id: string;
  /** Original prediction metrics */
  prediction: PredictionMetrics;
  /** Actual tool output (may be truncated) */
  actual_output: string;
  /** Ground truth label */
  label: 'true_positive' | 'false_positive' | 'false_negative' | 'true_negative';
  /** Evaluator's reasoning for the label */
  reasoning: string;
  /** Evaluator's confidence in the label (0-1) */
  confidence: number;
  /** ISO timestamp of evaluation */
  timestamp: string;
}

/**
 * Training data pair for model improvement.
 *
 * Complete training example capturing input context, prediction,
 * execution result, and evaluation for RLHF or model fine-tuning.
 */
export interface TrainingPair {
  /** Session identifier */
  session_id: string;
  /** Iteration number within session */
  iteration: number;

  // Input context
  /** Intelligence context at time of decision */
  intelligence: IntelligenceContext;
  /** Reasoner's prompt (for reference) */
  reasoner_prompt: string;

  // Reasoner's prediction
  /** Tactical plan generated by Reasoner */
  tactical_plan: TacticalPlanObject;

  // Execution result
  /** Raw execution output */
  execution_output: string;
  /** Whether execution succeeded */
  execution_success: boolean;

  // Evaluation
  /** Evaluation result from Evaluator Agent */
  evaluation: EvaluationResult;

  // Metadata
  /** ISO timestamp */
  created_at: string;
  /** Model version identifier */
  model_version: string;
}

// ==================== RAG MEMORY SYSTEM ====================

/**
 * Session step for JSONL logging.
 *
 * Captures a single step in the agent's decision-making process
 * for consumption by the RAG Memory System's ETL pipeline.
 *
 * Logs are written to logs/sessions/<session_id>.jsonl and processed
 * by the pentest-rag-memory ETL pipeline to extract anti-patterns.
 */
export interface SessionStep {
  /** Session identifier (shared across all steps in a session) */
  session_id: string;
  /** Step number within session (incremental) */
  step_index: number;
  /** ISO timestamp of step execution */
  timestamp: string;
  /** Step origin (agent, human intervention, or mixed) */
  role: 'agent' | 'human' | 'mixed';

  /** Observation at this step */
  observation: {
    /** Last tool output or environment state */
    last_tool_output: string;
    /** Open ports if available */
    open_ports?: number[];
    /** Target information if available */
    target_info?: Record<string, unknown>;
  };

  /** Agent's thought process */
  thought_process: {
    /** Situation analysis */
    analysis: string;
    /** Reasoning for chosen action */
    reasoning: string;
    /** Planned action */
    plan: string;
  };

  /** Action taken */
  action: {
    /** Tool name executed */
    tool_name: string;
    /** Tool arguments */
    tool_args: Record<string, unknown>;
  };

  /** Action result */
  result: string;

  /** Outcome label for ETL pipeline */
  outcome_label: 'success' | 'failed' | 'partial';

  /** Human intervention if applicable */
  human_intervention?: {
    /** Type of intervention */
    type: 'stop' | 'correct' | 'guide';
    /** Intervention message */
    message: string;
  };
}
