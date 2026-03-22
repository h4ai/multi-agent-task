#!/usr/bin/env node
/**
 * stalled-check.js — 僵尸任务检测 + 自动恢复
 * 
 * 检测 IN_PROGRESS 任务是否 stalled（被消费但无产出），自动恢复到可重派发状态。
 * 
 * 用法:
 *   node stalled-check.js --json                    # 只检测，输出 JSON 报告
 *   node stalled-check.js --auto-recover             # 检测 + 自动恢复 stalled 任务
 *   node stalled-check.js --threshold 60             # 自定义超时（分钟，默认 120）
 *   node stalled-check.js --auto-recover --dispatch  # 恢复后自动重新派发
 * 
 * 判定 stalled 的条件（全部满足）：
 *   1. status = IN_PROGRESS
 *   2. inbox archive 中有该任务的消息（已被消费）
 *   3. 最近 N 分钟内无新 git commit 引用该 TASK ID
 *   4. TASK JSON 的 steps 无进展（全部 PENDING）
 *   5. event_log 最后一条距今超过 N 分钟
 * 
 * 恢复流程：
 *   IN_PROGRESS → BLOCKED(stalled) → IN_PROGRESS(reset) → PENDING → dispatch
 *   简化为: IN_PROGRESS → BLOCKED → PENDING (利用合法转换)
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync } = require('child_process');

const PROJECT_ROOT = path.resolve(__dirname, '../..');
const TASKS_DIR = path.join(PROJECT_ROOT, 'tasks');
const INBOX_BASE = path.join(process.env.HOME, '.openclaw/shared/inbox');

// Parse args
const args = process.argv.slice(2);
const jsonMode = args.includes('--json');
const autoRecover = args.includes('--auto-recover');
const autoDispatch = args.includes('--dispatch');
const thresholdIdx = args.indexOf('--threshold');
const STALLED_THRESHOLD_MIN = thresholdIdx >= 0 ? parseInt(args[thresholdIdx + 1]) : 120; // 默认 2 小时

const now = Date.now();

function log(msg) {
  if (!jsonMode) console.log(msg);
}

function loadTaskFiles() {
  const files = fs.readdirSync(TASKS_DIR).filter(f => f.match(/^TASK-\d+\.json$/));
  return files.map(f => {
    try {
      const data = JSON.parse(fs.readFileSync(path.join(TASKS_DIR, f), 'utf-8'));
      return { file: f, ...data };
    } catch (e) {
      return null;
    }
  }).filter(Boolean);
}

function checkInboxArchive(taskId, agent) {
  const archiveDir = path.join(INBOX_BASE, agent, '.archive');
  if (!fs.existsSync(archiveDir)) return { consumed: false, consumedAt: null };
  
  const files = fs.readdirSync(archiveDir).filter(f => f.endsWith('.json'));
  for (const f of files) {
    try {
      const msg = JSON.parse(fs.readFileSync(path.join(archiveDir, f), 'utf-8'));
      if (msg.task_id === taskId) {
        return { consumed: true, consumedAt: msg.timestamp || null, file: f };
      }
    } catch (e) { /* skip */ }
  }
  return { consumed: false, consumedAt: null };
}

function checkRecentCommits(taskId, minutes) {
  try {
    const since = new Date(now - minutes * 60 * 1000).toISOString();
    const result = execSync(
      `cd "${path.join(PROJECT_ROOT, '../..')}" && git log --oneline --since="${since}" --all 2>/dev/null | grep -i "${taskId}" | wc -l`,
      { encoding: 'utf-8', timeout: 5000 }
    ).trim();
    return parseInt(result) || 0;
  } catch (e) {
    return 0;
  }
}

// 新增：检查整个 IN_PROGRESS 期间是否有任何 commit（不限 threshold 时间）
// 扩大搜索范围：同时检查 commit message 和 diff 中的 TASK JSON 文件
function checkAnyCommits(taskId) {
  try {
    // Method 1: grep commit message for TASK ID
    const byMessage = execSync(
      `cd "${path.join(PROJECT_ROOT, '../..')}" && git log --oneline --all 2>/dev/null | grep -i "${taskId}" | wc -l`,
      { encoding: 'utf-8', timeout: 5000 }
    ).trim();
    
    // Method 2: check if any commit modified the TASK JSON file
    const taskFile = `tasks/${taskId}.json`;
    const byFile = execSync(
      `cd "${path.join(PROJECT_ROOT, '../..')}" && git log --oneline --all -- "projects/enterprise-skillhub/${taskFile}" 2>/dev/null | wc -l`,
      { encoding: 'utf-8', timeout: 5000 }
    ).trim();
    
    // Method 3: check commits that touch task-related code (any file mentioning the task)
    const byDiff = execSync(
      `cd "${path.join(PROJECT_ROOT, '../..')}" && git log --oneline --all -S "${taskId}" 2>/dev/null | wc -l`,
      { encoding: 'utf-8', timeout: 8000 }
    ).trim();
    
    return Math.max(parseInt(byMessage) || 0, parseInt(byFile) || 0, parseInt(byDiff) || 0);
  } catch (e) {
    return 0;
  }
}

