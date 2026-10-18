# OpenCode Delegation Bridge & MCP Server

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D18.0.0-brightgreen.svg)](https://nodejs.org)
[![MCP Protocol](https://img.shields.io/badge/MCP-2024--11--05-orange.svg)](https://modelcontextprotocol.io)
[![Zero Dependencies](https://img.shields.io/badge/Dependencies-Zero-success.svg)](package.json)

Zero-dependency delegation engine, stdio MCP server, and native `/oc` slash workflow connecting **Google Antigravity** and **OpenAI Codex** to **OpenCode** specialized models (DeepSeek V4.1 Flash, GLM 5.3 Flash, MiMo 2.6, and more).

---

## 🏗️ Architecture & Integration Map

Google Antigravity leverages a three-tier customization system (Rules, Workflows, and Skills) alongside Model Context Protocol (MCP) servers. OpenAI Codex shares the `.agents/skills/` standard and supports stdio MCP servers.

| Component Layer | Workspace Path | Role in Architecture |
|---|---|---|
| **1. Slash Workflow (`/oc`)** | `.agents/workflows/oc.md` | Interactive slash commands (`/oc <task>`, `/oc glm <task>`, `/oc set default <model>`, `/oc models`) preventing accidental quota drain. |
| **2. Escalation Rule** | `.agents/rules/opencode-escalation.md` | Lightweight always-on rule enforcing the 15-line threshold and prompting escalation only upon local verification failure. |
| **3. Progressive Skill** | `.agents/skills/opencode-delegate/SKILL.md` | On-demand skill teaching agents structured brief generation, status recovery, and `git diff` review. |
| **4. Core Relay Engine** | `.agents/skills/opencode-delegate/scripts/bridge.mjs` | Zero-dependency Node.js CLI & library: live discovery, pre/post git snapshot isolation, scope enforcement, and auto-heal loop. |
| **5. Thin MCP Server** | `.agents/skills/opencode-delegate/scripts/mcp-server.mjs` | Zero-dependency stdio JSON-RPC 2.0 MCP server exposing `opencode_models`, `opencode_delegate`, and `opencode_continue`. |
| **6. Persistent State** | `.agents/opencode-models.json` | Stores active default models, named lanes (`fast`, `refactor`, `heavy`, `explore`), and execution policies. |
| **7. MCP Registration** | `.agents/mcp_config.json` | Connects the stdio server to Antigravity and Codex. |

```
                       ┌────────────────────────┐
                       │   Google Antigravity   │
                       │    / OpenAI Codex      │
                       └───────────┬────────────┘
                                   │
              ┌────────────────────┼────────────────────┐
              │ Stdio MCP          │ Slash / Rules      │
              ▼                    ▼                    ▼
     [mcp-server.mjs]       [.agents/rules/]     [.agents/workflows/oc.md]
              │
              ▼
       [bridge.mjs] ◄─── Persistent Config ([opencode-models.json])
         ├── Model Discovery & Availability Guard (15-min cache)
         ├── Quota / 429 Rate-Limit Guard
         ├── Pre- & Post-Execution Git & SHA-256 Snapshot
         ├── Allowed Paths Scope Guard
         └── Deterministic verify_cmd & Auto-Heal Loop
              │
              ▼
       [OpenCode CLI] (`opencode run --format json --auto`)
```

---

## 📁 Repository Structure

```
.
├── .agents/
│   ├── mcp_config.json                               # MCP registration config
│   ├── opencode-models.json                          # Model routing, lanes & aliases
│   ├── rules/
│   │   └── opencode-escalation.md                    # Escalation policy
│   ├── workflows/
│   │   └── oc.md                                     # /oc slash workflow
│   └── skills/
│       └── opencode-delegate/
│           ├── SKILL.md                              # Agent progressive skill
│           ├── references/
│           │   └── brief-template.md                 # Task brief template
│           └── scripts/
│               ├── bridge.mjs                        # Core engine & CLI
│               └── mcp-server.mjs                    # Stdio MCP server
├── .github/
│   └── workflows/
│       └── ci.yml                                    # Continuous integration checks
├── .gitignore
├── LICENSE
├── package.json
└── README.md
```

---

## ⚡ Core Engine Capabilities

1. **Model Auto-Discovery & Health Guard:**
   Discovers live models via `opencode models`, caches the results with configurable TTL (default: 15 minutes), and validates model availability prior to execution. If a model was deprecated, it halts with `MODEL_UNAVAILABLE` and presents live alternatives.
2. **Quota & Rate-Limit Guard (429):**
   Detects API quota exhaustion and returns `QUOTA_EXCEEDED` alongside alternative models so the parent agent can prompt the user to pivot rather than failing silently.
3. **Pre- & Post-Execution Git & SHA-256 Snapshot:**
   Computes SHA-256 hashes of untracked and modified files before invocation. Guarantees that pre-existing uncommitted changes are never attributed to OpenCode and verifies that OpenCode never makes unauthorized git commits.
4. **Scope Guard:**
   Restricts OpenCode edits to specified `allowedPaths`. Out-of-scope file modifications are flagged in `unexpectedFiles`.
5. **Deterministic `verify_cmd` & Auto-Heal Loop:**
   Executes user-defined test, typecheck, or lint commands after OpenCode completes. If verification fails, it resumes the OpenCode session automatically up to `maxHealRetries` times with compiler/test error output.

---

## 🚀 Quickstart & Setup

### Prerequisites
- Node.js `>= 18.0.0`
- OpenCode CLI (`>= 1.18.0`, tested on `1.19.3`):
  ```bash
  npm install -g opencode-ai@latest
  opencode --version
  ```

### 1. Register MCP Server

#### Google Antigravity
The workspace config is ready in `.agents/mcp_config.json`. To register globally, append to `~/.gemini/config/mcp_config.json`:
```json
{
  "mcpServers": {
    "opencode-delegate": {
      "command": "node",
      "args": [
        "/path/to/project/.agents/skills/opencode-delegate/scripts/mcp-server.mjs"
      ]
    }
  }
}
```

#### OpenAI Codex
Add to `~/.codex/config.toml`:
```toml
[mcp_servers.opencode_delegate]
command = "node"
args = ["/path/to/project/.agents/skills/opencode-delegate/scripts/mcp-server.mjs"]
```

---

## 🛠️ Usage

### 1. Slash Command (`/oc`)
Inside Google Antigravity chat:
```markdown
# List and discover live models
/oc models

# Set default model or lane
/oc set default opencode/deepseek-v4.1-flash-free
/oc set refactor opencode/glm-5.3-flash-free

# Delegate coding task with shorthand alias
/oc glm Refactor auth middleware to use JWT verification

# Delegate task to specific lane
/oc fast Generate unit tests for utils/date.ts
```

### 2. Standalone CLI (`bridge.mjs`)
When MCP is not connected, the bridge CLI can be called directly:

```bash
# Model Discovery & Configuration
node .agents/skills/opencode-delegate/scripts/bridge.mjs models list
node .agents/skills/opencode-delegate/scripts/bridge.mjs models refresh
node .agents/skills/opencode-delegate/scripts/bridge.mjs models set_default opencode/deepseek-v4.1-flash-free

# Delegate Task
node .agents/skills/opencode-delegate/scripts/bridge.mjs delegate '{
  "brief": "Implement email validation in src/validators.ts",
  "lane": "default",
  "contextFiles": ["src/validators.ts"],
  "allowedPaths": ["src/validators.ts", "test/validators.test.ts"],
  "verifyCmd": "npm test"
}'
```

### 3. Stdio MCP Tools
The MCP server exposes three JSON-RPC 2.0 tools:
- `opencode_models`: List, refresh, and configure active model lanes and trigger modes.
- `opencode_delegate`: Delegate tasks with context files, scope restrictions, and auto-heal verification.
- `opencode_continue`: Resume an existing session with delta instructions and review feedback.

---

## 🧪 Verification & Testing

Run the included test scripts:

```bash
# Syntax and validation check
npm test

# Test live model auto-discovery
npm run test:models

# Test unavailable model guard
npm run test:guard

# Test MCP server stdio handshake
npm run test:mcp
```

---

## 📄 License

This project is licensed under the [MIT License](LICENSE).
