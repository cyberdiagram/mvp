// Main Orchestrator - Coordinates all subagents

import { ReasonerAgent, ProfilerAgent, EvaluatorAgent } from '../intelligence/index.js';
import { VulnLookupAgent, RAGMemoryAgent, RAGMemoryDocument } from '../knowledge/index.js';
import {
  ExecutorAgent,
  DualMCPAgent,
  AgenticExecutor,
  DataCleanerAgent,
} from '../execution/index.js';
import { SkillManager } from '../utils/skill-manager.js';
import {
  CleanedData,
  DiscoveredService,
  IntelligenceContext,
  TrainingPair,
  SessionStep,
  TacticalPlanObject,
  ReasonerOutput,
  ExecutorPlan,
  VulnerabilityInfo,
  TargetProfile,
  LogLevel,
  LogEntry,
  ReconResult,
} from './types.js';
import { startActiveObservation, propagateAttributes } from '@langfuse/tracing';

export interface AgentConfig {
  anthropicApiKey: string;
  skillsDir: string;
  /** Kali MCP server URL (HTTP transport, Docker container) */
  kaliMcpUrl?: string;
  /** RAG Memory MCP server path (stdio transport, host-local) */
  ragMemoryServerPath?: string;
  enableEvaluation?: boolean;
  enableRAGMemory?: boolean;
  trainingDataPath?: string;
  sessionLogsPath?: string;
  /** Optional callback invoked for every structured log entry. Used by worker mode to relay logs to Redis Pub/Sub. */
  onLog?: (entry: LogEntry) => void;
}

/**
 * PentestAgent - Main orchestrator for the multi-agent penetration testing system.
 *
 * This class coordinates eight specialized subagents:
 * - ReasonerAgent (Sonnet 4): Strategic brain with tactical planning
 * - ExecutorAgent (Haiku 4.5): Breaks plans into executable tool steps
 * - MCPAgent: Executes security tools via MCP protocol (Nmap, SearchSploit, RAG)
 * - DataCleanerAgent (Haiku 4.5): Parses and enriches tool output
 * - ProfilerAgent (Haiku 3.5): Target profiling (OS, tech stack, security posture)
 * - VulnLookupAgent: Vulnerability research via SearchSploit MCP
 * - RAGMemoryAgent: Retrieves playbooks and anti-patterns from past experiences
 * - EvaluatorAgent (Haiku 3.5): Post-execution evaluation and labeling
 *
 * The agent follows an enhanced iterative loop with Intelligence Layer + RAG Memory:
 * Reasoner → Executor → MCP → DataCleaner → Intelligence Layer (Profiler + VulnLookup)
 * → RAG Memory (Playbooks + Anti-Patterns) → back to Reasoner with full context
 * → Evaluation Loop → Training Data
 */
export class PentestAgent {
  /** Configuration for the agent system */
  private config: AgentConfig;

  /** Strategic reasoning agent (Claude Sonnet 4) */
  private reasoner: ReasonerAgent;

  /** Execution planning agent (Claude Haiku 4.5) */
  private executor: ExecutorAgent;

  /** MCP protocol agent for tool execution (RAG stdio + Kali HTTP) */
  private mcpAgent: DualMCPAgent;

  /** Agentic executor for autonomous OODA loop and script generation */
  public agenticExecutor: AgenticExecutor | null = null;

  /** Unified skill manager (skills + memory) */
  public skillManager: SkillManager;

  /** Data cleaning/parsing agent (Claude Haiku 4.5) */
  private dataCleaner: DataCleanerAgent;

  /** Target profiling agent (Claude Haiku 3.5) */
  private profiler: ProfilerAgent;

  /** Vulnerability lookup agent (SearchSploit MCP) */
  private vulnLookup: VulnLookupAgent;

  /** RAG Memory agent (Playbooks + Anti-Patterns) */
  private ragMemory: RAGMemoryAgent | null = null;

  /** Evaluation agent (Claude Haiku 3.5) */
  private evaluator: EvaluatorAgent;

  /** Session ID for tracking and logging */
  private sessionId: string;

  /** Collected training pairs for RLHF */
  private trainingPairs: TrainingPair[] = [];

  /** Step index for session logging */
  private stepIndex: number = 0;

  /** Set of analyzed service fingerprints to avoid duplicate intelligence analysis */
  private analyzedServiceFingerprints: Set<string> = new Set();

  /** Tracks executed command signatures and their count for duplicate detection */
  private executionHistory: Map<string, number> = new Map();

  /**
   * DEBUG SWITCH: When true, prevents anti-pattern content from being injected
   * into the Reasoner's prompt. Playbook injection is unaffected.
   * Set to false to restore normal behavior after testing.
   */
  private debugDisableAntiPatternInjection: boolean = false;

  /**
   * Creates a new PentestAgent with all subagents.
   *
   * @param config - Configuration object containing:
   *   - anthropicApiKey: API key for Claude API calls
   *   - skillsDir: Path to skill markdown files
   *   - mcpServers: Paths to MCP server executables (nmap, searchsploit, rag_memory)
   *   - enableEvaluation: Enable evaluation loop and training data collection
   *   - enableRAGMemory: Enable RAG memory recall before decisions
   *   - trainingDataPath: Path to save training data JSON files
   *   - sessionLogsPath: Path to save JSONL session logs for RAG ETL
   */
  constructor(config: AgentConfig) {
    this.config = config;
    this.skillManager = new SkillManager(config.skillsDir);
    this.reasoner = new ReasonerAgent(config.anthropicApiKey);
    this.executor = new ExecutorAgent(config.anthropicApiKey);
    this.mcpAgent = new DualMCPAgent();
    this.dataCleaner = new DataCleanerAgent(config.anthropicApiKey);
    this.profiler = new ProfilerAgent(config.anthropicApiKey);
    this.vulnLookup = new VulnLookupAgent(this.mcpAgent);
    this.evaluator = new EvaluatorAgent(config.anthropicApiKey);

    // Initialize RAG Memory agent if enabled
    if (config.enableRAGMemory && config.ragMemoryServerPath) {
      this.ragMemory = new RAGMemoryAgent(this.mcpAgent);
    }

    // Generate session ID for tracking
    this.sessionId = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Logs a structured message to console and optionally to the onLog callback.
   * @param level - Severity tag (INFO, STEP, RESULT, VULN, WARN, ERROR).
   * @param phase - The orchestrator phase producing the log (e.g. "Reasoner", "MCP Agent").
   * @param message - The log message body.
   */
  private log(level: LogLevel, phase: string, message: string): void {
    console.log(`[${phase}] ${message}`);
    this.config.onLog?.({ level, phase, message });
  }

  /**
   * Initializes the multi-agent system.
   *
   * This method:
   * 1. Loads skill documents from markdown files (e.g., nmap_skill.md)
   * 2. Builds skill context and injects it into the Reasoner's system prompt
   * 3. Connects MCP Agent to security tool servers (Nmap, etc.)
   *
   * Must be called before reconnaissance() or interactive().
   */
  async initialize(): Promise<void> {
    this.log('INFO', 'Orchestrator', 'Initializing multi-agent system...');

    // Load skills and inject into agents.
    // The Reasoner receives ONLY user-defined tool rules (agent_rules.json) — NOT the full
    // skill documentation. The Reasoner makes high-level strategic decisions and never writes
    // nmap commands directly, so loading 6,000+ tokens of command syntax into it wastes
    // ~22% of the 30k/min rate-limit budget. Command-level constraints from skill files are
    // enforced by the Executor (embedded in execute_shell_cmd's tool description).
    await this.skillManager.loadSkills();
    const rulesContext = this.skillManager.buildRulesPromptSection();
    if (rulesContext) {
      this.reasoner.setSkillContext(rulesContext);
    }
    const skillContext = this.skillManager.buildSkillContext('reconnaissance pentest');
    const parsingSkills = this.skillManager.buildSkillContext('fingerprint parsing');
    this.dataCleaner.setSkillContext(parsingSkills);
    this.log(
      'INFO',
      'Orchestrator',
      '✓ Skills loaded — Reasoner: rules only | DataCleaner: parsing skills | Executor: constraints via tool description'
    );

    // Initialize Dual MCP Agent (RAG stdio + Kali HTTP)
    await this.mcpAgent.initialize({
      ragMemory: this.config.ragMemoryServerPath
        ? { path: this.config.ragMemoryServerPath }
        : undefined,
      kali: this.config.kaliMcpUrl ? { url: this.config.kaliMcpUrl } : undefined,
    });
    this.log('INFO', 'Orchestrator', '✓ Dual MCP Agent initialized');

    // Build dynamic tool list from Kali discovery + RAG tools
    const kaliTools = this.mcpAgent.getKaliToolNames();
    const allTools = [...kaliTools, 'rag_recall', 'rag_query_playbooks'];
    this.executor = new ExecutorAgent(this.config.anthropicApiKey, allTools);

    // Embed skill constraint lines directly inside execute_shell_cmd's tool description.
    // We do NOT inject the full skill text (it contains old tool names like nmap_port_scan
    // that no longer exist and would confuse the Executor). Instead we extract only lines
    // containing hard constraint keywords so the model sees the rules exactly where it
    // looks when choosing command arguments — inside the tool it actually uses.
    const CONSTRAINT_RE = /\b(NEVER|MUST NOT|DO NOT|WARNING|IMPORTANT|CRITICAL|ALWAYS|AVOID)\b/i;
    const constraintLines = skillContext
      .split('\n')
      .filter((line) => CONSTRAINT_RE.test(line))
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && line.length < 200); // skip stray long lines

    if (constraintLines.length > 0) {
      const constraintBlock =
        'Skill constraints (obey when building commands):\n  ' + constraintLines.join('\n  ');
      this.executor.appendToToolDescription('execute_shell_cmd', constraintBlock);
    }

    this.log('INFO', 'Orchestrator', '✓ Skills loaded (Reasoner + DataCleaner + Executor)');

    // Initialize AgenticExecutor (autonomous OODA loop)
    if (this.mcpAgent.isKaliConnected()) {
      this.agenticExecutor = new AgenticExecutor(this.mcpAgent, this.skillManager);
      if (this.config.onLog) {
        this.agenticExecutor.setOnLog(this.config.onLog);
      }
      this.log('INFO', 'Orchestrator', '✓ Agentic Executor initialized');
    }

    this.log('INFO', 'Orchestrator', 'Ready!');
    this.log(
      'INFO',
      'Orchestrator',
      'Core Agents: Reasoner (Sonnet 4), Executor (Haiku 4.5), MCP Agent, Data Cleaner (Haiku 4.5)'
    );
    this.log(
      'INFO',
      'Orchestrator',
      'Intelligence Layer: Profiler (Haiku 3.5), VulnLookup (SearchSploit MCP)'
    );
    if (this.ragMemory) {
      this.log('INFO', 'Orchestrator', 'RAG Memory: Enabled (Playbooks + Anti-Patterns)');
    }
    if (this.config.enableEvaluation) {
      this.log('INFO', 'Orchestrator', 'Evaluation: Enabled (Evaluator Haiku 3.5)');
    }
    if (this.config.enableRAGMemory) {
      this.log('INFO', 'Orchestrator', 'RAG Memory: Enabled');
    }
    this.log('INFO', 'Orchestrator', `Session ID: ${this.sessionId}`);
  }

