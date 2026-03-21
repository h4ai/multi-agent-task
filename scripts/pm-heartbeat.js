#!/usr/bin/env node
/**
 * pm-heartbeat.js — PM Agent 定时任务脚本
 * 
 * 类似 Monitor 的 patrol.js，把 PM 的标准化工作脚本化：
 *   1. 门禁检查：REVIEW 任务是否满足 DONE 条件
 *   2. 任务推进：识别可派发的 pending 任务
 *   3. Subagent 状态：检查活跃/死亡的 subagent
 *   4. 阻塞检测：blocked 任务超时
 * 
 * Usage:
 *   node pm-heartbeat.js              # 完整检查
 *   node pm-heartbeat.js --json       # JSON 输出
 *   node pm-heartbeat.js --gatecheck  # 仅门禁检查
 * 
 * JSON 输出:
 *   {
 *     action: "HEARTBEAT_OK" | "GATE_PASS" | "GATE_FAIL" | "DISPATCH_READY" | "ALERT",
 *     gate_results: [...],        // 每个 REVIEW 任务的门禁结果
 *     dispatchable: [...],        // 可派发的 pending 任务
 *     blocked_alerts: [...],      // 阻塞超时告警
 *     notification_text: "..."    // 可直接发群的文本
 *   }
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const projectRoot = path.resolve(__dirname, '../..');
const tasksDir = path.join(projectRoot, 'tasks');

const args = process.argv.slice(2);
const jsonOnly = args.includes('--json');
const gateOnly = args.includes('--gatecheck');

// ============================================================
// Load all tasks
// ============================================================
function loadTasks() {
  const tasks = [];
  const files = fs.readdirSync(tasksDir).filter(f => /^TASK-\d{3}[A-Z]?\.json$/.test(f));
  for (const file of files) {
    try {
      tasks.push(JSON.parse(fs.readFileSync(path.join(tasksDir, file), 'utf8')));
    } catch (e) {
      tasks.push({ id: file, _parseError: e.message });
    }
  }
  return tasks;
}

// ============================================================
// Gate Check: REVIEW → DONE 门禁
// ============================================================
function gateCheck(task) {
  const checks = [];
  let pass = true;

  // 1. JSON 合法
  if (task._parseError) {
    checks.push({ check: 'JSON 格式', pass: false, detail: task._parseError });
    return { taskId: task.id, pass: false, checks };
  }

  // 2. Status 必须是 REVIEW
  const status = (task.status || '').toUpperCase();
  if (status !== 'REVIEW') {
    return { taskId: task.id, pass: null, checks: [{ check: '状态', pass: null, detail: `${status}（非 REVIEW，跳过）` }] };
  }

  // 3. Steps 全 DONE
  const steps = task.steps || [];
  const doneSteps = steps.filter(s => (s.status || '').toUpperCase() === 'DONE');
  const allDone = steps.length > 0 && doneSteps.length === steps.length;
  checks.push({ check: 'Steps 完成', pass: allDone, detail: `${doneSteps.length}/${steps.length}` });
  if (!allDone) pass = false;

  // 4. Dev 任务必须有 commits
  if (task.assignee === 'dev') {
    const hasCommits = task.code_context?.commits?.length > 0;
    checks.push({ check: 'Git Commits', pass: hasCommits, detail: hasCommits ? `${task.code_context.commits.length} 个` : '无' });
    if (!hasCommits) pass = false;
  }

  // 5. Regression check
  const rc = task.verification?.regression_check;
  if (rc) {
    const allPass = ['homepage', 'search', 'login_logout'].every(f => rc[f] === 'PASS' || rc[f] === null);
    const detail = ['homepage', 'search', 'login_logout'].map(f => `${f}=${rc[f] || 'null'}`).join(', ');
    checks.push({ check: 'Regression Check', pass: allPass, detail });
    if (!allPass) pass = false;
  }

  // 6. Event log 非空
  const hasLog = task.event_log?.length > 0;
  checks.push({ check: 'Event Log', pass: hasLog, detail: hasLog ? `${task.event_log.length} 条` : '空' });
  if (!hasLog) pass = false;

  // 7. Artifacts 非空（措施 3: 防止 STEPS_NO_ARTIFACTS 告警）
  const hasArtifacts = task.artifacts?.length > 0;
  checks.push({ check: 'Artifacts', pass: hasArtifacts, detail: hasArtifacts ? `${task.artifacts.length} 个` : '无' });
  if (!hasArtifacts) pass = false;

  // 8. Runtime Logs 非空（Dev 任务，措施 3: 防止空 runtime_logs）
  if (task.assignee === 'dev') {
    const rl = task.verification?.runtime_logs;
    const hasRL = rl && (rl.api_requests?.length > 0 || rl.browser_checks?.length > 0 || rl.backend_logs?.length > 0);
    checks.push({ check: 'Runtime Logs', pass: !!hasRL, detail: hasRL ? '有证据' : '无' });
    if (!hasRL) pass = false;
  }

  // 9. QA Report（QA 任务，措施 3: 防止 QA_NO_REPORT 告警）
  if (task.assignee === 'qa') {
    const hasReport = !!task.verification?.qa_report;
    checks.push({ check: 'QA Report', pass: hasReport, detail: hasReport ? '有报告' : '无' });
    if (!hasReport) pass = false;
  }

  // 10. validate-task.js 格式（措施 4: 前置卡点）
  try {
    const out = execSync(`node ${path.join(__dirname, 'validate-task.js')} --pre-execute ${task.id} 2>&1`, {
      encoding: 'utf8', timeout: 10000
    });
    const hasError = out.includes('❌');
    checks.push({ check: 'Schema 校验', pass: !hasError, detail: hasError ? '有格式错误' : '合规' });
    if (hasError) pass = false;
  } catch (e) {
    const hasError = (e.stdout || '').includes('❌');
    checks.push({ check: 'Schema 校验', pass: !hasError, detail: hasError ? '有格式错误' : '合规' });
    if (hasError) pass = false;
  }

  return { taskId: task.id, pass, checks, title: task.title, assignee: task.assignee };
}

// ============================================================
// Dispatch Check: 哪些 PENDING 可以派发
// ============================================================
function dispatchCheck(tasks) {
  const statusMap = {};
  for (const t of tasks) statusMap[t.id] = (t.status || '').toUpperCase();

  const dispatchable = [];
  for (const t of tasks) {
    if ((t.status || '').toUpperCase() !== 'PENDING') continue;
    const deps = t.prerequisites || t.dependencies || [];
    const unmet = deps.filter(d => statusMap[d] && statusMap[d] !== 'DONE' && statusMap[d] !== 'REVIEW');
    if (unmet.length === 0) {
      dispatchable.push({
        taskId: t.id,
        title: t.title,
        assignee: t.assignee,
        priority: t.priority,
        wave: t.execution?.parallel_group,
        unmet_deps: [],
        ready: true
      });
    } else {
      // Track but mark not ready
      dispatchable.push({
        taskId: t.id,
        title: t.title,
        assignee: t.assignee,
        priority: t.priority,
        wave: t.execution?.parallel_group,
        unmet_deps: unmet.map(d => `${d}(${statusMap[d]})`),
        ready: false
      });
    }
  }
  return dispatchable;
}

// ============================================================
// Blocked Alert
// ============================================================
function blockedCheck(tasks) {
  const now = Date.now();
  const alerts = [];
  for (const t of tasks) {
    if ((t.status || '').toUpperCase() !== 'BLOCKED') continue;
    let lastTime = null;
    if (t.event_log?.length) {
      const last = t.event_log[t.event_log.length - 1];
      if (last.timestamp) lastTime = new Date(last.timestamp).getTime();
    }
    if (lastTime && (now - lastTime) > 4 * 3600000) {
      alerts.push({ taskId: t.id, title: t.title, blocked_hours: Math.round((now - lastTime) / 3600000) });
    }
  }
  return alerts;
}

// ============================================================
// Build Report
// ============================================================
function buildReport(tasks) {
  const now = new Date().toISOString().replace('T', ' ').substring(0, 16);

  // Gate checks
  const gateResults = tasks.map(gateCheck).filter(r => r.pass !== null);
  const passed = gateResults.filter(r => r.pass === true);
  const failed = gateResults.filter(r => r.pass === false);

  // Dispatch
  const dispatch = dispatchCheck(tasks);
  const ready = dispatch.filter(d => d.ready);
  const blocked = dispatch.filter(d => !d.ready);

  // Blocked alerts
  const blockedAlerts = blockedCheck(tasks);

  // Status summary
  const statusCount = {};
  for (const t of tasks) {
    const s = (t.status || 'UNKNOWN').toUpperCase();
    statusCount[s] = (statusCount[s] || 0) + 1;
  }

  // Determine action
  let action;
  if (failed.length > 0) action = 'GATE_FAIL';
  else if (passed.length > 0) action = 'GATE_PASS';
  else if (ready.length > 0) action = 'DISPATCH_READY';
  else if (blockedAlerts.length > 0) action = 'ALERT';
  else action = 'HEARTBEAT_OK';

  // Build notification
  let text = `【项目经理】📋 PM 定时汇报 [${now}]\n\n`;
  text += `任务总览: ${Object.entries(statusCount).sort().map(([s,c]) => `${s}:${c}`).join(' | ')}\n`;

  if (gateResults.length > 0) {
    text += `\n### 门禁检查 (${passed.length}✅ ${failed.length}❌ / ${gateResults.length} 个 REVIEW)\n`;
    for (const r of gateResults) {
      const icon = r.pass ? '✅' : '❌';
      const failedChecks = r.checks.filter(c => !c.pass).map(c => c.check);
      text += `  ${icon} ${r.taskId}${r.pass ? '' : ` — 未通过: ${failedChecks.join(', ')}`}\n`;
    }
  }

  if (passed.length > 0) {
    text += `\n### ✅ 可推进到 DONE\n`;
    for (const r of passed) text += `  → ${r.taskId}: ${r.title}\n`;
  }

  if (ready.length > 0) {
    text += `\n### 📦 可派发任务 (${ready.length} 个)\n`;
    for (const d of ready) text += `  → ${d.taskId} [${d.assignee}] ${d.title}\n`;
  }

  if (blocked.length > 0) {
    text += `\n### ⏳ 等待依赖 (${blocked.length} 个)\n`;
    for (const d of blocked) text += `  → ${d.taskId}: 等 ${d.unmet_deps.join(', ')}\n`;
  }

  if (blockedAlerts.length > 0) {
    text += `\n### 🚨 阻塞超时\n`;
    for (const a of blockedAlerts) text += `  → ${a.taskId}: 阻塞 ${a.blocked_hours}h\n`;
  }

  // Summary action line
  if (action === 'GATE_PASS') text += `\n下一步: 将 ${passed.length} 个任务推进到 DONE，然后派发 QA/下一波`;
  else if (action === 'GATE_FAIL') text += `\n下一步: ${failed.length} 个任务门禁未通过，需打回 Dev 补充`;
  else if (action === 'DISPATCH_READY') text += `\n下一步: ${ready.length} 个任务依赖已满足，可以派发`;

  return {
    action,
    timestamp: new Date().toISOString(),
    notification_text: text.trim(),
    status_summary: statusCount,
    gate_results: gateResults,
    gate_passed: passed.map(r => r.taskId),
    gate_failed: failed.map(r => ({ taskId: r.taskId, failed_checks: r.checks.filter(c => !c.pass).map(c => c.check) })),
    dispatchable: ready.map(d => ({ taskId: d.taskId, assignee: d.assignee, title: d.title, wave: d.wave })),
    waiting_deps: blocked.map(d => ({ taskId: d.taskId, unmet: d.unmet_deps })),
    blocked_alerts: blockedAlerts
  };
}

// ============================================================
// CLI
// ============================================================
const tasks = loadTasks();
const result = buildReport(tasks);

if (jsonOnly) {
  console.log(JSON.stringify(result, null, 2));
} else {
  console.log(result.notification_text);
  console.log(`\n---`);
  console.log(`action=${result.action} gate_passed=${result.gate_passed.length} gate_failed=${result.gate_failed.length} dispatchable=${result.dispatchable.length}`);
}

process.exit(result.gate_failed.length > 0 ? 1 : 0);
