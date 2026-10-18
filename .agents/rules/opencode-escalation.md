# OpenCode Quota Guard & Escalation Policy

1. **Default Mode is `slash_only`:** Do NOT automatically invoke `opencode_delegate` on routine tasks unless the user invokes `/oc`, explicitly asks to use OpenCode (or a model like `glm`, `deepseek`, `mimo`), or changes `triggerMode` in `.agents/opencode-models.json`.
2. **Minimum Complexity Threshold:** Never delegate single-file edits under 15 lines of code; perform those directly.
3. **Smart Escalation on Failure or High Complexity:** If you attempt a coding/refactoring task locally and fail compiler/test verification once, OR if the task requires complex multi-file algorithmic changes where DeepSeek V4.1 Flash, GLM 5.3 Flash, or MiMo 2.6 excels, pause and ask the user:
   *"Would you like me to delegate this to OpenCode (`<default_model>`)?"*