// 新增：检查 inbox 是否有未消费的消息
function checkInboxPending(taskId, agent) {
  const inboxDir = path.join(os.homedir(), '.openclaw', 'shared', 'inbox', agent);
  if (!fs.existsSync(inboxDir)) return false;
  const files = fs.readdirSync(inboxDir).filter(f => f.endsWith('.json') && !f.startsWith('.'));
  return files.some(f => {
    try {
      const msg = JSON.parse(fs.readFileSync(path.join(inboxDir, f), 'utf8'));
      return msg.task_id === taskId || (msg.metadata && msg.metadata.task_id === taskId);
    } catch { return false; }
  });
}

function getLastEventTime(task) {
  const events = task.event_log || [];
  if (events.length === 0) return null;
  const last = events[events.length - 1];
  if (last.timestamp) {
    return new Date(last.timestamp).getTime();
  }
  return null;
}

function getStepsProgress(task) {
  const steps = task.steps || [];
  if (steps.length === 0) return { total: 0, done: 0, progress: false };
  const done = steps.filter(s => {
    const st = (s.status || '').toUpperCase();
    return st === 'DONE' || st === 'COMPLETED';
  }).length;
  return { total: steps.length, done, progress: done > 0 };
}

// === Main ===
const tasks = loadTaskFiles();
const inProgressTasks = tasks.filter(t => (t.status || '').toUpperCase() === 'IN_PROGRESS');

log(`🔍 检查 IN_PROGRESS 任务: ${inProgressTasks.length} 个 (threshold: ${STALLED_THRESHOLD_MIN}分钟)`);
log('');

const report = {
  timestamp: new Date().toISOString(),
  threshold_minutes: STALLED_THRESHOLD_MIN,
  checked: inProgressTasks.length,
  stalled: [],
  active: [],
  recovered: [],
  dispatched: []
};

