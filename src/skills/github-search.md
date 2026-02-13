---
tool_name: "github-search"
category: "recon"
tags: ["github", "poc", "exploit", "cve", "osint"]
description: "Search GitHub for CVE proof-of-concept exploits via API and clone/adapt them."
---
# GitHub PoC Search

## Overview
Find, evaluate, and adapt public proof-of-concept exploits from GitHub repositories using the GitHub Search API (no authentication required, 60 requests/hour rate limit).

## Key Commands

### Search for CVE-related repositories
```bash
curl -s "https://api.github.com/search/repositories?q=CVE-XXXX-XXXXX+exploit&sort=stars&order=desc" \
  | python3 -c "import sys,json; repos=json.load(sys.stdin).get('items',[])[:5]; [print(f\"{r['full_name']} ({r['stargazers_count']}*): {r['html_url']}\") for r in repos]"
```

### Search for code containing CVE references
```bash
curl -s "https://api.github.com/search/code?q=CVE-XXXX-XXXXX+language:python" \
  | python3 -c "import sys,json; items=json.load(sys.stdin).get('items',[])[:5]; [print(f\"{i['repository']['full_name']}: {i['path']}\") for i in items]"
```

### Clone a repository (shallow)
```bash
git clone https://github.com/<owner>/<repo>.git --depth 1 /app/scripts/<repo>
```

### Inspect before running
```bash
cat /app/scripts/<repo>/exploit.py
cat /app/scripts/<repo>/requirements.txt 2>/dev/null
pip3 install -r /app/scripts/<repo>/requirements.txt
```

### Typical execution
```bash
python3 /app/scripts/<repo>/exploit.py --target <IP> --port <PORT>
```

## Rate Limiting
- Unauthenticated: 60 requests/hour (search API: 10 requests/minute)
- Check limits: `curl -s https://api.github.com/rate_limit`
- For heavy usage, set GITHUB_TOKEN and add: `-H "Authorization: token $GITHUB_TOKEN"`

## Security Audit Checklist
Before executing any downloaded PoC:
1. Read the full source code
2. Check for hardcoded IPs/domains that are not the target
3. Look for data exfiltration (unexpected outbound connections)
4. Verify the payload matches the vulnerability description
5. Check for destructive operations (rm -rf, format, etc.)

## Anti-Patterns
- Never run a PoC without reading its source code first
- Do not blindly install requirements.txt from untrusted repos (review first)
- Avoid repos with zero stars and no README
- Do not exceed GitHub API rate limits — cache results when possible
- Do not use git clone without --depth 1 (wastes bandwidth on full history)
