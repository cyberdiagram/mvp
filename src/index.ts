/**
 * Main Entry Point - Interactive CLI for the Pentest Agent.
 *
 * Supports:
 * 1. **Reconnaissance Commands**: `recon <target>` or direct IP/hostname input
 * 2. **Exploit Execution Commands**: generate, execute, interactive, autorun, plan, autonomous
 * 3. **Memory Manager Commands**: `remember`, `forget`, `rules`
 * 4. **Interactive Mode**: Continuous input loop with command history
 */

import 'dotenv/config';
import { shutdownTracing } from './agent/utils/instrumentation.js';
import path from 'path';
import * as fs from 'fs';
import * as readline from 'readline';
import { PentestAgent } from './agent/index.js';
import type { TacticalPlanObject } from './agent/core/types.js';

function displayBanner(): void {
  console.log('\n');
  console.log('  ██████╗ ███████╗███╗   ██╗████████╗███████╗███████╗████████╗');
  console.log('  ██╔══██╗██╔════╝████╗  ██║╚══██╔══╝██╔════╝██╔════╝╚══██╔══╝');
  console.log('  ██████╔╝█████╗  ██╔██╗ ██║   ██║   █████╗  ███████╗   ██║   ');
  console.log('  ██╔═══╝ ██╔══╝  ██║╚██╗██║   ██║   ██╔══╝  ╚════██║   ██║   ');
  console.log('  ██║     ███████╗██║ ╚████║   ██║   ███████╗███████║   ██║   ');
  console.log('  ╚═╝     ╚══════╝╚═╝  ╚═══╝   ╚═╝   ╚══════╝╚══════╝   ╚═╝   ');
  console.log('                    AI-Powered Penetration Testing Agent v2.0');
  console.log('');
  console.log('─'.repeat(65));
  console.log('');
  console.log('  === Reconnaissance ===');
  console.log('    recon <target>            Run automated reconnaissance');
  console.log('');
  console.log('  === Exploit Execution ===');
  console.log('    generate <task>           Generate a PoC script with Claude');
  console.log('    execute <filename>        Run an existing script in Kali container');
  console.log('    interactive <task>        Generate, review/edit, then execute');
  console.log('    autorun <task>            Generate + write + execute automatically');
  console.log('    plan <json-file>          Load Tactical Plan and choose strategy');
  console.log('    autonomous <task>         Full agentic OODA loop');
  console.log('');
  console.log('  === Memory ===');
  console.log('    remember <tool> <rule>    Save a tool preference');
  console.log('    forget <tool>             Clear preferences for a tool');
  console.log('    rules [tool]              List saved preferences');
  console.log('');
  console.log('  === System ===');
  console.log('    help                      Show this help');
  console.log('    exit                      Quit');
  console.log('');
  console.log('─'.repeat(65));
}

function displayHelp(): void {
  console.log('\n  Available Commands:\n');
  console.log('  Reconnaissance:');
  console.log('    recon <target>    - Run automated reconnaissance');
  console.log('                        Example: recon 192.168.1.0/24');
  console.log('');
  console.log('  Exploit Execution:');
  console.log('    generate <task>       - Generate a Python PoC script');
  console.log('    execute <filename>    - Execute a script already in Kali');
  console.log('    interactive <task>    - Generate → review/edit → execute');
  console.log('    autorun <task>        - Generate → write → execute (no review)');
  console.log('    plan <json-file>      - Load Tactical Plan, choose strategy');
  console.log('    autonomous <task>     - Full OODA agentic loop');
  console.log('');
  console.log('  Memory Manager:');
  console.log('    remember <tool> <rule>  - Save a tool preference');
  console.log('    forget <tool>           - Clear all preferences for a tool');
  console.log('    rules [tool]            - List saved preferences');
  console.log('');
  console.log('  Other:');
  console.log('    help              - Show this help message');
  console.log('    exit / quit       - Quit the application');
  console.log('');
  console.log('  Quick Input:');
  console.log('    <IP or hostname>  - Automatically runs recon on the target');
  console.log('');
}

function isTarget(input: string): boolean {
  const ipPattern = /^[\d.\/]+$/;
  if (ipPattern.test(input)) return true;

  const commands = [
    'recon', 'remember', 'forget', 'rules', 'help', 'exit', 'quit',
    'generate', 'execute', 'interactive', 'autorun', 'plan', 'autonomous',
  ];
  const firstWord = input.split(' ')[0].toLowerCase();

  if (input.includes('.') && !commands.includes(firstWord)) return true;
  return false;
}

