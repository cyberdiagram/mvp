"""
Kali Linux MCP Server — Dynamic Execution + Information Retrieval

Exposes 6 tools via FastMCP over HTTP :3001:

Dynamic Execution (no encapsulation):
  - execute_shell_cmd: Run arbitrary shell commands (nmap, hydra, sqlmap, etc.)
  - write_file: Deploy scripts to /app/scripts/
  - execute_script: Run Python scripts from /app/scripts/
  - manage_packages: Check/install apt packages

Information Retrieval (encapsulated):
  - searchsploit_search: Query ExploitDB with structured JSON output
  - searchsploit_examine: Read exploit source code by EDB-ID
"""

import os
import re
import shlex
import shutil
import subprocess
from datetime import datetime
from mcp.server.fastmcp import FastMCP

mcp = FastMCP("kali-pentest-server", host="0.0.0.0", port=3001)

SCRIPTS_DIR = "/app/scripts"
LOGS_DIR = "/app/logs"
MAX_OUTPUT_LENGTH = 4000
EXECUTION_TIMEOUT = 120
INSTALL_TIMEOUT = 300
PACKAGE_NAME_RE = re.compile(r"^[a-z0-9\-]+$")


# ─── Dynamic Execution Tools ─────────────────────────────────


@mcp.tool()
def write_file(filename: str, content: str) -> str:
    """Write content to a file in /app/scripts/. Use this to deploy scripts before execution."""
    filepath = os.path.join(SCRIPTS_DIR, filename)
    os.makedirs(os.path.dirname(filepath), exist_ok=True)
    with open(filepath, "w") as f:
        f.write(content)
    os.chmod(filepath, 0o755)
    return f"File written: {filepath} ({len(content)} bytes)"


@mcp.tool()
def execute_script(filename: str, args: str = "") -> str:
    """Execute a Python script from /app/scripts/. Optionally pass space-separated args."""
    filepath = os.path.join(SCRIPTS_DIR, filename)
    if not os.path.exists(filepath):
        return f"Error: File not found: {filepath}"

    cmd = ["python3", filepath]
    if args:
        cmd.extend(args.split())

    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=EXECUTION_TIMEOUT,
            cwd=SCRIPTS_DIR,
        )
        stdout = result.stdout or ""
        stderr = result.stderr or ""
        output = f"Exit code: {result.returncode}\n"
        if stdout:
            output += f"\n--- STDOUT ---\n{stdout}"
        if stderr:
            output += f"\n--- STDERR ---\n{stderr}"

        if len(output) > MAX_OUTPUT_LENGTH:
            output = output[:MAX_OUTPUT_LENGTH] + "\n...(truncated)"

        return output

    except subprocess.TimeoutExpired:
        return f"Error: Script timed out after {EXECUTION_TIMEOUT}s"
    except Exception as e:
        return f"Error executing script: {e}"


@mcp.tool()
def execute_shell_cmd(command: str) -> str:
    """Execute an arbitrary shell command inside the Kali container. Returns exit code, stdout, and stderr."""
    try:
        result = subprocess.run(
            command,
            shell=True,
            capture_output=True,
            text=True,
            timeout=EXECUTION_TIMEOUT,
            cwd=SCRIPTS_DIR,
        )
        stdout = result.stdout or ""
        stderr = result.stderr or ""
        output = f"Exit code: {result.returncode}\n"
        if stdout:
            output += f"\n--- STDOUT ---\n{stdout}"
        if stderr:
            output += f"\n--- STDERR ---\n{stderr}"

        if len(output) > MAX_OUTPUT_LENGTH:
            output = output[:MAX_OUTPUT_LENGTH] + "\n...(truncated)"

        return output

    except subprocess.TimeoutExpired:
        return f"Error: Command timed out after {EXECUTION_TIMEOUT}s"
    except Exception as e:
        return f"Error executing command: {e}"


