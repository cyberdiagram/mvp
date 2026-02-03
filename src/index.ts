import path from 'path';
import { config } from "./config";
import { PentestAgent } from './agent/index.js';
// import * as dotenv from 'dotenv';

// dotenv.config();

async function main() {

  const nmapPath = process.env.NMAP_SERVER_PATH || path.resolve('../pentest-mcp/nmap-server-ts/dist/index.js');
  const anthropicApiKey ="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";

  // Configuration
  const config = {
    anthropicApiKey:anthropicApiKey,
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
