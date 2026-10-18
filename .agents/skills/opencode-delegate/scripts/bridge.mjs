#!/usr/bin/env node
import { spawn, execSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DEFAULT_CONFIG_PATH = path.resolve(__dirname, "../../../opencode-models.json");
const CACHE_FILE = path.join(os.tmpdir(), "opencode-bridge-models-cache.json");

export function loadConfig(workspaceRoot = process.cwd()) {
  const wsConfig = path.join(workspaceRoot, ".agents", "opencode-models.json");
  const target = fs.existsSync(wsConfig) ? wsConfig : DEFAULT_CONFIG_PATH;
  if (!fs.existsSync(target)) {
    throw new Error(`Missing config file at ${target}`);
  }
  return { config: JSON.parse(fs.readFileSync(target, "utf8")), configPath: target };
}

export function saveConfig(config, configPath) {
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n", "utf8");
}

/**
 * Discovers live models from `opencode models` with optional cache.
 */
export function discoverModels({ forceRefresh = false, ttlSeconds = 900 } = {}) {
  if (!forceRefresh && fs.existsSync(CACHE_FILE)) {
    try {
      const cached = JSON.parse(fs.readFileSync(CACHE_FILE, "utf8"));
      if (Date.now() - cached.timestamp < ttlSeconds * 1000 && Array.isArray(cached.models)) {
        return cached.models;
      }
    } catch {
      // ignore corrupted cache
    }
  }

  const cmd = forceRefresh ? "opencode models --refresh" : "opencode models";
  let raw = "";
  try {
    raw = execSync(cmd, { encoding: "utf8", timeout: 20000, stdio: ["ignore", "pipe", "pipe"] });
  } catch (err) {
    // Fallback without --refresh if older CLI version
    raw = execSync("opencode models", { encoding: "utf8", timeout: 15000, stdio: ["ignore", "pipe", "pipe"] });
  }

  const models = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("Available") && !line.startsWith("---"))
    .map((line) => line.split(/\s+/)[0])
    .filter((token) => token.includes("/"));

  try {
    fs.writeFileSync(CACHE_FILE, JSON.stringify({ timestamp: Date.now(), models }, null, 2), "utf8");
  } catch {
    // ignore cache write issues
  }
  return models;
}

/**
 * Highlights high-value coding models (DeepSeek, GLM, MiMo, Qwen, Free/Go).
 */
export function filterRecommendedModels(models) {
  const priorityRegex = /(deepseek|glm|mimo|qwen|minimax|kimi|flash|free|opencode\/)/i;
  const preferred = models.filter((m) => priorityRegex.test(m));
  return preferred.length > 0 ? preferred : models.slice(0, 25);
}

/**
 * Resolves a model alias, lane, or explicit ID and verifies availability.
 */
export function resolveAndValidateModel({ requestedModel, workspaceRoot = process.cwd() }) {
  const { config, configPath } = loadConfig(workspaceRoot);
  const ttl = config.execution?.modelCacheTtlSeconds ?? 900;
  let liveModels = discoverModels({ forceRefresh: false, ttlSeconds: ttl });

  let candidate = requestedModel
    ? config.aliases?.[requestedModel] || requestedModel
    : config.defaultModel || config.lanes?.default;

  if (!liveModels.includes(candidate)) {
    // Refresh once in case the model was just added
    liveModels = discoverModels({ forceRefresh: true, ttlSeconds: ttl });
  }

  if (!liveModels.includes(candidate)) {
    // Fuzzy match check (e.g. user said "deepseek-v4.1-flash" without provider prefix)
    const suffixMatch = liveModels.find(
      (m) => m.toLowerCase().endsWith(`/${candidate.toLowerCase()}`) || m.toLowerCase().includes(candidate.toLowerCase())
    );
    if (suffixMatch && requestedModel) {
      candidate = suffixMatch;
    } else {
      return {
        valid: false,
        status: "MODEL_UNAVAILABLE",
        requestedModel: candidate,
        availableRecommendedModels: filterRecommendedModels(liveModels),
        configPath,
        actionRequired:
          "STOP. Inform the user that the configured OpenCode model is currently unavailable, show availableRecommendedModels, and ask which one to set as the new default."
      };
    }
  }

  return { valid: true, resolvedModel: candidate, config, configPath };
}

/**
 * Updates default model, fallback mappings, or trigger mode from chat.
 */
