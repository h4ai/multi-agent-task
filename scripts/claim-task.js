#!/usr/bin/env node
/**
 * claim-task.js — Agent 自动领取任务脚本
 * 
 * Usage:
 *   node scripts/tasks/claim-task.js --agent dev     # Dev Agent 检查可领取任务
 *   node scripts/tasks/claim-task.js --agent qa      # QA Agent 检查可领取任务
 *   node scripts/tasks/claim-task.js --agent dev --claim TASK-001  # 领取指定任务
 *   node scripts/tasks/claim-task.js --agent dev --auto            # 自动领取优先级最高的任务
 *   node scripts/tasks/claim-task.js --graph                       # 输出依赖图
 * 
 * 领取条件（全部满足才可领取）:
 *   1. status = PENDING
 *   2. assignee = 当前 Agent
 *   3. prerequisites 中所有任务 status = DONE（或 REVIEW 视配置）
 *   4. 没有其他同 assignee 的任务在 IN_PROGRESS（可选，防止一个 Agent 同时跑太多）
 * 
 * Exit codes:
 *   0 = 有可领取任务（或领取成功）
 *   1 = 无可领取任务
 *   2 = 参数错误
 */

const fs = require('fs');
const path = require('path');

const tasksDir = path.resolve(__dirname, '../../tasks');

// Parse args
const args = process.argv.slice(2);
const getArg = (flag) => {
  const idx = args.indexOf(flag);
  return idx >= 0 && idx + 1 < args.length ? args[idx + 1] : null;
};
const hasFlag = (flag) => args.includes(flag);

const agent = getArg('--agent');
const claimId = getArg('--claim');
const autoMode = hasFlag('--auto');
const claimAll = hasFlag('--claim-all');
const graphMode = hasFlag('--graph');
const dryRun = hasFlag('--dry-run');
const maxParallel = parseInt(getArg('--max-parallel') || '5', 10);
const depStatuses = (getArg('--dep-status') || 'DONE').toUpperCase().split(',');

// Load all tasks
function loadTasks() {
  const files = fs.readdirSync(tasksDir).filter(f => /^TASK-\d{3}[A-Z]?\.json$/.test(f));
  const tasks = {};
  for (const file of files) {
    try {
      const task = JSON.parse(fs.readFileSync(path.join(tasksDir, file), 'utf8'));
      tasks[task.id] = task;
    } catch (e) {
      console.error(`❌ Failed to parse ${file}: ${e.message}`);
    }
  }
  return tasks;
}

// Check if a task's prerequisites are all met
function prerequisitesMet(task, allTasks) {
  const prereqs = task.prerequisites || [];
  if (prereqs.length === 0) return { met: true, blocking: [] };
  
  const blocking = [];
  for (const prereqId of prereqs) {
    const prereq = allTasks[prereqId];
    if (!prereq) {
      blocking.push({ id: prereqId, reason: '任务不存在' });
      continue;
    }
    const status = (prereq.status || '').toUpperCase();
    if (!depStatuses.includes(status)) {
      blocking.push({ id: prereqId, status: prereq.status, reason: `状态为 ${prereq.status}（需要 ${depStatuses.join('/')})` });
    }
  }
  
  return { met: blocking.length === 0, blocking };
}

// Find claimable tasks for an agent
function findClaimable(agent, allTasks) {
  const claimable = [];
  
  // Count currently IN_PROGRESS tasks for this agent
  const inProgress = Object.values(allTasks).filter(t =>
    t.assignee === agent && (t.status || '').toUpperCase() === 'IN_PROGRESS'
  );
  
  for (const [id, task] of Object.entries(allTasks)) {
    const status = (task.status || '').toUpperCase();
    if (status === 'CANCELED') continue;
    if (status !== 'PENDING') continue;
    if (task.assignee !== agent) continue;
    
    const { met, blocking } = prerequisitesMet(task, allTasks);
    if (met) {
      claimable.push(task);
    }
  }
  
  // Sort by priority (P0 > P1 > P2), then by ID for stability
  const priorityOrder = { 'P0': 0, 'P1': 1, 'P2': 2 };
  claimable.sort((a, b) => {
    const pa = priorityOrder[a.priority] ?? 9;
    const pb = priorityOrder[b.priority] ?? 9;
    if (pa !== pb) return pa - pb;
    return a.id.localeCompare(b.id);
  });
  
  return { claimable, inProgressCount: inProgress.length, inProgress };
}

// Claim a task (update status to IN_PROGRESS + add event_log)
function claimTask(taskId, agent, allTasks) {
  const task = allTasks[taskId];
  if (!task) {
    console.error(`❌ Task ${taskId} not found`);
    return false;
  }
  
  const status = (task.status || '').toUpperCase();
  if (status !== 'PENDING') {
    console.error(`❌ Task ${taskId} status is ${task.status}（只能领取 PENDING 任务）`);
    return false;
  }
  
  if (task.assignee !== agent) {
    console.error(`❌ Task ${taskId} assignee is ${task.assignee}（你是 ${agent}）`);
    return false;
  }
  
  const { met, blocking } = prerequisitesMet(task, allTasks);
  if (!met) {
    console.error(`❌ Task ${taskId} 前置任务未就绪:`);
    for (const b of blocking) {
      console.error(`   - ${b.id}: ${b.reason}`);
    }
    return false;
  }
  
  if (dryRun) {
    console.log(`🔍 [DRY RUN] Would claim ${taskId}`);
    return true;
  }
  
  // Update task
  const now = new Date().toISOString();
  task.status = 'IN_PROGRESS';
  task.updated = now;
  
  // Add event_log entry
  if (!task.event_log) task.event_log = [];
  task.event_log.push({
    event_id: `EVT-${Date.now()}`,
    type: 'status_changed',
    actor: agent,
    step_id: null,
    timestamp: now,
    payload: {
      from_status: 'PENDING',
      to_status: 'IN_PROGRESS',
      reason: `${agent} agent 自动领取任务`,
      evidence: null
    }
  });
  
  // Write back
  const filePath = path.join(tasksDir, `${taskId}.json`);
  fs.writeFileSync(filePath, JSON.stringify(task, null, 2));
  
  console.log(`✅ Claimed ${taskId} → IN_PROGRESS`);
  return true;
}

