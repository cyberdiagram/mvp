// Main Orchestrator - Coordinates all subagents

import { SkillsLoader } from './skillsLoader.js';
import {
  ReasonerAgent,
  ExecutorAgent,
  MCPAgent,
  DataCleanerAgent,
  ProfilerAgent,
  VulnLookupAgent,
  EvaluatorAgent,
  CleanedData,
  DiscoveredService,
  IntelligenceContext,
  TrainingPair,
  SessionStep,
} from './definitions/index.js';

export interface AgentConfig {
  anthropicApiKey: string;
  skillsDir: string;
  mcpServers: {
    nmap: { path: string };
    searchsploit?: { path: string };
    rag_memory?: { path: string };
  };
  enableEvaluation?: boolean;
  enableRAGMemory?: boolean;
  trainingDataPath?: string;
  sessionLogsPath?: string;
}

/**
 * PentestAgent - Main orchestrator for the multi-agent penetration testing system.
 *
 * This class coordinates seven specialized subagents:
 * - ReasonerAgent (Sonnet 4): Strategic brain with tactical planning
 * - ExecutorAgent (Haiku 4.5): Breaks plans into executable tool steps
 * - MCPAgent: Executes security tools via MCP protocol (Nmap, SearchSploit, RAG)
 * - DataCleanerAgent (Haiku 4.5): Parses and enriches tool output
 * - ProfilerAgent (Haiku 3.5): Target profiling (OS, tech stack, security posture)
 * - VulnLookupAgent: Vulnerability research via SearchSploit MCP
 * - EvaluatorAgent (Haiku 3.5): Post-execution evaluation and labeling
 *
 * The agent follows an enhanced iterative loop with Intelligence Layer:
 * Reasoner → Executor → MCP → DataCleaner → Intelligence Layer (Profiler + VulnLookup)
 * → back to Reasoner with enriched intelligence → Evaluation Loop → Training Data
 */
export class PentestAgent {
  /** Configuration for the agent system */
  private config: AgentConfig;

  /**
   * Skills and rules loader - exposed publicly for Memory Manager access.
   *
   * The SkillsLoader provides:
   * - Skill documents loading (*_skill.md)
   * - Memory Manager (addRule, removeRule, listRules)
   * - Context building for LLM injection
   *
   * @public
   */
  public skillsLoader: SkillsLoader;

  /** Strategic reasoning agent (Claude Sonnet 4) */
  private reasoner: ReasonerAgent;

  /** Execution planning agent (Claude Haiku 4.5) */
  private executor: ExecutorAgent;

  /** MCP protocol agent for tool execution */
  private mcpAgent: MCPAgent;

  /** Data cleaning/parsing agent (Claude Haiku 4.5) */
  private dataCleaner: DataCleanerAgent;

  /** Target profiling agent (Claude Haiku 3.5) */
  private profiler: ProfilerAgent;

  /** Vulnerability lookup agent (SearchSploit MCP) */
  private vulnLookup: VulnLookupAgent;

  /** Evaluation agent (Claude Haiku 3.5) */
  private evaluator: EvaluatorAgent;

  /** Session ID for tracking and logging */
  private sessionId: string;

  /** Collected training pairs for RLHF */
  private trainingPairs: TrainingPair[] = [];

  /** Step index for session logging */
  private stepIndex: number = 0;

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
    this.skillsLoader = new SkillsLoader(config.skillsDir);
    this.reasoner = new ReasonerAgent(config.anthropicApiKey);
    this.executor = new ExecutorAgent(config.anthropicApiKey);
    this.mcpAgent = new MCPAgent();
    this.dataCleaner = new DataCleanerAgent(config.anthropicApiKey);
    this.profiler = new ProfilerAgent(config.anthropicApiKey);
    this.vulnLookup = new VulnLookupAgent(this.mcpAgent);
    this.evaluator = new EvaluatorAgent(config.anthropicApiKey);

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

    // Load skills
    await this.skillsLoader.loadSkills();
    const skillContext = this.skillsLoader.buildSkillContext('reconnaissance pentest');
    this.reasoner.setSkillContext(skillContext);
    console.log('[Orchestrator] ✓ Skills loaded');

    // Initialize MCP Agent
    await this.mcpAgent.initialize({
      servers: this.config.mcpServers,
    });
    console.log('[Orchestrator] ✓ MCP Agent initialized');

