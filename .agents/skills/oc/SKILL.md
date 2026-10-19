---
name: oc
description: Delegate coding, refactoring, UI/UX design, testing, or bug fixes directly to OpenCode models (DeepSeek V4.1 Flash, GLM 5.3 Flash, MiMo 2.6) with automatic fallback and self-healing verification. Triggers when the user runs /oc or mentions OpenCode.
---

# /oc — OpenCode Delegation

Use this skill whenever the user types `/oc`, `/oc <task>`, `/oc <model> <task>`, or asks to delegate work to OpenCode.

## Usage Syntax:
- `/oc <task>` — Delegate task to default model (`opencode/deepseek-v4.1-flash-free`).
- `/oc glm <task>` — Delegate task to GLM 5.3 Flash.
- `/oc mimo <task>` — Delegate task to MiMo 2.6 Flash.
- `/oc ds <task>` — Delegate task explicitly to DeepSeek.
- `/oc models` — List active models, current default, and fallback chain.

## Delegation Protocol:
1. **Model Selection:**
   If the first word of the task matches a known alias (`glm`, `mimo`, `ds`, `deepseek`), extract it as `modelOverride`.
2. **Execute Delegation:**
   Call the MCP tool `opencode_delegate` (or execute `opencode-bridge delegate "<task>"`).
   - If the task targets specific files, pass them in `contextFiles` and `allowedPaths`.
   - For pure vibe-coding requests (e.g. "make this page look modern", "build a dashboard"), pass the prompt directly without restricting paths so OpenCode can create and organize the necessary files.
   - If a test or build command exists (`npm test`, `pytest`, `cargo test`), pass it in `verifyCmd`.
3. **Handle Results:**
   - Present the touched files and a concise summary of changes.
   - If verification failed, report compiler/test errors so the user can guide the next step.
