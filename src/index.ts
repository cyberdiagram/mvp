/**
 * Main Entry Point - Interactive CLI for the Pentest Agent.
 *
 * This module provides a user-input based interface that supports:
 * 1. **Reconnaissance Commands**: `recon <target>` or direct IP/hostname input
 * 2. **Memory Manager Commands**: `remember`, `forget`, `rules`
 * 3. **Interactive Mode**: Continuous input loop with command history
 *
 * The Memory Manager follows Anthropic's Claude Code architecture pattern,
 * allowing users to persist tool preferences (e.g., "always use -Pn with nmap").
 *
 * @module index
 * @author Leo
 * @version 1.1
 * @date 2026-02-05
 */

import 'dotenv/config';
import path from 'path';
import * as readline from 'readline';
import { PentestAgent } from './agent/index.js';

/**
 * Displays the welcome banner and available commands.
 *
 * Shows ASCII art logo and lists all available commands with descriptions.
 *
 * @returns {void}
 */
function displayBanner(): void {
  console.log('\n');
  console.log('  ██████╗ ███████╗███╗   ██╗████████╗███████╗███████╗████████╗');
  console.log('  ██╔══██╗██╔════╝████╗  ██║╚══██╔══╝██╔════╝██╔════╝╚══██╔══╝');
  console.log('  ██████╔╝█████╗  ██╔██╗ ██║   ██║   █████╗  ███████╗   ██║   ');
  console.log('  ██╔═══╝ ██╔══╝  ██║╚██╗██║   ██║   ██╔══╝  ╚════██║   ██║   ');
  console.log('  ██║     ███████╗██║ ╚████║   ██║   ███████╗███████║   ██║   ');
  console.log('  ╚═╝     ╚══════╝╚═╝  ╚═══╝   ╚═╝   ╚══════╝╚══════╝   ╚═╝   ');
  console.log('                    AI-Powered Penetration Testing Agent v1.0');
  console.log('');
  console.log('─'.repeat(65));
  console.log('');
  console.log('  Commands:');
  console.log('    recon <target>          - Run reconnaissance on target');
  console.log('    remember <tool> <rule>  - Save a tool preference (Memory Manager)');
  console.log('    forget <tool>           - Clear all preferences for a tool');
  console.log('    rules [tool]            - List saved rules/preferences');
  console.log('    help                    - Show this help message');
  console.log('    exit                    - Quit the application');
  console.log('');
  console.log('  Tips:');
  console.log('    - Enter an IP address directly to start reconnaissance');
  console.log('    - Use "remember nmap use -Pn" to save preferences');
  console.log('');
  console.log('─'.repeat(65));
}

/**
 * Displays the help message with all available commands.
 *
 * Shows detailed descriptions and examples for each command.
 *
 * @returns {void}
 */
function displayHelp(): void {
  console.log('\n  Available Commands:\n');
  console.log('  Reconnaissance:');
  console.log('    recon <target>    - Run automated reconnaissance');
  console.log('                        Example: recon 192.168.1.0/24');
  console.log('                        Example: recon scanme.nmap.org');
  console.log('');
  console.log('  Memory Manager (Preference Persistence):');
  console.log('    remember <tool> <rule>  - Save a tool preference');
  console.log('                              Example: remember nmap always use -Pn after discovery');
  console.log('                              Example: remember gobuster use -t 50 threads');
  console.log('');
  console.log('    forget <tool>           - Clear all preferences for a tool');
  console.log('                              Example: forget nmap');
  console.log('');
  console.log('    rules [tool]            - List saved preferences');
  console.log('                              Example: rules       (list all)');
  console.log('                              Example: rules nmap  (list nmap rules only)');
  console.log('');
  console.log('  Other:');
  console.log('    help              - Show this help message');
  console.log('    exit / quit       - Quit the application');
  console.log('');
  console.log('  Quick Input:');
  console.log('    <IP or hostname>  - Automatically runs recon on the target');
  console.log('                        Example: 192.168.1.10');
  console.log('                        Example: example.com');
  console.log('');
}

/**
 * Checks if input looks like a target (IP address or hostname).
 *
 * Used to detect when user enters a target directly without the "recon" command.
 *
 * @param {string} input - The user input to check
 * @returns {boolean} True if the input looks like a valid target
 *
 * @example
 * isTarget('192.168.1.1');    // true
 * isTarget('scanme.nmap.org'); // true
 * isTarget('remember');        // false
 */
function isTarget(input: string): boolean {
  // Check for IP address pattern (with optional CIDR)
  const ipPattern = /^[\d.\/]+$/;
  if (ipPattern.test(input)) {
    return true;
  }

  // Check for hostname (contains dot but doesn't start with common commands)
  const commands = ['recon', 'remember', 'forget', 'rules', 'help', 'exit', 'quit'];
  const firstWord = input.split(' ')[0].toLowerCase();

  if (input.includes('.') && !commands.includes(firstWord)) {
    return true;
  }

  return false;
}

