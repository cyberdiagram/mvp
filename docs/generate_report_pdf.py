#!/usr/bin/env python3
"""
Generate a simulated pentest report PDF from report-llm-response.json
and report-worker-payload.json.

Usage:
    python3 generate_report_pdf.py
Output:
    AutoRed_PentestReport_<session_id_short>.pdf
"""

import json
import re
import os
from datetime import datetime
from fpdf import FPDF
from fpdf.enums import XPos, YPos

# ── Paths ────────────────────────────────────────────────────────────────────
DOCS_DIR   = os.path.dirname(os.path.abspath(__file__))
LLM_FILE   = os.path.join(DOCS_DIR, "report-llm-response.json")
META_FILE  = os.path.join(DOCS_DIR, "report-worker-payload.json")

with open(LLM_FILE)  as f: llm  = json.load(f)
with open(META_FILE) as f: meta = json.load(f)

TARGET      = meta["target"]
SESSION_ID  = meta["session_id"]
COMPLETED   = meta["completed_at"]
SHORT_SID   = SESSION_ID[:8]

SNIPS       = llm["remediation_snippets"]
COMPLIANCE  = llm["compliance_findings"]
PATTERNS    = llm["anti_patterns"]

# ── Colour palette ───────────────────────────────────────────────────────────
C_DARK      = (15,  23,  42)    # slate-900  — headings, text
C_MID       = (51,  65,  85)    # slate-700  — body text
C_LIGHT     = (226, 232, 240)   # slate-200  — table alternating row
C_WHITE     = (255, 255, 255)
C_RED       = (220, 38,  38)    # critical
C_ORANGE    = (234, 88,  12)    # high
C_YELLOW    = (202, 138,  4)    # medium / at-risk
C_GREEN     = (22,  163,  74)   # low / compliant
C_BLUE      = (37,  99,  235)   # accent — section headers
C_BLUE_DARK = (30,  64,  175)
C_BLUE_LITE = (219, 234, 254)   # accent bg
C_BADGE_RED = (254, 226, 226)
C_BADGE_YEL = (254, 243, 199)
C_BADGE_GRN = (220, 252, 231)
C_CODE_BG   = (30,  30,  30)
C_CODE_FG   = (212, 212, 212)
C_POS_BG    = (220, 252, 231)   # green tint — positive anti-pattern
C_NEG_BG    = (254, 226, 226)   # red tint   — negative anti-pattern

SEVERITY_COLOR = {
    "Critical": C_RED,
    "High":     C_ORANGE,
    "Medium":   C_YELLOW,
    "Low":      C_GREEN,
}
STATUS_COLOR = {
    "non_compliant": (C_RED,       C_BADGE_RED, "Non-Compliant"),
    "at_risk":       (C_ORANGE,    C_BADGE_YEL, "At Risk"),
    "compliant":     (C_GREEN,     C_BADGE_GRN, "Compliant"),
}

# ── PDF class ─────────────────────────────────────────────────────────────────
FONT_DIR = "/usr/share/fonts/truetype/dejavu/"

