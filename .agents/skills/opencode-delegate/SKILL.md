---
name: opencode-delegate
description: Delegate multi-file coding, refactoring, unit test generation, or codebase exploration to OpenCode models (DeepSeek V4.1 Flash, GLM 5.3 Flash, MiMo 2.6) and configure OpenCode model lanes via chat.
---

# OpenCode Delegation Skill

Use this skill when the user invokes `/oc`, asks to delegate work to OpenCode, asks to switch/list OpenCode models, or accepts a Smart Escalation prompt.

## 1. Conversational Model Management
When the user asks what models are available or asks to change the default model:
- Call `opencode_models` (`action: "list"` or `"set_default"` or `"set_lane"`).
- Fallback CLI if MCP is not loaded:
  `node .agents/skills/opencode-delegate/scripts/bridge.mjs models <list|refresh|set_default> [model]`

## 2. How to Delegate Tasks (`opencode_delegate`)
1. **Do Not Pre-Read Everything:** Let OpenCode read the heavy files. Pass target file paths in `contextFiles`.
2. **Always Provide a `verifyCmd` When Possible:** Pass a targeted test or typecheck command (e.g., `npm test -- path/to/test`, `npx tsc --noEmit`, `pytest -q`) so `bridge.mjs` can run its automatic self-heal loop before returning control to you.
3. **Specify `allowedPaths`:** Pass the directories or files OpenCode is allowed to edit so out-of-scope edits are flagged in `unexpectedFiles`.
4. **Fallback CLI Command (if MCP is offline):**
   `node .agents/skills/opencode-delegate/scripts/bridge.mjs delegate '{"brief":"...","lane":"default","contextFiles":["..."],"verifyCmd":"..."}'`

## 3. Handling `MODEL_UNAVAILABLE` and `QUOTA_EXCEEDED`
- Never guess or silently switch models if `opencode_delegate` returns `MODEL_UNAVAILABLE` or `QUOTA_EXCEEDED`.
- Present the `availableRecommendedModels` list to the user and ask which model they want to set as the new default. Once they reply, call `opencode_models` with `action: "set_default"` and re-run `opencode_delegate`.

## 4. Reviewing the Deliverable (`git diff`)
- OpenCode is forbidden from committing. The working tree diff is the deliverable.
- Inspect `git diff -- <touchedFiles>` after `opencode_delegate` returns.
- If `unexpectedFiles` is non-empty, alert the user or revert unauthorized changes.
- If the implementation needs adjustments, call `opencode_continue` with `sessionId` and a concise `deltaBrief` rather than rewriting from scratch.
