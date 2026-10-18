#!/usr/bin/env node
import readline from "node:readline";
import { configureModels, delegateTask } from "./bridge.mjs";

const TOOLS = [
  {
    name: "opencode_models",
    description:
      "List available OpenCode models (DeepSeek, GLM, MiMo, etc.), set the default or lane model, or change triggerMode (slash_only, smart_suggest, auto_flash).",
    inputSchema: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["list", "refresh", "set_default", "set_lane", "set_mode"],
          description: "Action to perform on the OpenCode model registry."
        },
        model: {
          type: "string",
          description: "Model ID or alias (e.g. 'deepseek-v4.1-flash', 'glm-5.3-flash', 'mimo') when setting a model."
        },
        lane: {
          type: "string",
          enum: ["default", "fast", "refactor", "heavy", "explore"],
          description: "Target lane when action is set_lane."
        },
        triggerMode: {
          type: "string",
          enum: ["slash_only", "smart_suggest", "auto_flash"],
          description: "Delegation trigger mode when action is set_mode."
        }
      },
      required: ["action"]
    }
  },
  {
    name: "opencode_delegate",
    description:
      "Delegate a coding, refactoring, testing, or read-only exploration task to OpenCode with pre/post git snapshots, model availability checking, and automatic verify_cmd self-healing.",
    inputSchema: {
      type: "object",
      properties: {
        brief: {
          type: "string",
          description: "Structured task specification including goal, constraints, and target files."
        },
        lane: {
          type: "string",
          enum: ["default", "fast", "refactor", "heavy", "explore"],
          description: "Model lane to use (default, fast, refactor, heavy, explore)."
        },
        modelOverride: {
          type: "string",
          description: "Optional explicit model or alias ('glm', 'mimo', 'deepseek') overriding the lane."
        },
        contextFiles: {
          type: "array",
          items: { type: "string" },
          description: "List of relative file paths for OpenCode to inspect immediately."
        },
        allowedPaths: {
          type: "array",
          items: { type: "string" },
          description: "Optional list of file or directory paths OpenCode is permitted to modify."
        },
        verifyCmd: {
          type: "string",
          description: "Optional deterministic test/typecheck/lint command (e.g. 'npm test') to verify and auto-heal."
        },
        readOnly: {
          type: "boolean",
          description: "If true, runs OpenCode in read-only 'plan' mode so no files can be modified."
        }
      },
      required: ["brief"]
    }
  },
  {
    name: "opencode_continue",
    description:
      "Resume an existing OpenCode session by sessionId with delta review feedback after inspecting git diff.",
    inputSchema: {
      type: "object",
      properties: {
        sessionId: {
          type: "string",
          description: "The sessionId returned by a previous opencode_delegate call."
        },
        deltaBrief: {
          type: "string",
          description: "Targeted follow-up instructions or review corrections."
        },
        verifyCmd: {
          type: "string",
          description: "Optional verification command to run after applying fixes."
        },
        modelOverride: {
          type: "string",
          description: "Optional model override."
        }
      },
      required: ["sessionId", "deltaBrief"]
    }
  }
];

function sendResponse(id, result) {
  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, result }) + "\n");
}

function sendError(id, code, message) {
  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } }) + "\n");
}

const rl = readline.createInterface({ input: process.stdin, terminal: false });

rl.on("line", async (line) => {
  if (!line.trim()) return;
  let req;
  try {
    req = JSON.parse(line);
  } catch {
    return;
  }

  const { id, method, params } = req;

  try {
    if (method === "initialize") {
      sendResponse(id, {
        protocolVersion: "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "opencode-delegate-mcp", version: "1.0.0" }
      });
    } else if (method === "notifications/initialized") {
      // No response needed for notifications
    } else if (method === "tools/list") {
      sendResponse(id, { tools: TOOLS });
    } else if (method === "tools/call") {
      const toolName = params?.name;
      const args = params?.arguments || {};

      let output;
      if (toolName === "opencode_models") {
        output = configureModels(args);
      } else if (toolName === "opencode_delegate") {
        output = await delegateTask(args);
      } else if (toolName === "opencode_continue") {
        output = await delegateTask({
          brief: args.deltaBrief,
          sessionId: args.sessionId,
          verifyCmd: args.verifyCmd,
          modelOverride: args.modelOverride
        });
      } else {
        throw new Error(`Unknown tool: ${toolName}`);
      }

      sendResponse(id, {
        content: [{ type: "text", text: JSON.stringify(output, null, 2) }]
      });
    } else if (id !== undefined) {
      sendError(id, -32601, `Method not found: ${method}`);
    }
  } catch (err) {
    if (id !== undefined) {
      sendResponse(id, {
        isError: true,
        content: [{ type: "text", text: JSON.stringify({ status: "ERROR", message: err.message }) }]
      });
    }
  }
});