class PentestReport(FPDF):

    def __init__(self):
        super().__init__("P", "mm", "A4")
        self.set_auto_page_break(auto=True, margin=20)
        self.set_margins(18, 18, 18)
        # Register Unicode fonts so em-dash, bullets, etc. render correctly
        self.add_font("Sans",     style="",  fname=FONT_DIR + "DejaVuSans.ttf")
        self.add_font("Sans",     style="B", fname=FONT_DIR + "DejaVuSans-Bold.ttf")
        self.add_font("Mono",     style="",  fname=FONT_DIR + "DejaVuSansMono.ttf")
        self.add_font("Mono",     style="B", fname=FONT_DIR + "DejaVuSansMono-Bold.ttf")

    # ── Header / Footer ──────────────────────────────────────────────────────
    def header(self):
        if self.page_no() == 1:
            return
        self.set_fill_color(*C_DARK)
        self.rect(0, 0, 210, 10, "F")
        self.set_font("Sans", "B", 8)
        self.set_text_color(*C_WHITE)
        self.set_xy(0, 1.5)
        self.cell(0, 6, f"  AutoRed.AI — Penetration Test Report  |  {TARGET}  |  CONFIDENTIAL",
                  align="L")
        self.set_text_color(*C_DARK)
        self.ln(4)

    def footer(self):
        self.set_y(-14)
        self.set_font("Sans", "", 7.5)
        self.set_text_color(148, 163, 184)
        self.cell(0, 5,
                  f"AutoRed.AI v1.0  |  Session {SHORT_SID}  |  "
                  f"Generated {datetime.utcnow().strftime('%Y-%m-%d %H:%M UTC')}",
                  align="C")
        self.set_text_color(*C_DARK)

    # ── Helpers ───────────────────────────────────────────────────────────────
    def h1(self, txt):
        self.ln(4)
        self.set_fill_color(*C_BLUE_DARK)
        self.set_text_color(*C_WHITE)
        self.set_font("Sans", "B", 13)
        self.cell(0, 9, f"  {txt}", new_x=XPos.LMARGIN, new_y=YPos.NEXT, fill=True)
        self.set_text_color(*C_DARK)
        self.ln(2)

    def h2(self, txt):
        self.ln(3)
        self.set_font("Sans", "B", 11)
        self.set_text_color(*C_BLUE)
        self.cell(0, 7, txt, new_x=XPos.LMARGIN, new_y=YPos.NEXT)
        self.set_draw_color(*C_BLUE_LITE)
        self.set_line_width(0.4)
        self.line(self.get_x(), self.get_y(), self.get_x() + 174, self.get_y())
        self.set_text_color(*C_DARK)
        self.ln(1)

    def h3(self, txt):
        self.ln(2)
        self.set_font("Sans", "B", 10)
        self.set_text_color(*C_MID)
        self.cell(0, 6, txt, new_x=XPos.LMARGIN, new_y=YPos.NEXT)
        self.set_text_color(*C_DARK)

    def body(self, txt, indent=0):
        self.set_font("Sans", "", 9.5)
        self.set_text_color(*C_MID)
        self.set_x(self.l_margin + indent)
        self.multi_cell(0, 5.5, txt)
        self.set_text_color(*C_DARK)
        self.ln(1)

    def kv_row(self, key, val, fill=False):
        self.set_font("Sans", "B", 9)
        self.set_fill_color(*C_LIGHT) if fill else self.set_fill_color(*C_WHITE)
        self.set_text_color(*C_MID)
        self.cell(48, 6.5, f"  {key}", fill=True)
        self.set_font("Sans", "", 9)
        self.set_text_color(*C_DARK)
        self.cell(0, 6.5, f"  {val}", fill=True,
                  new_x=XPos.LMARGIN, new_y=YPos.NEXT)

    def badge(self, txt, fg, bg):
        self.set_font("Sans", "B", 8)
        self.set_text_color(*fg)
        self.set_fill_color(*bg)
        w = self.get_string_width(txt) + 6
        self.cell(w, 5.5, txt, fill=True)

    def severity_badge(self, sev):
        color = SEVERITY_COLOR.get(sev, C_MID)
        bg    = (254, 226, 226) if sev == "Critical" else \
                (255, 237, 213) if sev == "High"     else \
                (254, 249, 195) if sev == "Medium"   else \
                (220, 252, 231)
        self.badge(sev, color, bg)

    def score_bar(self, score, width=60, height=5):
        """Render a horizontal score bar (0–100)."""
        x, y = self.get_x(), self.get_y()
        # Background
        self.set_fill_color(*C_LIGHT)
        self.rect(x, y, width, height, "F")
        # Fill
        fill_w = (score / 100) * width
        color  = C_RED if score < 50 else C_YELLOW if score < 70 else C_GREEN
        self.set_fill_color(*color)
        self.rect(x, y, fill_w, height, "F")
        # Score label
        self.set_font("Sans", "B", 7.5)
        self.set_text_color(*C_WHITE if score < 50 else C_DARK)
        self.set_xy(x + fill_w - 14, y)
        self.cell(14, height, f"{score}/100", align="R")
        self.set_text_color(*C_DARK)

    def code_block(self, code, lang=""):
        lines = code.split("\n")
        line_h = 4.5
        pad    = 4
        height = len(lines) * line_h + pad * 2
        available = self.h - self.b_margin - self.get_y()
        if height > available:
            self.add_page()

        x0, y0 = self.get_x(), self.get_y()
        w = self.epw

        # Background rect
        self.set_fill_color(*C_CODE_BG)
        self.rect(x0, y0, w, height, "F")

        # Language tag top-right
        if lang:
            self.set_font("Mono", "", 7)
            self.set_text_color(100, 116, 139)
            self.set_xy(x0 + w - self.get_string_width(lang) - 4, y0 + 1.5)
            self.cell(0, 3, lang)

        # Code lines
        self.set_font("Mono", "", 8)
        self.set_text_color(*C_CODE_FG)
        self.set_xy(x0 + pad, y0 + pad)
        for line in lines:
            self.set_x(x0 + pad)
            self.cell(w - pad * 2, line_h, line, new_x=XPos.LMARGIN, new_y=YPos.NEXT)

        self.set_text_color(*C_DARK)
        self.set_xy(x0, y0 + height + 2)

    def divider(self):
        self.ln(2)
        self.set_draw_color(*C_LIGHT)
        self.set_line_width(0.3)
        self.line(self.l_margin, self.get_y(), self.l_margin + 174, self.get_y())
        self.ln(3)

    def bullet(self, txt, indent=4):
        self.set_font("Sans", "", 9.5)
        self.set_text_color(*C_MID)
        x0 = self.l_margin + indent
        self.set_x(x0)
        self.cell(4, 5.5, "•")
        self.set_x(x0 + 5)
        self.multi_cell(self.epw - indent - 5, 5.5, txt)
        self.set_text_color(*C_DARK)


