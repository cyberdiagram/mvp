# Data Parsing Skill: Advanced Fingerprinting

## Overview

This skill provides identification rules for specific technologies that are commonly
hidden behind generic service banners. Use these patterns when parsing nmap output,
HTTP headers, and service banners to produce accurate `product` and `category` values.

---

## Network Appliances

### pfSense Identification
- **Context**: Ports 80/443 open with HTTP service
- **Indicators**:
  - Server header: `lighttpd` (pfSense default web server)
  - NSE Script `http-title`: contains "pfSense - Login" or "pfSense"
  - Self-signed certificate with "pfSense" in subject/issuer
- **Action**: Set `product` to "pfSense Firewall", `category` to "network-device", `criticality` to "high"

### Fortinet FortiGate Identification
- **Context**: Ports 80/443/10443 open
- **Indicators**:
  - HTTP title contains "FortiGate" or "Fortinet"
  - Server header: custom or absent (Fortinet strips it)
  - SSL certificate subject includes "Fortinet" or "FortiGate"
- **Action**: Set `product` to "Fortinet FortiGate", `category` to "network-device", `criticality` to "high"

### MikroTik RouterOS Identification
- **Context**: Ports 80/8291/8728/8729 open
- **Indicators**:
  - HTTP title contains "RouterOS" or "MikroTik"
  - Port 8291 (Winbox protocol) is open
  - FTP banner contains "MikroTik"
- **Action**: Set `product` to "MikroTik RouterOS", `category` to "network-device", `criticality` to "high"

---

## Web Application Servers & Middleware

### Oracle WebLogic Identification
- **Context**: Port 7001/7002 open
- **Indicators**:
  - `t3` or `t3s` protocol detected in banner
  - HTTP title contains "WebLogic" or "Error 404--Not Found" (default page)
  - Banner includes "WebLogic Server"
- **Action**: Set `product` to "Oracle WebLogic", `category` to "web", `criticality` to "high"
- **Note**: WebLogic has many critical CVEs (CVE-2019-2725, CVE-2020-14882)

### Apache Tomcat Identification
- **Context**: Ports 8080/8443 open
- **Indicators**:
  - HTTP title contains "Apache Tomcat" or default Tomcat page
  - Server header: `Apache-Coyote` or `Apache Tomcat`
  - `/manager/html` path exists
- **Action**: Set `product` to "Apache Tomcat", `category` to "web", `criticality` to "medium"

### JBoss/WildFly Identification
- **Context**: Ports 8080/9990 open
- **Indicators**:
  - HTTP headers contain "JBoss" or "WildFly"
  - Port 9990 (management console) open
  - Default page shows "Welcome to WildFly"
- **Action**: Set `product` to "JBoss/WildFly", `category` to "web", `criticality` to "high"

---

## Content Management Systems

### WordPress Identification
- **Context**: Port 80/443 with HTTP service
- **Indicators**:
  - HTML contains `/wp-content/`, `/wp-includes/`, or `wp-login.php`
  - `X-Powered-By` header contains "WordPress"
  - Generator meta tag: "WordPress X.X"
- **Action**: Set `product` to "WordPress", `category` to "web", `criticality` to "medium"

### Joomla Identification
- **Context**: Port 80/443 with HTTP service
- **Indicators**:
  - HTML contains `/administrator/` login page
  - Generator meta tag: "Joomla"
  - `/components/` and `/modules/` paths exist
- **Action**: Set `product` to "Joomla CMS", `category` to "web", `criticality` to "medium"

---

## Database Services

### Redis Identification
- **Context**: Port 6379 open
- **Indicators**:
  - Banner contains "Redis" or responds to PING with PONG
  - Service detected as "redis"
- **Action**: Set `product` to "Redis", `category` to "database", `criticality` to "high"
- **Note**: Redis without authentication is a common misconfiguration

### Elasticsearch Identification
- **Context**: Ports 9200/9300 open
- **Indicators**:
  - HTTP response contains `"cluster_name"` and `"tagline" : "You Know, for Search"`
  - Port 9300 (transport) detected
- **Action**: Set `product` to "Elasticsearch", `category` to "database", `criticality` to "high"

### MongoDB Identification
- **Context**: Port 27017 open
- **Indicators**:
  - Banner contains "MongoDB" or responds to ismaster command
  - Service detected as "mongodb"
- **Action**: Set `product` to "MongoDB", `category` to "database", `criticality` to "high"
- **Note**: Check for unauthenticated access immediately

---

## Industrial Control Systems (ICS)

### Modbus Identification
- **Context**: Port 502 open
- **Indicators**:
  - Service detected as "modbus" or "mbap"
- **Action**: Set `product` to "Modbus Device", `category` to "ics", `criticality` to "high"

### Siemens S7 Identification
- **Context**: Port 102 open
- **Indicators**:
  - Service detected as "iso-tsap" or "s7comm"
- **Action**: Set `product` to "Siemens S7 PLC", `category` to "ics", `criticality` to "high"

---

## Remote Management

### iLO/iDRAC/IPMI Identification
- **Context**: Ports 443/623/17988 open
- **Indicators**:
  - HTTP title contains "iLO", "iDRAC", or "IPMI"
  - Port 623 (IPMI/RMCP) open
  - SSL certificate contains "Hewlett-Packard" or "Dell"
- **Action**: Set `product` to "HP iLO" / "Dell iDRAC" / "IPMI BMC", `category` to "remote-access", `criticality` to "high"

### VMware ESXi Identification
- **Context**: Ports 443/902/9443 open
- **Indicators**:
  - HTTP title contains "VMware ESXi"
  - Port 902 (NFC) open
  - SSL certificate contains "VMware"
- **Action**: Set `product` to "VMware ESXi", `category` to "remote-access", `criticality` to "high"

---

## General Rules

1. When a service banner or title strongly matches a pattern above, prefer the specific product name over the generic service name
2. Network appliances and ICS devices should always be `criticality: high` due to their infrastructure role
3. When multiple indicators match, confidence should be increased (0.8+)
4. If only one weak indicator matches (e.g., just a port number), note it but keep confidence lower (0.5-0.6)