// Print dependency graph
function printGraph(allTasks) {
  console.log('📊 任务依赖图:\n');
  
  const statusIcon = {
    'PENDING': '⏳',
    'IN_PROGRESS': '🔄',
    'REVIEW': '👀',
    'DONE': '✅',
    'BLOCKED': '🚫',
    'FAILED': '❌',
    'CANCELED': '🚮'
  };
  
  // Group by wave
  const waves = {};
  for (const [id, task] of Object.entries(allTasks)) {
    if ((task.status || '').toUpperCase() === 'CANCELED') continue;
    const wave = task.execution?.parallel_group || 'unassigned';
    if (!waves[wave]) waves[wave] = [];
    waves[wave].push(task);
  }
  
  for (const [wave, tasks] of Object.entries(waves).sort()) {
    console.log(`── ${wave} ──`);
    for (const task of tasks) {
      const icon = statusIcon[(task.status || '').toUpperCase()] || '❓';
      const prereqs = (task.prerequisites || []).join(', ') || '无';
      const { met } = prerequisitesMet(task, allTasks);
      const ready = met ? '🟢 READY' : '🔴 BLOCKED';
      console.log(`  ${icon} ${task.id} (${task.assignee}) [${task.priority}] — ${task.title.substring(0, 40)}`);
      console.log(`     前置: [${prereqs}] ${(task.status || '').toUpperCase() === 'PENDING' ? ready : ''}`);
    }
    console.log('');
  }
}

// === Main ===

const allTasks = loadTasks();

if (graphMode) {
  printGraph(allTasks);
  process.exit(0);
}

if (!agent && !graphMode) {
  console.error('❌ Usage: node claim-task.js --agent dev|qa|po [--auto] [--claim TASK-XXX] [--graph]');
  process.exit(2);
}

if (claimId) {
  // Claim specific task
  const ok = claimTask(claimId, agent, allTasks);
  process.exit(ok ? 0 : 1);
}

// Find claimable
const { claimable, inProgressCount, inProgress } = findClaimable(agent, allTasks);
const availableSlots = maxParallel - inProgressCount;

if (inProgressCount > 0) {
  console.log(`ℹ️  ${agent}: 当前有 ${inProgressCount} 个任务进行中（并行上限 ${maxParallel}，剩余 ${availableSlots} 个槽位）`);
  for (const t of inProgress) {
    console.log(`   🔄 ${t.id} — ${t.title.substring(0, 50)}`);
  }
  console.log('');
}

if (claimable.length === 0) {
  console.log(`ℹ️  ${agent}: 当前无可领取任务`);
  
  // Show why tasks are blocked
  const pending = Object.values(allTasks).filter(t => 
    t.assignee === agent && (t.status || '').toUpperCase() === 'PENDING'
  );
  if (pending.length > 0) {
    console.log(`\n   等待中的任务:`);
    for (const t of pending) {
      const { blocking } = prerequisitesMet(t, allTasks);
      if (blocking.length > 0) {
        console.log(`   - ${t.id}: 等待 ${blocking.map(b => `${b.id}(${b.status || '不存在'})`).join(', ')}`);
      }
    }
  }
  process.exit(1);
}

if (availableSlots <= 0) {
  console.log(`⚠️  ${agent}: 有 ${claimable.length} 个可领取任务，但并行槽位已满（${inProgressCount}/${maxParallel}）`);
  process.exit(1);
}

// Limit claimable to available slots
const canClaim = claimable.slice(0, availableSlots);

console.log(`🎯 ${agent}: ${claimable.length} 个可领取，可领 ${canClaim.length} 个（槽位 ${availableSlots}/${maxParallel}）:\n`);
for (const t of canClaim) {
  const wt = t.worktree?.enabled ? `worktree: ${t.worktree.path}` : 'no worktree';
  console.log(`  [${t.priority}] ${t.id} — ${t.title.substring(0, 50)}`);
  console.log(`       ${wt}`);
  console.log(`       prerequisites: ${(t.prerequisites || []).join(', ') || '无'}`);
  console.log('');
}

if (autoMode) {
  // Auto-claim the highest priority task (single)
  const top = canClaim[0];
  console.log(`🤖 自动领取最高优先级任务: ${top.id} (${top.priority})`);
  const ok = claimTask(top.id, agent, allTasks);
  process.exit(ok ? 0 : 1);
}

if (claimAll) {
  // Claim all available tasks up to max-parallel
  console.log(`🤖 批量领取 ${canClaim.length} 个任务（max-parallel=${maxParallel}）:\n`);
  const claimed = [];
  for (const t of canClaim) {
    if (claimTask(t.id, agent, allTasks)) {
      claimed.push(t.id);
    }
  }
  console.log(`\n✅ 成功领取 ${claimed.length} 个: ${claimed.join(', ')}`);
  
  // Output JSON for Agent to parse
  console.log(`\n__CLAIMED_JSON__`);
  console.log(JSON.stringify(claimed));
  
  process.exit(claimed.length > 0 ? 0 : 1);
}

process.exit(0);