# ═══════════════════════════════════════════════════════════════════════════════
# Build the PDF
# ═══════════════════════════════════════════════════════════════════════════════
pdf = PentestReport()

# ── Cover Page ────────────────────────────────────────────────────────────────
pdf.add_page()

# Top banner
pdf.set_fill_color(*C_DARK)
pdf.rect(0, 0, 210, 55, "F")

pdf.set_text_color(*C_WHITE)
pdf.set_font("Sans", "B", 22)
pdf.set_xy(18, 12)
pdf.cell(0, 10, "Penetration Test Report")

pdf.set_font("Sans", "", 12)
pdf.set_xy(18, 24)
pdf.cell(0, 8, "Automated Red Teaming  |  AutoRed.AI v1.0")

# Accent line
pdf.set_fill_color(*C_BLUE)
pdf.rect(18, 34, 80, 1.5, "F")

pdf.set_font("Sans", "B", 14)
pdf.set_xy(18, 37)
pdf.cell(0, 8, f"Target:  {TARGET}")

pdf.set_text_color(*C_DARK)
pdf.set_xy(0, 60)

# Meta table
pdf.ln(4)
def cover_row(k, v, fill=False):
    pdf.set_font("Sans", "B", 9.5)
    pdf.set_fill_color(*(C_LIGHT if fill else C_WHITE))
    pdf.set_text_color(*C_MID)
    pdf.cell(50, 7, f"  {k}", fill=True)
    pdf.set_font("Sans", "", 9.5)
    pdf.set_text_color(*C_DARK)
    pdf.cell(0, 7, f"  {v}", fill=True, new_x=XPos.LMARGIN, new_y=YPos.NEXT)

cover_row("Target",      TARGET,               False)
cover_row("Session ID",  SESSION_ID,           True)
cover_row("Completed",   COMPLETED,            False)
cover_row("Engine",      "AutoRed.AI v1.0 — Claude AI + Kali MCP", True)
cover_row("Classification", "CONFIDENTIAL",    False)

# Vulnerability summary badges on cover
pdf.ln(8)
pdf.set_font("Sans", "B", 10)
pdf.set_text_color(*C_MID)
pdf.cell(0, 6, "Findings at a Glance", new_x=XPos.LMARGIN, new_y=YPos.NEXT)
pdf.ln(2)

counts = {"Critical": 0, "High": 0, "Medium": 0, "Low": 0}
# parse from executive_summary table in section 3
for line in llm["executive_summary"].split("\n"):
    for sev in counts:
        if f"| {sev}" in line or f"| {sev.lower()}" in line.lower():
            counts[sev] += 1

