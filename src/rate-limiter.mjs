export class TokenBucket {
  constructor({ capacity, refillRatePerSecond }) {
    if (capacity <= 0) {
      throw new Error("capacity must be positive");
    }
    if (refillRatePerSecond <= 0) {
      throw new Error("refillRatePerSecond must be positive");
    }
    this.capacity = capacity;
    this.refillRatePerSecond = refillRatePerSecond;
    this.tokens = capacity;
    this.lastRefillTime = Date.now();
  }

  getTokens() {
    this._refill();
    return this.tokens;
  }

  tryAcquire(count) {
    this._refill();
    if (this.tokens >= count) {
      this.tokens -= count;
      return true;
    }
    return false;
  }

  reset() {
    this.tokens = this.capacity;
    this.lastRefillTime = Date.now();
  }

  _refill() {
    const now = Date.now();
    const elapsedMs = now - this.lastRefillTime;
    if (elapsedMs <= 0) return;
    const tokensToAdd = (elapsedMs / 1000) * this.refillRatePerSecond;
    this.tokens = Math.min(this.capacity, this.tokens + tokensToAdd);
    this.lastRefillTime = now;
  }
}
