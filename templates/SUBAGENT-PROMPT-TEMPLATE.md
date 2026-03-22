# Subagent 派发 Prompt 模板

> PM 直接 spawn Dev/QA subagent 时，必须在 task prompt 末尾附带以下标准收尾步骤。
> 这是**防止 Agent 跳过 PHASE-FINAL 的最后防线**。

## Dev Subagent 标准收尾（复制到 prompt 末尾）

```
## 完成后必做（PHASE-FINAL — 不可跳过！）

### Step 1: 补全 TASK JSON 所有字段
编辑 tasks/TASK-XXX.json:
- code_context.commits[]: 至少 1 个 { hash, message, type }
- verification.runtime_logs: { api_requests: [...], browser_checks: [...] }
- verification.regression_check: { homepage: "PASS", search: "PASS", login_logout: "PASS" }
  ⚠️ 值必须精确为 "PASS"，不能写 "PASS — xxx"
- artifacts[]: 每个交付文件 { type, path, description }
- steps[]: 所有 status 改为 "DONE"

### Step 2: 更新状态
node scripts/tasks/update-task.js TASK-XXX --status REVIEW --actor dev --reason "AC X/X PASS"

### Step 3: 强制门禁（不通过则不能 commit！）
node scripts/tasks/pre-commit-gate.js TASK-XXX && git add -A && git commit -m "feat: TASK-XXX ..."
⚡ && 连接符确保门禁不通过时 commit 被阻断
⚡ 如果阻断了，按脚本输出的提示修复后重新运行

### Step 4: 通知 PM
node scripts/tasks/inbox.js send --to pm --from dev --type task_done --task-id TASK-XXX --content "完成，AC X/X PASS"
```

## QA Subagent 标准收尾

```
## 完成后必做（PHASE-FINAL — 不可跳过！）

### Step 1: 补全 TASK JSON
编辑 tasks/TASK-XXX.json:
- verification.qa_report: "测试报告摘要（X/X PASS, X FAIL）"
- verification.screenshots[]: 截图路径列表
- artifacts[]: 报告/截图文件列表
- steps[]: 所有 status 改为 "DONE"

### Step 2: 更新状态
node scripts/tasks/update-task.js TASK-XXX --status REVIEW --actor qa --reason "X/X PASS"

### Step 3: 强制门禁
node scripts/tasks/pre-commit-gate.js TASK-XXX && git add -A && git commit -m "test: TASK-XXX QA验证"

### Step 4: 通知 PM
node scripts/tasks/inbox.js send --to pm --from qa --type task_done --task-id TASK-XXX --content "QA完成"
```
