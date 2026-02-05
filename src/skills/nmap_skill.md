# Nmap Reconnaissance Skill

## Overview

This skill teaches systematic network reconnaissance using Nmap. The agent learns to think through scanning strategies, interpret results, and make informed decisions about next steps.

## Core Principles

### 1. **Progressive Disclosure**

- Start broad, then narrow focus
- Balance speed vs. stealth vs. accuracy
- Adapt based on what you discover

### 2. **Context Awareness**

- Consider the engagement scope (black box, gray box, white box)
- Respect time constraints
- Account for network conditions (IDS/IPS presence, firewall rules)

### 3. **Intelligence Over Data**

- Raw port lists are not insights
- Every scan should answer a specific question
- Prioritize actionable findings

### 4. **-Pn Propagation Rule**

Once a host is confirmed alive from the initial `-Pn` discovery scan:
- **ALL subsequent scans on that host MUST include `-Pn`**
- This skips redundant ping probes (we already know it's up)
- Avoids potential issues with ICMP filtering
- Speeds up scans by removing discovery overhead

```
Example flow:
1. nmap -Pn 192.168.1.10        → Host is up!
2. nmap -Pn -p- 192.168.1.10    → Port scan (uses -Pn)
3. nmap -Pn -sV -p 22,80 ...    → Service detection (uses -Pn)
4. nmap -Pn --script vuln ...   → Vulnerability scan (uses -Pn)
```

---

## Scanning Decision Framework

### When to Use Which Scan

#### **Initial Discovery Phase**

```
Thought Process:
- "I need to know what's alive on the network"
- "I want to be relatively fast and not too noisy"
- "I'll do detailed scans on confirmed hosts later"

Action: Host discovery scan
Command: nmap -Pn 192.168.1.0/24
```

#### **Port Enumeration Phase**

```
Thought Process:
- "I know the host is up from my -Pn discovery scan"
- "Since host is confirmed up, I should continue using -Pn to skip redundant ping probes"
- "Top 1000 ports covers ~90% of common services"
- "If I find something interesting, I'll do a full scan"

Action: Quick port scan
Command: nmap -Pn -T4 -p- --min-rate=1000 192.168.1.10
```

**IMPORTANT: Once host is confirmed up, always use -Pn in subsequent scans to:**
- Skip unnecessary ping probes (we already know the host is alive)
- Avoid potential ICMP filtering issues
- Speed up scans by removing discovery overhead

#### **Service Fingerprinting Phase**

```
Thought Process:
- "I have a list of open ports from my port scan"
- "Host is already confirmed up, so I use -Pn to skip ping"
- "Version detection will help me find specific exploits"
- "OS detection provides context for privilege escalation later"

Action: Service and version detection
Command: nmap -Pn -sV -sC -O -p 22,80,443,3306 192.168.1.10
```

---

## Reasoning Patterns

### Pattern 1: Port Analysis

**Input:** Port 22 is open
**Reasoning Chain:**

```
Thought: Port 22 typically runs SSH. This is a critical service because:
1. It provides remote access to the system
2. Weak credentials or outdated versions are common vulnerabilities
3. SSH version can reveal the OS and patch level

Before attempting brute force or exploit searches, I need:
- Exact SSH version (for CVE lookup)
- Authentication methods supported
- Banner information for OS fingerprinting

Action: nmap -Pn -p 22 -sV --script ssh-auth-methods,ssh-hostkey 192.168.1.10
```

### Pattern 2: Service Clustering

**Input:** Ports 80, 443, 8080, 8443 are open
**Reasoning Chain:**

```
Thought: Multiple HTTP/HTTPS ports suggest:
- Different applications or services
- Load balancers or proxies
- Development vs. production environments
- Potential for virtual host confusion attacks

Strategy:
1. Identify what's running on each port (Apache, Nginx, IIS?)
2. Check for different application versions
3. Look for SSL/TLS misconfigurations on HTTPS ports
4. Test for HTTP methods enabled

Action: nmap -Pn -p 80,443,8080,8443 -sV --script http-methods,http-title,ssl-enum-ciphers 192.168.1.10
```

### Pattern 3: Unusual Port Discovery

**Input:** Port 31337 is open (non-standard port)
**Reasoning Chain:**

```
Thought: Port 31337 is not a standard service port. Possibilities:
1. Custom application (need version detection)
2. Backdoor (historically associated with malware)
3. Service running on non-standard port (security through obscurity)
4. Honeypot or IDS trap

Approach:
- Service version detection to identify what's actually running
- Script scan for common vulnerabilities
- Banner grab to see if it reveals information
- Manual connection with netcat if automated tools fail

Action: nmap -Pn -p 31337 -sV -sC --version-intensity 9 192.168.1.10
```

### Pattern 4: OS Fingerprinting Context

**Input:** Need to determine target OS
**Reasoning Chain:**

```
Thought: OS identification helps because:
1. Exploit selection (Windows vs. Linux vs. BSD)
2. Privilege escalation strategy planning
3. Understanding default configurations
4. Predicting other services that might be present

However, OS detection can be:
- Noisy (triggers IDS alerts)
- Inaccurate (firewalls alter TCP/IP stack behavior)
- Unnecessary if banner info already reveals OS

I'll combine OS detection with service detection for efficiency.

Action: nmap -Pn -O -sV --osscan-guess 192.168.1.10
```

---

## Common Nmap Scripts and When to Use Them

### Web Service Scripts

```bash
# When: Port 80/443 is open (host already confirmed up)
# Why: Identify web technologies before deeper enumeration
nmap -Pn -p 80,443 --script http-enum,http-headers,http-methods,http-robots.txt 192.168.1.10

Thought: These scripts reveal:
- Directory structure (http-enum)
- Server headers that might indicate technologies (http-headers)
- Potentially dangerous HTTP methods like PUT, DELETE (http-methods)
- Disclosed paths in robots.txt (http-robots.txt)
```

### SMB/NetBIOS Scripts

```bash
# When: Ports 139, 445 are open (Windows host suspected, host confirmed up)
# Why: SMB is a goldmine for Windows exploitation
nmap -Pn -p 139,445 --script smb-os-discovery,smb-protocols,smb-security-mode 192.168.1.10

Thought: SMB enumeration can provide:
- Exact Windows version and build
- Domain information
- SMB signing status (relay attack potential)
- Supported SMB protocols (SMBv1 = EternalBlue candidate)
```

### Database Scripts

```bash
# When: Database ports detected (3306=MySQL, 5432=PostgreSQL, 1433=MSSQL)
# Why: Databases often have misconfigurations or weak credentials
nmap -Pn -p 3306 --script mysql-info,mysql-empty-password 192.168.1.10

Thought: Before brute-forcing, check for:
- Version information (CVE lookup)
- Empty or default credentials
- Anonymous access
- Information disclosure in banners
```

### Vulnerability Scanning Scripts

```bash
# When: You've identified services and want to check for known vulns
# Why: Automate CVE checking before manual exploitation
nmap -Pn -p 445 --script smb-vuln-* 192.168.1.10

Thought: The smb-vuln-* scripts check for:
- MS17-010 (EternalBlue)
- MS08-067 (Conficker)
- Other high-severity SMB vulnerabilities
This saves time vs. manual CVE research.
```

---

## Scan Strategy Decision Tree

```
START: New target IP address
│
├─ Q: Do I know if the host is up?
│  ├─ NO → Host discovery scan (-Pn)
│  │       If host responds → Mark as "HOST CONFIRMED UP"
│  └─ YES → Continue (use -Pn in all subsequent scans)
│
├─ Q: Do I know what ports are open?
│  ├─ NO → Quick port scan (-Pn -p- or -Pn --top-ports 1000)
│  │       NOTE: Use -Pn since host is already confirmed up
│  └─ YES → Continue
│
├─ Q: Do I know what services are running?
│  ├─ NO → Service detection (-Pn -sV -sC)
│  │       NOTE: Use -Pn since host is already confirmed up
│  └─ YES → Continue
│
├─ Q: Do I need OS information?
│  ├─ YES → OS detection (-Pn -O)
│  └─ NO → Continue
│
└─ Q: Do I need vulnerability checks?
   ├─ YES → Targeted NSE scripts (-Pn --script vuln)
   └─ NO → Proceed to next phase (web enum, exploitation, etc.)

RULE: Once host is confirmed up from initial -Pn scan,
      ALL subsequent scans MUST include -Pn flag.
```

---

## Command Construction Logic

### Stealth vs. Speed Trade-offs

#### **Stealth Mode (Evasion Required)**

```bash
Thought: The target likely has IDS/IPS. I need to be slow and fragmented.
Considerations:
- Use -T2 or -T1 timing (slower)
- Fragment packets (-f)
- Randomize scan order (--randomize-hosts)
- Use decoys (-D) to hide real source IP
- Avoid service detection (triggers more alerts)

Action: nmap -sS -T2 -f -D RND:10 --randomize-hosts 192.168.1.0/24
```

#### **Speed Mode (Internal Network/Time Constrained)**

```bash
Thought: Internal network, unlikely to have strict IDS. Time is limited.
Considerations:
- Use -T4 or -T5 timing
- Increase min-rate (--min-rate=1000)
- Parallel scanning (--min-hostgroup 100)
- Focus on common ports first

Action: nmap -T4 --min-rate=1000 --top-ports 100 192.168.1.0/24
```

#### **Balanced Mode (Default Approach)**

```bash
Thought: Unknown environment, balance between speed and detection risk.
Considerations:
- Use -T3 (default, adaptive timing)
- Scan top ports first, then expand if needed
- Use service detection selectively
- Save results for later analysis

Action: nmap -Pn -T3 -p- -sV -sC -oA scan_results 192.168.1.10
```

---

## Output Interpretation Patterns

### Example 1: Web Server Discovery

```
PORT    STATE SERVICE VERSION
80/tcp  open  http    Apache httpd 2.4.41 ((Ubuntu))
443/tcp open  ssl/http Apache httpd 2.4.41 ((Ubuntu))
```

**Reasoning:**

```
Thought: Apache 2.4.41 on Ubuntu suggests:
1. This is a Linux target (eliminates Windows exploits)
2. Apache 2.4.41 has known CVEs (check CVE-2021-41773, CVE-2021-42013)
3. Ubuntu context means potential for outdated packages
4. Both HTTP and HTTPS open → check for SSL misconfigurations
5. Next steps: web enumeration (gobuster), SSL scanning, exploit research

Priority Actions:
1. Check Apache version against known CVEs
2. Run nikto for web vulnerabilities
3. Test for path traversal (CVE-2021-41773)
4. Enumerate directories with gobuster
```

### Example 2: Windows Domain Controller

```
PORT    STATE SERVICE       VERSION
53/tcp  open  domain        Simple DNS Plus
88/tcp  open  kerberos-sec  Microsoft Windows Kerberos
135/tcp open  msrpc         Microsoft Windows RPC
139/tcp open  netbios-ssn   Microsoft Windows netbios-ssn
389/tcp open  ldap          Microsoft Windows Active Directory LDAP
445/tcp open  microsoft-ds  Microsoft Windows Server 2016 SMB
```

**Reasoning:**

```
Thought: This port signature screams Domain Controller:
- Port 88 (Kerberos) = authentication service
- Port 389 (LDAP) = directory services
- Port 445 (SMB) = file sharing and admin access
- Port 53 (DNS) = name resolution

This is a HIGH-VALUE target. Attack vectors:
1. Kerberoasting (extract service account hashes)
2. LDAP enumeration (user/group info without auth)
3. SMB relay attacks (if signing not required)
4. DNS zone transfer attempts
5. Check for MS14-068 (Kerberos vulnerability)

Priority Actions:
1. Check SMB signing status (smb-security-mode script)
2. Attempt LDAP anonymous bind
3. Enumerate users via RPC (enum4linux)
4. Test for zerologon (CVE-2020-1472)
```

### Example 3: Unusual Service Combination

```
PORT      STATE SERVICE VERSION
22/tcp    open  ssh     OpenSSH 7.6p1
3000/tcp  open  ppp?
27017/tcp open  mongodb MongoDB 3.6.8
```

**Reasoning:**

```
Thought: Interesting mix here:
1. SSH = Linux system, likely Ubuntu 18.04 (based on OpenSSH 7.6)
2. Port 3000 = often Node.js/React dev server (check with curl)
3. MongoDB on 27017 = NoSQL database, often misconfigured

Red flags:
- MongoDB accessible remotely (should be localhost only)
- Port 3000 exposed (possible development environment)
- Potential for NoSQL injection in the web app

Priority Actions:
1. Check MongoDB for anonymous access (no authentication)
2. Identify what's on port 3000 (curl -I http://target:3000)
3. If MongoDB is open, enumerate databases (mongo --host target)
4. Test web app on 3000 for NoSQL injection
```

---

## Error Handling and Adaptation

### Scenario 1: Host Appears Down

```
Thought: Nmap reports host as down, but I expect it to be up. Reasons:
1. Firewall dropping ICMP (ping)
2. Aggressive firewall rules blocking SYN packets
3. Host actually is down
4. Nmap's timing is too aggressive

Adaptation Strategy:
- Disable ping scan (-Pn) to force port scanning
- Try different probe methods (TCP SYN, TCP ACK, UDP)
- Reduce timing (-T2) in case of rate limiting
- Try specific well-known ports (-p 80,443,22)

Action: nmap -Pn -p 80,443,22,3389 192.168.1.10
```

### Scenario 2: Service Detection Fails

```
Thought: Nmap shows port open but can't identify service. Reasons:
1. Custom application with no signature
2. Service running on non-standard port
3. SSL/TLS encryption hiding service
4. Version detection not aggressive enough

Adaptation Strategy:
- Increase version intensity (--version-intensity 9)
- Try SSL detection (--script ssl-cert)
- Manual banner grabbing (nc, telnet)
- Check with multiple tools (netcat, curl)

Action: nmap -Pn -sV --version-intensity 9 -p 8443 192.168.1.10
```

### Scenario 3: Scan Triggering Blocks

```
Thought: Midway through scan, connection times out. Likely:
1. IDS/IPS detected scan and blocked my IP
2. Rate limiting kicked in
3. Firewall rules changed during scan
4. Network instability

Adaptation Strategy:
- Switch to slower timing (-T1, -T2)
- Use decoy scans to mask source (-D)
- Fragment packets (-f, --mtu)
- Scan from different source IP/network if possible
- Wait before retrying (cool-down period)

Action: nmap -sS -T1 -f -D RND:5 192.168.1.10
```

---

## Integration with Other Tools

### Nmap → Next Tool Decision Logic

```python
def decide_next_tool(nmap_results):
    """
    Thought: Based on Nmap results, determine the logical next tool
    """

    if 'http' in nmap_results.services:
        thought = "HTTP service found. Need web enumeration."
        return "gobuster", "nikto", "whatweb"

    elif '445' in nmap_results.ports and 'Windows' in nmap_results.os:
        thought = "Windows SMB found. Check for EternalBlue and enum shares."
        return "smbclient", "enum4linux", "crackmapexec"

    elif '3306' in nmap_results.ports:
        thought = "MySQL found. Check for weak credentials before SQLmap."
        return "mysql", "hydra"

    elif '21' in nmap_results.ports:
        thought = "FTP found. Check for anonymous login and version vulns."
        return "ftp", "searchsploit"

    else:
        thought = "Standard ports found. Do general vulnerability assessment."
        return "searchsploit", "metasploit"
```

---

## Output Management

### Always Save Results

```bash
# Use all output formats for flexibility
nmap -oA scan_results [other options] target

Thought: Saving outputs because:
- -oN (normal): human-readable for reporting
- -oX (XML): machine-parseable for automation
- -oG (greppable): quick command-line analysis
- -oA: saves all three formats

This allows me to:
1. Parse results programmatically later
2. Generate professional reports
3. Compare scans over time
4. Share findings with team
```

### Organize by Phase

```bash
# Directory structure for organized scanning
mkdir -p scans/{discovery,enumeration,vulnerability}

# Host discovery
nmap -Pn 192.168.1.0/24 -oA scans/discovery/hosts

# Port enumeration (use -Pn since host confirmed up)
nmap -Pn -p- 192.168.1.10 -oA scans/enumeration/ports_full

# Service detection (use -Pn since host confirmed up)
nmap -Pn -sV -sC -p 22,80,443 192.168.1.10 -oA scans/enumeration/services

# Vulnerability scanning (use -Pn since host confirmed up)
nmap -Pn --script vuln -p 445 192.168.1.10 -oA scans/vulnerability/smb_vulns
```

---

## Common Mistakes to Avoid

### ❌ Mistake 1: Scanning Too Broadly

```bash
# BAD: Scanning entire Class B network for all ports
nmap -p- 192.168.0.0/16

Thought: This will take DAYS and generate massive amounts of traffic.
```

**✅ Correct Approach:**

```bash
# Start with host discovery
nmap -Pn 192.168.0.0/16 -oA live_hosts

# Then scan top ports on live hosts only
nmap --top-ports 100 -iL live_hosts.txt

Thought: Progressive refinement is faster and more manageable.
```

### ❌ Mistake 2: Ignoring Context

```bash
# BAD: Using aggressive scan on client production network
nmap -T5 -A --script vuln 10.0.0.0/8

Thought: This could crash services or trigger alerts.
```

**✅ Correct Approach:**

```bash
# Adjust to engagement rules
nmap -T3 --top-ports 1000 10.0.0.100 -oA careful_scan

Thought: Client production network = be cautious, avoid disruption.
```

### ❌ Mistake 3: Not Following Up

```bash
# BAD: Running scan and moving to exploitation immediately
nmap -p 80 target && msfconsole

Thought: I don't know what version of web server is running.
```

**✅ Correct Approach:**

```bash
# Layer your reconnaissance (use -Pn since host is known)
nmap -Pn -p 80 -sV -sC target
# Analyze results, identify server version
# Research specific CVEs for that version
# THEN attempt exploitation

Thought: Quality reconnaissance prevents wasted exploitation attempts.
```

---

## Training Data Format for Fine-tuning

### Example Training Samples

```json
[
  {
    "messages": [
      {
        "role": "system",
        "content": "You are a penetration testing agent. Think through your reconnaissance strategy step-by-step."
      },
      {
        "role": "user",
        "content": "You've just started testing target 192.168.1.50. What's your first Nmap command?"
      },
      {
        "role": "assistant",
        "content": "Thought: I'm at the very beginning with a new target. I need to answer these questions in order:\n1. Is the host even alive?\n2. What ports are open?\n3. What services are running?\n\nSince I don't know anything yet, I'll start with host discovery. A ping scan (-sn) is fast and will tell me if the host responds to ICMP or common TCP probes. This avoids wasting time on full port scans if the host is down or heavily firewalled.\n\nAction: nmap -Pn 192.168.1.50"
      }
    ]
  },
  {
    "messages": [
      {
        "role": "user",
        "content": "The host is up. Nmap found ports 22, 80, and 3306 open. What do you do next?"
      },
      {
        "role": "assistant",
        "content": "Thought: I have three open ports, each representing a different service:\n- Port 22: Likely SSH (remote admin access)\n- Port 80: Likely HTTP (web server)\n- Port 3306: Likely MySQL (database)\n\nBefore I can plan exploitation, I need to know:\n- Exact service versions (for CVE lookup)\n- OS type (Linux vs Windows affects exploitation)\n- Any low-hanging fruit in default scripts\n\nSince I already confirmed the host is up from my initial discovery scan, I'll use -Pn to skip redundant ping probes and go straight to port scanning.\n\nService detection with -sV will fingerprint versions. Adding -sC runs default NSE scripts which might reveal misconfigurations. I'll also add -O for OS detection since this appears to be a server stack (SSH + web + database suggests Linux).\n\nAction: nmap -Pn -sV -sC -O -p 22,80,3306 192.168.1.50"
      }
    ]
  },
  {
    "messages": [
      {
        "role": "user",
        "content": "Port 445 is open on a Windows host. What should you check first?"
      },
      {
        "role": "assistant",
        "content": "Thought: Port 445 is SMB (Server Message Block), which is critical for Windows exploitation. Before attempting any attacks, I need to gather intelligence:\n\n1. SMB version - SMBv1 is vulnerable to EternalBlue (MS17-010)\n2. SMB signing status - if disabled, relay attacks are possible\n3. OS version - determines which exploits will work\n4. Share enumeration - might find sensitive data without exploitation\n\nSince the host is already confirmed up (I know port 445 is open), I'll use -Pn to skip ping discovery.\n\nThe smb-security-mode script checks signing status, and smb-os-discovery identifies the Windows version. I'll also check for common SMB vulnerabilities.\n\nAction: nmap -Pn -p 445 --script smb-protocols,smb-security-mode,smb-os-discovery,smb-vuln-ms17-010 192.168.1.50"
      }
    ]
  },
  {
    "messages": [
      {
        "role": "user",
        "content": "Your Nmap scan is being blocked halfway through. What do you do?"
      },
      {
        "role": "assistant",
        "content": "Thought: Mid-scan blocking typically means:\n1. IDS/IPS detected the scan pattern and blacklisted my IP\n2. Rate limiting kicked in due to aggressive timing\n3. Firewall rules dynamically adjusted\n\nI need to become stealthier:\n- Reduce timing from -T4/-T5 to -T2 (polite timing)\n- Fragment packets with -f to evade signature detection\n- Use decoys with -D to hide my real source among fake IPs\n- Add delays between probes\n\nIf this is a real engagement, I might need to:\n- Coordinate with client to whitelist my IP\n- Scan from a different source IP\n- Wait for the block to expire (often 15-60 minutes)\n\nAction: nmap -sS -T2 -f -D RND:5 --scan-delay 1s 192.168.1.50"
      }
    ]
  }
]
```

---

## Success Metrics

Your agent should demonstrate:

1. **Contextual Awareness**: Chooses scan types based on engagement phase
2. **Efficiency**: Doesn't waste time on redundant scans
3. **Interpretation**: Explains what results mean, not just reports them
4. **Adaptability**: Adjusts strategy when scans fail or are blocked
5. **Integration**: Knows when to move from Nmap to other tools

---

## Quick Reference Commands

```bash
# Host Discovery (first scan on new target)
nmap -Pn 192.168.1.0/24

# ============================================
# IMPORTANT: Once host is confirmed UP,
# ALL subsequent scans should use -Pn
# ============================================

# Quick Port Scan (top 1000) - use -Pn since host is confirmed up
nmap -Pn -T4 --top-ports 1000 192.168.1.10

# Full Port Scan - use -Pn since host is confirmed up
nmap -Pn -p- -T4 192.168.1.10

# Service Detection - use -Pn since host is confirmed up
nmap -Pn -sV -sC -p 22,80,443 192.168.1.10

# OS Detection - use -Pn since host is confirmed up
nmap -Pn -O 192.168.1.10

# Vulnerability Scan - use -Pn since host is confirmed up
nmap -Pn --script vuln -p 80,443 192.168.1.10

# Stealth Scan - use -Pn since host is confirmed up
nmap -Pn -sS -T2 -f 192.168.1.10

# UDP Scan (slow but important) - use -Pn since host is confirmed up
nmap -Pn -sU --top-ports 100 192.168.1.10

# Output All Formats - use -Pn since host is confirmed up
nmap -Pn -oA scan_results 192.168.1.10

# Comprehensive Scan (kitchen sink) - use -Pn since host is confirmed up
nmap -Pn -sS -sV -sC -O -A -T4 -p- --script vuln -oA comprehensive_scan 192.168.1.10
```

---

## Integration Checklist

When implementing this skill in your agent:

- [ ] Agent checks context before choosing scan type
- [ ] Agent explains reasoning before executing commands
- [ ] Agent interprets results, not just displays them
- [ ] Agent adapts when scans fail or are blocked
- [ ] Agent knows when to transition to next tool
- [ ] Agent saves all scan results properly
- [ ] Agent prioritizes findings by criticality
- [ ] Agent considers engagement rules (time, noise level)

---

## Additional Resources for Training

### Recommended NSE Script Categories

```bash
# Authentication testing
--script auth

# Brute force attacks
--script brute

# Discovery and enumeration
--script discovery

# Exploit detection
--script exploit

# Vulnerability detection
--script vuln

# Malware detection
--script malware

# Safe scripts only
--script safe
```

### Port-to-Service Quick Reference

```
21    - FTP
22    - SSH
23    - Telnet
25    - SMTP
53    - DNS
80    - HTTP
110   - POP3
135   - MSRPC
139   - NetBIOS
143   - IMAP
443   - HTTPS
445   - SMB
1433  - MSSQL
3306  - MySQL
3389  - RDP
5432  - PostgreSQL
5900  - VNC
8080  - HTTP Proxy
8443  - HTTPS Alt
27017 - MongoDB
```

---

## End of Skill Document

This skill should be integrated with:

- **Web enumeration skills** (gobuster, nikto, whatweb)
- **Exploitation framework skills** (Metasploit, searchsploit)
- **Password attack skills** (hydra, john, hashcat)
- **Post-exploitation skills** (privilege escalation, lateral movement)
- **Reporting skills** (documentation, evidence collection)
