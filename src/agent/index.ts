import { SkillsLoader } from './skillsLoader.js';
import { Reasoner } from './reasoner.js';
import { MCPExecutor } from './executor.js';

export interface AgentConfig {
  anthropicApiKey: string;
  skillsDir: string;
  mcpServers: {
    nmap: { path: string };
    // Add others as needed
  };
}

export class PentestAgent {
  private skillsLoader: SkillsLoader;
  private reasoner: Reasoner;
  private executor: MCPExecutor;
  private config: AgentConfig;

  constructor(config: AgentConfig) {
    this.config = config;
    this.skillsLoader = new SkillsLoader(config.skillsDir);
    this.reasoner = new Reasoner(config.anthropicApiKey, this.skillsLoader);
    this.executor = new MCPExecutor();
  }

  /**
   * Initialize the agent
   */
  async initialize(): Promise<void> {
    console.log('[Agent] Initializing...');
    
    // Load skills
    await this.skillsLoader.loadSkills();
    console.log('[Agent] ✓ Skills loaded');
    
    // Initialize MCP clients
    await this.executor.initialize({
      servers: this.config.mcpServers,
    });
    console.log('[Agent] ✓ MCP servers connected');
    
    console.log('[Agent] Ready!');
  }

  /**
   * Execute a reconnaissance mission on a target
   */
  async reconnaissance(target: string): Promise<void> {
    console.log(`\n[Agent] Starting reconnaissance on: ${target}`);
    console.log('=' .repeat(60));

    let context = `Target: ${target}`;
    let maxIterations = 10;
    let iteration = 0;

    while (iteration < maxIterations) {
      iteration++;
      console.log(`\n[Agent] Iteration ${iteration}`);
      console.log('-'.repeat(60));

      // Step 1: Reason about what to do
      const reasoning = await this.reasoner.reason(
        `I am performing reconnaissance on ${target}`,
        context
      );

      console.log(`[Agent] Thought: ${reasoning.thought}`);
      console.log(`[Agent] Action: ${reasoning.action}`);

      // Step 2: Execute tool if specified
      if (reasoning.tool && reasoning.arguments) {
        console.log(`[Agent] Calling tool: ${reasoning.tool}`);
        
        const result = await this.executor.executeTool({
          tool: reasoning.tool,
          arguments: reasoning.arguments,
        });

        if (result.success) {
          console.log(`[Agent] ✓ Tool execution successful`);
          console.log(`[Agent] Output preview: ${result.output.substring(0, 200)}...`);
          
          // Add result to context for next iteration
          context += `\n\nLast action: ${reasoning.action}\nResult: ${result.output.substring(0, 500)}`;
        } else {
          console.log(`[Agent] ✗ Tool execution failed: ${result.error}`);
          context += `\n\nLast action failed: ${result.error}`;
        }
      } else {
        // No tool to execute, agent is thinking or done
        console.log(`[Agent] No tool to execute. Analysis phase.`);
        
        // Check if agent indicates it's done
        if (reasoning.action.toLowerCase().includes('done') || 
            reasoning.action.toLowerCase().includes('complete')) {
          console.log('[Agent] Mission complete!');
          break;
        }
      }

      // Small delay between iterations
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    console.log('\n' + '='.repeat(60));
    console.log('[Agent] Reconnaissance finished');
  }

  /**
   * Interactive mode - chat with the agent
   */
  async interactive(): Promise<void> {
    const readline = require('readline');
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    console.log('\n[Agent] Interactive mode started. Type your queries.');
    console.log('[Agent] Type "exit" to quit.\n');

    const prompt = () => {
      rl.question('You: ', async (input: string) => {
        if (input.toLowerCase() === 'exit') {
          rl.close();
          return;
        }

        try {
          const reasoning = await this.reasoner.reason(input);
          
          console.log(`\n[Agent] Thought: ${reasoning.thought}`);
          console.log(`[Agent] Action: ${reasoning.action}`);

          if (reasoning.tool && reasoning.arguments) {
            console.log(`[Agent] Executing: ${reasoning.tool}...`);
            
            const result = await this.executor.executeTool({
              tool: reasoning.tool,
              arguments: reasoning.arguments,
            });

            if (result.success) {
              console.log(`[Agent] Result:\n${result.output.substring(0, 500)}...\n`);
            } else {
              console.log(`[Agent] Error: ${result.error}\n`);
            }
          }
        } catch (error: any) {
          console.error('[Agent] Error:', error.message);
        }

        prompt();
      });
    };

    prompt();
  }

  /**
   * Shutdown the agent
   */
  async shutdown(): Promise<void> {
    await this.executor.shutdown();
    console.log('[Agent] Shutdown complete');
  }
}