# HuaweiCloud Penetration Test Report

**Organization:** Huawei Cloud Computing Company — Security Professional Service Delivery Team

**Project Period:** 2023/09/01 — 2023/09/30

> ⚠️ Copyright infringement must be prosecuted.

---

## Table of Contents

1. [Overview](#1-overview)
   - [1.1 Project Background](#11-project-background)
   - [1.2 Project Plan](#12-project-plan)
   - [1.3 Test Scope](#13-test-scope)
2. [Test Policy](#2-test-policy)
   - [2.1 Test Method](#21-test-method)
   - [2.2 Summary of Key Test Points](#22-summary-of-key-test-points)
   - [2.3 Test Method Summary](#23-test-method-summary)
   - [2.4 Test Tool Description](#24-test-tool-description)
   - [2.5 Vulnerability Level Definition](#25-vulnerability-level-definition)
3. [Test Result](#3-test-result)
   - [3.1 Test Result Summary](#31-test-result-summary)
4. [Test Result Description](#4-test-result-description)
   - [4.1 Unauthorized Access to etcd in the Kubernetes Cluster (Medium-risk)](#41-unauthorized-access-to-etcd-in-the-kubernetes-cluster-medium-risk)
   - [4.2 IAM URL Open Redirection Vulnerability (Low-risk)](#42-iam-url-open-redirection-vulnerability-low-risk)
   - [4.3 OpenStack ironic-python-agent Information Leakage Vulnerability (Low-risk)](#43-openstack-ironic-python-agent-information-leakage-vulnerability-low-risk)
5. [Security Suggestions](#5-security-suggestions)
   - [5.1 Vulnerability Fixing Suggestions](#51-vulnerability-fixing-suggestions)
   - [5.2 Suggestions for Security Protection](#52-suggestions-for-security-protection)
   - [5.3 Suggestions on Security O&M](#53-suggestions-on-security-om)

---

## 1. Overview

### 1.1 Project Background

The purpose of this penetration test is to identify vulnerabilities and risks in the assets of the management plane of Saudi Arabia NEOM HCSO, and to provide a report including the issues found and mitigation suggestions.

### 1.2 Project Plan

| Field               | Details                                                           |
|---------------------|-------------------------------------------------------------------|
| **Test Object**     | Network devices, Servers, and Applications in the NEOM HCSO Management Plane |
| **Authorized Time** | 2023/09/01 — 2023/09/30                                          |
| **Project Leader**  | Zhang Zhipeng                                                     |

### 1.3 Test Scope

| No. | Network       | IP Address       |
|-----|---------------|------------------|
| 1   | iBMC Plane    | 28.249.128.0/17  |
| 2   | Service Plane | 26.249.128.0/17  |

---

## 2. Test Policy

### 2.1 Test Method

This penetration test uses the **gray-box test method**. After connecting to the O&M network via SVN, the test covers network devices, servers, and services/applications deployed in the management plane.

### 2.2 Summary of Key Test Points

| Test Item | Test Content |
|-----------|-------------|
| **Network and Port Detection** | Multiple service systems may be deployed on servers of the tested system, or default service ports may be open, or services within the authorization scope may have exploitable vulnerabilities affecting the tested application. |
| **HTTP Service Fingerprint Testing** | 1) Use tools such as wappalyzer with the domain name (or IP address) and port to view the output. 2) Use NC to submit requests and determine content based on returned HTTP headers. |
| **Multifactor Authentication** | Check whether multiple authentication modes are used on the login page. |
| **Session Management** | Check whether a session management mechanism is used; whether the session cookie has the `Http-Only` attribute; whether the session cookie has the `Secure` attribute; and whether session hijacking attacks are defended against. |
| **Data Verification** | Check for SQL injection, XSS, CSRF, file upload, command execution, local verification bypass, and other improper data verification vulnerabilities. |
| **SSL Encryption for Sensitive Data** | Check whether pages transmitting sensitive information use SSL encryption. Login process should use HTTPS with POST. |
| **Sensitive Information Protection** | Check whether local sensitive information is encrypted during transmission and storage. Check whether server error messages, HTML, JS, or CSS files contain sensitive information. Check for information leakage across all functions. |
| **Configuration Management** | Check for directory listing risks, directory guessing risks, default server management login pages, enabled HTTP methods (OPTIONS, Trace, PUT, Move), accessible backup/database files, and missing access restrictions for sensitive directories. |
| **Web Server Console Discovery** | Search for web middleware consoles with exploitable security vulnerabilities. Attempt login using default credentials; a successful login confirms the vulnerability. |
| **Open Source Application Version Testing** | Identify open source programs or their components in use that may carry public CVE vulnerabilities. |
| **Directory and File Brute Force** | Search for directories and files unreachable by a crawler using dictionary mode. |
| **Unauthorized Operations** | Assume a low-privilege application user and attempt to access known administrative URLs not available in the admin menu. |
| **OS Command Execution** | On pages that invoke system commands, substitute alternate commands and verify if execution occurs. |
| **Bypass Authentication** | 1) Direct access to protected pages. 2) Parameter modification. 3) Session ID prediction. 4) Cookie spoofing. 5) HTML form SQL bypass (universal password). |
| **Weak Password Cracking** | 1) Use password generation or dictionary attacks on the login page to crack system and device accounts. 2) Collect default credentials through reconnaissance and attempt logins. |

### 2.3 Test Method Summary

Multiple penetration testing methods are used — including port detection, service identification, fingerprint collection, configuration checks, vulnerability testing, exploitation, and replay analysis — to detect security risks in management plane assets and provide targeted security improvement suggestions.

### 2.4 Test Tool Description

| Tool Type | Tool Name |
|-----------|-----------|
| **Information Collection** | Port & service identification: `nmap`, `nabbu`, `httpx`, `kscan`; JS information collection: `JSfinder` |
| **Directory Brute Force** | `dirsearch` |
| **Vulnerability Scanning** | `Nuclei` |
| **Password Guessing** | Burp Suite Community |
| **Script Testing** | Burp Suite Community |

### 2.5 Vulnerability Level Definition

Vulnerability risk levels are determined by the **CVSS (Common Vulnerability Scoring System)** score — an industry standard for evaluating the severity of security vulnerabilities, currently at version 3.0.

The **Base Metric Group** is used to score vulnerabilities reflecting the security risks faced by the system:

| Score Range | Risk Level  |
|-------------|-------------|
| 9.0 – 10.0  | Critical    |
| 7.0 – 8.9   | High        |
| 4.0 – 6.9   | Medium      |
| 0.0 – 3.9   | Low         |

> CVSS 3.0 uses three metric groups: Base, Temporal, and Environmental.

For vulnerabilities that cannot be directly exploited to threaten CIA attributes but violate Huawei's redline definition or security specifications (or industry best practices), the rating is based on the risk size after successful exploitation, Huawei redline definitions, and security regulations.

**Remediation Priorities:**
- **Critical / High:** Must be fixed; highest priority.
- **Medium:** Recommended to fix; medium priority.
- **Low (Warning):** Can be fixed based on site requirements; long-term rectification plan recommended.

---

## 3. Test Result

### 3.1 Test Result Summary

Penetration testing was executed on the management plane platform assets. **Three vulnerabilities** were discovered: one medium-risk and two low-risk.

| No. | System / Address | Vulnerability Name | Risk Level | Vulnerability Level |
|-----|------------------|--------------------|------------|---------------------|
| 1 | `26.249.164.176:2379` `26.249.164.175:2379` `26.249.164.174:2379` | Unauthorized Access to K8S Cluster etcd | Medium-risk | Level 3 |
| 2 | `26.249.164.136` | HCSO IAM URL Open Redirection Vulnerability | Low-risk | Level 4 |
| 3 | `26.249.236.6:9999` `26.249.236.8:9999` `26.249.220.6:9999` `26.249.236.5:9999` `26.249.220.8:9999` `26.249.220.4:9999` `26.249.220.5:9999` `26.249.236.4:9999` | OpenStack ironic-python-agent Information Leakage | Low-risk | Level 4 |

---

## 4. Test Result Description

### 4.1 Unauthorized Access to etcd in the Kubernetes Cluster (Medium-risk)

#### Test Addresses

```
26.249.164.176:2379
26.249.164.175:2379
26.249.164.174:2379
```

#### Test Procedure

Run the `curl` command or `etcdctl` command to access the etcd API without authentication:

```bash
curl http://26.249.164.176:2379/v2/keys/?recursive=true
```

The API responds successfully and returns data without requiring any credentials, confirming unauthenticated access.

#### Vulnerability Risk

Kubernetes etcd is used to store cluster state data. Unauthorized access to etcd allows attackers to:

- Obtain Kubernetes authentication tokens and TLS keys stored in etcd.
- Take over the entire Kubernetes cluster.

#### Vulnerability Fix Suggestions

- Enable **client certificate authentication** when starting etcd using the `--client-cert-auth` parameter.
- **Encrypt etcd data at rest** so that data cannot be used even if leaked.
- Set the `--listen-client-urls` parameter correctly to prevent the etcd service address from being exposed to external networks.

---

### 4.2 IAM URL Open Redirection Vulnerability (Low-risk)

#### Test Address

```
https://26.249.164.136
```

#### Test Procedure

Access the login interface and modify the `idp_login_url` parameter to an arbitrary external URL. The server performs the redirect without validating the destination:

```
https://26.249.164.136/authui/federation/login?idp_login_url=http://w3.huawei.com/next/indexa.html&logintoken=1
```

The user is redirected to the specified (malicious) website without any restriction.

#### Vulnerability Risk

The root cause is that access URLs are not fully verified or filtered. Attackers can:

- Construct malicious URLs to redirect users to arbitrary websites or applications.
- Launch **phishing attacks**, spread **malware**, and execute **targeted attacks**.

#### Vulnerability Fix Suggestions

- **Validate and filter URL parameters** to ensure they conform to expected formats and types.
- Define a **trustlist (allowlist) of permitted redirect destinations**.
- Use **relative or absolute paths** for redirects; avoid using user-supplied parameters to directly construct redirection URLs.

---

### 4.3 OpenStack ironic-python-agent Information Leakage Vulnerability (Low-risk)

#### Test Addresses

```
http://26.249.236.6:9999
http://26.249.236.8:9999
http://26.249.220.6:9999
http://26.249.236.5:9999
http://26.249.220.8:9999
http://26.249.220.4:9999
http://26.249.220.5:9999
http://26.249.236.4:9999
```

#### Test Procedure

Access the ironic-python-agent REST API directly via a browser or HTTP client without authentication. The API responds with internal service data and configuration details.

#### Vulnerability Risk

- **Service data and internal sensitive information** may be disclosed.
- Leaked data may enable attackers to execute **system commands** and interact with **operating system files**, causing system damage or major data leakage.

#### Vulnerability Fix Suggestions

- Configure **identity authentication and authorization mechanisms** for all API interface access.
- Configure **firewall policies** to restrict access to the interface to specified IP addresses only.

---

## 5. Security Suggestions

### 5.1 Vulnerability Fixing Suggestions

#### 5.1.1 Consider "Surface" Security During Vulnerability Fixing

Penetration testing may only detect "point" security issues. For attackers, only a few "point" vulnerabilities are needed to threaten core assets. For defense, **"plane" (surface-level) security** must be achieved.

When fixing vulnerabilities, consider the whole security posture — do not only fix the specific "point" vulnerability identified. Address the broader class of risk it represents.

### 5.2 Suggestions for Security Protection

#### 5.2.1 Network Isolation

As an independent region, the HCSO may serve different customers. If the HCSO is an independent region (e.g., `me-east-212` for NEOM in Saudi Arabia), the O&M zones of different HCSOs should be **isolated by firewalls at the network layer**.

### 5.3 Suggestions on Security O&M

#### 5.3.1 Security Management Suggestions

For vulnerabilities discovered during penetration testing, review whether:

- The **coverage scope of site rollout checks** and **routine vulnerability scanning** has gaps that missed these issues.
- **Corresponding vulnerability detection capabilities and tools** need to be supplemented to prevent similar issues in the future.

---

*End of Report*