# Scan remediation snippets instead for a count proxy — use fixed mock counts
counts = {"Critical": 2, "High": 1, "Medium": 1, "Low": 0}

for sev, cnt in counts.items():
    color = SEVERITY_COLOR[sev]
    bg    = (254, 226, 226) if sev == "Critical" else \
            (255, 237, 213) if sev == "High"     else \
            (254, 249, 195) if sev == "Medium"   else \
            (220, 252, 231)
    pdf.set_fill_color(*bg)
    pdf.set_draw_color(*color)
    pdf.set_line_width(0.5)
    x0, y0 = pdf.get_x(), pdf.get_y()
    pdf.rect(x0, y0, 38, 20, "DF")
    pdf.set_font("Sans", "B", 18)
    pdf.set_text_color(*color)
    pdf.set_xy(x0, y0 + 2)
    pdf.cell(38, 10, str(cnt), align="C")
    pdf.set_font("Sans", "", 8)
    pdf.set_text_color(*C_MID)
    pdf.set_xy(x0, y0 + 12)
    pdf.cell(38, 6, sev, align="C")
    pdf.set_xy(x0 + 42, y0)

pdf.set_text_color(*C_DARK)
pdf.ln(26)
pdf.set_font("Sans", "", 8)
pdf.set_text_color(148, 163, 184)
pdf.cell(0, 5,
    "This report was generated automatically. All findings should be independently verified "
    "before remediation.", align="C")
pdf.set_text_color(*C_DARK)


# ── Section 1: Overview ───────────────────────────────────────────────────────
pdf.add_page()
pdf.h1("1.  Overview")

pdf.h2("1.1  Target Profile")
for i, (k, v) in enumerate([
    ("Target",           TARGET),
    ("OS",               "Linux (Ubuntu 20.04)"),
    ("Tech Stack",       "Apache 2.4 · Tomcat 9.0 · MySQL 8.0 · OpenSSH 8.2"),
    ("Security Posture", "Weak"),
    ("Risk Level",       "High-Value"),
]):
    pdf.kv_row(k, v, fill=(i % 2 == 0))

pdf.h2("1.2  Test Scope")
pdf.kv_row("Target",         TARGET,    fill=False)
pdf.kv_row("Services",       "SSH (22) · HTTP (80) · HTTPS (443) · MySQL (3306) · Tomcat (8080)", fill=True)
pdf.kv_row("Paths Attempted","4",        fill=False)
pdf.kv_row("Exploited",      "3 of 4",  fill=True)
pdf.kv_row("Defenses Held",  "1 — SSH brute-force blocked by fail2ban", fill=False)

pdf.h2("1.3  Test Timeline")
pdf.kv_row("Authorized Time", "2026-02-24",         fill=False)
pdf.kv_row("Completed At",    COMPLETED,            fill=True)
pdf.kv_row("Engine",          "AutoRed.AI v1.0 — Automated Gray-Box via Claude AI + Kali MCP", fill=False)


# ── Section 2: Test Policy ───────────────────────────────────────────────────
pdf.h1("2.  Test Policy")

pdf.h2("2.1  Test Method")
pdf.body(
    "This penetration test uses an automated gray-box test method powered by Claude AI agents "
    "connected to a live Kali Linux environment via MCP (Model Context Protocol). The agent "
    "autonomously discovers services, identifies vulnerabilities, and attempts exploitation "
    "using an OODA-loop-based reasoning engine without prior knowledge of internal architecture."
)

pdf.h2("2.2  Tools Used")
tools = [
    ("Port & Service Identification", "nmap, httpx"),
    ("Vulnerability Research",        "searchsploit, Nuclei"),
    ("Exploitation",                  "Custom MCP shell tools (Kali container)"),
    ("Credential Testing",            "Hydra, manual default credential checks"),
]
for i, (k, v) in enumerate(tools):
    pdf.kv_row(k, v, fill=(i % 2 == 0))

