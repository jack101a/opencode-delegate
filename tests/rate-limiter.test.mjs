import test from "node:test";
import assert from "node:assert/strict";
import { TokenBucket } from "../src/rate-limiter.mjs";

test("TokenBucket Rate Limiter", async (t) => {
  await t.test("initializes with max capacity", () => {
    const bucket = new TokenBucket({ capacity: 10, refillRatePerSecond: 2 });
    assert.equal(bucket.getTokens(), 10);
  });

  await t.test("tryAcquire succeeds when tokens are available", () => {
    const bucket = new TokenBucket({ capacity: 5, refillRatePerSecond: 1 });
    assert.equal(bucket.tryAcquire(2), true);
    assert.equal(bucket.getTokens(), 3);
  });

  await t.test("tryAcquire rejects when requesting more tokens than available", () => {
    const bucket = new TokenBucket({ capacity: 3, refillRatePerSecond: 1 });
    assert.equal(bucket.tryAcquire(5), false);
    assert.equal(bucket.getTokens(), 3);
  });

  await t.test("refills tokens over time up to capacity", async () => {
    const bucket = new TokenBucket({ capacity: 5, refillRatePerSecond: 10 });
    assert.equal(bucket.tryAcquire(5), true);
    assert.equal(bucket.getTokens(), 0);

    // Wait 250ms -> should refill at 10 tokens/sec (~2.5 tokens)
    await new Promise((r) => setTimeout(r, 250));
    assert.ok(bucket.getTokens() >= 2, `Expected >= 2 tokens, got ${bucket.getTokens()}`);
    assert.ok(bucket.getTokens() <= 5, "Must not exceed max capacity");
  });

  await t.test("reset restores tokens to full capacity", () => {
    const bucket = new TokenBucket({ capacity: 5, refillRatePerSecond: 1 });
    bucket.tryAcquire(4);
    assert.equal(bucket.getTokens(), 1);
    bucket.reset();
    assert.equal(bucket.getTokens(), 5);
  });

  await t.test("rejects invalid constructor inputs", () => {
    assert.throws(() => new TokenBucket({ capacity: -1, refillRatePerSecond: 1 }));
    assert.throws(() => new TokenBucket({ capacity: 10, refillRatePerSecond: 0 }));
  });
});
