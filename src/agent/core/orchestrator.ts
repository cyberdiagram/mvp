// Main Orchestrator - Coordinates all subagents

import { ReasonerAgent, ProfilerAgent, EvaluatorAgent } from '../intelligence/index.js';
import { VulnLookupAgent, RAGMemoryAgent } from '../knowledge/index.js';
import { ExecutorAgent, DualMCPAgent, AgenticExecutor, DataCleanerAgent } from '../execution/index.js';
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
    console.log('[Orchestrator] Initializing multi-agent system...');

    // Load skills and inject into agents
    await this.skillManager.loadSkills();
    const skillContext = this.skillManager.buildSkillContext('reconnaissance pentest');
    this.reasoner.setSkillContext(skillContext);
    const parsingSkills = this.skillManager.buildSkillContext('fingerprint parsing');
    this.dataCleaner.setSkillContext(parsingSkills);
    console.log('[Orchestrator] ✓ Skills loaded (Reasoner + DataCleaner)');

    // Initialize Dual MCP Agent (RAG stdio + Kali HTTP)
    await this.mcpAgent.initialize({
      ragMemory: this.config.ragMemoryServerPath
        ? { path: this.config.ragMemoryServerPath }
        : undefined,
      kali: this.config.kaliMcpUrl
        ? { url: this.config.kaliMcpUrl }
        : undefined,
    });
    console.log('[Orchestrator] ✓ Dual MCP Agent initialized');

    // Build dynamic tool list from Kali discovery + RAG tools
    const kaliTools = this.mcpAgent.getKaliToolNames();
    const allTools = [...kaliTools, 'rag_recall', 'rag_query_playbooks'];
    this.executor = new ExecutorAgent(this.config.anthropicApiKey, allTools);

    // Initialize AgenticExecutor (autonomous OODA loop)
    if (this.mcpAgent.isKaliConnected()) {
      this.agenticExecutor = new AgenticExecutor(this.mcpAgent, this.skillManager);
      console.log('[Orchestrator] ✓ Agentic Executor initialized');
    }

    console.log('[Orchestrator] Ready!');
    console.log(
      '[Orchestrator] Core Agents: Reasoner (Sonnet 4), Executor (Haiku 4.5), MCP Agent, Data Cleaner (Haiku 4.5)'
    );
    console.log(
      '[Orchestrator] Intelligence Layer: Profiler (Haiku 3.5), VulnLookup (SearchSploit MCP)'
    );
    if (this.ragMemory) {
      console.log('[Orchestrator] RAG Memory: Enabled (Playbooks + Anti-Patterns)');
    }
    if (this.config.enableEvaluation) {
      console.log('[Orchestrator] Evaluation: Enabled (Evaluator Haiku 3.5)');
    }
    if (this.config.enableRAGMemory) {
      console.log('[Orchestrator] RAG Memory: Enabled');
    }
    console.log(`[Orchestrator] Session ID: ${this.sessionId}`);
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
          const delayMs = initialDelayMs * Math.pow(2, attempt); // Exponential backoff
          console.log(
            `  ⚠ Attempt ${attempt + 1}/${maxRetries + 1} failed, retrying in ${delayMs}ms...`
          );
          await new Promise((resolve) => setTimeout(resolve, delayMs));
        }
      }
    }

    // All retries exhausted
    console.log(`  ✗ All ${maxRetries + 1} attempts failed:`, lastError?.message);
    return null;
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

    console.log('\n[RAG Memory] Phase 0: Checking for past failure warnings...');

    try {
      const { antiPatterns, formattedText } =
        await this.ragMemory.recallInternalWarnings(observation);

      if (antiPatterns.length > 0 && formattedText) {
        if (this.debugDisableAntiPatternInjection) {
          console.log('[RAG Memory] ⚠ DEBUG: Anti-pattern injection SKIPPED');
        } else {
          console.log(`[RAG Memory] ✓ Injected ${antiPatterns.length} failure lesson(s)`);
          this.reasoner.injectMemoryContext(formattedText);
        }
      }
    } catch (err) {
      console.log('[RAG Memory] ⚠ Failed (continuing without memory):', err);
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
    console.log('\n[Reasoner] Analyzing situation...');
    const reasoning = await this.reasoner.reason(observation);

    console.log(`[Reasoner] Thought: ${reasoning.thought}`);
    console.log(`[Reasoner] Action: ${reasoning.action}`);

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
    console.log('\n[Executor] Planning execution...');

    const plan = await this.executor.planExecution(reasoning, {
      target,
      openPorts: openPorts.length > 0 ? openPorts : undefined,
    });

    if (plan.steps.length === 0) {
      console.log('[Executor] No executable steps. Continuing analysis...');
      return null;
    }

    console.log(`[Executor] Plan: ${plan.steps.length} step(s)`);
    plan.steps.forEach((step, i) => {
      console.log(`  ${i + 1}. ${step.tool}: ${step.description}`);
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
  }> {
    const results: CleanedData[] = [];
    const failures: Array<{ tool: string; error: string }> = [];
    const repeatedCommands: string[] = [];
    let currentPlan = { ...plan };

    while (true) {
      const step = this.executor.getNextStep(currentPlan);
      if (!step) break;

      // Duplicate operation detection
      const commandSignature = `${step.tool}:${JSON.stringify(step.arguments)}`;
      const priorCount = this.executionHistory.get(commandSignature) || 0;
      if (priorCount > 0) {
        console.log(
          `[Orchestrator] ⚠ Repeated command detected (run #${priorCount + 1}): ${step.tool} ${JSON.stringify(step.arguments)}`
        );
        repeatedCommands.push(commandSignature);
      }
      this.executionHistory.set(commandSignature, priorCount + 1);

      // MCP Agent executes tool
      console.log(`\n[MCP Agent] Executing: ${step.tool}`);
      const rawResult = await this.mcpAgent.executeTool(step);

      if (rawResult.success) {
        console.log('[MCP Agent] ✓ Execution successful');

        // Data Cleaner processes raw output
        console.log('[Data Cleaner] Parsing output...');
        const cleanedData = await this.dataCleaner.clean(rawResult.output, step.tool);
        console.log(`[Data Cleaner] ✓ Type: ${cleanedData.type}`);
        console.log(`[Data Cleaner] Summary: ${cleanedData.summary}`);

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
                  console.log(`[Data Cleaner] ↻ Updated ${key} with enriched data`);
                }
              }
            }
            console.log(
              `[Data Cleaner] ✓ Extracted ${services.length} services (${added} new, ${services.length - added} deduplicated)`
            );
            services.forEach((s, i) => {
              const product = s.product ? `${s.product} ${s.version || ''}`.trim() : 'unknown';
              console.log(
                `[Data Cleaner]   ${i + 1}. ${s.host}:${s.port} ${s.service} | product=${product} | category=${s.category} | criticality=${s.criticality} | confidence=${s.confidence}`
              );
            });
          }
        }

        results.push(cleanedData);
      } else {
        console.log(`[MCP Agent] ✗ Execution failed: ${rawResult.error}`);
        failures.push({ tool: step.tool, error: rawResult.error || 'Unknown error' });
      }

      currentPlan = this.executor.advancePlan(currentPlan);
    }

    return { results, failures, repeatedCommands };
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
    currentIntelligence: IntelligenceContext | null
  ): Promise<IntelligenceContext | null> {
    // Skip if no services discovered
    if (allDiscoveredServices.length === 0) {
      return currentIntelligence;
    }

    // Identify new services that haven't been analyzed yet
    const newServices = allDiscoveredServices.filter((service) => {
      const fingerprint = this.createServiceFingerprint(service);
      return !this.analyzedServiceFingerprints.has(fingerprint);
    });

    // Skip if no new services (all already analyzed)
    if (newServices.length === 0) {
      return currentIntelligence;
    }

    console.log(
      `\n[Intelligence Layer] Analyzing ${newServices.length} new service(s)... (${allDiscoveredServices.length} total)`
    );

    // Run Profiler and VulnLookup in parallel with retry mechanism
    const [newTargetProfile, newVulnerabilities] = await Promise.all([
      this.retryWithBackoff(
        () => this.profiler.profile(newServices),
        2, // Max 2 retries
        1000 // 1s initial delay
      ).catch((err) => {
        console.log('[Profiler] ⚠ Failed after retries (continuing without profile):', err.message);
        return null;
      }),
      this.retryWithBackoff(
        () => this.vulnLookup.findVulnerabilities(newServices),
        2, // Max 2 retries
        1000 // 1s initial delay
      ).catch((err) => {
        console.log(
          '[VulnLookup] ⚠ Failed after retries (continuing without CVE data):',
          err.message
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
      console.log(
        `[Profiler] ✓ Profile: ${newTargetProfile.os_family || 'Unknown'} - ${newTargetProfile.security_posture}`
      );
    }

    // Log vulnerability results
    const validNewVulns = newVulnerabilities || [];
    if (validNewVulns.length > 0) {
      console.log(`[VulnLookup] ✓ Found ${validNewVulns.length} vulnerabilities`);
      validNewVulns.slice(0, 3).forEach((v) => {
        console.log(`  - ${v.cve_id} (${v.severity})`);
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

      console.log(
        `[Intelligence Layer] ✓ Merged intelligence: ${mergedVulnerabilities.length} total vulnerabilities`
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
    console.log('[Intelligence Layer] ✓ Intelligence context updated in Reasoner');

    // RAG Memory Recall (Playbooks + Anti-Patterns) - always run for new services
    await this._runRAGMemoryForIntelligence(newServices, validNewVulns, newTargetProfile);

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
  ): Promise<void> {
    if (!this.ragMemory) return;

    console.log('\n[RAG Memory] Phase 4b: Searching attack playbooks...');

    try {
      const serviceNames = [
        ...new Set(services.map((s) => s.product || s.service).filter((s) => s !== 'unknown')),
      ];

      const { playbooks, formattedText } = await this.ragMemory.searchHandbook({
        services: serviceNames.length > 0 ? serviceNames : undefined,
        profile: profile?.os_family || undefined,
      });

      if (playbooks.length > 0 && formattedText) {
        console.log(`[RAG Memory] ✓ Injected ${playbooks.length} attack playbook(s)`);
        this.reasoner.injectMemoryContext(formattedText);
      }
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.log('[RAG Memory] ⚠ Failed (continuing without memory):', errorMsg);
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
    const negativeKeywords = ['no exploits found', '0 results', 'no matches', 'not found', '0 shellcodes', '0 exploits', 'no relevant warnings', 'no relevant playbooks'];
    const allStepsNegative = allResults.length > 0 && allResults.every((r) =>
      negativeKeywords.some((kw) => r.summary.toLowerCase().includes(kw))
    );

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
  async reconnaissance(target: string): Promise<void> {
    console.log(`\n[Orchestrator] Starting reconnaissance on: ${target}`);
    console.log(`[Orchestrator] Session ID: ${this.sessionId}`);
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

    // ========================================================================
    // MAIN RECONNAISSANCE LOOP (wrapped in Langfuse trace)
    // ========================================================================
    await startActiveObservation('reconnaissance', async (rootSpan) => {
    rootSpan.update({
      input: { target, sessionId: this.sessionId },
      metadata: { maxIterations },
    });
    await propagateAttributes({
      sessionId: this.sessionId,
      traceName: `recon-${target}`,
      tags: ['reconnaissance', 'pentest'],
      metadata: { target },
    }, async () => {

    let missionComplete = false;

    while (iteration < maxIterations && !missionComplete) {
      iteration++;
      console.log(`\n[Orchestrator] === Iteration ${iteration} ===`);

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
          output: { thought: reasoning.thought, action: reasoning.action, is_complete: reasoning.is_complete },
        });
      });

      // Collect every tactical plan (displayed + saved after all iterations)
      if (reasoning.tactical_plan) {
        allTacticalPlans.push(reasoning.tactical_plan);
      }

      // Check if mission is complete
      if (reasoning.is_complete) {
        console.log('\n[Orchestrator] Reasoner indicates mission complete');
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
          currentIntelligence
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

      iterSpan.update({ output: { status: 'completed', resultsThisIteration: executionResults.length } });
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

    }); // end propagateAttributes
    }); // end root span

    console.log('\n' + '='.repeat(60));
    console.log('[Orchestrator] Reconnaissance finished');
    console.log(`[Orchestrator] Total iterations: ${iteration}`);
    console.log(`[Orchestrator] Results collected: ${aggregatedResults.length}`);

    // Save any remaining training data
    if (this.config.enableEvaluation && this.trainingPairs.length > 0) {
      await this.saveTrainingData();
    }

    // Print summary
    if (aggregatedResults.length > 0) {
      console.log('\n[Orchestrator] === Summary ===');
      aggregatedResults.forEach((result, i) => {
        console.log(`${i + 1}. [${result.type}] ${result.summary}`);
      });
    }

    // Display and save all Tactical Plans after iterations are complete
    if (allTacticalPlans.length > 0) {
      for (const plan of allTacticalPlans) {
        this.displayTacticalPlan(plan);
      }
      await this.saveTacticalPlans(allTacticalPlans, target);
    }

    // Print evaluation summary
    if (this.config.enableEvaluation) {
      console.log('\n[Orchestrator] === Evaluation Summary ===');
      console.log(`[Orchestrator] Session ID: ${this.sessionId}`);
      console.log(
        `[Orchestrator] Training pairs collected: ${this.trainingPairs.length === 0 ? 'saved' : 'pending save'}`
      );
    }
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
    console.log('\n[Evaluation Loop] Starting evaluation...');
    console.log(`[Evaluation Loop] Plan ID: ${tacticalPlan.plan_id}`);
    console.log(`[Evaluation Loop] Attack Vectors: ${tacticalPlan.attack_vectors.length}`);

    for (const vector of tacticalPlan.attack_vectors) {
      console.log(`\n[Evaluation Loop] Executing vector: ${vector.vector_id}`);

      try {
        // Execute attack vector
        const toolResult = await this.mcpAgent.executeTool({
          tool: vector.action.tool_name,
          arguments: vector.action.parameters,
          description: `Execute attack vector ${vector.vector_id}`,
        });

        if (!toolResult.success) {
          console.log(`[Evaluation Loop] ⚠ Vector failed: ${toolResult.error}`);
          continue;
        }

        // Evaluate outcome
        console.log('[Evaluation Loop] Evaluating outcome...');
        const evaluation = await this.evaluator.evaluate(
          vector.vector_id,
          vector.prediction_metrics,
          toolResult.output
        );

        console.log(
          `[Evaluation Loop] ✓ Label: ${evaluation.label} (confidence: ${evaluation.confidence})`
        );
        console.log(`[Evaluation Loop] Reasoning: ${evaluation.reasoning}`);

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
        console.log(
          `[Evaluation Loop] ✓ Training pair collected (total: ${this.trainingPairs.length})`
        );
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.log(
          `[Evaluation Loop] ⚠ Failed to evaluate vector ${vector.vector_id}: ${errorMessage}`
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

      console.log(
        `[Training Data] ✓ Saved ${this.trainingPairs.length} training pairs to ${filename}`
      );

      // Clear training pairs after saving
      this.trainingPairs = [];
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.log(`[Training Data] ⚠ Failed to save training data: ${errorMessage}`);
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
      console.log(`[Session Logging] ⚠ Failed to log session step: ${errorMessage}`);
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
  private async saveTacticalPlans(
    plans: TacticalPlanObject[],
    target: string
  ): Promise<void> {
    try {
      const fs = await import('fs/promises');
      const path = await import('path');

      const tacticalDir = path.resolve('Tactical');
      await fs.mkdir(tacticalDir, { recursive: true });

      for (const plan of plans) {
        const filename = `${this.sessionId}_${plan.plan_id}.json`;
        const filepath = path.join(tacticalDir, filename);
        await fs.writeFile(filepath, JSON.stringify(plan, null, 2), 'utf-8');
        console.log(`[Tactical Plan] ✓ Saved ${filename}`);
      }

      console.log(
        `[Tactical Plan] ✓ ${plans.length} plan(s) saved to ${tacticalDir}`
      );
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.log(`[Tactical Plan] ⚠ Failed to save tactical plans: ${errorMessage}`);
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
    console.log('[Orchestrator] Shutdown complete');
  }
}