function separator(): void {
  console.log('\n' + '='.repeat(60) + '\n');
}

/**
 * Loads a Tactical Plan JSON file and validates required fields.
 */
function loadTacticalPlan(filePath: string): TacticalPlanObject {
  if (!fs.existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }
  const raw = fs.readFileSync(filePath, 'utf-8');
  const plan = JSON.parse(raw) as TacticalPlanObject;

  if (!plan.target_ip) throw new Error("Invalid plan: missing 'target_ip'");
  if (!plan.attack_vectors || plan.attack_vectors.length === 0) {
    throw new Error("Invalid plan: missing 'attack_vectors'");
  }
  return plan;
}

/**
 * Prompts the user with a question and returns their input.
 */
function ask(rl: readline.Interface, prompt: string): Promise<string> {
  return new Promise((resolve) => rl.question(prompt, resolve));
}

// ─── Memory Manager Handlers ─────────────────────────────────

function handleRemember(agent: PentestAgent, args: string[]): void {
  if (args.length < 2) {
    console.log('\n  Usage: remember <tool> <rule>');
    console.log('  Example: remember nmap always use -Pn after host discovery\n');
    return;
  }
  const tool = args[0];
  const rule = args.slice(1).join(' ');
  agent.skillManager.addRule(tool, rule);
  console.log(`\n  Rule saved for ${tool}: "${rule}"\n`);
}

function handleForget(agent: PentestAgent, args: string[]): void {
  if (args.length < 1) {
    console.log('\n  Usage: forget <tool>');
    return;
  }
  const tool = args[0];
  const count = agent.skillManager.clearRules(tool);
  if (count > 0) {
    console.log(`\n  Cleared ${count} rule(s) for ${tool}\n`);
  } else {
    console.log(`\n  No rules found for ${tool}\n`);
  }
}

function handleRules(agent: PentestAgent, args: string[]): void {
  const toolFilter = args[0];
  const rules = agent.skillManager.listRules(toolFilter);
  const toolNames = Object.keys(rules);

  if (toolNames.length === 0) {
    if (toolFilter) {
      console.log(`\n  No rules saved for ${toolFilter}\n`);
    } else {
      console.log('\n  No rules saved. Use "remember <tool> <rule>" to add preferences.\n');
    }
    return;
  }

  console.log('\n  Saved Rules:');
  console.log('  ' + '─'.repeat(50));
  for (const [tool, toolRules] of Object.entries(rules)) {
    if (toolRules.length === 0) continue;
    console.log(`\n  ${tool}:`);
    toolRules.forEach((rule, index) => {
      console.log(`    ${index}. ${rule}`);
    });
  }
  console.log('');
}

// ─── Exploit Execution Handlers ──────────────────────────────

async function handleGenerate(agent: PentestAgent, args: string[]): Promise<void> {
  if (!agent.agenticExecutor) {
    console.log('\n  Error: Kali MCP server not connected. Cannot generate scripts.\n');
    return;
  }
  if (args.length === 0) {
    console.log('\n  Usage: generate <task description>');
    return;
  }
  const task = args.join(' ');
  console.log('\nGenerating script...\n');
  const script = await agent.agenticExecutor.generateScript(task);
  separator();
  console.log('--- Generated Script ---');
  console.log(script);
  separator();
}

async function handleExecute(agent: PentestAgent, rl: readline.Interface, args: string[]): Promise<void> {
  if (!agent.agenticExecutor) {
    console.log('\n  Error: Kali MCP server not connected.\n');
    return;
  }
  if (args.length === 0) {
    console.log('\n  Usage: execute <filename>');
    return;
  }
  const filename = args[0];
  console.log(`\nExecuting ${filename} in Kali container...\n`);

  const result = await agent.agenticExecutor.runAgentLoop(
    `Execute the existing script file "${filename}" in the Kali container using execute_script tool.`,
    3
  );
  separator();
  console.log('--- Execution Result ---');
  console.log(result.finalText);
  separator();
}

async function handleInteractive(agent: PentestAgent, rl: readline.Interface, args: string[]): Promise<void> {
  if (!agent.agenticExecutor) {
    console.log('\n  Error: Kali MCP server not connected.\n');
    return;
  }
  if (args.length === 0) {
    console.log('\n  Usage: interactive <task description>');
    return;
  }
  const task = args.join(' ');
  const localTmpFile = './.tmp_payload.py';

  console.log('\nGenerating script...\n');
  const script = await agent.agenticExecutor.generateScript(task);
  fs.writeFileSync(localTmpFile, script);

  console.log(`[!] Payload generated and saved to ${localTmpFile}`);
  console.log('[!] Please review/edit the script in your editor.');
  await ask(rl, '\nPress Enter when ready to EXECUTE...');

  const finalScript = fs.readFileSync(localTmpFile, 'utf-8');
  const { filename, result } = await agent.agenticExecutor.executeFinal(finalScript);

  separator();
  console.log(`Script: ${filename}`);
  console.log('--- Final Script ---');
  console.log(finalScript);
  separator();
  console.log('--- Execution Result ---');
  console.log(result);
  separator();
}