export function configureModels({ action, model, triggerMode, workspaceRoot = process.cwd() }) {
  const { config, configPath } = loadConfig(workspaceRoot);
  const liveModels = discoverModels({ forceRefresh: action === "refresh" });

  if (action === "list" || action === "refresh") {
    return {
      status: "OK",
      triggerMode: config.triggerMode,
      defaultModel: config.defaultModel || config.lanes?.default,
      fallbacks: config.fallbacks,
      aliases: config.aliases,
      availableRecommendedModels: filterRecommendedModels(liveModels),
      totalModelsCount: liveModels.length
    };
  }

  if (action === "set_mode") {
    const allowedModes = ["slash_only", "smart_suggest", "auto_flash"];
    if (!allowedModes.includes(triggerMode)) {
      throw new Error(`Invalid triggerMode '${triggerMode}'. Allowed: ${allowedModes.join(", ")}`);
    }
    config.triggerMode = triggerMode;
    saveConfig(config, configPath);
    return { status: "CONFIG_UPDATED", triggerMode: config.triggerMode, configPath };
  }

  if (action === "set_default") {
    if (!model) throw new Error("Parameter 'model' is required for set_default.");
    const aliasResolved = config.aliases?.[model] || model;
    const exactOrFuzzy =
      liveModels.find((m) => m === aliasResolved) ||
      liveModels.find((m) => m.toLowerCase().endsWith(`/${aliasResolved.toLowerCase()}`)) ||
      liveModels.find((m) => m.toLowerCase().includes(aliasResolved.toLowerCase()));

    if (!exactOrFuzzy) {
      return {
        status: "MODEL_UNAVAILABLE",
        requestedModel: model,
        availableRecommendedModels: filterRecommendedModels(liveModels),
        actionRequired: "The requested model was not found in `opencode models`. Ask the user to pick from availableRecommendedModels."
      };
    }

    config.defaultModel = exactOrFuzzy;
    if (config.lanes) config.lanes.default = exactOrFuzzy;
    saveConfig(config, configPath);
    return {
      status: "CONFIG_UPDATED",
      newModel: exactOrFuzzy,
      defaultModel: config.defaultModel,
      fallbacks: config.fallbacks,
      configPath
    };
  }

  throw new Error(`Unknown action: ${action}`);
}

/**
 * Captures git working tree state and SHA-256 hashes of modified/untracked files
 * so pre-existing dirty files are never confused with OpenCode changes.
 */
