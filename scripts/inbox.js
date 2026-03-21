#!/usr/bin/env node
/**
 * inbox.js — 文件级 Agent 间消息通信
 * 
 * 借鉴 ClawTeam file.py 的 FileTransport：
 *   - 原子写入（tmp → rename）
 *   - claim → consumed → ack/quarantine
 *   - dead_letter 死信队列
 * 
 * 适配 OpenClaw 多 Agent 架构，不依赖 sessions_send。
 * 
 * Usage:
 *   node inbox.js send --to pm --from dev --type task_done --content "TASK-001 done"
 *   node inbox.js send --to pm --from dev --type task_done --task-id TASK-001 --priority urgent
 *   node inbox.js receive --agent pm [--limit 10] [--json]
 *   node inbox.js peek --agent pm [--json]
 *   node inbox.js count --agent pm
 *   node inbox.js broadcast --from pm --content "全员注意" [--exclude dev]
 *   node inbox.js list-agents
 *   node inbox.js history --limit 20 [--json]
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// === Config ===
const sharedDir = process.env.MAT_SHARED_DIR ||
  path.join(require('os').homedir(), '.openclaw', 'shared');
const INBOX_ROOT = path.join(sharedDir, 'inbox');
const EVENT_LOG_DIR = path.join(sharedDir, 'inbox', '.events');
const DEAD_LETTER_DIR = path.join(sharedDir, 'inbox', '.dead_letters');

const KNOWN_AGENTS = ['pm', 'dev', 'qa', 'po', 'monitor'];
const VALID_TYPES = [
  'message', 'task_done', 'bug_report', 'request', 'alert',
  'broadcast', 'status_update', 'review_result', 'gate_pass',
  'gate_fail', 'zombie_detected', 'dep_resolved'
];

// === Helpers ===
function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function agentInbox(agent) {
  const dir = path.join(INBOX_ROOT, agent);
  ensureDir(dir);
  return dir;
}

function generateId() {
  return crypto.randomBytes(4).toString('hex');
}

function nowMs() {
  return Date.now();
}

function parseArgs(argv) {
  const result = { _positional: [] };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      const key = argv[i].slice(2);
      if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) {
        result[key] = argv[i + 1];
        i++;
      } else {
        result[key] = true;
      }
    } else {
      result._positional.push(argv[i]);
    }
  }
  return result;
}

// === Core: Send (借鉴 ClawTeam FileTransport.deliver) ===
function sendMessage(to, from, type, content, opts = {}) {
  const inbox = agentInbox(to);
  const ts = nowMs();
  const uid = generateId();
  
  const msg = {
    id: `msg-${ts}-${uid}`,
    type: type || 'message',
    from: from,
    to: to,
    content: content || '',
    timestamp: new Date().toISOString(),
    priority: opts.priority || 'normal',
    task_id: opts.taskId || null,
    request_id: opts.requestId || `req-${uid}`,
    metadata: opts.metadata || {}
  };

  const filename = `msg-${ts}-${uid}.json`;
  const tmpPath = path.join(inbox, `.tmp-${uid}.json`);
  const targetPath = path.join(inbox, filename);

  // 原子写入（借鉴 ClawTeam: tmp.write → tmp.replace）
  try {
    fs.writeFileSync(tmpPath, JSON.stringify(msg, null, 2));
    fs.renameSync(tmpPath, targetPath);
  } catch (e) {
    try { fs.unlinkSync(tmpPath); } catch {}
    throw e;
  }

  // 写入 event log（借鉴 ClawTeam MailboxManager._log_event）
  logEvent(msg);

  return msg;
}

// === Core: Receive (借鉴 ClawTeam FileTransport.claim_messages) ===
function receiveMessages(agent, limit = 10) {
  const inbox = agentInbox(agent);
  const files = fs.readdirSync(inbox)
    .filter(f => f.startsWith('msg-') && f.endsWith('.json'))
    .sort(); // 时间戳排序 = FIFO

  const messages = [];
  for (const f of files.slice(0, limit)) {
    const filePath = path.join(inbox, f);
    const consumedPath = filePath.replace('.json', '.consumed');

    // Step 1: rename → .consumed（原子 claim，防重复消费）
    try {
      fs.renameSync(filePath, consumedPath);
    } catch {
      continue; // 另一个进程已 claim
    }

    // Step 2: 读取
    try {
      const data = fs.readFileSync(consumedPath, 'utf8');
      const msg = JSON.parse(data);
      messages.push(msg);
      // Step 3: ack — 删除 consumed 文件
      fs.unlinkSync(consumedPath);
    } catch (e) {
      // 解析失败 → dead_letter（借鉴 ClawTeam quarantine）
      quarantine(agent, consumedPath, e.message);
    }
  }

  return messages;
}

// === Core: Peek (不消费) ===
function peekMessages(agent) {
  const inbox = agentInbox(agent);
  const files = fs.readdirSync(inbox)
    .filter(f => f.startsWith('msg-') && f.endsWith('.json'))
    .sort();

  return files.map(f => {
    try {
      return JSON.parse(fs.readFileSync(path.join(inbox, f), 'utf8'));
    } catch { return null; }
  }).filter(Boolean);
}

// === Core: Count ===
function countMessages(agent) {
  const inbox = agentInbox(agent);
  try {
    return fs.readdirSync(inbox)
      .filter(f => f.startsWith('msg-') && f.endsWith('.json'))
      .length;
  } catch { return 0; }
}

// === Core: Broadcast ===
function broadcast(from, content, opts = {}) {
  const exclude = new Set((opts.exclude || '').split(',').filter(Boolean));
  exclude.add(from);
  
  const results = [];
  for (const agent of KNOWN_AGENTS) {
    if (exclude.has(agent)) continue;
    const msg = sendMessage(agent, from, 'broadcast', content, opts);
    results.push(msg);
  }
  return results;
}

// === Dead Letter Queue (借鉴 ClawTeam _quarantine_bytes) ===
function quarantine(agent, filePath, error) {
  const deadDir = path.join(DEAD_LETTER_DIR, agent);
  ensureDir(deadDir);
  
  const basename = path.basename(filePath);
  const destPath = path.join(deadDir, basename);
  
  try {
    fs.renameSync(filePath, destPath);
  } catch {
    try { fs.unlinkSync(filePath); } catch {}
  }

  // 写 meta 文件
  const metaPath = destPath + '.meta.json';
  fs.writeFileSync(metaPath, JSON.stringify({
    agent,
    sourceName: basename,
    error,
    quarantinedAt: new Date().toISOString()
  }, null, 2));
}

// === Event Log (借鉴 ClawTeam MailboxManager._log_event) ===
function logEvent(msg) {
  ensureDir(EVENT_LOG_DIR);
  const ts = nowMs();
  const uid = generateId();
  const logPath = path.join(EVENT_LOG_DIR, `evt-${ts}-${uid}.json`);
  try {
    fs.writeFileSync(logPath, JSON.stringify(msg, null, 2));
  } catch {} // best-effort
}

function getEventLog(limit = 20) {
  ensureDir(EVENT_LOG_DIR);
  return fs.readdirSync(EVENT_LOG_DIR)
    .filter(f => f.startsWith('evt-') && f.endsWith('.json'))
    .sort()
    .reverse()
    .slice(0, limit)
    .map(f => {
      try {
        return JSON.parse(fs.readFileSync(
          path.join(EVENT_LOG_DIR, f), 'utf8'));
      } catch { return null; }
    })
    .filter(Boolean);
}

// === CLI ===
const rawArgs = process.argv.slice(2);
const action = rawArgs[0];
const opts = parseArgs(rawArgs.slice(1));

switch (action) {
  case 'send': {
    if (!opts.to || !opts.from) {
      console.error('Usage: node inbox.js send --to <agent> --from <agent> --content "..."');
      process.exit(2);
    }
    const msg = sendMessage(
      opts.to, opts.from, opts.type, opts.content,
      { priority: opts.priority, taskId: opts['task-id'], requestId: opts['request-id'] }
    );
    if (opts.json) {
      console.log(JSON.stringify(msg, null, 2));
    } else {
      console.log(`✅ Sent ${msg.id} → ${opts.to} (${opts.type || 'message'})`);
    }
    break;
  }

  case 'receive': {
    if (!opts.agent) {
      console.error('Usage: node inbox.js receive --agent <name> [--limit N]');
      process.exit(2);
    }
    const msgs = receiveMessages(opts.agent, parseInt(opts.limit) || 10);
    if (opts.json) {
      console.log(JSON.stringify(msgs, null, 2));
    } else if (msgs.length === 0) {
      console.log(`📭 ${opts.agent}: 无新消息`);
    } else {
      for (const m of msgs) {
        const pri = m.priority === 'urgent' ? '🔴' : '📩';
        console.log(
          `${pri} [${m.timestamp}] ${m.type} from=${m.from}: ${m.content}`);
      }
      console.log(`\n共 ${msgs.length} 条消息已消费`);
    }
    break;
  }

  case 'peek': {
    if (!opts.agent) {
      console.error('Usage: node inbox.js peek --agent <name>');
      process.exit(2);
    }
    const msgs = peekMessages(opts.agent);
    if (opts.json) {
      console.log(JSON.stringify(msgs, null, 2));
    } else if (msgs.length === 0) {
      console.log(`📭 ${opts.agent}: 无待处理消息`);
    } else {
      for (const m of msgs) {
        const pri = m.priority === 'urgent' ? '🔴' : '📩';
        console.log(
          `${pri} [${m.timestamp}] ${m.type} from=${m.from}: ${(m.content || '').substring(0, 80)}`);
      }
      console.log(`\n共 ${msgs.length} 条（未消费）`);
    }
    break;
  }

  case 'count': {
    if (!opts.agent) {
      // 列出所有 agent 的消息数
      for (const a of KNOWN_AGENTS) {
        const n = countMessages(a);
        console.log(`${a}: ${n} 条待处理`);
      }
    } else {
      console.log(countMessages(opts.agent));
    }
    break;
  }

  case 'broadcast': {
    if (!opts.from || !opts.content) {
      console.error('Usage: node inbox.js broadcast --from <agent> --content "..." [--exclude a,b]');
      process.exit(2);
    }
    const results = broadcast(opts.from, opts.content, { exclude: opts.exclude });
    if (opts.json) {
      console.log(JSON.stringify(results, null, 2));
    } else {
      console.log(`📢 广播到 ${results.length} 个 Agent: ${results.map(r => r.to).join(', ')}`);
    }
    break;
  }

  case 'list-agents': {
    try {
      const dirs = fs.readdirSync(INBOX_ROOT)
        .filter(d => !d.startsWith('.') && 
          fs.statSync(path.join(INBOX_ROOT, d)).isDirectory());
      for (const d of dirs) {
        const n = countMessages(d);
        console.log(`${d}: ${n} 条待处理`);
      }
    } catch {
      console.log('(inbox 目录尚未创建)');
    }
    break;
  }

  case 'history': {
    const events = getEventLog(parseInt(opts.limit) || 20);
    if (opts.json) {
      console.log(JSON.stringify(events, null, 2));
    } else {
      for (const e of events) {
        console.log(`[${e.timestamp}] ${e.type} ${e.from}→${e.to}: ${(e.content || '').substring(0, 60)}`);
      }
      console.log(`\n共 ${events.length} 条历史记录`);
    }
    break;
  }

  default:
    console.error(`Usage: node inbox.js <send|receive|peek|count|broadcast|list-agents|history> [options]`);
    process.exit(2);
}