async function handleAutorun(agent: PentestAgent, args: string[]): Promise<void> {
  if (!agent.agenticExecutor) {
    console.log('\n  Error: Kali MCP server not connected.\n');
    return;
  }
  if (args.length === 0) {
    console.log('\n  Usage: autorun <task description>');
    return;
  }
  const task = args.join(' ');
  const { script, filename, result } = await agent.agenticExecutor.autoExecute(task);
  separator();
  console.log(`Script: ${filename}`);
  console.log('--- Generated Script ---');
  console.log(script);
  separator();
  console.log('--- Execution Result ---');
  console.log(result);
  separator();
}

async function handlePlan(agent: PentestAgent, rl: readline.Interface, args: string[]): Promise<void> {
  if (!agent.agenticExecutor) {
    console.log('\n  Error: Kali MCP server not connected.\n');
    return;
  }
  if (args.length === 0) {
    console.log('\n  Usage: plan <path-to-tactical-plan.json>');
    return;
  }

  const plan = loadTacticalPlan(args[0].trim());
  const v = plan.attack_vectors[0];
  const cls = v.prediction_metrics.classification;
  const hyp = v.prediction_metrics.hypothesis;

  console.log(`\n[+] Loaded plan: ${plan.plan_id}`);
  console.log(`[+] Target: ${plan.target_ip}`);
  console.log(`[+] Attack vectors: ${plan.attack_vectors.length}`);
  console.log(`[+] Primary vector: ${cls.cve_id || 'N/A'} (${cls.attack_type})`);
  console.log(`[+] MITRE ATT&CK: ${cls.mitre_id}`);
  console.log(
    `[+] Confidence: ${(hyp.confidence_score * 100).toFixed(0)}% | Expected success: ${hyp.expected_success}`
  );
  console.log(`[+] Rationale: ${hyp.rationale_tags.join(', ')}`);
  console.log(`[+] Tool: ${v.action.tool_name}`);
  separator();

  const mode = await ask(
    rl,
    'Select execution strategy:\n  1. Tool-based Autonomy (Metasploit, etc.)\n  2. GitHub PoC Search & Execute\n  3. Manual Construction (Auto-code generation)\n  4. Interactive (Generate, Review, Execute)\nChoice: '
  );

  switch (mode.trim()) {
    case '1': {
      console.log('\nStarting tool-based autonomous execution...\n');
      const result = await agent.agenticExecutor!.runAgentWithTacticalPlan(plan, 'tool');
      separator();
      console.log('--- Agent Summary ---');
      console.log(`Turns used: ${result.turnsUsed}`);
      console.log(`Tool calls: ${result.toolCalls.length}`);
      separator();
      console.log('--- Final Report ---');
      console.log(result.finalText);
      break;
    }
    case '2': {
      console.log('\nStarting GitHub-based autonomous execution...\n');
      const result = await agent.agenticExecutor!.runAgentWithTacticalPlan(plan, 'github');
      separator();
      console.log('--- Agent Summary ---');
      console.log(`Turns used: ${result.turnsUsed}`);
      console.log(`Tool calls: ${result.toolCalls.length}`);
      separator();
      console.log('--- Final Report ---');
      console.log(result.finalText);
      break;
    }
    case '3': {
      const { script, filename, result } = await agent.agenticExecutor!.autoExecuteFromPlan(plan);
      separator();
      console.log(`Script: ${filename}`);
      console.log('--- Generated Script ---');
      console.log(script);
      separator();
      console.log('--- Execution Result ---');
      console.log(result);
      break;
    }
    case '4': {
      console.log('\nGenerating exploit from Tactical Plan...\n');
      const script = await agent.agenticExecutor!.generateScriptFromPlan(plan);
      const localTmpFile = './.tmp_payload.py';
      fs.writeFileSync(localTmpFile, script);
      console.log(`[!] Payload generated and saved to ${localTmpFile}`);
      console.log('[!] Please review/edit the script in your editor.');
      await ask(rl, '\nPress Enter when ready to EXECUTE...');
      const finalScript = fs.readFileSync(localTmpFile, 'utf-8');
      const { filename, result } = await agent.agenticExecutor!.executeFinal(finalScript);
      separator();
      console.log(`Script: ${filename}`);
      console.log('--- Final Script ---');
      console.log(finalScript);
      separator();
      console.log('--- Execution Result ---');
      console.log(result);
      break;
    }
    default:
      console.log('Invalid strategy selected.');
  }
  separator();
}