/**
 * Handles the "remember" command to add a new tool preference.
 *
 * Parses the command arguments and calls the Memory Manager's addRule method.
 *
 * @param {PentestAgent} agent - The pentest agent instance
 * @param {string[]} args - Command arguments [tool, ...rule words]
 * @returns {void}
 *
 * @example
 * handleRemember(agent, ['nmap', 'always', 'use', '-Pn']);
 * // Adds rule: "always use -Pn" for nmap
 */
function handleRemember(agent: PentestAgent, args: string[]): void {
  if (args.length < 2) {
    console.log('\n  Usage: remember <tool> <rule>');
    console.log('  Example: remember nmap always use -Pn after host discovery\n');
    return;
  }

  const tool = args[0];
  const rule = args.slice(1).join(' ');

  agent.skillsLoader.addRule(tool, rule);
  console.log(`\n  ✓ Rule saved for ${tool}: "${rule}"\n`);
}

/**
 * Handles the "forget" command to clear all rules for a tool.
 *
 * Removes all preferences associated with the specified tool.
 *
 * @param {PentestAgent} agent - The pentest agent instance
 * @param {string[]} args - Command arguments [tool]
 * @returns {void}
 *
 * @example
 * handleForget(agent, ['nmap']);
 * // Clears all rules for nmap
 */
function handleForget(agent: PentestAgent, args: string[]): void {
  if (args.length < 1) {
    console.log('\n  Usage: forget <tool>');
    console.log('  Example: forget nmap\n');
    return;
  }

  const tool = args[0];
  const count = agent.skillsLoader.clearRules(tool);

  if (count > 0) {
    console.log(`\n  ✓ Cleared ${count} rule(s) for ${tool}\n`);
  } else {
    console.log(`\n  No rules found for ${tool}\n`);
  }
}

/**
 * Handles the "rules" command to list saved preferences.
 *
 * Displays all rules or rules for a specific tool in a formatted list.
 *
 * @param {PentestAgent} agent - The pentest agent instance
 * @param {string[]} args - Command arguments [optional tool]
 * @returns {void}
 *
 * @example
 * handleRules(agent, []);        // List all rules
 * handleRules(agent, ['nmap']);  // List nmap rules only
 */
function handleRules(agent: PentestAgent, args: string[]): void {
  const toolFilter = args[0];
  const rules = agent.skillsLoader.listRules(toolFilter);

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

/**
 * Main entry point for the pentest agent CLI.
 *
 * This function:
 * 1. Loads configuration from environment variables
 * 2. Creates and initializes the PentestAgent
 * 3. Starts an interactive input loop
 * 4. Processes user commands (recon, remember, forget, rules, etc.)
 * 5. Handles graceful shutdown
 *
 * Environment Variables:
 * - NMAP_SERVER_PATH: Path to nmap MCP server (optional)
 * - ANTHROPIC_API_KEY: Claude API key (required)
 *
 * @async
 * @returns {Promise<void>}
 */
async function main(): Promise<void> {
  // Load configuration from environment
  const nmapPath =
    process.env.NMAP_SERVER_PATH ||
    path.resolve('../pentest-mcp-server/nmap-server-ts/dist/index.js');

  const anthropicApiKey = process.env.ANTHROPIC_API_KEY;
  if (!anthropicApiKey) {
    console.error('Error: ANTHROPIC_API_KEY environment variable is required');
    process.exit(1);
  }

  // Build configuration object
  const config = {
    anthropicApiKey,
    skillsDir: path.resolve('./src/skills'),
    mcpServers: {
      nmap: {
        path: nmapPath,
      },
    },
  };

  // Create and initialize agent
  const agent = new PentestAgent(config);
  await agent.initialize();

  // Display welcome banner
  displayBanner();

  // Create readline interface for user input
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  /**
   * Main command processing loop.
   *
   * Reads user input, parses commands, and dispatches to handlers.
   * Continues until user types "exit" or "quit".
   *
   * @returns {void}
   */
  const prompt = (): void => {
    rl.question('\n> ', async (input: string) => {
      const trimmed = input.trim();

      // Handle empty input
      if (!trimmed) {
        prompt();
        return;
      }

      // Parse command and arguments
      const [command, ...args] = trimmed.split(' ');
      const lowerCommand = command.toLowerCase();

      try {
        switch (lowerCommand) {
          // Exit commands
          case 'exit':
          case 'quit':
            console.log('\n  Shutting down...');
            await agent.shutdown();
            rl.close();
            process.exit(0);

          // Help command
          case 'help':
            displayHelp();
            break;

          // Reconnaissance command
          case 'recon':
            if (args[0]) {
              await agent.reconnaissance(args[0]);
            } else {
              console.log('\n  Usage: recon <target>');
              console.log('  Example: recon 192.168.1.0/24\n');
            }
            break;

          // Memory Manager: Remember
          case 'remember':
            handleRemember(agent, args);
            break;

          // Memory Manager: Forget
          case 'forget':
            handleForget(agent, args);
            break;

          // Memory Manager: Rules
          case 'rules':
            handleRules(agent, args);
            break;

          // Default: Check if input looks like a target
          default:
            if (isTarget(trimmed)) {
              // Treat as reconnaissance target
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

      // Continue the loop
      prompt();
    });
  };

  // Start the interactive prompt
  prompt();
}

// Run main function
main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