pdf.h2("2.3  Vulnerability Level Definition")
levels = [
    ("9.0 – 10.0", "Critical", C_RED,    C_BADGE_RED),
    ("7.0 – 8.9",  "High",     C_ORANGE, (255, 237, 213)),
    ("4.0 – 6.9",  "Medium",   C_YELLOW, (254, 249, 195)),
    ("0.0 – 3.9",  "Low",      C_GREEN,  C_BADGE_GRN),
]
for i, (score_range, label, fg, bg) in enumerate(levels):
    fill = (i % 2 == 0)
    pdf.set_fill_color(*(C_LIGHT if fill else C_WHITE))
    pdf.set_font("Sans", "", 9)
    pdf.set_text_color(*C_MID)
    pdf.cell(40, 6.5, f"  {score_range}", fill=True)
    pdf.set_fill_color(*bg)
    pdf.set_font("Sans", "B", 8.5)
    pdf.set_text_color(*fg)
    pdf.cell(30, 6.5, label, fill=True)
    pdf.set_fill_color(*(C_LIGHT if fill else C_WHITE))
    pdf.set_font("Sans", "", 9)
    pdf.set_text_color(*C_MID)
    remediation_note = (
        "Must fix immediately — highest priority" if label == "Critical" else
        "Must fix immediately" if label == "High" else
        "Recommended fix — medium priority" if label == "Medium" else
        "Address per risk appetite"
    )
    pdf.cell(0, 6.5, f"  {remediation_note}", fill=True,
             new_x=XPos.LMARGIN, new_y=YPos.NEXT)
pdf.set_text_color(*C_DARK)


# ── Section 3: Test Result Summary ──────────────────────────────────────────
pdf.add_page()
pdf.h1("3.  Test Result Summary")
pdf.body(
    "Penetration testing was executed against "
    f"{TARGET}. 4 vulnerabilities were discovered across 5 services."
)

# Table header
pdf.ln(2)
col_w = [10, 70, 68, 14, 12]
headers = ["No.", "Target:Port", "Vulnerability", "Severity", "CVSS"]
pdf.set_fill_color(*C_DARK)
pdf.set_text_color(*C_WHITE)
pdf.set_font("Sans", "B", 9)
for w, h in zip(col_w, headers):
    pdf.cell(w, 7, f" {h}", fill=True)
pdf.ln()
pdf.set_text_color(*C_DARK)

rows = [
    ("1", "192.168.1.100:80/login",      "SQL Injection on Login Endpoint",       "Critical", "9.8"),
    ("2", "192.168.1.100:8080/manager",  "Default Tomcat Manager Credentials",    "Critical", "9.1"),
    ("3", "192.168.1.100:3306/mysql",    "Unencrypted Remote Root MySQL Access",  "High",     "8.6"),
    ("4", "192.168.1.100:80",            "Missing Web Application Firewall",      "Medium",   "5.3"),
]
for i, (no, addr, vuln, sev, cvss) in enumerate(rows):
    fill = (i % 2 == 0)
    pdf.set_fill_color(*(C_LIGHT if fill else C_WHITE))
    pdf.set_font("Sans", "", 8.5)
    pdf.set_text_color(*C_MID)
    pdf.cell(col_w[0], 6.5, f" {no}",   fill=True)
    pdf.cell(col_w[1], 6.5, f" {addr}", fill=True)
    pdf.cell(col_w[2], 6.5, f" {vuln}", fill=True)
    # Severity badge cell
    sev_color = SEVERITY_COLOR.get(sev, C_MID)
    sev_bg    = (254, 226, 226) if sev == "Critical" else \
                (255, 237, 213) if sev == "High"     else \
                (254, 249, 195) if sev == "Medium"   else \
                (220, 252, 231)
    pdf.set_fill_color(*sev_bg)
    pdf.set_text_color(*sev_color)
    pdf.set_font("Sans", "B", 8)
    pdf.cell(col_w[3], 6.5, f" {sev}", fill=True)
    pdf.set_fill_color(*(C_LIGHT if fill else C_WHITE))
    pdf.set_font("Sans", "B", 8.5)
    pdf.set_text_color(*C_MID)
    pdf.cell(col_w[4], 6.5, cvss, align="C", fill=True,
             new_x=XPos.LMARGIN, new_y=YPos.NEXT)

pdf.set_text_color(*C_DARK)
pdf.ln(4)
pdf.body("Summary: 2 Critical, 1 High, 1 Medium. "
         "3 of 4 attack paths successfully exploited. "
         "1 defense held — SSH brute-force blocked by fail2ban.")