async function handleAutonomous(agent: PentestAgent, rl: readline.Interface, args: string[]): Promise<void> {
  if (!agent.agenticExecutor) {
    console.log('\n  Error: Kali MCP server not connected.\n');
    return;
  }
  if (args.length === 0) {
    console.log('\n  Usage: autonomous <task description>');
    return;
  }
  const task = args.join(' ');
  const maxTurnsStr = await ask(rl, 'Max turns (default 15): ');
  const maxTurns = parseInt(maxTurnsStr) || 15;

  console.log(`\nStarting autonomous agent (max ${maxTurns} turns)...\n`);
  const result = await agent.agenticExecutor.runAgentLoop(task, maxTurns);
  separator();
  console.log('--- Agent Summary ---');
  console.log(`Turns used: ${result.turnsUsed}`);
  console.log(`Tool calls: ${result.toolCalls.length}`);
  console.log(`Tools used: ${[...new Set(result.toolCalls.map((t) => t.name))].join(', ')}`);
  separator();
  console.log('--- Final Report ---');
  console.log(result.finalText);
  separator();
}

// ─── Main ────────────────────────────────────────────────────

async function main(): Promise<void> {
  const anthropicApiKey = process.env.ANTHROPIC_API_KEY;
  if (!anthropicApiKey) {
    console.error('Error: ANTHROPIC_API_KEY environment variable is required');
    process.exit(1);
  }

  const ragMemoryPath = process.env.RAG_MEMORY_SERVER_PATH;
  const kaliMcpUrl = process.env.KALI_MCP_URL || 'http://localhost:3001';

  const config = {
    anthropicApiKey,
    skillsDir: path.resolve('./src/skills'),
    kaliMcpUrl,
    ragMemoryServerPath: ragMemoryPath,
    enableEvaluation: process.env.ENABLE_EVALUATION === 'true',
    enableRAGMemory: process.env.ENABLE_RAG_MEMORY === 'true' && !!ragMemoryPath,
    trainingDataPath: process.env.TRAINING_DATA_PATH || './logs/training_data',
    sessionLogsPath: process.env.SESSION_LOGS_PATH || './logs/sessions',
  };

  const agent = new PentestAgent(config);
  await agent.initialize();

  displayBanner();

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const prompt = (): void => {
    rl.question('\n> ', async (input: string) => {
      const trimmed = input.trim();
      if (!trimmed) {
        prompt();
        return;
      }

      const [command, ...args] = trimmed.split(' ');
      const lowerCommand = command.toLowerCase();

      try {
        switch (lowerCommand) {
          case 'exit':
          case 'quit':
            console.log('\n  Shutting down...');
            await agent.shutdown();
            await shutdownTracing();
            rl.close();
            process.exit(0);

          case 'help':
            displayHelp();
            break;

          // === Reconnaissance ===
          case 'recon':
            if (args[0]) {
              await agent.reconnaissance(args[0]);
            } else {
              console.log('\n  Usage: recon <target>\n');
            }
            break;

          // === Exploit Execution ===
          case 'generate':
            await handleGenerate(agent, args);
            break;

          case 'execute':
            await handleExecute(agent, rl, args);
            break;

          case 'interactive':
            await handleInteractive(agent, rl, args);
            break;

          case 'autorun':
            await handleAutorun(agent, args);
            break;

          case 'plan':
            await handlePlan(agent, rl, args);
            break;

          case 'autonomous':
            await handleAutonomous(agent, rl, args);
            break;

          // === Memory Manager ===
          case 'remember':
            handleRemember(agent, args);
            break;

          case 'forget':
            handleForget(agent, args);
            break;

          case 'rules':
            handleRules(agent, args);
            break;

          // Default: Check if input looks like a target
          default:
            if (isTarget(trimmed)) {
              await agent.reconnaissance(trimmed);
            } else {
              console.log(`\n  Unknown command: ${command}`);
              console.log('  Type "help" for available commands.\n');
            }
        }
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error(`\n  Error: ${errorMessage}\n`);
      }

      prompt();
    });
  };

  prompt();
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
