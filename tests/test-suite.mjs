import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execSync, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

import {
  loadConfig,
  saveConfig,
  discoverModels,
  filterRecommendedModels,
  resolveAndValidateModel,
  configureModels,
  delegateTask
} from "../.agents/skills/opencode-delegate/scripts/bridge.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..");
const MCP_SERVER_PATH = path.resolve(REPO_ROOT, ".agents/skills/opencode-delegate/scripts/mcp-server.mjs");

test("Suite 1: Config Loading & Persistence", async (t) => {
  await t.test("loadConfig returns valid configuration object and path", () => {
    const { config, configPath } = loadConfig(REPO_ROOT);
    assert.ok(config, "Config must exist");
    assert.equal(typeof config.version, "number");
    assert.equal(typeof config.triggerMode, "string");
    assert.ok(config.defaultModel, "defaultModel must be defined");
    assert.ok(Array.isArray(config.fallbacks), "fallbacks must be an array");
    assert.ok(config.aliases, "aliases must be an object");
    assert.ok(fs.existsSync(configPath), "configPath must exist on disk");
  });

  await t.test("configureModels: rejects invalid triggerMode", () => {
    assert.throws(
      () => configureModels({ action: "set_mode", triggerMode: "invalid_mode", workspaceRoot: REPO_ROOT }),
      /Invalid triggerMode/
    );
  });

  await t.test("configureModels: list returns status OK and recommended models", () => {
    const res = configureModels({ action: "list", workspaceRoot: REPO_ROOT });
    assert.equal(res.status, "OK");
    assert.ok(Array.isArray(res.availableRecommendedModels));
    assert.ok(res.totalModelsCount > 0);
  });

  await t.test("configureModels: set_default rejects unknown model", () => {
    const res = configureModels({ action: "set_default", model: "unknown-model-xyz", workspaceRoot: REPO_ROOT });
    assert.equal(res.status, "MODEL_UNAVAILABLE");
    assert.ok(res.availableRecommendedModels.length > 0);
  });
});

test("Suite 2: Model Discovery & Resilience", async (t) => {
  await t.test("discoverModels retrieves live models from OpenCode", () => {
    const models = discoverModels({ forceRefresh: false });
    assert.ok(Array.isArray(models));
    assert.ok(models.length > 0);
    assert.ok(models.some((m) => m.includes("deepseek")), "DeepSeek should be in available models");
  });

  await t.test("filterRecommendedModels filters prioritized coding models", () => {
    const raw = ["custom/generic", "opencode/deepseek-v4.1-flash-free", "test/model", "opencode/glm-5.3-flash-free"];
    const filtered = filterRecommendedModels(raw);
    assert.ok(filtered.includes("opencode/deepseek-v4.1-flash-free"));
    assert.ok(filtered.includes("opencode/glm-5.3-flash-free"));
  });

  await t.test("discoverModels handles corrupted cache gracefully", () => {
    const cacheFile = path.join(os.tmpdir(), "opencode-bridge-models-cache.json");
    fs.writeFileSync(cacheFile, "CORRUPTED_JSON_NOT_VALID", "utf8");
    const models = discoverModels({ forceRefresh: false });
    assert.ok(Array.isArray(models));
    assert.ok(models.length > 0);
  });
});

test("Suite 3: Model Resolution & Validation Edge Cases", async (t) => {
  await t.test("resolves configured default model without error", () => {
    const res = resolveAndValidateModel({ workspaceRoot: REPO_ROOT });
    assert.equal(res.valid, true);
    assert.ok(res.resolvedModel.includes("deepseek"));
  });

  await t.test("resolves shorthand aliases correctly", () => {
    const aliases = ["deepseek", "ds", "glm", "mimo"];
    for (const alias of aliases) {
      const res = resolveAndValidateModel({ requestedModel: alias, workspaceRoot: REPO_ROOT });
      assert.equal(res.valid, true, `Alias ${alias} should resolve to valid model`);
      assert.ok(res.resolvedModel.startsWith("opencode/"), `Model ${res.resolvedModel} should have opencode prefix`);
    }
  });

  await t.test("fuzzy matching resolves model without provider prefix", () => {
    const res = resolveAndValidateModel({ requestedModel: "mimo-v2.6-flash-free", workspaceRoot: REPO_ROOT });
    assert.equal(res.valid, true);
    assert.equal(res.resolvedModel, "opencode/mimo-v2.6-flash-free");
  });

  await t.test("non-existent model returns MODEL_UNAVAILABLE with suggestions", () => {
    const res = resolveAndValidateModel({ requestedModel: "opencode/non-existent-model-999", workspaceRoot: REPO_ROOT });
    assert.equal(res.valid, false);
    assert.equal(res.status, "MODEL_UNAVAILABLE");
    assert.ok(Array.isArray(res.availableRecommendedModels));
    assert.ok(res.actionRequired.includes("STOP"));
  });
});

