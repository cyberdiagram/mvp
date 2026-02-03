import * as fs from 'fs';
import * as path from 'path';

export class Logger {
  private logFile: string;

  constructor(logFile: string = 'nmap-mcp.log') {
    this.logFile = logFile;
  }

  log(level: 'INFO' | 'WARN' | 'ERROR', message: string, data?: any): void {
    const timestamp = new Date().toISOString();
    const logEntry = {
      timestamp,
      level,
      message,
      data,
    };

    const logLine = JSON.stringify(logEntry) + '\n';

    fs.appendFileSync(this.logFile, logLine);
    console.error(`[${level}] ${message}`, data || '');
  }

  info(message: string, data?: any): void {
    this.log('INFO', message, data);
  }

  warn(message: string, data?: any): void {
    this.log('WARN', message, data);
  }

  error(message: string, data?: any): void {
    this.log('ERROR', message, data);
  }
}