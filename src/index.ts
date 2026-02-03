import path from 'path';
import { PentestAgent } from './agent/index.js';

async function main() {
  const nmapPath =
    process.env.NMAP_SERVER_PATH ||
    path.resolve('../pentest-mcp-server/nmap-server-ts/dist/index.js');

  const anthropicApiKey = process.env.ANTHROPIC_API_KEY;
  if (!anthropicApiKey) {
    console.error('Error: ANTHROPIC_API_KEY environment variable is required');
    process.exit(1);
  }

  // Configuration
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

  // Get command from CLI
  const command = process.argv[2];
  const target = process.argv[3];

  if (command === 'recon' && target) {
    // Run reconnaissance
    await agent.reconnaissance(target);
  } else if (command === 'interactive') {
    // Interactive mode
    await agent.interactive();
  } else {
    console.log('Usage:');
    console.log('  npm start recon <target>      - Run reconnaissance on target');
    console.log('  npm start interactive         - Start interactive mode');
  }

  // Shutdown
  await agent.shutdown();
}

main().catch(console.error);