# ── Section 4: Test Result Description ──────────────────────────────────────
pdf.add_page()
pdf.h1("4.  Test Result Description")

findings = [
    {
        "title":    "SQL Injection on Login Endpoint",
        "severity": "Critical",
        "cvss":     "9.8",
        "address":  "192.168.1.100:80/login — Apache HTTP (port 80)",
        "procedure": (
            "Submitted a union-based SQL injection payload to the /login form's username parameter:\n\n"
            "  username=' UNION SELECT 1,username,password,4 FROM users-- -&password=x\n\n"
            "The server returned a 200 OK response containing user credential hashes."
        ),
        "risk": (
            "The login endpoint performs no input sanitization or parameterized queries. "
            "Successful exploitation exposes 2,847 user records and 15,203 payment records "
            "to unauthorized read access."
        ),
        "fix": (
            "Use parameterized queries or prepared statements in all database interactions. "
            "Deploy an AWS WAF rule to block SQLi patterns. "
            "Implement input validation on all user-supplied parameters."
        ),
    },
    {
        "title":    "Default Credentials on Tomcat Manager",
        "severity": "Critical",
        "cvss":     "9.1",
        "address":  "192.168.1.100:8080/manager/html — Apache Tomcat 9.0 (port 8080)",
        "procedure": (
            "Navigated to the Tomcat Manager web console and authenticated using "
            "factory-default credentials tomcat:tomcat. Login succeeded on the first attempt."
        ),
        "risk": (
            "With Manager access, an attacker can deploy arbitrary WAR files, achieving "
            "remote code execution on the host. No exploit is required — only the default password."
        ),
        "fix": (
            "Change all Tomcat Manager credentials immediately. "
            "Disable the Manager application in production environments. "
            "Restrict /manager by IP allowlist at the reverse proxy."
        ),
    },
    {
        "title":    "Unencrypted Remote Root MySQL Access",
        "severity": "High",
        "cvss":     "8.6",
        "address":  "192.168.1.100:3306/mysql — MySQL 8.0 (port 3306)",
        "procedure": (
            "Connected from an external host without TLS using the root account:\n\n"
            "  mysql -h 192.168.1.100 -u root -p --ssl-mode=DISABLED\n\n"
            "Root login succeeded over an unencrypted connection."
        ),
        "risk": (
            "Allows a network-positioned attacker to read, modify, or delete all databases. "
            "Credentials can be captured via packet capture on the same subnet."
        ),
        "fix": (
            "Disable remote root login. Bind MySQL to localhost (bind-address = 127.0.0.1). "
            "Enforce TLS. Restrict port 3306 to the internal application subnet only."
        ),
    },
    {
        "title":    "Missing Web Application Firewall",
        "severity": "Medium",
        "cvss":     "5.3",
        "address":  "192.168.1.100:80 — Apache HTTP (port 80)",
        "procedure": (
            "Sent SQLi, XSS, and path traversal payloads to the web application. "
            "No WAF, rate limiting, or input filtering was detected — "
            "all payloads reached the application unmodified."
        ),
        "risk": (
            "All OWASP Top 10 attack patterns reach the application directly. "
            "The SQL injection in Finding 4.1 was amplified by the absence of perimeter filtering."
        ),
        "fix": (
            "Deploy AWS WAF, Cloudflare WAF, or mod_security with the OWASP Core Rule Set "
            "in front of Apache. Enable rate limiting on authentication endpoints."
        ),
    },
]

for idx, f in enumerate(findings):
    pdf.h2(f"4.{idx+1}  {f['title']}")

    # Severity + CVSS inline
    pdf.set_font("Sans", "", 9)
    pdf.set_text_color(*C_MID)
    pdf.cell(20, 6, "Severity:")
    pdf.severity_badge(f["severity"])
    pdf.set_font("Sans", "", 9)
    pdf.set_text_color(*C_MID)
    pdf.cell(12, 6, "   CVSS:")
    pdf.set_font("Sans", "B", 9)
    pdf.set_text_color(*SEVERITY_COLOR.get(f["severity"], C_MID))
    pdf.cell(0, 6, f"  {f['cvss']}", new_x=XPos.LMARGIN, new_y=YPos.NEXT)
    pdf.set_text_color(*C_DARK)
    pdf.ln(1)

    pdf.h3("Test Address")
    pdf.body(f["address"], indent=2)

    pdf.h3("Test Procedure")
    pdf.body(f["procedure"], indent=2)

    pdf.h3("Vulnerability Risk")
    pdf.body(f["risk"], indent=2)

    pdf.h3("Vulnerability Fix Suggestion")
    pdf.body(f["fix"], indent=2)

    if idx < len(findings) - 1:
        pdf.divider()


