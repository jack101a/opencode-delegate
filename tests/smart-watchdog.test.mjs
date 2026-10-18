import test from "node:test";
import assert from "node:assert/strict";
import { loadConfig } from "../.agents/skills/opencode-delegate/scripts/bridge.mjs";

test("Smart Watchdog & Fallback Chain Configuration", async (t) => {
  const { config } = loadConfig();

  await t.test("fallback chain is strictly DeepSeek -> GLM -> MiMo", () => {
    assert.equal(config.defaultModel, "opencode/deepseek-v4.1-flash-free");
    assert.deepEqual(config.fallbacks, [
      "opencode/glm-5.3-flash-free",
      "opencode/mimo-v2.6-flash-free"
    ]);
  });

  await t.test("execution policy sets 3 retries per model and 5m timeout", () => {
    assert.equal(config.execution?.retriesPerModel, 3);
    assert.equal(config.execution?.timeoutMs, 300000);
    assert.equal(config.execution?.idleTimeoutMs, 90000);
    assert.equal(config.execution?.adaptiveExtensionMs, 60000);
    assert.equal(config.execution?.maxAdaptiveExtensions, 3);
  });
});
