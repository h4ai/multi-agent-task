# Phase Final: 任务收尾（强制，不可跳过）

> 每个 subagent 任务完成时必须执行以下步骤，跳过任何一步 = 任务未完成。

## 1. 更新 TASK JSON（防止 Monitor 告警）

```bash
# 使用 update-task.js 更新状态
node scripts/tasks/update-task.js TASK-XXX --status REVIEW \
  --actor {role} \
  --reason "任务完成，AC X/X PASS"
```

## 2. 补全 TASK JSON 必填字段

手动编辑 `tasks/TASK-XXX.json`，确保以下字段非空：

### Dev 任务
- [ ] `code_context.commits[]` — 至少 1 个 commit（hash + message + type）
- [ ] `verification.runtime_logs` — 至少 1 条 api_requests 或 browser_checks
- [ ] `verification.regression_check` — homepage/search/login_logout 全部填 `"PASS"`（精确大写，不是小写 "pass"）
- [ ] `artifacts[]` — 修改的文件列表（type + path + description）
- [ ] `steps[]` — 所有步骤 status 改为 `"DONE"`

### QA 任务
- [ ] `verification.qa_report` — 测试报告摘要（字符串）
- [ ] `verification.screenshots[]` — 截图路径列表
- [ ] `artifacts[]` — 报告/截图文件列表
- [ ] `steps[]` — 所有步骤 status 改为 `"DONE"`

## 3. 验证 TASK JSON

```bash
node scripts/tasks/validate-task.js TASK-XXX
# 必须显示 ✅ 全部通过 或 ⚠️ 仅 WARNING
# 如果有 ❌ ERROR → 修复后重试
```

## 4. Self-Improve（反思）

```bash
# 反思本次任务执行
# 写入私有记录
cat >> /path/to/workspace/.learnings/LEARNINGS.md << 'EOF'

### [LRN-{date}-{seq}] {一句话标题}
- Agent: {role}
- Task: TASK-XXX
- Category: insight/correction/best_practice
- Priority: P0/P1/P2
- Description: ...
- Resolution: ...
EOF

# 写入当日 memory
cat >> /path/to/workspace/memory/YYYY-MM-DD.md << 'EOF'
### TASK-XXX 完成
- AC: X/X PASS
- 经验: ...
EOF
```

## 5. 通知 PM（通过 Inbox）

```bash
# 通知 PM 任务完成（文件级通信，不需要 sessions_send）
node scripts/tasks/inbox.js send \
  --to pm --from {role} \
  --type task_done \
  --task-id TASK-XXX \
  --content "TASK-XXX 完成，AC X/X PASS，耗时 Xh"
```

## 6. Git Commit

```bash
git add -A
git commit -m "{type}({scope}): {message}"
```

---

**PM 门禁会检查以上所有字段。缺失任何一项 = 门禁不通过 = 打回补全。**