# ── Section 5: Security Suggestions ─────────────────────────────────────────
pdf.add_page()
pdf.h1("5.  Security Suggestions")

pdf.h2("5.1  Vulnerability Fixing Suggestions")
pdf.body(
    "Remediate Critical findings within 24 hours. The SQL injection and default Tomcat "
    "credentials independently allow full system compromise and must not coexist in production. "
    "When fixing, consider the full attack surface — the absence of a WAF amplified the SQL "
    "injection impact. Defense-in-depth prevents single points of failure."
)

pdf.h2("5.2  Security Protection Recommendations")
recs = [
    ("Network Segmentation",
     "Port 3306 (MySQL) must not be internet-exposed. "
     "Place the database on an isolated subnet accessible only from the application tier."),
    ("WAF Deployment",
     "Deploy AWS WAF, Cloudflare WAF, or mod_security with OWASP CRS "
     "before the next production deployment."),
    ("Credential Management",
     "Implement a secrets manager (HashiCorp Vault or AWS Secrets Manager) "
     "to rotate and audit all service credentials automatically."),
    ("Patch Management",
     "Tomcat 9.0 is approaching end-of-life. "
     "Upgrade to Tomcat 10.1+ and establish a quarterly patching schedule."),
]
for rec_title, rec_body in recs:
    pdf.set_font("Sans", "B", 9.5)
    pdf.set_text_color(*C_DARK)
    pdf.cell(0, 6, f"  {rec_title}", new_x=XPos.LMARGIN, new_y=YPos.NEXT)
    pdf.body(rec_body, indent=4)

pdf.h2("5.3  Compliance & Audit Overview")
# Compliance cards
for cf in COMPLIANCE:
    reg    = cf["regulation"]
    status = cf["status"]
    score  = cf.get("score", 0) or 0
    fg, bg, label = STATUS_COLOR.get(status, (C_MID, C_LIGHT, status))

    pdf.ln(2)
    # Card header
    pdf.set_fill_color(*bg)
    pdf.set_draw_color(*fg)
    pdf.set_line_width(0.6)
    x0, y0 = pdf.get_x(), pdf.get_y()
    pdf.rect(x0, y0, 174, 7, "DF")
    pdf.set_font("Sans", "B", 10)
    pdf.set_text_color(*fg)
    pdf.set_xy(x0 + 2, y0 + 0.5)
    pdf.cell(100, 6, reg)
    pdf.set_font("Sans", "B", 8)
    pdf.set_xy(x0 + 130, y0 + 0.5)
    pdf.cell(44, 6, label, align="R")
    pdf.set_text_color(*C_DARK)
    pdf.set_xy(x0, y0 + 8)

    # Score bar
    pdf.set_x(x0 + 2)
    pdf.set_font("Sans", "", 8)
    pdf.set_text_color(*C_MID)
    pdf.cell(18, 5, "Score:")
    pdf.set_x(x0 + 20)
    pdf.score_bar(score, width=100, height=5)
    pdf.ln(7)

    # Failing items
    pdf.set_font("Sans", "", 8.5)
    pdf.set_text_color(*C_MID)
    for item in cf.get("items", []):
        pdf.bullet(item, indent=4)
    pdf.ln(1)

    # Articles
    if cf.get("articles"):
        pdf.set_font("Sans", "", 8)
        pdf.set_text_color(100, 116, 139)
        pdf.set_x(pdf.l_margin + 4)
        pdf.multi_cell(0, 4.5, "  References: " + "  ·  ".join(cf["articles"]))
    pdf.ln(2)


