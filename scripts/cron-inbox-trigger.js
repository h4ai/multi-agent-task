#!/usr/bin/env node
/**
 * cron-inbox-trigger.js
 * 
 * 被 cron 调用，检查 agent 的 inbox：
 * - 如果有消息：输出消息内容（让 cron prompt 包含消息）
 * - 如果没消息：输出 HEARTBEAT_OK 信号
 * 
 * 用法: node cron-inbox-trigger.js --agent qa
 * 
 * 设计理念：把 inbox 检查从 agent exec 中提取出来，
 * 在 cron 触发前就确定是否有消息，避免 isolated session exec 失败问题。
 */

const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const agentIdx = args.indexOf('--agent');
const agent = agentIdx >= 0 ? args[agentIdx + 1] : null;

if (!agent) {
  console.error('Usage: node cron-inbox-trigger.js --agent <name>');
  process.exit(2);
}

const INBOX_ROOT = path.join(process.env.HOME || '/home/azureuser', '.openclaw/shared/inbox');
const inboxDir = path.join(INBOX_ROOT, agent);

// Peek at inbox (non-destructive)
function peekInbox() {
  if (!fs.existsSync(inboxDir)) return [];
  
  return fs.readdirSync(inboxDir)
    .filter(f => f.startsWith('msg-') && f.endsWith('.json'))
    .sort()
    .map(f => {
      try {
        return JSON.parse(fs.readFileSync(path.join(inboxDir, f), 'utf8'));
      } catch { return null; }
    })
    .filter(Boolean);
}

const messages = peekInbox();

if (messages.length === 0) {
  // 无消息 — agent 会回 HEARTBEAT_OK
  process.exit(0);
}

// 有消息 — 输出摘要供 cron prompt 使用
console.log(`📬 ${agent} inbox: ${messages.length} 条消息待处理`);
for (const m of messages) {
  console.log(`  - ${m.type}: ${m.task_id || ''} (from: ${m.from}, priority: ${m.priority || 'normal'})`);
}