    console.log('[Orchestrator] Ready!');
    console.log('[Orchestrator] Core Agents: Reasoner (Sonnet 4), Executor (Haiku 4.5), MCP Agent, Data Cleaner (Haiku 4.5)');
    console.log('[Orchestrator] Intelligence Layer: Profiler (Haiku 3.5), VulnLookup (SearchSploit MCP)');
    if (this.config.enableEvaluation) {
      console.log('[Orchestrator] Evaluation: Enabled (Evaluator Haiku 3.5)');
    }
    if (this.config.enableRAGMemory) {
      console.log('[Orchestrator] RAG Memory: Enabled');
    }
    console.log(`[Orchestrator] Session ID: ${this.sessionId}`);
  }

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

    this.reasoner.reset();
    let iteration = 0;
    const maxIterations = 15;
    let aggregatedResults: CleanedData[] = [];
    let allDiscoveredServices: DiscoveredService[] = [];
    let currentIntelligence: IntelligenceContext | null = null;

    // Initial observation to Reasoner
    let observation = `Starting reconnaissance mission on target: ${target}`;

    while (iteration < maxIterations) {
      iteration++;
      console.log(`\n[Orchestrator] === Iteration ${iteration} ===`);

      // STEP 0: RAG MEMORY RECALL (before reasoning)
      if (this.config.enableRAGMemory && this.config.mcpServers.rag_memory) {
        console.log('\n[RAG Memory] Querying past experience...');
        try {
          const memoryRecall = await this.mcpAgent.executeTool({
            tool: 'rag_recall',
            arguments: { observation, top_k: 3 },
            description: 'Recall anti-patterns from past sessions',
          });
          if (memoryRecall.success && memoryRecall.output) {
            console.log('[RAG Memory] ✓ Injecting warnings into Reasoner context');
            this.reasoner.injectMemoryContext(memoryRecall.output);
          }
        } catch (err) {
          console.log('[RAG Memory] ⚠ Failed (continuing without memory):', err);
        }
      }

      // Step 1: REASONER - Strategic planning
      console.log('\n[Reasoner] Analyzing situation...');
      const reasoning = await this.reasoner.reason(observation);

      console.log(`[Reasoner] Thought: ${reasoning.thought}`);
      console.log(`[Reasoner] Action: ${reasoning.action}`);

      // Check if mission is complete
      if (reasoning.is_complete) {
        console.log('\n[Orchestrator] Reasoner indicates mission complete');
        break;
      }

      // Step 2: EXECUTOR - Break down into steps
      console.log('\n[Executor] Planning execution...');
      const plan = await this.executor.planExecution(reasoning);

      if (plan.steps.length === 0) {
        console.log('[Executor] No executable steps. Continuing analysis...');
        observation = 'No tools to execute. Continue with analysis or indicate completion.';
        continue;
      }

      console.log(`[Executor] Plan: ${plan.steps.length} step(s)`);
      plan.steps.forEach((step, i) => {
        console.log(`  ${i + 1}. ${step.tool}: ${step.description}`);
      });

      // Step 3: Execute each step via MCP Agent and clean with Data Cleaner
      let currentPlan = { ...plan };

      while (true) {
        const step = this.executor.getNextStep(currentPlan);
        if (!step) break;

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

          // Extract discovered services if present
          if (Array.isArray(cleanedData.data)) {
            const services = cleanedData.data as DiscoveredService[];
            if (services.length > 0 && 'host' in services[0]) {
              allDiscoveredServices.push(...services);
              console.log(`[Data Cleaner] ✓ Extracted ${services.length} services`);
            }
          }

          // STEP 4: INTELLIGENCE LAYER (Parallel execution)
          if (allDiscoveredServices.length > 0 && !currentIntelligence) {
            console.log('\n[Intelligence Layer] Starting parallel analysis...');

            const [targetProfile, vulnerabilities] = await Promise.all([
              this.profiler.profile(allDiscoveredServices).catch((err) => {
                console.log('[Profiler] ⚠ Failed (continuing without profile):', err.message);
                return null;
              }),
              this.vulnLookup
                .findVulnerabilities(allDiscoveredServices)
                .catch((err) => {
                  console.log('[VulnLookup] ⚠ Failed (continuing without CVE data):', err.message);
                  return [];
                }),
            ]);

            if (targetProfile) {
              console.log(
                `[Profiler] ✓ Profile: ${targetProfile.os_family || 'Unknown'} - ${targetProfile.security_posture}`
              );
            }

            if (vulnerabilities.length > 0) {
              console.log(`[VulnLookup] ✓ Found ${vulnerabilities.length} vulnerabilities`);
              vulnerabilities.slice(0, 3).forEach((v) => {
                console.log(`  - ${v.cve_id} (${v.severity})`);
              });
            }

            // Build intelligence context
            currentIntelligence = {
              discoveredServices: allDiscoveredServices,
              targetProfile: targetProfile || undefined,
              vulnerabilities: vulnerabilities,
              pocFindings: vulnerabilities
                .filter((v) => v.poc_url)
                .map((v) => ({ tool: v.affected_service, url: v.poc_url! })),
            };

            // Inject intelligence into Reasoner
            this.reasoner.setIntelligenceContext(currentIntelligence);
            console.log('[Intelligence Layer] ✓ Intelligence context injected into Reasoner');

            // Attach to cleaned data
            cleanedData.intelligence = currentIntelligence;
          }

          aggregatedResults.push(cleanedData);

          // STEP 5: EVALUATION LOOP (if tactical plan exists)
          if (this.config.enableEvaluation && reasoning.tactical_plan) {
            await this.runEvaluationLoop(
              reasoning.tactical_plan,
              currentIntelligence,
              cleanedData,
              iteration
            );
          }

          // STEP 5b: SESSION LOGGING (for RAG ETL pipeline)
          if (this.config.sessionLogsPath) {
            await this.logSessionStep(observation, reasoning, cleanedData, iteration);
          }
        } else {
          console.log(`[MCP Agent] ✗ Execution failed: ${rawResult.error}`);
        }

        currentPlan = this.executor.advancePlan(currentPlan);
      }

      // Step 6: Feed enriched results back to Reasoner
      const lastResult = aggregatedResults[aggregatedResults.length - 1];
      if (lastResult) {
        if (lastResult.intelligence) {
          const intel = lastResult.intelligence;
          observation = `Tool execution completed.\n\nDiscovered Services: ${intel.discoveredServices.length} services found`;
          if (intel.targetProfile) {
            observation += `\n\nTarget Profile:\n- OS: ${intel.targetProfile.os_family || 'Unknown'}\n- Security: ${intel.targetProfile.security_posture}\n- Risk: ${intel.targetProfile.risk_level}`;
          }
          if (intel.vulnerabilities.length > 0) {
            observation += `\n\nVulnerabilities Found: ${intel.vulnerabilities.length}\nTop CVEs: ${intel.vulnerabilities.slice(0, 3).map((v) => v.cve_id).join(', ')}`;
          }
          observation += `\n\nSummary: ${lastResult.summary}`;
        } else {
          observation = `Tool execution completed.\nResult: ${JSON.stringify(lastResult.data, null, 2)}\nSummary: ${lastResult.summary}`;
        }
        this.reasoner.addObservation(observation);
      } else {
        observation = 'Tool execution completed but no results obtained.';
      }

      // Small delay between iterations
      await new Promise((resolve) => setTimeout(resolve, 500));
    }

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

    // Print evaluation summary
    if (this.config.enableEvaluation) {
      console.log('\n[Orchestrator] === Evaluation Summary ===');
      console.log(`[Orchestrator] Session ID: ${this.sessionId}`);
      console.log(`[Orchestrator] Training pairs collected: ${this.trainingPairs.length === 0 ? 'saved' : 'pending save'}`);
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

        console.log(`[Evaluation Loop] ✓ Label: ${evaluation.label} (confidence: ${evaluation.confidence})`);
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
        console.log(`[Evaluation Loop] ✓ Training pair collected (total: ${this.trainingPairs.length})`);
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.log(`[Evaluation Loop] ⚠ Failed to evaluate vector ${vector.vector_id}: ${errorMessage}`);
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

      console.log(`[Training Data] ✓ Saved ${this.trainingPairs.length} training pairs to ${filename}`);

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

          // Execute if there's a tool call
          if (reasoning.tool && reasoning.arguments) {
            const plan = await this.executor.planExecution(reasoning);
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
