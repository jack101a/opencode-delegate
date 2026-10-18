---
description: Delegate coding, testing, or model configuration to OpenCode (/oc)
---

# `/oc` — OpenCode Delegation & Model Router Workflow

Parse the user's arguments following `/oc` and execute the matching action below:

1. **Model Discovery & Configuration Commands:**
   - If the user runs `/oc models` or `/oc refresh`:
     Call MCP tool `opencode_models` with `action: "refresh"` (or `node .agents/skills/opencode-delegate/scripts/bridge.mjs models refresh`) and display the active default model and fallbacks alongside available Free models.
   - If the user runs `/oc set default <model>`:
     Call `opencode_models` with `action: "set_default"` and confirm the updated configuration.
   - If the user runs `/oc mode <slash_only|smart_suggest|auto_flash>`:
     Call `opencode_models` with `action: "set_mode"` and confirm.

2. **Model Shorthand Prefix Detection:**
   - If the first word after `/oc` is `glm`, `mimo`, `deepseek`, or `ds`, pass that token as `modelOverride` to `opencode_delegate` and treat the rest of the message as the coding task.
   - Otherwise, delegate using the default model (`opencode/deepseek-v4.1-flash-free`) with automatic fallback to GLM and MiMo if quota is reached.

3. **Execute & Audit Loop:**
   - Construct a concise, high-signal `brief` containing the objective, relevant `contextFiles`, `allowedPaths`, and a deterministic `verifyCmd` (such as the project's test or typecheck command).
   - Call `opencode_delegate`.
   - **If `status` is `MODEL_UNAVAILABLE` or `QUOTA_EXCEEDED`:** Stop immediately, show the user the returned `availableRecommendedModels`, and ask which model they want to set as the new default.
   - **If `status` is `VERIFIED_PASS` or `COMPLETED_UNVERIFIED`:** Run `git diff` on the returned `touchedFiles` to audit the changes, report any `unexpectedFiles`, and summarize the result for the user. If minor fixes are needed, call `opencode_continue` with the returned `sessionId`.