# ── Section 6: Remediation as Code ──────────────────────────────────────────
pdf.add_page()
pdf.h1("6.  Remediation as Code")
pdf.body(
    "The following infrastructure-as-code snippets provide ready-to-deploy fixes "
    "for the critical and high vulnerabilities identified in this assessment."
)

for snip in SNIPS:
    pdf.h2(snip["label"])
    pdf.set_font("Sans", "", 9)
    pdf.set_text_color(*C_MID)
    pdf.multi_cell(0, 5.5, snip.get("description", ""))
    pdf.set_text_color(*C_DARK)
    pdf.ln(2)
    pdf.code_block(snip["code"], lang=snip.get("language", ""))
    pdf.ln(3)


# ── Section 7: Learned Anti-Patterns ────────────────────────────────────────
pdf.add_page()
pdf.h1("7.  Learned Anti-Patterns")
pdf.body(
    "Observations from the engagement — both defenses that held "
    "and weaknesses that were exploited or amplified."
)
pdf.ln(2)

positives = [p for p in PATTERNS if p["type"] == "positive"]
negatives = [p for p in PATTERNS if p["type"] == "negative"]

if positives:
    pdf.h2("Positive — Security Controls That Held")
    for p in positives:
        x0, y0 = pdf.get_x(), pdf.get_y()
        # Measure height needed
        pdf.set_font("Sans", "", 9)
        lines = pdf.multi_cell(158, 5.5, p["detail"], dry_run=True, output="LINES")
        card_h = 7 + len(lines) * 5.5 + 4
        if pdf.get_y() + card_h > pdf.h - pdf.b_margin:
            pdf.add_page()
            x0, y0 = pdf.get_x(), pdf.get_y()
        pdf.set_fill_color(*C_POS_BG)
        pdf.set_draw_color(*C_GREEN)
        pdf.set_line_width(0.5)
        pdf.rect(x0, y0, 174, card_h, "DF")
        pdf.set_xy(x0 + 3, y0 + 2)
        pdf.set_font("Sans", "B", 9.5)
        pdf.set_text_color(*C_GREEN)
        pdf.cell(0, 5.5, f"✓  {p['title']}", new_x=XPos.LMARGIN, new_y=YPos.NEXT)
        pdf.set_xy(x0 + 5, pdf.get_y())
        pdf.set_font("Sans", "", 9)
        pdf.set_text_color(*C_MID)
        pdf.multi_cell(164, 5.5, p["detail"])
        pdf.set_xy(x0, y0 + card_h + 3)
        pdf.set_text_color(*C_DARK)

if negatives:
    pdf.ln(4)
    pdf.h2("Negative — Weaknesses Observed")
    for p in negatives:
        x0, y0 = pdf.get_x(), pdf.get_y()
        pdf.set_font("Sans", "", 9)
        lines = pdf.multi_cell(158, 5.5, p["detail"], dry_run=True, output="LINES")
        card_h = 7 + len(lines) * 5.5 + 4
        if pdf.get_y() + card_h > pdf.h - pdf.b_margin:
            pdf.add_page()
            x0, y0 = pdf.get_x(), pdf.get_y()
        pdf.set_fill_color(*C_NEG_BG)
        pdf.set_draw_color(*C_RED)
        pdf.set_line_width(0.5)
        pdf.rect(x0, y0, 174, card_h, "DF")
        pdf.set_xy(x0 + 3, y0 + 2)
        pdf.set_font("Sans", "B", 9.5)
        pdf.set_text_color(*C_RED)
        pdf.cell(0, 5.5, f"✗  {p['title']}", new_x=XPos.LMARGIN, new_y=YPos.NEXT)
        pdf.set_xy(x0 + 5, pdf.get_y())
        pdf.set_font("Sans", "", 9)
        pdf.set_text_color(*C_MID)
        pdf.multi_cell(164, 5.5, p["detail"])
        pdf.set_xy(x0, y0 + card_h + 3)
        pdf.set_text_color(*C_DARK)


# ── Output ────────────────────────────────────────────────────────────────────
out_path = os.path.join(DOCS_DIR, f"AutoRed_PentestReport_{SHORT_SID}.pdf")
pdf.output(out_path)
print(f"[+] PDF generated: {out_path}")
print(f"    Pages: {pdf.page}")