@mcp.tool()
def manage_packages(action: str, package_name: str) -> str:
    """Manage system packages. action='check' to see if installed, action='install' to install via apt-get."""
    if not PACKAGE_NAME_RE.match(package_name):
        return f"Error: Invalid package name '{package_name}'. Only [a-z0-9-] allowed."

    if action == "check":
        path = shutil.which(package_name)
        if path:
            return f"INSTALLED — {package_name} found at {path}"
        return f"MISSING — {package_name} not found on PATH"

    elif action == "install":
        log_path = os.path.join(LOGS_DIR, "installs.log")
        os.makedirs(LOGS_DIR, exist_ok=True)
        timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

        try:
            result = subprocess.run(
                f"apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y {package_name}",
                shell=True,
                capture_output=True,
                text=True,
                timeout=INSTALL_TIMEOUT,
            )
            status = "SUCCESS" if result.returncode == 0 else f"FAILED (exit {result.returncode})"
            with open(log_path, "a") as f:
                f.write(f"[{timestamp}] INSTALL {package_name} → {status}\n")

            if result.returncode == 0:
                return f"SUCCESS — {package_name} installed"
            else:
                error_tail = (result.stderr or "")[-500:]
                return f"FAILED — apt-get returned exit code {result.returncode}\n{error_tail}"

        except subprocess.TimeoutExpired:
            with open(log_path, "a") as f:
                f.write(f"[{timestamp}] INSTALL {package_name} → TIMEOUT\n")
            return f"Error: Installation timed out after {INSTALL_TIMEOUT}s"
        except Exception as e:
            with open(log_path, "a") as f:
                f.write(f"[{timestamp}] INSTALL {package_name} → ERROR: {e}\n")
            return f"Error installing package: {e}"

    else:
        return f"Error: Unknown action '{action}'. Use 'check' or 'install'."


# ─── Information Retrieval Tools (Encapsulated) ──────────────


@mcp.tool()
def searchsploit_search(query: str, exact: bool = False) -> str:
    """Search ExploitDB for exploits matching a query. Returns JSON results."""
    sanitized_query = shlex.quote(query)
    exact_flag = "--exact " if exact else ""
    cmd = f"searchsploit {exact_flag}{sanitized_query} --json"

    try:
        result = subprocess.run(
            cmd,
            shell=True,
            capture_output=True,
            text=True,
            timeout=EXECUTION_TIMEOUT,
            cwd=SCRIPTS_DIR,
        )
        stdout = result.stdout or ""
        stderr = result.stderr or ""

        if result.returncode != 0:
            return f"searchsploit error (exit {result.returncode}): {stderr[:500]}"

        # Return the JSON output directly (searchsploit --json produces valid JSON)
        output = stdout.strip()
        if len(output) > MAX_OUTPUT_LENGTH:
            output = output[:MAX_OUTPUT_LENGTH] + "\n...(truncated)"
        return output

    except subprocess.TimeoutExpired:
        return f"Error: searchsploit timed out after {EXECUTION_TIMEOUT}s"
    except Exception as e:
        return f"Error running searchsploit: {e}"


@mcp.tool()
def searchsploit_examine(edb_id: str) -> str:
    """Read the source code of a specific ExploitDB exploit by its EDB-ID."""
    # Validate edb_id is numeric to prevent injection
    if not re.match(r"^\d+$", edb_id.strip()):
        return f"Error: Invalid EDB-ID '{edb_id}'. Must be numeric."

    cmd = f"searchsploit -x {edb_id.strip()}"

    try:
        result = subprocess.run(
            cmd,
            shell=True,
            capture_output=True,
            text=True,
            timeout=EXECUTION_TIMEOUT,
            cwd=SCRIPTS_DIR,
            env={**os.environ, "PAGER": "cat"},  # prevent pager from swallowing output in non-TTY
        )
        stdout = result.stdout or ""
        stderr = result.stderr or ""

        if result.returncode != 0:
            return f"searchsploit examine error (exit {result.returncode}): {stderr[:500]}"

        output = stdout.strip()
        if len(output) > MAX_OUTPUT_LENGTH:
            output = output[:MAX_OUTPUT_LENGTH] + "\n...(truncated)"
        return output

    except subprocess.TimeoutExpired:
        return f"Error: searchsploit timed out after {EXECUTION_TIMEOUT}s"
    except Exception as e:
        return f"Error examining exploit: {e}"


if __name__ == "__main__":
    mcp.run(transport="streamable-http")
