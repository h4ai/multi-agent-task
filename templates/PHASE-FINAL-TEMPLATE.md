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

## 4. Self-Improve（反思 — 强制，不可跳过！）

### 4a. 回答 3 个问题（必须认真思考）
1. **做对了什么？** — 哪个决策/方法效果好？可复用？
2. **做错了什么？** — 哪里卡住了？走了弯路？犯了什么错？
3. **下次怎么改？** — 如果重做这个任务，会怎么做？

### 4b. 写入私有 learnings（workspace/.learnings/）
```bash
# 踩坑记录 → ERRORS.md
cat >> /path/to/workspace/.learnings/ERRORS.md << 'EOF'

### [ERR-YYYYMMDD-XXX] {一句话描述错误}
- **Pattern-Key**: {唯一关键词，用于去重}
- **Agent**: {role}
- **Task**: TASK-XXX
- **Context**: 在做什么时遇到的
- **Problem**: 具体错误是什么
- **Root Cause**: 根因分析
- **Solution**: 怎么解决的
- **Prevention**: 下次怎么避免
- **Recurrence-Count**: 1
- **First-Seen**: YYYY-MM-DD
EOF

# 最佳实践 → LEARNINGS.md
cat >> /path/to/workspace/.learnings/LEARNINGS.md << 'EOF'

### [LRN-YYYYMMDD-XXX] {一句话标题}
- **Pattern-Key**: {唯一关键词}
- **Agent**: {role}
- **Task**: TASK-XXX
- **Category**: insight | correction | best_practice | pattern
- **What Worked**: 具体做法
- **Why It Worked**: 原因分析
- **Reusable**: Yes/No — 适用场景说明
- **Recurrence-Count**: 1
- **First-Seen**: YYYY-MM-DD
EOF
```

### 4c. 写入 shared learnings（跨 Agent 共享）
> 只有**通用性强**的经验才写 shared，项目特定的只写私有。

```bash
SHARED_DIR="${HOME}/.openclaw/shared/learnings/{role}"

# 判断标准：其他 Agent 能从中受益吗？
# ✅ "Docker build 时 node_modules 缓存导致依赖不更新" → 通用
# ❌ "TASK-016 的 VersionUploader 组件 props 名写错了" → 项目特定

# 如果是通用经验：
cat >> ${SHARED_DIR}/LEARNINGS.md << 'EOF'
### [LRN-YYYYMMDD-XXX] {标题}
- Pattern-Key: {关键词}
- Source-Task: TASK-XXX
- Applicable-To: dev/qa/po/all
- Summary: ...
EOF

# 如果影响多个角色，也写到 common：
cat >> ${HOME}/.openclaw/shared/learnings/common/CROSS-AGENT.md << 'EOF'
### [CROSS-YYYYMMDD-XXX] {标题}
- Source: {role} / TASK-XXX
- Affects: dev, qa（列出受影响的角色）
- Summary: ...
EOF
```

### 4d. 写入当日 memory
```bash
cat >> /path/to/workspace/memory/YYYY-MM-DD.md << 'EOF'

### TASK-XXX 完成
- AC: X/X PASS
- 耗时: Xh
- 经验: {一句话总结最重要的学习}
- 踩坑: {一句话总结最大的坑，如果没有就写"无"}
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
