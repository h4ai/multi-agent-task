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

## Step 6: 检查是否需要 promote
如果任何条目 Recurrence-Count ≥ 3 且最近 30 天内重复出现：
- 考虑写入 SOUL.md 或 AGENTS.md（通知 main agent 审批）

## 完成
反思完成后，正常结束即可。不需要回复消息。
