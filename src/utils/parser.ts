export interface Host {
  ip: string;
  hostname?: string;
  state: 'up' | 'down';
  ports: Port[];
}

export interface Port {
  port: number;
  protocol: 'tcp' | 'udp';
  state: string;
  service: string;
  version?: string;
}

export class NmapParser {
  static parseHosts(nmapOutput: string): Host[] {
    const hosts: Host[] = [];
    let currentHost: Host | null = null;

    const lines = nmapOutput.split('\n');

    for (const line of lines) {
      // Parse host line
      if (line.includes('Nmap scan report for')) {
        if (currentHost) {
          hosts.push(currentHost);
        }

        const ipMatch = line.match(/for ([0-9.]+)/);
        const hostnameMatch = line.match(/for ([^\s]+) \(([0-9.]+)\)/);

        if (hostnameMatch) {
          currentHost = {
            hostname: hostnameMatch[1],
            ip: hostnameMatch[2],
            state: 'up',
            ports: [],
          };
        } else if (ipMatch) {
          currentHost = {
            ip: ipMatch[1],
            state: 'up',
            ports: [],
          };
        }
      }

      // Parse port line
      if (currentHost && line.match(/^\d+\/(tcp|udp)/)) {
        const parts = line.trim().split(/\s+/);
        if (parts.length >= 3) {
          const [portProto, state, service, ...versionParts] = parts;
          const [port, protocol] = portProto.split('/');

          currentHost.ports.push({
            port: parseInt(port),
            protocol: protocol as 'tcp' | 'udp',
            state,
            service,
            version: versionParts.join(' ') || undefined,
          });
        }
      }
    }

    if (currentHost) {
      hosts.push(currentHost);
    }

    return hosts;
  }
}