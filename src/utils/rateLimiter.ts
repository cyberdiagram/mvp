export class RateLimiter {
  private requests: Map<string, number[]> = new Map();
  private maxRequests: number;
  private windowMs: number;

  constructor(maxRequests: number = 10, windowMs: number = 60000) {
    this.maxRequests = maxRequests;
    this.windowMs = windowMs;
  }

  async checkLimit(clientId: string): Promise<boolean> {
    const now = Date.now();
    const requests = this.requests.get(clientId) || [];

    // Remove old requests outside the window
    const recentRequests = requests.filter((time) => now - time < this.windowMs);

    if (recentRequests.length >= this.maxRequests) {
      return false; // Rate limit exceeded
    }

    recentRequests.push(now);
    this.requests.set(clientId, recentRequests);

    return true; // Request allowed
  }

  reset(clientId: string): void {
    this.requests.delete(clientId);
  }
}