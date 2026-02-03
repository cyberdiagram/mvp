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

export class PentestAgent {
  private config: AgentConfig;

  // Subagents
  private skillsLoader: SkillsLoader;
  private reasoner: ReasonerAgent;
  private executor: ExecutorAgent;
  private mcpAgent: MCPAgent;
  private dataCleaner: DataCleanerAgent;

  constructor(config: AgentConfig) {
    this.config = config;
    this.skillsLoader = new SkillsLoader(config.skillsDir);
    this.reasoner = new ReasonerAgent(config.anthropicApiKey);
    this.executor = new ExecutorAgent(config.anthropicApiKey);
    this.mcpAgent = new MCPAgent();
    this.dataCleaner = new DataCleanerAgent(config.anthropicApiKey);
  }

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
    console.log('[Orchestrator] Subagents: Reasoner (sonnet), Executor (haiku), MCP Agent, Data Cleaner (haiku)');
  }

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
                console.log(`[Data Cleaner] Data: ${JSON.stringify(cleaned.data, null, 2).substring(0, 500)}...`);
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

  async shutdown(): Promise<void> {
    await this.mcpAgent.shutdown();
    console.log('[Orchestrator] Shutdown complete');
  }
}