  // ============================================================================
  // UTILITY HELPER METHODS
  // ============================================================================

  /**
   * Helper: Create unique fingerprint for a discovered service
   *
   * Generates a deterministic fingerprint string from service properties
   * to track which services have already been analyzed.
   *
   * @param service - The discovered service to fingerprint
   * @returns A unique string fingerprint
   *
   * @private
   */
  private createServiceFingerprint(service: DiscoveredService): string {
    return `${service.host}:${service.port}:${service.service}:${service.product || ''}:${service.version || ''}`;
  }

  /**
   * Helper: Retry mechanism with exponential backoff
   *
   * Executes a promise-returning function with retry logic for handling
   * transient network failures or API flakiness.
   *
   * @param fn - Async function to execute with retry
   * @param maxRetries - Maximum number of retry attempts (default: 2)
   * @param initialDelayMs - Initial delay before first retry in milliseconds (default: 1000)
   * @returns Promise resolving to the function's result or null on complete failure
   *
   * @private
   */
  private async retryWithBackoff<T>(
    fn: () => Promise<T>,
    maxRetries: number = 2,
    initialDelayMs: number = 1000
  ): Promise<T | null> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await fn();
      } catch (error) {
        lastError = error as Error;

        if (attempt < maxRetries) {
          // 400 "prompt too long" — retrying with identical content will always fail.
          // Bail immediately so the error surfaces cleanly instead of wasting 3 attempts.
          const isContextTooLong =
            (error as any)?.status === 400 ||
            (error as any)?.statusCode === 400 ||
            lastError.message?.includes('prompt is too long') ||
            lastError.message?.includes('too long') ||
            lastError.message?.startsWith('400');
          if (isContextTooLong) {
            this.log(
              'ERROR',
              'Orchestrator',
              '✗ Prompt too long — aborting retries (truncation required)'
            );
            break;
          }

          // Rate limit errors (HTTP 429) require much longer waits than transient errors.
          // The Anthropic SDK may report the status on .status or .statusCode, and the
          // human-readable message uses "rate limit" (space) while the JSON type uses
          // "rate_limit" (underscore) — check all variants plus the leading "429" prefix.
          const isRateLimit =
            (error as any)?.status === 429 ||
            (error as any)?.statusCode === 429 ||
            lastError.message?.includes('rate_limit') ||
            lastError.message?.includes('rate limit') ||
            lastError.message?.startsWith('429');
          const baseDelay = isRateLimit ? 30_000 : initialDelayMs;
          const delayMs = baseDelay * Math.pow(2, attempt); // Exponential backoff
          this.log(
            'WARN',
            'Orchestrator',
            `⚠ Attempt ${attempt + 1}/${maxRetries + 1} failed${isRateLimit ? ' [rate limit]' : ''}, retrying in ${delayMs}ms...`
          );
          await new Promise((resolve) => setTimeout(resolve, delayMs));
        }
      }
    }

    // All retries exhausted
    this.log(
      'ERROR',
      'Orchestrator',
      `✗ All ${maxRetries + 1} attempts failed: ${lastError?.message}`
    );
    return null;
  }

  /**
   * Writes the merged final target profile to logs/Intelligence/{sessionId}_final.json.
   *
   * Called once after the recon loop completes. Merges all accumulated state into
   * a single document for the web UI:
   * - services       — all discovered services (highest-confidence version per host:port)
   * - target_profile — last Profiler output (has full context of all services)
   * - vulnerabilities — union across all iterations, deduped by CVE ID
   * - tactical_plan  — last tactical plan generated (if any)
   *
   * @param target             - Reconnaissance target (IP/hostname)
   * @param services           - All discovered services (final merged state)
   * @param intelligence       - Final IntelligenceContext (profile + vulns)
   * @param tacticalPlans      - All tactical plans generated during the session
   * @param totalIterations    - Number of iterations the loop ran
   * @param totalResults       - Total number of tool results collected
   */
  private async _writeFinalProfile(
    target: string,
    services: DiscoveredService[],
    intelligence: IntelligenceContext | null,
    tacticalPlans: TacticalPlanObject[],
    fileVulns: VulnerabilityInfo[],
    totalIterations: number,
    totalResults: number
  ): Promise<void> {
    try {
      const fs = await import('fs/promises');
      const path = await import('path');

      const intelDir = path.resolve('logs', 'Intelligence');
      await fs.mkdir(intelDir, { recursive: true });

      const finalProfile: Record<string, unknown> = {
        session_id: this.sessionId,
        target,
        completed_at: new Date().toISOString(),
        stats: {
          total_iterations: totalIterations,
          total_results: totalResults,
          services_discovered: services.length,
        },
        services,
      };

      if (intelligence?.targetProfile) {
        finalProfile.target_profile = intelligence.targetProfile;
      }

      // Merge VulnLookup CVEs with file-parsed vulns, deduplicated by cve_id
      const vulnMap = new Map<string, VulnerabilityInfo>();
      for (const v of intelligence?.vulnerabilities ?? []) vulnMap.set(v.cve_id, v);
      for (const v of fileVulns) if (!vulnMap.has(v.cve_id)) vulnMap.set(v.cve_id, v);
      if (vulnMap.size > 0) {
        finalProfile.vulnerabilities = Array.from(vulnMap.values());
      }

      // Include the last tactical plan (most refined — generated with full intelligence)
      if (tacticalPlans.length > 0) {
        finalProfile.tactical_plan = tacticalPlans[tacticalPlans.length - 1];
      }

      const filename = `${this.sessionId}_final.json`;
      const filepath = path.join(intelDir, filename);
      await fs.writeFile(filepath, JSON.stringify(finalProfile, null, 2), 'utf-8');

      this.log('INFO', 'Orchestrator', `✓ Final profile saved → logs/Intelligence/${filename}`);
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      this.log('WARN', 'Orchestrator', `⚠ Failed to write final profile: ${msg}`);
    }
  }

  /**
   * Writes a Phase 4 intelligence record to logs/Intelligence/.
   *
   * Always writes a file when Phase 4 analyzed new services. Optional fields
   * are included only when they contain valid data:
   * - target_profile  — omitted when null
   * - vulnerabilities — omitted when empty
   * - rag_playbooks   — omitted when empty
   *
   * Each iteration that analyzes new services produces one file:
   *   logs/Intelligence/<sessionId>_iter<NN>.json
   *
   * @param iteration       - Current loop iteration number
   * @param newServices     - Services analyzed this iteration (always present)
   * @param profile         - Profiler result (null if failed/no data)
   * @param vulnerabilities - VulnLookup results (may be empty)
   * @param playbooks       - RAG searchHandbook results (may be empty)
   */
  private async _logIntelligenceRecord(
    iteration: number,
    newServices: DiscoveredService[],
    profile: TargetProfile | null,
    vulnerabilities: VulnerabilityInfo[],
    playbooks: RAGMemoryDocument[]
  ): Promise<void> {
    this.log(
      'INFO',
      'Intelligence',
      `[iter ${iteration}] _logIntelligenceRecord called — services=${newServices.length} profile=${!!profile} vulns=${vulnerabilities.length} playbooks=${playbooks.length}`
    );
    try {
      const fs = await import('fs/promises');
      const path = await import('path');

      const intelDir = path.resolve('logs', 'Intelligence');
      await fs.mkdir(intelDir, { recursive: true });

      const record: Record<string, unknown> = {
        session_id: this.sessionId,
        iteration,
        timestamp: new Date().toISOString(),
        new_services: newServices,
      };

      if (profile) {
        record.target_profile = profile;
      }

      if (vulnerabilities.length > 0) {
        record.vulnerabilities = vulnerabilities;
      }

      if (playbooks.length > 0) {
        record.rag_playbooks = playbooks.map((p) => ({
          id: p.id,
          type: p.metadata.type,
          service: p.metadata.service,
          category: p.metadata.category,
          tags: p.metadata.tags,
          source: p.metadata.source,
          document: p.document,
        }));
      }

      const filename = `${this.sessionId}_iter${String(iteration).padStart(2, '0')}.json`;
      const filepath = path.join(intelDir, filename);
      await fs.writeFile(filepath, JSON.stringify(record, null, 2), 'utf-8');

      this.log(
        'INFO',
        'Intelligence',
        `✓ Logged intelligence record → logs/Intelligence/${filename}`
      );
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      this.log('WARN', 'Intelligence', `⚠ Failed to log intelligence record: ${msg}`);
    }
  }

  // ============================================================================
  // PRIVATE HELPER METHODS - Reconnaissance Loop Phases
  // ============================================================================

  /**
   * Phase 0: RAG Memory Recall (Pre-Reasoning)
   *
   * Queries the RAG memory system before reasoning to inject anti-pattern
   * warnings and lessons learned from past sessions into the Reasoner's context.
   *
   * This helps the agent avoid repeating past mistakes by providing context
   * about failed attempts and alternative approaches.
   *
   * @param observation - Current observation/scenario to query against
   * @returns void - Injects memory context directly into Reasoner if successful
   *
   * @private
   */
  private async _runRAGMemoryRecall(observation: string): Promise<void> {
    if (!this.ragMemory) return;

    this.log('INFO', 'RAG Memory', 'Phase 0: Checking for past failure warnings...');

    try {
      const { antiPatterns, formattedText } =
        await this.ragMemory.recallInternalWarnings(observation);

      if (antiPatterns.length > 0 && formattedText) {
        if (this.debugDisableAntiPatternInjection) {
          this.log('WARN', 'RAG Memory', '⚠ DEBUG: Anti-pattern injection SKIPPED');
        } else {
          this.log('INFO', 'RAG Memory', `✓ Injected ${antiPatterns.length} failure lesson(s)`);
          this.reasoner.injectAntiPatternContext(formattedText);
        }
      }
    } catch (err) {
      this.log('WARN', 'RAG Memory', `⚠ Failed (continuing without memory): ${err}`);
    }
  }

  /**
   * Phase 1: Strategic Reasoning
   *
   * Sends the current observation to the Reasoner agent (Claude Sonnet 4) to
   * get strategic decisions about what to do next. The Reasoner outputs high-level
   * actions without specifying tools or parameters.
   *
   * The Reasoner may also generate a Tactical Plan with attack vectors and
   * prediction metrics if intelligence context is available.
   *
   * @param observation - Current situation/results to reason about
   * @returns ReasonerOutput with thought, action, is_complete flag, and optional tactical_plan
   *
   * @private
   */
  private async _runReasoningPhase(observation: string): Promise<ReasonerOutput> {
    this.log('STEP', 'Reasoner', 'Analyzing situation...');
    const reasoning = await this.retryWithBackoff(() => this.reasoner.reason(observation));
    if (!reasoning) {
      throw new Error('Reasoner failed after all retries — cannot continue recon loop');
    }

    this.log('STEP', 'Reasoner', `Thought: ${reasoning.thought}`);
    this.log('STEP', 'Reasoner', `Action: ${reasoning.action}`);

    return reasoning;
  }

  /**
   * Phase 2: Tactical Execution Planning
   *
   * Takes the Reasoner's high-level strategic action and breaks it down into
   * 1-N concrete tool steps via the Executor agent (Claude Haiku 4.5).
   *
   * The Executor decides which specific tools to use (e.g., nmap_port_scan)
   * and what parameters to pass, creating an execution plan.
   *
   * @param reasoning - Strategic action from Reasoner
   * @param target - Target IP/hostname/CIDR
   * @param openPorts - Previously discovered open ports (for context)
   * @returns ExecutorPlan with ordered steps, or null if no steps to execute
   *
   * @private
   */
  private async _runExecutionPlanning(
    reasoning: ReasonerOutput,
    target: string,
    openPorts: number[]
  ): Promise<ExecutorPlan | null> {
    this.log('STEP', 'Executor', 'Planning execution...');

    const plan = await this.executor.planExecution(reasoning, {
      target,
      openPorts: openPorts.length > 0 ? openPorts : undefined,
    });

    if (plan.steps.length === 0) {
      this.log('STEP', 'Executor', 'No executable steps. Continuing analysis...');
      return null;
    }

    this.log('STEP', 'Executor', `Plan: ${plan.steps.length} step(s)`);
    plan.steps.forEach((step, i) => {
      this.log('STEP', 'Executor', `  ${i + 1}. ${step.tool}: ${step.description}`);
    });

    return plan;
  }

  /**
   * Phase 3: Tool Execution and Data Cleaning
   *
   * Executes all steps in the execution plan sequentially:
   * 1. MCPAgent executes the tool (e.g., nmap_port_scan via MCP protocol)
   * 2. DataCleanerAgent parses raw output into structured JSON
   * 3. Extracts discovered services for intelligence layer
   *
   * Tracks both successes and failures so the Reasoner receives accurate
   * feedback about what actually happened during execution.
   *
   * @param plan - Execution plan from Executor
   * @param allDiscoveredServices - Array to append discovered services to
   * @returns Object with cleaned results and failure details
   *
   * @private
   */
  private async _runToolExecutionLoop(
    plan: ExecutorPlan,
    allDiscoveredServices: DiscoveredService[]
  ): Promise<{
    results: CleanedData[];
    failures: Array<{ tool: string; error: string }>;
    repeatedCommands: string[];
    fileVulns: VulnerabilityInfo[];
  }> {
    const results: CleanedData[] = [];
    const failures: Array<{ tool: string; error: string }> = [];
    const repeatedCommands: string[] = [];
    const fileVulns: VulnerabilityInfo[] = [];
    let currentPlan = { ...plan };

    while (true) {
      const step = this.executor.getNextStep(currentPlan);
      if (!step) break;

      // Duplicate operation detection
      const commandSignature = `${step.tool}:${JSON.stringify(step.arguments)}`;
      const priorCount = this.executionHistory.get(commandSignature) || 0;
      if (priorCount > 0) {
        this.log(
          'WARN',
          'Orchestrator',
          `⚠ Repeated command detected (run #${priorCount + 1}): ${step.tool} ${JSON.stringify(step.arguments)}`
        );
        repeatedCommands.push(commandSignature);
      }
      this.executionHistory.set(commandSignature, priorCount + 1);

      // MCP Agent executes tool
      this.log('STEP', 'MCP Agent', `Executing: ${step.tool}`);
      const rawResult = await this.mcpAgent.executeTool(step);

      if (rawResult.success) {
        this.log('RESULT', 'MCP Agent', '✓ Execution successful');

        // Data Cleaner processes raw output
        this.log('STEP', 'Data Cleaner', 'Parsing output...');
        const cleanedData = await this.dataCleaner.clean(rawResult.output, step.tool);
        this.log('RESULT', 'Data Cleaner', `✓ Type: ${cleanedData.type}`);
        this.log('RESULT', 'Data Cleaner', `Summary: ${cleanedData.summary}`);

        // Extract discovered services if present, deduplicating by host:port.
        // When a duplicate is found, keep the entry with more detail (product/version).
        if (Array.isArray(cleanedData.data)) {
          const services = cleanedData.data as DiscoveredService[];
          if (services.length > 0 && 'host' in services[0]) {
            let added = 0;
            for (const s of services) {
              const key = `${s.host}:${s.port}`;
              const existingIdx = allDiscoveredServices.findIndex(
                (existing) => `${existing.host}:${existing.port}` === key
              );
              if (existingIdx === -1) {
                allDiscoveredServices.push(s);
                added++;
              } else {
                // Replace if new entry has more detail (product/version info)
                const existing = allDiscoveredServices[existingIdx];
                if (!existing.product && s.product) {
                  allDiscoveredServices[existingIdx] = s;
                  this.log('RESULT', 'Data Cleaner', `↻ Updated ${key} with enriched data`);
                }
              }
            }
            this.log(
              'RESULT',
              'Data Cleaner',
              `✓ Extracted ${services.length} services (${added} new, ${services.length - added} deduplicated)`
            );
            services.forEach((s, i) => {
              const product = s.product ? `${s.product} ${s.version || ''}`.trim() : 'unknown';
              this.log(
                'RESULT',
                'Data Cleaner',
                `  ${i + 1}. ${s.host}:${s.port} ${s.service} | product=${product} | category=${s.category} | criticality=${s.criticality} | confidence=${s.confidence}`
              );
            });
          }
        }

        // Parse vulnerability data from agent-written analysis files
        if (step.tool === 'write_file') {
          const filename = ((step.arguments?.filename as string) || '').toLowerCase();
          const content = (step.arguments?.content as string) || '';
          if (filename.includes('vuln') && content.length > 0) {
            const parsed = await this.dataCleaner.parseVulnerabilityReport(content);
            if (parsed.length > 0) {
              this.log(
                'RESULT',
                'Data Cleaner',
                `✓ Extracted ${parsed.length} vulnerabilities from ${step.arguments?.filename}`
              );
              fileVulns.push(...parsed);
            }
          }
        }

        results.push(cleanedData);
      } else {
        this.log('ERROR', 'MCP Agent', `✗ Execution failed: ${rawResult.error}`);
        failures.push({ tool: step.tool, error: rawResult.error || 'Unknown error' });
      }

      currentPlan = this.executor.advancePlan(currentPlan);
    }

    return { results, failures, repeatedCommands, fileVulns };
  }

  /**
   * Phase 4: Intelligence Layer Analysis (Incremental)
   *
   * Runs advanced intelligence analysis on discovered services:
   * 1. Profiler: OS detection, tech stack inference, security posture
   * 2. VulnLookup: CVE/exploit research via SearchSploit MCP
   * 3. RAG Memory: Query playbooks and anti-patterns for discovered services
   *
   * **Incremental Analysis**: This method only analyzes NEW services that haven't
   * been analyzed before (tracked via service fingerprints). Results are merged
   * into existing intelligence context, keeping the Reasoner up-to-date throughout
   * the mission.
   *
   * **Retry Logic**: Profiler and VulnLookup use exponential backoff retry (max 2 retries)
   * to handle transient network failures or API flakiness.
   *
   * Profiler and VulnLookup run in parallel for efficiency.
   * Results are combined into IntelligenceContext and injected into Reasoner.
   *
   * @param allDiscoveredServices - All services discovered so far
   * @param currentIntelligence - Existing intelligence context (null if first run)
   * @returns IntelligenceContext with profile, vulnerabilities, and PoC findings
   *
   * @private
   */
  private async _runIntelligencePhase(
    allDiscoveredServices: DiscoveredService[],
    currentIntelligence: IntelligenceContext | null,
    iteration: number
  ): Promise<IntelligenceContext | null> {
    this.log(
      'INFO',
      'Intelligence',
      `[iter ${iteration}] allDiscoveredServices=${allDiscoveredServices.length}`
    );

    // Skip if no services discovered
    if (allDiscoveredServices.length === 0) {
      this.log('INFO', 'Intelligence', `[iter ${iteration}] skip — no services discovered yet`);
      return currentIntelligence;
    }

    // Identify new services that haven't been analyzed yet
    const newServices = allDiscoveredServices.filter((service) => {
      const fingerprint = this.createServiceFingerprint(service);
      return !this.analyzedServiceFingerprints.has(fingerprint);
    });

    this.log(
      'INFO',
      'Intelligence',
      `[iter ${iteration}] newServices=${newServices.length}, alreadyAnalyzed=${allDiscoveredServices.length - newServices.length}`
    );

    // Skip if no new services (all already analyzed)
    if (newServices.length === 0) {
      this.log('INFO', 'Intelligence', `[iter ${iteration}] skip — all services already analyzed`);
      return currentIntelligence;
    }

    this.log(
      'STEP',
      'Intelligence',
      `Analyzing ${newServices.length} new service(s)... (${allDiscoveredServices.length} total)`
    );

    // Run Profiler and VulnLookup in parallel with retry mechanism
    const [newTargetProfile, newVulnerabilities] = await Promise.all([
      this.retryWithBackoff(
        () => this.profiler.profile(newServices),
        2, // Max 2 retries
        1000 // 1s initial delay
      ).catch((err) => {
        this.log(
          'WARN',
          'Profiler',
          `⚠ Failed after retries (continuing without profile): ${err.message}`
        );
        return null;
      }),
      this.retryWithBackoff(
        () => this.vulnLookup.findVulnerabilities(newServices),
        2, // Max 2 retries
        1000 // 1s initial delay
      ).catch((err) => {
        this.log(
          'WARN',
          'VulnLookup',
          `⚠ Failed after retries (continuing without CVE data): ${err.message}`
        );
        return [];
      }),
    ]);

    // Mark new services as analyzed
    newServices.forEach((service) => {
      const fingerprint = this.createServiceFingerprint(service);
      this.analyzedServiceFingerprints.add(fingerprint);
    });

    // Log profiler results
    if (newTargetProfile) {
      this.log(
        'RESULT',
        'Profiler',
        `✓ Profile: ${newTargetProfile.os_family || 'Unknown'} - ${newTargetProfile.security_posture}`
      );
    }

    // Log vulnerability results
    const validNewVulns = newVulnerabilities || [];
    if (validNewVulns.length > 0) {
      this.log('VULN', 'VulnLookup', `✓ Found ${validNewVulns.length} vulnerabilities`);
      validNewVulns.slice(0, 3).forEach((v) => {
        this.log('VULN', 'VulnLookup', `  - ${v.cve_id} (${v.severity})`);
      });
    }

    // Merge results into existing intelligence or create new context
    let mergedProfile: TargetProfile | undefined;
    let mergedVulnerabilities: VulnerabilityInfo[];

    if (currentIntelligence) {
      // Merge profile (prefer more detailed/recent profile)
      mergedProfile = newTargetProfile || currentIntelligence.targetProfile;

      // Merge vulnerabilities (combine and deduplicate by CVE ID)
      const existingVulns = currentIntelligence.vulnerabilities || [];
      const combinedVulns = [...existingVulns, ...validNewVulns];
      const vulnMap = new Map<string, VulnerabilityInfo>();
      combinedVulns.forEach((v) => {
        if (!vulnMap.has(v.cve_id)) {
          vulnMap.set(v.cve_id, v);
        }
      });
      mergedVulnerabilities = Array.from(vulnMap.values());

      this.log(
        'RESULT',
        'Intelligence',
        `✓ Merged intelligence: ${mergedVulnerabilities.length} total vulnerabilities`
      );
    } else {
      // First run - no merging needed
      mergedProfile = newTargetProfile || undefined;
      mergedVulnerabilities = validNewVulns;
    }

    // Build updated intelligence context
    const intelligence: IntelligenceContext = {
      discoveredServices: allDiscoveredServices,
      targetProfile: mergedProfile,
      vulnerabilities: mergedVulnerabilities,
      pocFindings: mergedVulnerabilities
        .filter((v) => v.poc_url)
        .map((v) => ({ tool: v.affected_service, url: v.poc_url! })),
    };

    // Inject updated intelligence into Reasoner
    this.reasoner.setIntelligenceContext(intelligence);
    this.log('RESULT', 'Intelligence', '✓ Intelligence context updated in Reasoner');

    // RAG Memory Recall (Playbooks + Anti-Patterns) - always run for new services
    const ragPlaybooks = await this._runRAGMemoryForIntelligence(
      newServices,
      validNewVulns,
      newTargetProfile
    );

    // Log this iteration's intelligence data to logs/Intelligence/
    await this._logIntelligenceRecord(
      iteration,
      newServices,
      newTargetProfile,
      validNewVulns,
      ragPlaybooks
    );

    return intelligence;
  }

  /**
   * Phase 4b: RAG Memory Recall for Intelligence
   *
   * Queries RAG memory with discovered services, CVEs, and target profile
   * to retrieve relevant playbooks (successful strategies) and anti-patterns
   * (failed attempts with alternatives).
   *
   * The retrieved knowledge is formatted and injected into the Reasoner's
   * context to guide tactical planning.
   *
   * @param services - Discovered services from scanning
   * @param vulnerabilities - CVEs from VulnLookup
   * @param profile - Target profile from Profiler
   * @returns void - Injects formatted memory context into Reasoner
   *
   * @private
   */
  private async _runRAGMemoryForIntelligence(
    services: DiscoveredService[],
    vulnerabilities: VulnerabilityInfo[],
    profile: TargetProfile | null
  ): Promise<RAGMemoryDocument[]> {
    if (!this.ragMemory) return [];

    this.log('INFO', 'RAG Memory', 'Phase 4b: Searching attack playbooks...');

    try {
      const serviceNames = [
        ...new Set(services.map((s) => s.product || s.service).filter((s) => s !== 'unknown')),
      ];

      const { playbooks, formattedText } = await this.ragMemory.searchHandbook({
        services: serviceNames.length > 0 ? serviceNames : undefined,
        profile: profile?.os_family || undefined,
      });

      if (playbooks.length > 0 && formattedText) {
        // Cap playbook context to prevent exceeding the 200k-token context window.
        // Full industry playbooks can be 500k+ chars; 40k chars (~10k tokens) is
        // enough to convey the key attack vectors and payloads for 3-5 playbooks.
        const MAX_PLAYBOOK_CHARS = 40_000;
        const cappedText =
          formattedText.length > MAX_PLAYBOOK_CHARS
            ? formattedText.slice(0, MAX_PLAYBOOK_CHARS) +
              '\n[... playbook content truncated to stay within context limit ...]'
            : formattedText;
        this.log(
          'INFO',
          'RAG Memory',
          `✓ Injected ${playbooks.length} attack playbook(s) (${cappedText.length}ch / ${formattedText.length}ch raw)`
        );
        this.reasoner.injectPlaybookContext(cappedText);
      }

      return playbooks;
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      this.log('WARN', 'RAG Memory', `⚠ Failed (continuing without memory): ${errorMsg}`);
      return [];
    }
  }

  /**
   * Phase 5: Evaluation and Logging
   *
   * If evaluation is enabled and a tactical plan exists:
   * 1. Runs evaluation loop to label outcomes (TP/FP/FN/TN)
   * 2. Logs session step for RAG ETL pipeline consumption
   *
   * The evaluation compares predicted outcomes with actual results to
   * generate training data for continuous improvement.
   *
   * @param reasoning - Reasoner output with tactical plan
   * @param intelligence - Intelligence context used for planning
   * @param cleanedData - Cleaned tool output
   * @param iteration - Current iteration number
   * @returns void - Side effects: writes to logs and training data files
   *
   * @private
   */
  private async _runEvaluationAndLogging(
    reasoning: ReasonerOutput,
    intelligence: IntelligenceContext | null,
    cleanedData: CleanedData,
    iteration: number,
    observation: string
  ): Promise<void> {
    // Evaluation loop (if enabled)
    if (this.config.enableEvaluation && reasoning.tactical_plan) {
      await this.runEvaluationLoop(reasoning.tactical_plan, intelligence, cleanedData, iteration);
    }

    // Session logging for RAG ETL pipeline
    if (this.config.sessionLogsPath) {
      await this.logSessionStep(observation, reasoning, cleanedData, iteration);
    }
  }

  /**
   * Phase 6: Prepare Next Observation
   *
   * Builds the observation message for the next Reasoner iteration based on
   * the most recent tool execution results. Includes:
   * - Discovered services count
   * - Target profile (OS, security posture, risk level)
   * - Vulnerabilities found (CVE list)
   * - Summary of last tool execution
   *
   * This formatted observation provides context for the Reasoner's next
   * strategic decision.
   *
   * @param lastResult - Most recent cleaned data result
   * @returns Formatted observation string for next iteration
   *
   * @private
   */
  private _prepareNextObservation(
    allResults: CleanedData[],
    failures?: Array<{ tool: string; error: string }>,
    repeatedCommands?: string[]
  ): string {
    const hasFailures = failures && failures.length > 0;

    if (allResults.length === 0 && !hasFailures) {
      return 'No executable steps were generated. The Executor could not map the requested action to available tools. Reassess the strategy using only available tools: nmap_*, searchsploit_*, rag_*.';
    }

    // Build failure report if any tools failed
    let failureReport = '';
    if (hasFailures) {
      const failureLines = failures!.map((f) => `  - ${f.tool}: ${f.error}`).join('\n');
      failureReport = `\n\nWARNING — ${failures!.length} tool(s) FAILED:\n${failureLines}\nThese actions were NOT completed. Do NOT assume their results are available.`;
    }

    if (allResults.length === 0 && hasFailures) {
      return `ALL tool executions failed this iteration. No new data was collected.${failureReport}`;
    }

    // Build summary of ALL step results so the Reasoner sees every outcome
    const stepSummaries = allResults
      .map((r, i) => `  ${i + 1}. [${r.type}] ${r.summary}`)
      .join('\n');

    let obs = `Tool execution completed (${allResults.length} step(s)):\n${stepSummaries}`;

    // Attach intelligence context from the last result that has it
    const lastWithIntel = [...allResults].reverse().find((r) => r.intelligence);
    if (lastWithIntel?.intelligence) {
      const intel = lastWithIntel.intelligence;
      obs += `\n\nDiscovered Services: ${intel.discoveredServices.length} services found`;

      if (intel.targetProfile) {
        obs += `\n\nTarget Profile:\n- OS: ${intel.targetProfile.os_family || 'Unknown'}\n- Security: ${intel.targetProfile.security_posture}\n- Risk: ${intel.targetProfile.risk_level}`;
      }

      if (intel.vulnerabilities.length > 0) {
        obs += `\n\nVulnerabilities Found: ${intel.vulnerabilities.length}\nTop CVEs: ${intel.vulnerabilities
          .slice(0, 3)
          .map((v) => v.cve_id)
          .join(', ')}`;
      }
    }

    obs += failureReport;

    // Inject strong warning for duplicate commands
    if (repeatedCommands && repeatedCommands.length > 0) {
      obs += `\n\n[SYSTEM INTERVENTION - LOOP DETECTED]`;
      obs += `\nYou have executed the EXACT same command(s) multiple times with identical parameters. This indicates your current strategy is hitting a dead end or a tool limitation.`;
      obs += `\n\nCRITICAL INSTRUCTIONS:`;
      obs += `\n1. STOP repeating the last action. It will not produce new results.`;
      obs += `\n2. RE-EVALUATE your available tools. Are you trying to perform an action (like directory scanning) with an incompatible tool?`;
      obs += `\n3. PIVOT your strategy. If you cannot verify a hypothesis with current tools, make a logical assumption based on existing evidence and proceed to the next phase (e.g., from Enumeration to Vulnerability Research).`;
      obs += `\n4. DO NOT ask for "more details" on the same service unless you change the tool or parameters significantly.`;
    }

    // Generic failure loop detection: all queries returned empty results
    const negativeKeywords = [
      'no exploits found',
      '0 results',
      'no matches',
      'not found',
      '0 shellcodes',
      '0 exploits',
      'no relevant warnings',
      'no relevant playbooks',
    ];
    const allStepsNegative =
      allResults.length > 0 &&
      allResults.every((r) => negativeKeywords.some((kw) => r.summary.toLowerCase().includes(kw)));

    if (allStepsNegative) {
      obs += `\n\n[SYSTEM ADVICE - DATABASE EXHAUSTION]`;
      obs += `\nAll your database queries (external exploits or internal RAG knowledge) yielded NO specific results for these parameters.`;
      obs += `\n\nSTRATEGY GUIDANCE:`;
      obs += `\n1. STOP searching. The information you are looking for is NOT in the current databases.`;
      obs += `\n2. DO NOT keep slightly changing keywords; it will not change the database content.`;
      obs += `\n3. USE GENERAL PRINCIPLES: If no specific CVE/Playbook is found, fall back to your general training about this technology (e.g., typical misconfigurations, common vulnerabilities for the detected service versions).`;
      obs += `\n4. PROCEED TO MANUAL STEPS: Formulate a hypothesis based on the service version and security posture, then attempt to verify it through active tools rather than passive database lookups.`;
    }

    return obs;
  }

  // ============================================================================
  // MAIN RECONNAISSANCE LOOP
  // ============================================================================

  /**
   * Runs automated reconnaissance on a target.
   *
   * This is the main agent loop that:
   * 1. Sends observations to Reasoner → gets strategic decisions
   * 2. Passes decisions to Executor → breaks into tool steps
   * 3. Executes each step via MCP Agent → gets raw output
   * 4. Cleans output via DataCleaner → structured JSON
   * 5. Feeds results back to Reasoner → continues until complete
   *
   * The loop runs up to 15 iterations or until Reasoner sets is_complete=true.
   *
   * @param target - The target to scan (IP address, hostname, or CIDR range)
   *
   * @example
   * await agent.reconnaissance('192.168.1.0/24');  // Scan a subnet
   * await agent.reconnaissance('scanme.nmap.org'); // Scan a single host
   */
  async reconnaissance(target: string): Promise<ReconResult> {
    // Generate a fresh session ID for each recon run (agent is reused across tasks in worker mode)
    this.sessionId = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    this.log('INFO', 'Orchestrator', `Starting reconnaissance on: ${target}`);
    this.log('INFO', 'Orchestrator', `Session ID: ${this.sessionId}`);
    console.log('='.repeat(60));

    // Initialize loop state
    this.reasoner.reset();
    this.analyzedServiceFingerprints.clear();
    this.executionHistory.clear();
    let iteration = 0;
    const maxIterations = 15;
    let aggregatedResults: CleanedData[] = [];
    let allDiscoveredServices: DiscoveredService[] = [];
    let currentIntelligence: IntelligenceContext | null = null;
    let observation = `Starting reconnaissance mission on target: ${target}`;
    let allTacticalPlans: TacticalPlanObject[] = [];
    const allFileVulns: VulnerabilityInfo[] = [];

    // ========================================================================
    // MAIN RECONNAISSANCE LOOP (wrapped in Langfuse trace)
    // ========================================================================
    await startActiveObservation('reconnaissance', async (rootSpan) => {
      rootSpan.update({
        input: { target, sessionId: this.sessionId },
        metadata: { maxIterations },
      });
      await propagateAttributes(
        {
          sessionId: this.sessionId,
          traceName: `recon-${target}`,
          tags: ['reconnaissance', 'pentest'],
          metadata: { target },
        },
        async () => {
          let missionComplete = false;

          while (iteration < maxIterations && !missionComplete) {
            iteration++;
            this.log('STEP', 'Orchestrator', `=== Iteration ${iteration} ===`);

            await startActiveObservation(`iteration-${iteration}`, async (iterSpan) => {
              iterSpan.update({ input: { iteration, observation: observation.substring(0, 500) } });

              // ======================================================================
              // PHASE 0: RAG Memory Recall (Pre-Reasoning)
              // ======================================================================
              await startActiveObservation('phase0-rag-recall', async (span) => {
                await this._runRAGMemoryRecall(observation);
              });

              // ======================================================================
              // PHASE 1: Strategic Reasoning
              // ======================================================================
              let reasoning!: ReasonerOutput;
              await startActiveObservation('phase1-reasoning', async (span) => {
                reasoning = await this._runReasoningPhase(observation);
                span.update({
                  output: {
                    thought: reasoning.thought,
                    action: reasoning.action,
                    is_complete: reasoning.is_complete,
                  },
                });
              });

              // Collect every tactical plan (displayed + saved after all iterations)
              if (reasoning.tactical_plan) {
                allTacticalPlans.push(reasoning.tactical_plan);
              }

              // Check if mission is complete
              if (reasoning.is_complete) {
                this.log('INFO', 'Orchestrator', 'Reasoner indicates mission complete');

                // RC2: Phase 4b was skipped this iteration (it follows Phase 1's early return).
                // Inject playbooks now using all discovered services before accepting completion.
                if (this.ragMemory && allDiscoveredServices.length > 0) {
                  await this._runRAGMemoryForIntelligence(
                    allDiscoveredServices,
                    currentIntelligence?.vulnerabilities ?? [],
                    currentIntelligence?.targetProfile ?? null
                  );
                }

                // If no tactical plan was produced, re-prompt once with the new playbook context.
                if (!reasoning.tactical_plan && allTacticalPlans.length === 0) {
                  this.log(
                    'INFO',
                    'Orchestrator',
                    'No tactical plan yet — re-prompting Reasoner with playbook context'
                  );
                  const finalReasoning = await this._runReasoningPhase(
                    'Reconnaissance is complete. You now have full playbook context injected. ' +
                      'You MUST now produce a tactical_plan with at least one attack vector before finishing. ' +
                      'Generate the plan based on all discovered services and target intelligence.'
                  );
                  if (finalReasoning.tactical_plan) {
                    allTacticalPlans.push(finalReasoning.tactical_plan);
                  }
                }

                iterSpan.update({ output: { status: 'mission_complete' } });
                missionComplete = true;
                return;
              }

              // ======================================================================
              // PHASE 2: Tactical Execution Planning
              // ======================================================================
              let plan: ExecutorPlan | null = null;
              await startActiveObservation('phase2-execution-planning', async (span) => {
                const openPorts = [...new Set(allDiscoveredServices.map((s) => s.port))];
                plan = await this._runExecutionPlanning(reasoning, target, openPorts);
                span.update({ output: { steps: plan?.steps.length ?? 0 } });
              });

              // If no executable steps, continue to next iteration
              if (!plan) {
                observation = this._prepareNextObservation([]);
                iterSpan.update({ output: { status: 'no_executable_steps' } });
                return;
              }

              // ======================================================================
              // PHASE 3: Tool Execution and Data Cleaning
              // ======================================================================
              let executionResults: CleanedData[] = [];
              let executionFailures: Array<{ tool: string; error: string }> = [];
              let repeatedCommands: string[] = [];
              await startActiveObservation('phase3-tool-execution', async (span) => {
                const result = await this._runToolExecutionLoop(plan!, allDiscoveredServices);
                executionResults = result.results;
                executionFailures = result.failures;
                repeatedCommands = result.repeatedCommands;
                if (result.fileVulns.length > 0) allFileVulns.push(...result.fileVulns);
                span.update({
                  output: {
                    results: executionResults.length,
                    failures: executionFailures.length,
                    repeatedCommands: repeatedCommands.length,
                  },
                });
              });
              aggregatedResults.push(...executionResults);

              // ======================================================================
              // PHASE 4: Intelligence Layer Analysis
              // ======================================================================
              await startActiveObservation('phase4-intelligence', async (span) => {
                currentIntelligence = await this._runIntelligencePhase(
                  allDiscoveredServices,
                  currentIntelligence,
                  iteration
                );
                span.update({
                  output: {
                    services: allDiscoveredServices.length,
                    vulnerabilities: currentIntelligence?.vulnerabilities?.length ?? 0,
                  },
                });
              });

              // Attach intelligence to the last result for downstream use
              const lastResult = executionResults[executionResults.length - 1];
              if (lastResult && currentIntelligence) {
                lastResult.intelligence = currentIntelligence;
              }

              // ======================================================================
              // PHASE 5: Evaluation and Logging
              // ======================================================================
              if (lastResult) {
                await this._runEvaluationAndLogging(
                  reasoning,
                  currentIntelligence,
                  lastResult,
                  iteration,
                  observation
                );
              }

              // ======================================================================
              // PHASE 6: Prepare Next Observation (ALL results, not just last)
              // ======================================================================
              observation = this._prepareNextObservation(
                executionResults,
                executionFailures,
                repeatedCommands
              );
              this.reasoner.addObservation(observation);

              iterSpan.update({
                output: { status: 'completed', resultsThisIteration: executionResults.length },
              });
            }); // end iteration span

            // Small delay between iterations to avoid overwhelming the system
            await new Promise((resolve) => setTimeout(resolve, 500));

            // Break out of the while loop if the reasoner indicated completion inside the iteration
            if (aggregatedResults.length > 0 || iteration >= maxIterations) {
              // Check if mission was marked complete (reasoning.is_complete was handled inside the span)
            }
          }

          rootSpan.update({
            output: {
              totalIterations: iteration,
              totalResults: aggregatedResults.length,
              servicesDiscovered: allDiscoveredServices.length,
            },
          });
        }
      ); // end propagateAttributes
    }); // end root span

    console.log('\n' + '='.repeat(60));
    this.log('INFO', 'Orchestrator', 'Reconnaissance finished');
    this.log('INFO', 'Orchestrator', `Total iterations: ${iteration}`);
    this.log('INFO', 'Orchestrator', `Results collected: ${aggregatedResults.length}`);

    // Save any remaining training data
    if (this.config.enableEvaluation && this.trainingPairs.length > 0) {
      await this.saveTrainingData();
    }

    // Print summary
    if (aggregatedResults.length > 0) {
      this.log('INFO', 'Orchestrator', '=== Summary ===');
      aggregatedResults.forEach((result, i) => {
        this.log('RESULT', 'Orchestrator', `${i + 1}. [${result.type}] ${result.summary}`);
      });
    }

    // Display and save all Tactical Plans after iterations are complete
    if (allTacticalPlans.length > 0) {
      for (const plan of allTacticalPlans) {
        this.displayTacticalPlan(plan);
      }
      await this.saveTacticalPlans(allTacticalPlans, target);
    }

    // Write merged final profile for web UI consumption
    await this._writeFinalProfile(
      target,
      allDiscoveredServices,
      currentIntelligence,
      allTacticalPlans,
      allFileVulns,
      iteration,
      aggregatedResults.length
    );

    // Print evaluation summary
    if (this.config.enableEvaluation) {
      this.log('INFO', 'Orchestrator', '=== Evaluation Summary ===');
      this.log('INFO', 'Orchestrator', `Session ID: ${this.sessionId}`);
      this.log(
        'INFO',
        'Orchestrator',
        `Training pairs collected: ${this.trainingPairs.length === 0 ? 'saved' : 'pending save'}`
      );
    }

    return {
      sessionId: this.sessionId,
      iterations: iteration,
      results: aggregatedResults,
      discoveredServices: allDiscoveredServices,
      tacticalPlans: allTacticalPlans,
      intelligence: currentIntelligence,
    };
  }

  /**
   * Runs the evaluation loop on a tactical plan's attack vectors.
   *
   * This method:
   * 1. Executes each attack vector from the tactical plan
   * 2. Collects actual tool outputs
   * 3. Sends predictions and outputs to Evaluator for labeling
   * 4. Stores training pairs (input context + prediction + label) for RLHF
   *
   * @param tacticalPlan - The tactical plan with attack vectors to evaluate
   * @param intelligence - Current intelligence context
   * @param cleanedData - Cleaned data from reconnaissance phase
   * @param iteration - Current iteration number
   */
  private async runEvaluationLoop(
    tacticalPlan: any,
    intelligence: IntelligenceContext | null,
    cleanedData: CleanedData,
    iteration: number
  ): Promise<void> {
    this.log('STEP', 'Evaluation Loop', 'Starting evaluation...');
    this.log('STEP', 'Evaluation Loop', `Plan ID: ${tacticalPlan.plan_id}`);
    this.log('STEP', 'Evaluation Loop', `Attack Vectors: ${tacticalPlan.attack_vectors.length}`);

    for (const vector of tacticalPlan.attack_vectors) {
      this.log('STEP', 'Evaluation Loop', `Executing vector: ${vector.vector_id}`);

      try {
        // Execute attack vector
        const toolResult = await this.mcpAgent.executeTool({
          tool: vector.action.tool_name,
          arguments: vector.action.parameters,
          description: `Execute attack vector ${vector.vector_id}`,
        });

        if (!toolResult.success) {
          this.log('WARN', 'Evaluation Loop', `⚠ Vector failed: ${toolResult.error}`);
          continue;
        }

        // Evaluate outcome
        this.log('STEP', 'Evaluation Loop', 'Evaluating outcome...');
        const evaluation = await this.evaluator.evaluate(
          vector.vector_id,
          vector.prediction_metrics,
          toolResult.output
        );

        this.log(
          'RESULT',
          'Evaluation Loop',
          `✓ Label: ${evaluation.label} (confidence: ${evaluation.confidence})`
        );
        this.log('RESULT', 'Evaluation Loop', `Reasoning: ${evaluation.reasoning}`);

        // Create training pair
        const trainingPair: TrainingPair = {
          session_id: this.sessionId,
          iteration: iteration,
          intelligence: intelligence || {
            discoveredServices: [],
            vulnerabilities: [],
            pocFindings: [],
          },
          reasoner_prompt: `Tactical plan for ${tacticalPlan.target_ip}`,
          tactical_plan: tacticalPlan,
          execution_output: toolResult.output,
          execution_success: toolResult.success,
          evaluation: evaluation,
          created_at: new Date().toISOString(),
          model_version: 'reasoner-sonnet-4-evaluator-haiku-3.5',
        };

        this.trainingPairs.push(trainingPair);
        this.log(
          'RESULT',
          'Evaluation Loop',
          `✓ Training pair collected (total: ${this.trainingPairs.length})`
        );
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        this.log(
          'ERROR',
          'Evaluation Loop',
          `⚠ Failed to evaluate vector ${vector.vector_id}: ${errorMessage}`
        );
      }
    }

    // Save training data after each plan evaluation
    if (this.trainingPairs.length > 0 && this.config.trainingDataPath) {
      await this.saveTrainingData();
    }
  }

  /**
   * Saves collected training pairs to JSON file.
   *
   * Training data is saved in batches as:
   * {trainingDataPath}/{sessionId}_batch_{timestamp}.json
   *
   * Each file contains an array of TrainingPair objects for RLHF training.
   */
  private async saveTrainingData(): Promise<void> {
    if (!this.config.trainingDataPath || this.trainingPairs.length === 0) {
      return;
    }

    try {
      const fs = await import('fs/promises');
      const path = await import('path');

      // Ensure directory exists
      await fs.mkdir(this.config.trainingDataPath, { recursive: true });

      // Create filename with timestamp
      const timestamp = Date.now();
      const filename = `${this.sessionId}_batch_${timestamp}.json`;
      const filepath = path.join(this.config.trainingDataPath, filename);

      // Write training pairs to file
      await fs.writeFile(filepath, JSON.stringify(this.trainingPairs, null, 2), 'utf-8');

      this.log(
        'RESULT',
        'Training Data',
        `✓ Saved ${this.trainingPairs.length} training pairs to ${filename}`
      );

      // Clear training pairs after saving
      this.trainingPairs = [];
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.log('WARN', 'Training Data', `⚠ Failed to save training data: ${errorMessage}`);
    }
  }

  /**
   * Logs a session step to JSONL file for RAG ETL pipeline.
   *
   * Each session step is logged as a single JSON line containing:
   * - session_id: Session identifier
   * - step_index: Sequential step number
   * - timestamp: ISO timestamp
   * - observation: Input observation to Reasoner
   * - reasoning: Reasoner's output (thought, action, tool)
   * - cleaned_data: Structured output after execution
   * - iteration: Loop iteration number
   *
   * The RAG ETL pipeline processes these logs to extract:
   * - Anti-patterns (failed approaches)
   * - Success patterns (effective strategies)
   * - Contextual warnings for future sessions
   *
   * @param observation - The observation sent to Reasoner
   * @param reasoning - Reasoner's decision output
   * @param cleanedData - Cleaned/structured tool output
   * @param iteration - Current iteration number
   */
  private async logSessionStep(
    observation: string,
    reasoning: any,
    cleanedData: CleanedData,
    iteration: number
  ): Promise<void> {
    if (!this.config.sessionLogsPath) {
      return;
    }

    try {
      const fs = await import('fs/promises');
      const path = await import('path');

      // Ensure directory exists
      await fs.mkdir(this.config.sessionLogsPath, { recursive: true });

      // Create filename for this session
      const filename = `${this.sessionId}.jsonl`;
      const filepath = path.join(this.config.sessionLogsPath, filename);

      // Build session step object
      const sessionStep: SessionStep = {
        session_id: this.sessionId,
        step_index: this.stepIndex++,
        timestamp: new Date().toISOString(),
        role: 'agent',
        observation: {
          last_tool_output: observation,
          open_ports: this.extractOpenPorts(cleanedData),
          target_info: this.extractTargetInfo(cleanedData),
        },
        thought_process: {
          analysis: reasoning.thought || '',
          reasoning: reasoning.action || '',
          plan: reasoning.tool ? `Execute ${reasoning.tool}` : 'Continue analysis',
        },
        action: {
          tool_name: reasoning.tool || 'none',
          tool_args: reasoning.arguments || {},
        },
        result: cleanedData.summary,
        outcome_label: this.determineOutcomeLabel(cleanedData),
      };

      // Append as single JSON line
      const jsonLine = JSON.stringify(sessionStep) + '\n';
      await fs.appendFile(filepath, jsonLine, 'utf-8');
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.log('WARN', 'Session Logging', `⚠ Failed to log session step: ${errorMessage}`);
    }
  }

  /**
   * Extracts open ports from cleaned data for session logging.
   *
   * @param cleanedData - Cleaned data from tool execution
   * @returns Array of port numbers if available
   */
  private extractOpenPorts(cleanedData: CleanedData): number[] | undefined {
    if (Array.isArray(cleanedData.data)) {
      const services = cleanedData.data as any[];
      if (services.length > 0 && 'port' in services[0]) {
        return services.map((s) => s.port).filter((p) => typeof p === 'number');
      }
    }
    return undefined;
  }

  /**
   * Extracts target info from cleaned data for session logging.
   *
   * @param cleanedData - Cleaned data from tool execution
   * @returns Target information object if available
   */
  private extractTargetInfo(cleanedData: CleanedData): Record<string, unknown> | undefined {
    if (cleanedData.intelligence?.targetProfile) {
      return {
        os_family: cleanedData.intelligence.targetProfile.os_family,
        security_posture: cleanedData.intelligence.targetProfile.security_posture,
        risk_level: cleanedData.intelligence.targetProfile.risk_level,
      };
    }
    return undefined;
  }

  /**
   * Determines outcome label for session logging.
   *
   * @param cleanedData - Cleaned data from tool execution
   * @returns Outcome label: 'success', 'failed', or 'partial'
   */
  private determineOutcomeLabel(cleanedData: CleanedData): 'success' | 'failed' | 'partial' {
    if (cleanedData.type === 'error') {
      return 'failed';
    }
    if (Array.isArray(cleanedData.data) && cleanedData.data.length > 0) {
      return 'success';
    }
    if (cleanedData.data && typeof cleanedData.data === 'object') {
      return 'success';
    }
    return 'partial';
  }

  /**
   * Displays a tactical plan as formatted JSON in the console.
   *
   * @param plan - The tactical plan object to display
   */
  private displayTacticalPlan(plan: TacticalPlanObject): void {
    console.log('\n[Tactical Plan] ═══════════════════════════════════════════════════');
    console.log(JSON.stringify(plan, null, 2));
    console.log('[Tactical Plan] ═══════════════════════════════════════════════════\n');
  }

  /**
   * Saves all tactical plans from a recon session to the Tactical/ folder.
   *
   * Each plan is saved as an individual JSON file:
   *   Tactical/{sessionId}_{plan_id}.json
   *
   * @param plans - Array of tactical plans collected during reconnaissance
   * @param target - The target that was scanned (for metadata)
   */
  private async saveTacticalPlans(plans: TacticalPlanObject[], target: string): Promise<void> {
    try {
      const fs = await import('fs/promises');
      const path = await import('path');

      const tacticalDir = path.resolve('Tactical');
      await fs.mkdir(tacticalDir, { recursive: true });

      for (const plan of plans) {
        const filename = `${this.sessionId}_${plan.plan_id}.json`;
        const filepath = path.join(tacticalDir, filename);
        await fs.writeFile(filepath, JSON.stringify(plan, null, 2), 'utf-8');
        plan.plan_file_path = filepath;
        this.log('RESULT', 'Tactical Plan', `✓ Saved ${filename}`);
      }

      this.log('RESULT', 'Tactical Plan', `✓ ${plans.length} plan(s) saved to ${tacticalDir}`);
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.log('WARN', 'Tactical Plan', `⚠ Failed to save tactical plans: ${errorMessage}`);
    }
  }

  /**
   * Starts an interactive REPL (Read-Eval-Print Loop) mode.
   *
   * Allows users to:
   * - Type natural language queries about security reconnaissance
   * - The Reasoner interprets queries and suggests/executes tools
   * - Results are displayed and conversation continues
   *
   * Type "exit" to quit interactive mode.
   *
   * @example
   * You: Scan ports on 192.168.1.1
   * [Reasoner] Thought: User wants a port scan...
   * [MCP Agent] Executing: nmap_port_scan...
   */
  async interactive(): Promise<void> {
    const readline = await import('readline');
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    console.log('\n[Orchestrator] Interactive mode started.');
    console.log('[Orchestrator] Type your queries. Type "exit" to quit.\n');

    const prompt = (): void => {
      rl.question('You: ', async (input: string) => {
        if (input.toLowerCase() === 'exit') {
          rl.close();
          return;
        }

        try {
          // Get reasoning from Reasoner
          const reasoning = await this.reasoner.reason(input);
          console.log(`\n[Reasoner] Thought: ${reasoning.thought}`);
          console.log(`[Reasoner] Action: ${reasoning.action}`);

          // Skip execution if mission is complete
          if (reasoning.is_complete) {
            console.log('\n[Reasoner] Task complete.');
            prompt();
            return;
          }

          // Have Executor break down the action
          const plan = await this.executor.planExecution(reasoning);

          if (plan.steps.length > 0) {
            const step = this.executor.getNextStep(plan);

            if (step) {
              console.log(`\n[MCP Agent] Executing: ${step.tool}...`);
              const result = await this.mcpAgent.executeTool(step);

              if (result.success) {
                const cleaned = await this.dataCleaner.clean(result.output, step.tool);
                console.log(`\n[Data Cleaner] ${cleaned.summary}`);
                console.log(
                  `[Data Cleaner] Data: ${JSON.stringify(cleaned.data, null, 2).substring(0, 500)}...`
                );
                this.reasoner.addObservation(`Result: ${cleaned.summary}`);
              } else {
                console.log(`[MCP Agent] Error: ${result.error}`);
              }
            }
          }
        } catch (error: unknown) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          console.error('[Orchestrator] Error:', errorMessage);
        }

        console.log('');
        prompt();
      });
    };

    prompt();
  }

  /**
   * Gracefully shuts down the agent and all connections.
   *
   * Disconnects all MCP clients (Nmap server, etc.) and releases resources.
   * Should always be called when done using the agent.
   */
  async shutdown(): Promise<void> {
    await this.mcpAgent.shutdown();
    this.log('INFO', 'Orchestrator', 'Shutdown complete');
  }
}
