---
tool_name: "wpscan"
category: "web_scanner"
tags: ["wordpress", "cms", "enumeration"]
description: "WordPress security scanner for users, plugins, and themes."
---
# WPScan
## Key Commands
- Full scan: `wpscan --url <target> --enumerate u,p,t --force`
- User enumeration: `wpscan --url <target> --enumerate u --force`
- Stealthy scan: `wpscan --url <target> --stealthy`
## Anti-Patterns
- Do not use on non-WordPress sites
- Use --force if the target doesn't advertise as WordPress