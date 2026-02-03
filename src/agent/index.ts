// Main Orchestrator - Coordinates all subagents

import { SkillsLoader } from './skillsLoader.js';
import {
  ReasonerAgent,
  ExecutorAgent,
  MCPAgent,
  DataCleanerAgent,
  CleanedData,
} from './definitions/index.js';

export interface AgentConfig {
  anthropicApiKey: string;
  skillsDir: string;
  mcpServers: {
    nmap: { path: string };
  };
}

/**
 * PentestAgent - Main orchestrator for the multi-agent penetration testing system.
 *
 * This class coordinates four specialized subagents:
 * - ReasonerAgent (Sonnet): Strategic brain that decides what actions to take
 * - ExecutorAgent (Haiku): Breaks high-level plans into executable tool steps
 * - MCPAgent: Executes actual security tools via MCP protocol (Nmap, etc.)
 * - DataCleanerAgent (Haiku): Parses raw tool output into structured JSON
 *
 * The agent follows an iterative loop:
 * Reasoner → Executor → MCP → DataCleaner → back to Reasoner with results
 */
export class PentestAgent {
  private config: AgentConfig;

  // Subagents : ReasonerAgent , ExecutorAgent , MCPAgent , DataCleanerAgent
  private skillsLoader: SkillsLoader;
  private reasoner: ReasonerAgent;
  private executor: ExecutorAgent;
  private mcpAgent: MCPAgent;
  private dataCleaner: DataCleanerAgent;

  /**
   * Creates a new PentestAgent with all subagents.
   *
   * @param config - Configuration object containing:
   *   - anthropicApiKey: API key for Claude API calls
   *   - skillsDir: Path to skill markdown files
   *   - mcpServers: Paths to MCP server executables (nmap, etc.)
   */
  constructor(config: AgentConfig) {
    this.config = config;
    this.skillsLoader = new SkillsLoader(config.skillsDir);
    this.reasoner = new ReasonerAgent(config.anthropicApiKey);
    this.executor = new ExecutorAgent(config.anthropicApiKey);
    this.mcpAgent = new MCPAgent();
    this.dataCleaner = new DataCleanerAgent(config.anthropicApiKey);
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
    console.log(
      '[Orchestrator] Subagents: Reasoner (sonnet), Executor (haiku), MCP Agent, Data Cleaner (haiku)'
    );
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
    console.log('='.repeat(60));

    this.reasoner.reset();
    let iteration = 0;
    const maxIterations = 15;
    let aggregatedResults: CleanedData[] = [];

    // Initial observation to Reasoner
    let observation = `Starting reconnaissance mission on target: ${target}`;

    while (iteration < maxIterations) {
      iteration++;
      console.log(`\n[Orchestrator] === Iteration ${iteration} ===`);

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

          aggregatedResults.push(cleanedData);
        } else {
          console.log(`[MCP Agent] ✗ Execution failed: ${rawResult.error}`);
        }

        currentPlan = this.executor.advancePlan(currentPlan);
      }

      // Step 4: Feed cleaned results back to Reasoner
      const lastResult = aggregatedResults[aggregatedResults.length - 1];
      if (lastResult) {
        observation = `Tool execution completed.\nResult: ${JSON.stringify(lastResult.data, null, 2)}\nSummary: ${lastResult.summary}`;
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

    // Print summary
    if (aggregatedResults.length > 0) {
      console.log('\n[Orchestrator] === Summary ===');
      aggregatedResults.forEach((result, i) => {
        console.log(`${i + 1}. [${result.type}] ${result.summary}`);
      });
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