function captureGitSnapshot(cwd) {
  let head = null;
  const fileHashes = new Map();
  try {
    head = execSync("git rev-parse HEAD", { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    const statusOut = execSync("git status --porcelain", { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    for (const line of statusOut.split(/\r?\n/)) {
      if (!line.trim()) continue;
      const relPath = line.slice(3).trim().replace(/^"(.*)"$/, "$1");
      const absPath = path.join(cwd, relPath);
      if (fs.existsSync(absPath) && fs.statSync(absPath).isFile()) {
        const buf = fs.readFileSync(absPath);
        fileHashes.set(relPath, crypto.createHash("sha256").update(buf).digest("hex"));
      } else {
        fileHashes.set(relPath, "__DELETED__");
      }
    }
  } catch {
    // Non-git directory fallback
  }
  return { head, fileHashes };
}

function diffSnapshots(cwd, beforeSnap) {
  const afterSnap = captureGitSnapshot(cwd);
  const touchedFiles = [];
  for (const [relPath, afterHash] of afterSnap.fileHashes.entries()) {
    const beforeHash = beforeSnap.fileHashes.get(relPath);
    if (beforeHash !== afterHash) {
      touchedFiles.push(relPath);
    }
  }
  for (const [relPath] of beforeSnap.fileHashes.entries()) {
    if (!afterSnap.fileHashes.has(relPath)) {
      touchedFiles.push(relPath);
    }
  }
  const headChanged = beforeSnap.head && afterSnap.head && beforeSnap.head !== afterSnap.head;
  return { touchedFiles: [...new Set(touchedFiles)], headChanged };
}

/**
 * Spawns `opencode run --format json --auto` and parses JSONL stream events.
 */
function runOpenCodeProcess({ args, cwd, timeoutMs }) {
  return new Promise((resolve) => {
    const child = spawn("opencode", args, {
      cwd,
      env: { ...process.env, CI: "true" },
      stdio: ["ignore", "pipe", "pipe"]
    });

    let stdout = "";
    let stderr = "";
    let sessionId = null;
    const textChunks = [];
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      const str = chunk.toString();
      stdout += str;
      for (const line of str.split(/\r?\n/)) {
        if (!line.trim().startsWith("{")) continue;
        try {
          const evt = JSON.parse(line.trim());
          if (evt.sessionID || evt.sessionId || evt.session_id) {
            sessionId = evt.sessionID || evt.sessionId || evt.session_id;
          }
          if (evt.type === "text" && evt.part?.text) {
            textChunks.push(evt.part.text);
          } else if (typeof evt.content === "string") {
            textChunks.push(evt.content);
          }
        } catch {
          // ignore partial JSON line
        }
      }
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("close", (exitCode) => {
      clearTimeout(timer);
      const combined = `${stdout}\n${stderr}`;
      const isQuotaError = /(429|rate.?limit|quota.?exceeded|insufficient_quota|too many requests)/i.test(combined);
      const isModelError = /(model.*not found|invalid model|unknown model|provider.*not found)/i.test(combined);

      resolve({
        exitCode: exitCode ?? 1,
        timedOut,
        sessionId,
        isQuotaError,
        isModelError,
        summaryText: textChunks.join("\n").trim() || stdout.slice(-2000).trim(),
        stderr: stderr.slice(-2000).trim()
      });
    });
  });
}

function runVerifyCommand(verifyCmd, cwd) {
  try {
    const output = execSync(verifyCmd, {
      cwd,
      encoding: "utf8",
      timeout: 120000,
      stdio: ["ignore", "pipe", "pipe"]
    });
    return { passed: true, exitCode: 0, output: output.slice(-2000).trim() };
  } catch (err) {
    const combined = `${err.stdout || ""}\n${err.stderr || ""}`.trim();
    return {
      passed: false,
      exitCode: err.status ?? 1,
      output: combined.slice(-3000) || err.message
    };
  }
}

/**
 * Main delegation pipeline: Model Guard -> Snapshot -> OpenCode Run -> Scope Check -> Verify & Auto-Heal.
 */
export async function delegateTask({
  brief,
  modelOverride = null,
  contextFiles = [],
  allowedPaths = [],
  verifyCmd = null,
  readOnly = false,
  sessionId = null,
  workspaceRoot = process.cwd()
}) {
  const { config, configPath } = loadConfig(workspaceRoot);

  const initialCheck = resolveAndValidateModel({
    requestedModel: modelOverride,
    workspaceRoot
  });

  if (!initialCheck.valid && modelOverride) {
    return initialCheck;
  }

  const candidateModels = [];
  if (modelOverride) {
    candidateModels.push(initialCheck.resolvedModel);
  } else {
    if (initialCheck.valid) {
      candidateModels.push(initialCheck.resolvedModel);
    }
    if (Array.isArray(config.fallbacks)) {
      for (const fb of config.fallbacks) {
        const fbCheck = resolveAndValidateModel({ requestedModel: fb, workspaceRoot });
        if (fbCheck.valid && !candidateModels.includes(fbCheck.resolvedModel)) {
          candidateModels.push(fbCheck.resolvedModel);
        }
      }
    }
  }

  if (candidateModels.length === 0) {
    return initialCheck;
  }

  const maxHealRetries = config.execution?.maxHealRetries ?? 2;
  const timeoutMs = config.execution?.timeoutMs ?? 240000;
  const agentMode = readOnly ? "plan" : "build";

  const beforeSnap = captureGitSnapshot(workspaceRoot);

  const guardrails = [
    "CRITICAL EXECUTION CONSTRAINTS:",
    "1. Do NOT run `git commit`, `git push`, `git reset`, or alter git history.",
    "2. Stay strictly within the files required by the task brief.",
    "3. Provide a concise final summary of root causes and files changed."
  ].join("\n");

  const fullPrompt = `${brief}\n\n${guardrails}`;

  let runRes = null;
  let resolvedModel = candidateModels[0];
  const fallbackAttempts = [];

  for (let i = 0; i < candidateModels.length; i++) {
    resolvedModel = candidateModels[i];
    const args = ["run", "--format", "json", "--auto", "--model", resolvedModel, "--agent", agentMode];

    if (sessionId) {
      args.push("--session", sessionId);
    }
    for (const file of contextFiles) {
      if (fs.existsSync(path.resolve(workspaceRoot, file))) {
        args.push("-f", file);
      }
    }
    args.push(fullPrompt);

    runRes = await runOpenCodeProcess({ args, cwd: workspaceRoot, timeoutMs });

    if (runRes.isQuotaError || runRes.isModelError) {
      fallbackAttempts.push({
        model: resolvedModel,
        reason: runRes.isQuotaError ? "QUOTA_EXCEEDED" : "MODEL_ERROR"
      });
      if (i + 1 < candidateModels.length) {
        continue;
      }
    }
    break;
  }

  if (runRes.isQuotaError) {
    const liveModels = discoverModels({ forceRefresh: false });
    return {
      status: "QUOTA_EXCEEDED",
      exhaustedModel: resolvedModel,
      fallbackAttempts: fallbackAttempts.length > 0 ? fallbackAttempts : undefined,
      availableRecommendedModels: filterRecommendedModels(liveModels).filter((m) => !candidateModels.includes(m)),
      actionRequired:
        "STOP. The active OpenCode model and all configured fallbacks hit rate/quota limits. Ask whether to switch to one of availableRecommendedModels or finish the task locally."
    };
  }

  if (runRes.isModelError) {
    const liveModels = discoverModels({ forceRefresh: true });
    return {
      status: "MODEL_UNAVAILABLE",
      requestedModel: resolvedModel,
      fallbackAttempts: fallbackAttempts.length > 0 ? fallbackAttempts : undefined,
      availableRecommendedModels: filterRecommendedModels(liveModels),
      actionRequired:
        "STOP. The model failed validation during execution. Ask the user which available model to set as default."
    };
  }

  // Deterministic Verification & Self-Heal Loop
  let healAttemptsUsed = 0;
  let verifyResult = null;

  if (verifyCmd && !readOnly && runRes.exitCode === 0) {
    verifyResult = runVerifyCommand(verifyCmd, workspaceRoot);

    while (!verifyResult.passed && healAttemptsUsed < maxHealRetries && runRes.sessionId) {
      healAttemptsUsed += 1;
      const healPrompt = [
        `Verification command \`${verifyCmd}\` failed with exit code ${verifyResult.exitCode}.`,
        `Fix the implementation errors below without running git commit:`,
        "```",
        verifyResult.output,
        "```"
      ].join("\n");

      const healArgs = [
        "run",
        "--format",
        "json",
        "--auto",
        "--model",
        resolvedModel,
        "--agent",
        "build",
        "--session",
        runRes.sessionId,
        healPrompt
      ];

      runRes = await runOpenCodeProcess({ args: healArgs, cwd: workspaceRoot, timeoutMs });
      verifyResult = runVerifyCommand(verifyCmd, workspaceRoot);
    }
  }

  const { touchedFiles, headChanged } = diffSnapshots(workspaceRoot, beforeSnap);

  // Check allowedPaths scope (protects against GLM 5.3 wandering edits)
  const unexpectedFiles = [];
  if (Array.isArray(allowedPaths) && allowedPaths.length > 0) {
    for (const touched of touchedFiles) {
      const isAllowed = allowedPaths.some(
        (allowed) => touched === allowed || touched.startsWith(allowed.endsWith("/") ? allowed : `${allowed}/`)
      );
      if (!isAllowed) {
        unexpectedFiles.push(touched);
      }
    }
  }

  let diffStat = "";
  if (touchedFiles.length > 0) {
    try {
      diffStat = execSync(`git diff --stat -- ${touchedFiles.map((f) => `"${f}"`).join(" ")}`, {
        cwd: workspaceRoot,
        encoding: "utf8"
      }).trim();
    } catch {
      // ignore if untracked files
    }
  }

  const finalStatus =
    runRes.timedOut
      ? "TIMED_OUT"
      : verifyResult && !verifyResult.passed
      ? "VERIFIED_FAIL_AFTER_RETRIES"
      : verifyResult && verifyResult.passed
      ? "VERIFIED_PASS"
      : runRes.exitCode === 0
      ? "COMPLETED_UNVERIFIED"
      : "EXECUTION_ERROR";

  return {
    schema: "opencode-bridge.result.v1",
    status: finalStatus,
    modelUsed: resolvedModel,
    fallbackAttempts: fallbackAttempts.length > 0 ? fallbackAttempts : undefined,
    agentMode,
    sessionId: runRes.sessionId,
    healAttemptsUsed,
    touchedFiles,
    unexpectedFiles,
    unauthorizedCommitDetected: headChanged,
    diffStat,
    verifyResult,
    workerSummary: runRes.summaryText,
    stderr: runRes.exitCode !== 0 ? runRes.stderr : undefined
  };
}

// CLI Entrypoint so Skills/Workflows can also invoke bridge.mjs directly
if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  const [subcmd, ...rest] = process.argv.slice(2);
  (async () => {
    try {
      if (subcmd === "models") {
        const action = rest[0] || "list";
        const arg1 = rest[1];
        const out = configureModels({
          action,
          model: arg1,
          triggerMode: action === "set_mode" ? arg1 : undefined
        });
        console.log(JSON.stringify(out, null, 2));
      } else if (subcmd === "delegate") {
        const payload = JSON.parse(rest[0] || "{}");
        const out = await delegateTask(payload);
        console.log(JSON.stringify(out, null, 2));
      } else {
        console.error("Usage: bridge.mjs <models|delegate> [args]");
        process.exit(1);
      }
    } catch (err) {
      console.error(JSON.stringify({ status: "BRIDGE_ERROR", message: err.message }));
      process.exit(1);
    }
  })();
}