for (const task of inProgressTasks) {
  const taskId = task.id;
  const agent = (task.assignee || 'dev').toLowerCase();
  
  log(`--- ${taskId}: ${task.title || '?'} (assignee: ${agent}) ---`);
  
  // Check 1: inbox consumed?
  const inbox = checkInboxArchive(taskId, agent);
  log(`  Inbox consumed: ${inbox.consumed ? '✅ YES' : '❌ NO'} ${inbox.consumedAt ? `(at ${inbox.consumedAt.substring(0,16)})` : ''}`);
  
  // Check 1b: inbox still has pending message? → not stalled, just waiting
  const inboxPending = checkInboxPending(taskId, agent);
  if (inboxPending) {
    log(`  Inbox pending: ✅ 有未消费消息 — 跳过（等待 agent 消费）`);
    report.active.push({
      id: taskId, title: task.title, assignee: agent,
      reason: 'inbox message pending, waiting for agent',
      recent_commits: 0, steps: `${steps.done}/${steps.total}`
    });
    continue;
  }
  
  // Check 2: recent commits?
  const recentCommits = checkRecentCommits(taskId, STALLED_THRESHOLD_MIN);
  log(`  Recent commits: ${recentCommits > 0 ? `✅ ${recentCommits} commits` : '❌ 0'}`);
  
  // Check 2b: any commits ever for this task? (partial progress detection)
  const totalCommits = checkAnyCommits(taskId);
  if (recentCommits === 0 && totalCommits > 0) {
    log(`  Historical commits: ⚠️ ${totalCommits} (有历史提交但最近无活动 — PARTIAL_PROGRESS)`);
  }
  
  // Check 3: steps progress?
  const steps = getStepsProgress(task);
  log(`  Steps progress: ${steps.progress ? `✅ ${steps.done}/${steps.total}` : `❌ ${steps.done}/${steps.total}`}`);
  
  // Check 4: last event time
  const lastEvent = getLastEventTime(task);
  const minutesSinceEvent = lastEvent ? Math.floor((now - lastEvent) / 60000) : 9999;
  const eventStale = minutesSinceEvent > STALLED_THRESHOLD_MIN;
  log(`  Last event: ${lastEvent ? `${minutesSinceEvent}m ago` : 'never'} ${eventStale ? '❌ stale' : '✅ recent'}`);
  
  // Determine: stalled?
  // If task has historical commits → it's PARTIAL, not fully stalled
  const isPartialProgress = totalCommits > 0;
  const isStalled = inbox.consumed && recentCommits === 0 && !steps.progress && eventStale && !isPartialProgress;
  
  if (isStalled) {
    log(`  🚨 STALLED — 消息已消费但 ${STALLED_THRESHOLD_MIN}分钟内无产出`);
    report.stalled.push({
      id: taskId,
      title: task.title,
      assignee: agent,
      consumed_at: inbox.consumedAt,
      minutes_since_event: minutesSinceEvent,
      steps: `${steps.done}/${steps.total}`,
      recent_commits: recentCommits
    });
    
    if (autoRecover) {
      try {
        // Step 1: IN_PROGRESS → BLOCKED
        log(`  🔧 恢复: IN_PROGRESS → BLOCKED`);
        execSync(
          `node "${path.join(__dirname, 'update-task.js')}" ${taskId} --status BLOCKED --actor pm --reason "Auto-detected stalled: consumed ${minutesSinceEvent}m ago, 0 commits, 0 step progress"`,
          { encoding: 'utf-8', cwd: PROJECT_ROOT, timeout: 10000 }
        );
        
        // Step 2: BLOCKED → PENDING (合法转换 via CANCELED → PENDING 或直接)
        // 实际上 BLOCKED → IN_PROGRESS 和 BLOCKED → CANCELED 是合法的
        // 用 BLOCKED → CANCELED → PENDING
        log(`  🔧 恢复: BLOCKED → CANCELED`);
        execSync(
          `node "${path.join(__dirname, 'update-task.js')}" ${taskId} --status CANCELED --actor pm --reason "Stalled task reset for re-dispatch"`,
          { encoding: 'utf-8', cwd: PROJECT_ROOT, timeout: 10000 }
        );
        
        log(`  🔧 恢复: CANCELED → PENDING`);
        execSync(
          `node "${path.join(__dirname, 'update-task.js')}" ${taskId} --status PENDING --actor pm --reason "Ready for re-dispatch after stalled recovery"`,
          { encoding: 'utf-8', cwd: PROJECT_ROOT, timeout: 10000 }
        );
        
        report.recovered.push(taskId);
        log(`  ✅ 已恢复到 PENDING`);
        
        // Step 3: auto dispatch?
        if (autoDispatch) {
          try {
            log(`  📦 重新派发...`);
            const dispatchResult = execSync(
              `node "${path.join(__dirname, 'dispatch-task.js')}" ${taskId} --priority urgent`,
              { encoding: 'utf-8', cwd: PROJECT_ROOT, timeout: 30000 }
            );
            report.dispatched.push(taskId);
            log(`  ✅ 已重新派发`);
          } catch (e) {
            log(`  ❌ 派发失败: ${e.message.substring(0, 100)}`);
          }
        }
      } catch (e) {
        log(`  ❌ 恢复失败: ${e.message.substring(0, 100)}`);
      }
    }
  } else if (isPartialProgress && eventStale) {
    log(`  ⚠️ PARTIAL_PROGRESS — 有 ${totalCommits} 个历史 commit，但最近无活动`);
    log(`  → 不自动恢复（已有代码产出），需 PM 手动评估是否需要补充完成`);
    report.partial = report.partial || [];
    report.partial.push({
      id: taskId,
      title: task.title,
      assignee: agent,
      total_commits: totalCommits,
      minutes_since_event: minutesSinceEvent,
      steps: `${steps.done}/${steps.total}`,
      recommendation: 'Review existing commits, consider targeted re-dispatch for remaining work'
    });
  } else {
    log(`  ✅ ACTIVE — 有进展或尚未超时`);
    report.active.push({
      id: taskId,
      title: task.title,
      assignee: agent,
      recent_commits: recentCommits,
      steps: `${steps.done}/${steps.total}`,
      minutes_since_event: minutesSinceEvent
    });
  }
  log('');
}

// Summary
log('=== 总结 ===');
log(`  检查: ${report.checked} | Stalled: ${report.stalled.length} | Active: ${report.active.length}`);
if (report.recovered.length > 0) log(`  已恢复: ${report.recovered.join(', ')}`);
if (report.dispatched.length > 0) log(`  已派发: ${report.dispatched.join(', ')}`);

if (jsonMode) {
  console.log(JSON.stringify(report, null, 2));
}

process.exit(report.stalled.length > 0 && !autoRecover ? 1 : 0);
