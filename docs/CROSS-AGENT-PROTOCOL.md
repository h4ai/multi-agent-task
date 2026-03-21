# 跨 Agent 协作协议

> 所有 Agent 都可以通过 inbox 直接和其他 Agent 通信，不需要经过 PM 中转。

## 1. 请教 (question/answer)

当你遇到**自己领域之外**的问题，可以直接问其他 Agent：

```bash
# Dev 遇到权限问题，问 QA
node scripts/tasks/inbox.js send \
  --to qa --from dev \
  --type question \
  --task-id TASK-XXX \
  --content "QA 请教：ADMIN 角色应该能访问 /api/v1/admin/users 吗？我的测试返回 403"

# QA 回答
node scripts/tasks/inbox.js send \
  --to dev --from qa \
  --type answer \
  --task-id TASK-XXX \
  --content "根据权限矩阵，ADMIN 应该可以。你检查一下 JWT 里的 role 字段是否正确"
```

### 什么时候问
- ✅ 权限/角色问题 → 问 QA
- ✅ Spec 理解不确定 → 问 PO
- ✅ 部署/环境问题 → 问 OPS
- ✅ 任务优先级/排期 → 问 PM
- ❌ 自己能解决的不要问（先查 learnings）

### 规则
- 问题必须包含 `--task-id`（方便追踪）
- 回答方看到 question 类型消息要优先处理
- 超过 1 小时没回复 → PM 介入

## 2. Bug 报告

任何 Agent 发现 Bug 都可以直接报告：

```bash
node scripts/tasks/inbox.js send \
  --to pm --from qa \
  --type bug_report \
  --priority urgent \
  --content "发现登录后首页不显示用户名，疑似 auth state 没恢复"
```

## 3. 状态更新

执行中的 Agent 可以主动汇报进度：

```bash
node scripts/tasks/inbox.js send \
  --to pm --from dev \
  --type status_update \
  --task-id TASK-XXX \
  --content "Step 2/4 完成，预计还需 30 分钟"
```
