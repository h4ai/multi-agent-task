# 每日反思 — 自动触发（22:00）

你被系统唤醒进行每日反思。请严格按以下步骤执行：

## Step 1: 读取今天的记忆
```bash
cat memory/$(date +%Y-%m-%d).md
```
如果文件不存在，说明今天没有活动，直接写一条"今天无任务执行"到 memory 然后结束。

## Step 2: 回顾今天做了什么
列出今天执行的所有任务/对话/操作，每项简要总结：
- 做了什么
- 结果如何
- 遇到什么问题

## Step 3: 回答 3 个反思问题
1. **做对了什么？** — 哪个决策效果好？
2. **做错了什么？** — 哪里可以改进？
3. **模式识别** — 有没有反复出现的问题？

## Step 4: 写入 learnings
- 踩坑 → `.learnings/ERRORS.md`（Pattern-Key 去重！先 grep 再写）
- 最佳实践 → `.learnings/LEARNINGS.md`
- 通用经验 → `~/.openclaw/shared/learnings/{你的角色}/LEARNINGS.md`
- 跨角色经验 → `~/.openclaw/shared/learnings/common/CROSS-AGENT.md`

### 去重检查（必须！）
```bash
grep "Pattern-Key:" .learnings/LEARNINGS.md .learnings/ERRORS.md | grep -i "{关键词}"
```
- 找到 → 更新 Recurrence-Count + Last-Seen
- 没找到 → 新建条目

## Step 5: 更新 memory
在 `memory/$(date +%Y-%m-%d).md` 末尾追加：
```markdown
## 每日反思 (22:00)
- 今日任务数: X
- 关键学习: {一句话}
- 新增 learnings: X 条
- 新增 errors: X 条
```

## Step 6: 自动 Promote 检查（#5 改进 — 强制执行！）

扫描 `.learnings/ERRORS.md` 和 `.learnings/LEARNINGS.md` 中所有条目：

```bash
# 查找 Recurrence-Count ≥ 3 的条目
grep -B5 "Recurrence-Count: [3-9]\|Recurrence-Count: [1-9][0-9]" .learnings/ERRORS.md .learnings/LEARNINGS.md
```

对于每个 Recurrence-Count ≥ 3 的条目：

### 判断是否 promote
- **Pattern-Key 在最近 30 天内出现 ≥ 3 次** → 必须 promote
- **Priority 是 high/critical** → 必须 promote
- **其他** → 标记为 "pending_review"，等下次再看

### Promote 目标
| 经验类型 | Promote 到 | 示例 |
|---------|-----------|------|
| Agent 自身行为规范 | `SOUL.md` | "回复前必须检查 xxx" |
| 工作流程/步骤 | `AGENTS.md` | "执行前必须 validate" |
| 工具使用技巧 | `TOOLS.md` | "Docker build 加 --no-cache" |
| 通用编码模式 | `shared/learnings/common/` | "NestJS Guard 注意事项" |

### Promote 格式
不直接修改 SOUL.md/AGENTS.md，而是生成一个 promote 请求文件：

```bash
PROMOTE_DIR="${HOME}/.openclaw/shared/learnings/.promote-requests"
mkdir -p $PROMOTE_DIR
cat > ${PROMOTE_DIR}/promote-$(date +%Y%m%d)-{seq}.md << 'EOF'
# Promote Request

- **Source**: .learnings/ERRORS.md → [ERR-YYYYMMDD-XXX]
- **Pattern-Key**: xxx
- **Recurrence-Count**: N
- **Target File**: SOUL.md / AGENTS.md / TOOLS.md
- **Suggested Addition**:
  ```
  ## 规则: {一句话描述}
  {具体内容}
  ```
- **Requesting Agent**: {你的角色}
- **Created**: YYYY-MM-DD
EOF
```

### 通知 Main Agent 审批
```bash
# 通过 inbox 通知 main agent
node scripts/tasks/inbox.js send \
  --to pm --from {role} \
  --type promote_request \
  --content "Promote 请求: {Pattern-Key} → {target}，Recurrence={N}次"
```

原条目 Metadata 补充：
```
- Promoted: pending (promote-YYYYMMDD-XXX.md)
```

### 审批后
Main agent 或沈老板审批通过 → 手动合入目标文件 → 原条目标记：
```
- Promoted: approved → SOUL.md (YYYY-MM-DD)
```

## 完成
反思完成后，正常结束即可。不需要回复消息。
