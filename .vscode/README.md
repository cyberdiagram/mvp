# VSCode Configuration

This directory contains workspace-specific settings for Visual Studio Code.

## Files

### `settings.json`
Workspace settings including:
- **File visibility**: Makes `.env` files visible in Explorer (overrides default exclusion)
- **Syntax highlighting**: Associates `.env` files with dotenv language mode
- **Search configuration**: Excludes build artifacts and dependencies from search
- **Editor settings**: Custom formatting for `.env` files

### `extensions.json`
Recommended VSCode extensions for this project:
- **DotENV** (`mikestead.dotenv`) - Syntax highlighting for .env files
- **ESLint** (`dbaeumer.vscode-eslint`) - JavaScript linting
- **Prettier** (`esbenp.prettier-vscode`) - Code formatting

## Making .env Files Visible

The `.env` file is excluded from Git (in `.gitignore`) for security reasons, but it's now visible in VSCode Explorer thanks to the settings in `settings.json`.

### How to View .env File

1. **In Explorer**: Look for `.env` in the root directory (should appear with dotenv icon)
2. **Quick Open**: Press `Ctrl+P` (or `Cmd+P` on Mac) and type `.env`
3. **Command Palette**: `Ctrl+Shift+P` → "Open File" → `.env`

### Security Notes

⚠️ **IMPORTANT**: The `.env` file contains sensitive API keys and should NEVER be committed to Git.

- ✅ `.env` is in `.gitignore` (protected from Git)
- ✅ `.env` is visible in VSCode (for development)
- ❌ DO NOT share `.env` contents publicly
- ❌ DO NOT commit `.env` to version control

### Recommended VSCode Extensions

Install recommended extensions by:
1. Open Command Palette (`Ctrl+Shift+P`)
2. Type "Extensions: Show Recommended Extensions"
3. Install the listed extensions

## Environment Variables Reference

See [../docs/Configuration-Guide.md](../docs/Configuration-Guide.md) for complete documentation of all environment variables.

### Quick Reference

```bash
# Required
ANTHROPIC_API_KEY=sk-ant-...

# Optional MCP Servers
NMAP_SERVER_PATH=...
SEARCHSPLOIT_SERVER_PATH=...
RAG_MEMORY_SERVER_PATH=...

# Feature Flags
ENABLE_EVALUATION=true
ENABLE_RAG_MEMORY=true
TRAINING_DATA_PATH=./logs/training_data
SESSION_LOGS_PATH=./logs/sessions
```
