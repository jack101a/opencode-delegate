import test from "node:test";
import assert from "node:assert/strict";
import {
  computeSummaryStats,
  filterRecords,
  estimateTokens,
  generateTrendData
} from "../src/dashboard-engine.mjs";

const sampleRecords = [
  { id: 1, task: "Refactor auth middleware", model: "deepseek-v4.1", tokens: 1200, latencyMs: 340, status: "PASS", timestamp: Date.now() - 3600000 },
  { id: 2, task: "Write unit tests for date utils", model: "glm-5.3", tokens: 800, latencyMs: 220, status: "PASS", timestamp: Date.now() - 7200000 },
  { id: 3, task: "Fix edge case in parser", model: "mimo-v2.6", tokens: 450, latencyMs: 180, status: "FAIL", timestamp: Date.now() - 10800000 },
  { id: 4, task: "Database migration script", model: "deepseek-v4.1", tokens: 2100, latencyMs: 510, status: "PASS", timestamp: Date.now() - 14400000 }
];

test("Dashboard Engine: computeSummaryStats", async (t) => {
  await t.test("calculates totals and averages correctly", () => {
    const stats = computeSummaryStats(sampleRecords);
    assert.equal(stats.totalRequests, 4);
    assert.equal(stats.totalTokens, 4550);
    assert.equal(stats.avgLatencyMs, 313); // (340 + 220 + 180 + 510) / 4 = 312.5 -> 313
    assert.equal(stats.successRatePercent, 75); // 3 of 4 = 75%
  });

  await t.test("handles empty records without division by zero", () => {
    const stats = computeSummaryStats([]);
    assert.equal(stats.totalRequests, 0);
    assert.equal(stats.totalTokens, 0);
    assert.equal(stats.avgLatencyMs, 0);
    assert.equal(stats.successRatePercent, 100);
  });
});

test("Dashboard Engine: filterRecords", async (t) => {
  await t.test("filters by search keyword", () => {
    const res = filterRecords(sampleRecords, { search: "auth" });
    assert.equal(res.length, 1);
    assert.equal(res[0].id, 1);
  });

  await t.test("filters by status", () => {
    const res = filterRecords(sampleRecords, { status: "FAIL" });
    assert.equal(res.length, 1);
    assert.equal(res[0].id, 3);
  });

  await t.test("filters by model name", () => {
    const res = filterRecords(sampleRecords, { model: "deepseek-v4.1" });
    assert.equal(res.length, 2);
  });
});

test("Dashboard Engine: estimateTokens", async (t) => {
  await t.test("estimates token counts based on string length", () => {
    assert.equal(estimateTokens(""), 0);
    assert.equal(estimateTokens("hello world"), 3); // 11 chars / 4 rounded up
    assert.ok(estimateTokens("A".repeat(100)) >= 25);
  });
});

test("Dashboard Engine: generateTrendData", async (t) => {
  await t.test("generates bucketed hourly trend points", () => {
    const trend = generateTrendData(sampleRecords, 6);
    assert.ok(Array.isArray(trend));
    assert.equal(trend.length, 6);
    assert.ok(trend.some((pt) => pt.tokens > 0));
  });
});