test("Suite 4: Scope Guard & Unexpected Files Protection", async (t) => {
  await t.test("delegateTask reports unexpectedFiles when modifying outside allowedPaths", async () => {
    const tempFile = path.join(REPO_ROOT, "temp-scope-test.txt");
    try {
      // Simulate delegateTask with allowedPaths that do not include the touched file
      // We can run delegateTask with a verifyCmd that creates an out-of-scope file
      const res = await delegateTask({
        brief: "Create an unexpected file",
        allowedPaths: ["src/allowed-only.ts"],
        verifyCmd: `node -e "require('fs').writeFileSync('temp-scope-test.txt', 'test')"`,
        readOnly: false,
        workspaceRoot: REPO_ROOT
      });

      assert.ok(res.touchedFiles.includes("temp-scope-test.txt"), "Touched files must include temp-scope-test.txt");
      assert.ok(res.unexpectedFiles.includes("temp-scope-test.txt"), "unexpectedFiles must flag the out-of-scope edit");
    } finally {
      if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);
      const unexpectedMd = path.join(REPO_ROOT, "UNEXPECTED.md");
      if (fs.existsSync(unexpectedMd)) fs.unlinkSync(unexpectedMd);
    }
  });
});

test("Suite 5: MCP Server JSON-RPC 2.0 Compliance & Handshakes", async (t) => {
  function queryMcp(requests) {
    return new Promise((resolve, reject) => {
      const child = spawn("node", [MCP_SERVER_PATH], {
        cwd: REPO_ROOT,
        stdio: ["pipe", "pipe", "pipe"]
      });

      let stdout = "";
      child.stdout.on("data", (d) => {
        stdout += d.toString();
      });

      for (const req of requests) {
        child.stdin.write(JSON.stringify(req) + "\n");
      }
      child.stdin.end();

      child.on("close", (code) => {
        try {
          const lines = stdout.split(/\r?\n/).filter((l) => l.trim().startsWith("{"));
          const responses = lines.map((l) => JSON.parse(l));
          resolve(responses);
        } catch (err) {
          reject(new Error(`Failed parsing MCP response: ${stdout} (${err.message})`));
        }
      });
    });
  }

  await t.test("MCP initialize returns protocol version 2024-11-05 and serverInfo", async () => {
    const responses = await queryMcp([{ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }]);
    assert.equal(responses.length, 1);
    assert.equal(responses[0].id, 1);
    assert.equal(responses[0].result.protocolVersion, "2024-11-05");
    assert.equal(responses[0].result.serverInfo.name, "opencode-delegate-mcp");
  });

  await t.test("MCP tools/list returns exactly 3 registered tools with valid schemas", async () => {
    const responses = await queryMcp([{ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }]);
    assert.equal(responses.length, 1);
    const tools = responses[0].result.tools;
    assert.equal(tools.length, 3);
    const names = tools.map((x) => x.name);
    assert.ok(names.includes("opencode_models"));
    assert.ok(names.includes("opencode_delegate"));
    assert.ok(names.includes("opencode_continue"));

    for (const tool of tools) {
      assert.equal(tool.inputSchema.type, "object");
      assert.ok(Array.isArray(tool.inputSchema.required));
    }
  });

  await t.test("MCP tools/call opencode_models executes successfully over stdio", async () => {
    const responses = await queryMcp([
      {
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: { name: "opencode_models", arguments: { action: "list" } }
      }
    ]);
    assert.equal(responses.length, 1);
    const text = responses[0].result.content[0].text;
    const data = JSON.parse(text);
    assert.equal(data.status, "OK");
    assert.ok(data.defaultModel.includes("deepseek"));
  });

  await t.test("MCP unknown method returns standard JSON-RPC -32601 error", async () => {
    const responses = await queryMcp([{ jsonrpc: "2.0", id: 4, method: "non_existent_method", params: {} }]);
    assert.equal(responses.length, 1);
    assert.equal(responses[0].id, 4);
    assert.equal(responses[0].error.code, -32601);
  });

  await t.test("MCP unknown tool call returns error response cleanly", async () => {
    const responses = await queryMcp([
      { jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "unknown_tool", arguments: {} } }
    ]);
    assert.equal(responses.length, 1);
    assert.equal(responses[0].result.isError, true);
    assert.ok(responses[0].result.content[0].text.includes("Unknown tool"));
  });
});

test("Suite 6: End-to-End Execution & Fallback Chain Verification", async (t) => {
  await t.test("read-only plan mode does not mutate git working tree", async () => {
    const beforeStatus = execSync("git status --porcelain", { cwd: REPO_ROOT, encoding: "utf8" });
    const res = await delegateTask({
      brief: "Test read-only integrity verification in one sentence",
      readOnly: true,
      workspaceRoot: REPO_ROOT
    });

    assert.ok(["COMPLETED_UNVERIFIED", "VERIFIED_PASS"].includes(res.status));
    assert.equal(res.agentMode, "plan");
    assert.equal(res.unauthorizedCommitDetected, false);
    assert.equal(res.touchedFiles.length, 0);

    const afterStatus = execSync("git status --porcelain", { cwd: REPO_ROOT, encoding: "utf8" });
    assert.equal(beforeStatus, afterStatus, "Git status must remain identical before and after read-only execution");
  });
});
