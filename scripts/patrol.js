#!/usr/bin/env node
/**
 * patrol.js — Monitor Agent 统一巡检入口脚本
 * 
 * 将所有标准化检查合并为一个脚本，输出结构化 JSON 报告。
 * Monitor Agent 的 HEARTBEAT 只需：
 *   1. 运行此脚本
 *   2. 读 JSON 输出
 *   3. 决定：HEARTBEAT_OK / 通知 PM / 发飞书群
 * 
 * Usage:
 *   node patrol.js                      # 标准巡检，输出人类可读 + JSON
 *   node patrol.js --json               # 仅输出 JSON（给模型消费）
 *   node patrol.js --notify             # 巡检 + 自动生成通知文本
 *   node patrol.js --history            # 查看巡检历史
 *   node patrol.js --trends             # 查看趋势分析
 *   node patrol.js --task TASK-001      # 单任务巡检
 *   node patrol.js --diff               # 仅输出与上次巡检的差异
 * 
 * Exit codes:
 *   0 = 全部合规 → HEARTBEAT_OK
 *   1 = 有违规（ERROR）→ 通知 PM + 发群
 *   2 = 有告警（WARNING）→ 通知 PM
 * 
 * JSON 输出结构:
 *   {
 *     verdict: "OK" | "WARN" | "ERROR",
 *     action: "HEARTBEAT_OK" | "NOTIFY_PM" | "ALERT_GROUP",
 *     summary: "...",             // 一行总结
 *     notification_text: "...",   // 可直接发送的通知文本
 *     report: { ... },           // 详细报告
 *     delta: { ... },            // 与上次对比
 *     escalations: [ ... ],      // 需升级的趋势问题
 *   }
 */

const fs = require('fs');
const path = require('path');

const projectRoot = path.resolve(__dirname, '../..');
const tasksDir = path.join(projectRoot, 'tasks');
const historyDir = path.join(projectRoot, '.monitor');
const historyFile = path.join(historyDir, 'patrol-history.json');
const validateScript = path.join(__dirname, 'validate-task.js');

// ============================================================
// Args
// ============================================================
const args = process.argv.slice(2);
const hasFlag = (f) => args.includes(f);
const getArg = (f) => { const i = args.indexOf(f); return i >= 0 && i+1 < args.length ? args[i+1] : null; };

const jsonOnly = hasFlag('--json');
const showNotify = hasFlag('--notify');
const showHistory = hasFlag('--history');
const showTrends = hasFlag('--trends');
const showDiff = hasFlag('--diff');
const singleTask = getArg('--task');

// ============================================================
// Constants
// ============================================================
const VALID_STATUSES = ['PENDING', 'IN_PROGRESS', 'REVIEW', 'DONE', 'BLOCKED', 'CANCELED', 'FAILED'];
const ALLOWED_TRANSITIONS = {
  'PENDING': ['IN_PROGRESS', 'BLOCKED', 'CANCELED'],
  'IN_PROGRESS': ['REVIEW', 'BLOCKED', 'CANCELED', 'FAILED'],
  'REVIEW': ['DONE', 'IN_PROGRESS'],
  'BLOCKED': ['IN_PROGRESS', 'CANCELED'],
  'DONE': ['IN_PROGRESS'],
  'FAILED': ['IN_PROGRESS', 'CANCELED'],
  'CANCELED': ['PENDING']
};

// ============================================================
// History Manager
// ============================================================
class HistoryManager {
  constructor() { this.history = this._load(); }

  _load() {
    try {
      if (fs.existsSync(historyFile)) return JSON.parse(fs.readFileSync(historyFile, 'utf8'));
    } catch (e) { /* ignore */ }
    return { patrols: [], issue_tracker: {} };
  }

  save(result) {
    if (!fs.existsSync(historyDir)) fs.mkdirSync(historyDir, { recursive: true });
    this.history.patrols.push({
      timestamp: new Date().toISOString(),
      task_count: result.taskCount,
      violations: result.violationCount,
      warnings: result.warningCount,
      status_summary: result.statusSummary,
      completeness_scores: result.completenessScores,
      issue_keys: result.issueKeys
    });
    if (this.history.patrols.length > 100) this.history.patrols = this.history.patrols.slice(-100);

    for (const key of result.issueKeys) {
      if (!this.history.issue_tracker[key]) {
        this.history.issue_tracker[key] = { first_seen: new Date().toISOString(), last_seen: new Date().toISOString(), occurrences: 1, consecutive: 1, escalated: false };
      } else {
        const t = this.history.issue_tracker[key];
        t.last_seen = new Date().toISOString(); t.occurrences++; t.consecutive++;
      }
    }
    for (const [key, t] of Object.entries(this.history.issue_tracker)) {
      if (!result.issueKeys.includes(key)) t.consecutive = 0;
    }
    fs.writeFileSync(historyFile, JSON.stringify(this.history, null, 2));
  }

  getLast() { return this.history.patrols.length > 0 ? this.history.patrols[this.history.patrols.length - 1] : null; }
  
  getEscalations() {
    return Object.entries(this.history.issue_tracker)
      .filter(([_, t]) => t.consecutive >= 3 && !t.escalated)
      .map(([key, t]) => ({ key, ...t }));
  }

  getDelta(current) {
    const last = this.getLast();
    if (!last) return null;
    return {
      task_count: { prev: last.task_count, now: current.taskCount, delta: current.taskCount - last.task_count },
      violations: { prev: last.violations, now: current.violationCount, delta: current.violationCount - last.violations },
      warnings: { prev: last.warnings, now: current.warningCount, delta: current.warningCount - last.warnings },
      score_changes: this._scoreChanges(last.completeness_scores || {}, current.completenessScores),
      last_patrol: last.timestamp
    };
  }

  getAlertRate(windowSize = 10) {
    const recent = this.history.patrols.slice(-windowSize);
    if (recent.length === 0) return { rate: 0, alerts: 0, checks: 0, window: 0, target: 10 };
    const alerts = recent.reduce((sum, p) => sum + (p.violations || 0) + (p.warnings || 0), 0);
    const checks = recent.reduce((sum, p) => sum + (p.task_count || 0), 0);
    const rate = checks > 0 ? +(alerts / checks * 100).toFixed(1) : 0;
    return { rate, alerts, checks, window: recent.length, target: 10, pass: rate < 10 };
  }

  _scoreChanges(prev, now) {
    const improved = [], regressed = [];
    for (const [id, score] of Object.entries(now)) {
      if (prev[id] !== undefined) {
        const d = score - prev[id];
        if (d > 5) improved.push({ id, from: prev[id], to: score, delta: d });
        if (d < -5) regressed.push({ id, from: prev[id], to: score, delta: d });
      }
    }
    return { improved, regressed };
  }

  printHistory(limit = 15) {
    const p = this.history.patrols.slice(-limit);
    if (!p.length) { console.log('📜 暂无巡检历史'); return; }
    console.log(`\n📜 最近 ${p.length} 次巡检历史:\n`);
    console.log('  时间                     任务  违规  告警  状态');
    console.log('  ────────────────────────────────────────────');
    for (const e of p) {
      const t = e.timestamp.replace('T', ' ').substring(0, 19);
      const s = e.violations > 0 ? '❌' : e.warnings > 0 ? '⚠️' : '✅';
      console.log(`  ${t}  ${String(e.task_count).padStart(3)}   ${String(e.violations).padStart(2)}    ${String(e.warnings).padStart(2)}   ${s}`);
    }
  }

  printTrends() {
    const t = this.history.issue_tracker;
    const keys = Object.keys(t).filter(k => t[k].occurrences > 0);
    if (!keys.length) { console.log('📈 暂无趋势数据'); return; }
    console.log(`\n📈 问题趋势 (${keys.length} 个):\n`);
    for (const k of keys.sort((a, b) => t[b].consecutive - t[a].consecutive)) {
      const e = t[k];
      const s = e.consecutive >= 3 ? '🔴 需升级' : e.consecutive >= 2 ? '🟡 关注' : e.consecutive === 0 ? '✅ 已修复' : '🔵';
      console.log(`  ${s} ${k} — 连续${e.consecutive}次, 共${e.occurrences}次, 首次${e.first_seen.substring(0, 10)}`);
    }
  }
}

// ============================================================
// Completeness Scorer
// ============================================================
function scoreTask(task) {
  let filled = 0, total = 0;
  const chk = (v, w = 1) => {
    total += w;
    if (v !== null && v !== undefined && v !== '' && !(Array.isArray(v) && !v.length) && !(typeof v === 'object' && !Array.isArray(v) && !Object.keys(v).length)) filled += w;
  };
  chk(task.title, 2); chk(task.priority, 2); chk(task.assignee, 2); chk(task.task_class, 2);
  chk(task.spec_context?.spec_id, 1.5); chk(task.spec_context?.sections?.length ? task.spec_context.sections : null, 1.5);
  chk(task.spec_context?.acceptance_criteria?.length ? task.spec_context.acceptance_criteria : null, 2);
  chk(task.code_context?.files?.length ? task.code_context.files : null);
  chk(task.code_context?.branch); chk(task.env_context?.services?.length ? task.env_context.services : null);
  chk(task.steps?.length ? task.steps : null, 2);
  const st = (task.status || '').toUpperCase();
  if (st === 'REVIEW' || st === 'DONE') {
    chk(task.code_context?.commits?.length ? task.code_context.commits : null, 2);
    chk(task.verification?.regression_check?.homepage, 1.5);
    if (task.assignee === 'qa') { chk(task.verification?.screenshots?.length ? task.verification.screenshots : null, 2); }
  }
  if (st !== 'PENDING') chk(task.event_log?.length ? task.event_log : null, 1.5);
  chk(task.notes, 0.5);
  return Math.round((total > 0 ? filled / total : 0) * 100);
}

// ============================================================
// Checker Engine
// ============================================================
class PatrolChecker {
  constructor() {
    this.violations = []; this.warnings = []; this.tasks = [];
    this.completeness = {}; this.issueKeys = [];
  }
  error(id, cat, msg) { this.violations.push({ taskId: id, category: cat, message: msg }); this.issueKeys.push(`${id}:${cat}`); }
  warn(id, cat, msg) { this.warnings.push({ taskId: id, category: cat, message: msg }); this.issueKeys.push(`${id}:${cat}`); }

  loadTasks() {
    const files = fs.readdirSync(tasksDir).filter(f => /^TASK-\d{3}[A-Z]?\.json$/.test(f));
    for (const file of files) {
      try {
        const task = JSON.parse(fs.readFileSync(path.join(tasksDir, file), 'utf8'));
        if ((task.status || '').toUpperCase() !== 'CANCELED') this.tasks.push(task);
      } catch (e) { this.error(file, 'JSON_PARSE', `文件损坏: ${e.message}`); }
    }
    if (singleTask) {
      this.tasks = this.tasks.filter(t => t.id === singleTask);
      if (!this.tasks.length) { this.error(singleTask, 'NOT_FOUND', '任务不存在'); }
    }
  }

  // --- 11 checks ---
  check1_eventLogSync() {
    for (const t of this.tasks) {
      if ((t.status || '').toUpperCase() !== 'PENDING' && (!t.event_log || !t.event_log.length))
        this.error(t.id, 'EVENT_LOG_EMPTY', `status=${t.status} 但 event_log 为空`);
    }
  }
  check2_statusCase() {
    for (const t of this.tasks) {
      if (!VALID_STATUSES.includes(t.status || '')) {
        if (VALID_STATUSES.includes((t.status || '').toUpperCase()))
          this.warn(t.id, 'STATUS_CASE', `"${t.status}" 应为 "${(t.status || '').toUpperCase()}"`);
        else this.error(t.id, 'INVALID_STATUS', `"${t.status}" 不合法`);
      }
    }
  }
  check3_transitions() {
    for (const t of this.tasks) {
      for (const evt of (t.event_log || []).filter(e => e.type === 'status_changed' && e.payload)) {
        const from = (evt.payload.from_status || '').toUpperCase();
        const to = (evt.payload.to_status || '').toUpperCase();
        if (from && to) {
          const allowed = (ALLOWED_TRANSITIONS[from] || []);
          if (!allowed.includes(to)) this.error(t.id, 'ILLEGAL_TRANSITION', `${from} → ${to}`);
        }
      }
    }
  }
  check4_timeouts() {
    const now = Date.now();
    for (const t of this.tasks) {
      if ((t.status || '').toUpperCase() !== 'IN_PROGRESS') continue;
      const limit = (t.execution?.timeout_minutes || 60) * 60000;
      let last = null;
      if (t.event_log?.length) { const e = t.event_log[t.event_log.length - 1]; if (e.timestamp) last = new Date(e.timestamp).getTime(); }
      if (!last && t.updated) last = new Date(t.updated).getTime();
      if (last) {
        const elapsed = now - last;
        if (elapsed > limit) this.error(t.id, 'TIMEOUT', `超时 ${Math.round(elapsed/60000)}m/${Math.round(limit/60000)}m`);
        else if (elapsed > limit * 0.8) this.warn(t.id, 'NEAR_TIMEOUT', `即将超时 ${Math.round(elapsed/60000)}m/${Math.round(limit/60000)}m`);
      }
    }
  }
  check5_stuck() {
    const now = Date.now();
    for (const t of this.tasks) {
      if ((t.status || '').toUpperCase() !== 'IN_PROGRESS') continue;
      if (t.event_log?.length) {
        const last = t.event_log[t.event_log.length - 1];
        if (last.timestamp && (now - new Date(last.timestamp).getTime()) > 7200000)
          this.warn(t.id, 'STUCK', `无活动 ${Math.round((now - new Date(last.timestamp).getTime()) / 60000)}m`);
      }
    }
  }
  check6_completionCompliance() {
    for (const t of this.tasks) {
      const s = (t.status || '').toUpperCase();
      if (s !== 'DONE' && s !== 'REVIEW') continue;
      if (t.assignee === 'dev') {
        if (!t.code_context?.commits?.length) this.error(t.id, 'DEV_NO_COMMITS', '无 commit');
        const rc = t.verification?.regression_check;
        if (rc) {
          for (const f of ['homepage', 'search', 'login_logout']) {
            if (rc[f] !== 'PASS' && rc[f] !== null) this.error(t.id, 'REGRESSION_FAIL', `regression_check.${f}="${rc[f]}"`);
          }
        }
      }
      if (t.assignee === 'qa') {
        if (!t.verification?.screenshots?.length) this.error(t.id, 'QA_NO_SCREENSHOTS', '无截图');
        if (!t.verification?.qa_report) this.warn(t.id, 'QA_NO_REPORT', '无 PDF 报告');
      }
    }
  }
  check7_stepsArtifacts() {
    for (const t of this.tasks) {
      const done = (t.steps || []).filter(s => (s.status || '').toUpperCase() === 'DONE');
      if (done.length > 0 && (!t.artifacts || !t.artifacts.length))
        this.warn(t.id, 'STEPS_NO_ARTIFACTS', `${done.length} step DONE 但无 artifacts`);
    }
  }
  check8_dependencies() {
    const sm = {}; for (const t of this.tasks) sm[t.id] = (t.status || '').toUpperCase();
    for (const t of this.tasks) {
      const s = (t.status || '').toUpperCase();
      if (s === 'PENDING') continue;
      for (const dep of (t.prerequisites || t.dependencies || [])) {
        const ds = sm[dep];
        if (ds && ds !== 'DONE' && ds !== 'REVIEW' && ['IN_PROGRESS', 'REVIEW', 'DONE'].includes(s))
          this.error(t.id, 'DEP_NOT_MET', `依赖 ${dep}(${ds}) 未完成`);
      }
    }
  }
  check9_execution() {
    for (const t of this.tasks) {
      if (!t.execution) { this.warn(t.id, 'NO_EXECUTION', '缺少 execution'); continue; }
      if (!t.execution.mode) this.warn(t.id, 'NO_EXEC_MODE', 'execution.mode 缺失');
      if (!t.execution.parallel_group) this.warn(t.id, 'NO_WAVE', '无 parallel_group');
    }
  }
  check10_validateTask() {
    try {
      const { execSync } = require('child_process');
      const out = execSync(`node ${validateScript} --all 2>&1`, { encoding: 'utf8', timeout: 15000 });
      const n = (out.match(/❌/g) || []).length;
      if (n > 0) this.warn('GLOBAL', 'SCHEMA_ERRORS', `validate-task.js: ${n} 个格式错误`);
    } catch (e) {
      const n = ((e.stdout || '').match(/❌/g) || []).length;
      if (n > 0) this.warn('GLOBAL', 'SCHEMA_ERRORS', `validate-task.js: ${n} 个格式错误`);
    }
  }
  check11_completeness() {
    for (const t of this.tasks) {
      const score = scoreTask(t);
      this.completeness[t.id] = score;
      const s = (t.status || '').toUpperCase();
      if ((s === 'REVIEW' || s === 'DONE') && score < 70)
        this.warn(t.id, 'LOW_COMPLETENESS', `完成度 ${score}%（要求 ≥70%）`);
    }
  }

  runAll() {
    this.loadTasks();
    this.check1_eventLogSync();
    this.check2_statusCase();
    this.check3_transitions();
    this.check4_timeouts();
    this.check5_stuck();
    this.check6_completionCompliance();
    this.check7_stepsArtifacts();
    this.check8_dependencies();
    this.check9_execution();
    this.check10_validateTask();
    this.check11_completeness();
    return this;
  }
}

// ============================================================
// Report Builder
// ============================================================
function buildReport(checker) {
  const now = new Date().toISOString().replace('T', ' ').substring(0, 16);
  const statusSummary = {};
  const statusTasks = {};
  for (const t of checker.tasks) {
    const s = (t.status || 'UNKNOWN').toUpperCase();
    statusSummary[s] = (statusSummary[s] || 0) + 1;
    if (!statusTasks[s]) statusTasks[s] = [];
    statusTasks[s].push(t.id);
  }

  const history = new HistoryManager();
  const delta = history.getDelta({
    taskCount: checker.tasks.length,
    violationCount: checker.violations.length,
    warningCount: checker.warnings.length,
    completenessScores: checker.completeness
  });
  const escalations = history.getEscalations();

  // Determine verdict and action
  let verdict, action, exitCode;
  if (checker.violations.length > 0) {
    verdict = 'ERROR'; action = 'ALERT_GROUP'; exitCode = 1;
  } else if (checker.warnings.length > 0) {
    verdict = 'WARN'; action = 'NOTIFY_PM'; exitCode = 2;
  } else {
    verdict = 'OK'; action = 'HEARTBEAT_OK'; exitCode = 0;
  }

  // Alert rate (sliding window)
  const alertRate = history.getAlertRate(10);
  if (!alertRate.pass && action === 'HEARTBEAT_OK') action = 'NOTIFY_PM';

  // If there are escalations, always alert group
  if (escalations.length > 0 && action !== 'ALERT_GROUP') action = 'ALERT_GROUP';

  const summary = verdict === 'OK'
    ? `✅ 全部 ${checker.tasks.length} 个任务合规 (11 项检查)`
    : verdict === 'WARN'
    ? `⚠️ ${checker.warnings.length} 个告警, ${checker.tasks.length} 任务`
    : `❌ ${checker.violations.length} 个违规, ${checker.warnings.length} 个告警, ${checker.tasks.length} 任务`;

  // Build notification text
  let notifText = `【监督官】📊 巡检报告 [${now}]\n`;
  notifText += `状态: ${summary}\n\n`;

  notifText += `任务状态总览\n`;
  for (const [s, c] of Object.entries(statusSummary).sort()) {
    notifText += `  ${s}: ${c} 个 (${statusTasks[s].join(', ')})\n`;
  }

  if (checker.violations.length > 0) {
    notifText += `\n❌ 违规项 (${checker.violations.length})\n`;
    for (const v of checker.violations) notifText += `  ❌ [${v.taskId}] ${v.category}: ${v.message}\n`;
  }
  if (checker.warnings.length > 0) {
    notifText += `\n⚠️ 告警项 (${checker.warnings.length})\n`;
    for (const w of checker.warnings) notifText += `  ⚠️ [${w.taskId}] ${w.category}: ${w.message}\n`;
  }

  // Completeness (only show <80%)
  const lowScores = Object.entries(checker.completeness).filter(([_, s]) => s < 80).sort((a, b) => a[1] - b[1]);
  if (lowScores.length > 0) {
    notifText += `\n📈 需关注的完成度 (<80%)\n`;
    for (const [id, score] of lowScores) {
      const bar = '█'.repeat(Math.floor(score / 5)) + '░'.repeat(20 - Math.floor(score / 5));
      notifText += `  ${id}: ${bar} ${score}%\n`;
    }
  }

  // Alert rate display
  const rateIcon = alertRate.pass ? '✅' : '🔴';
  notifText += `\n📉 告警率 (最近${alertRate.window}次): ${rateIcon} ${alertRate.rate}% (${alertRate.alerts}/${alertRate.checks}) 目标<${alertRate.target}%\n`;

  if (delta) {
    notifText += `\n🔄 与上次对比\n`;
    notifText += `  违规: ${delta.violations.now} (${delta.violations.delta >= 0 ? '+' : ''}${delta.violations.delta})\n`;
    notifText += `  告警: ${delta.warnings.now} (${delta.warnings.delta >= 0 ? '+' : ''}${delta.warnings.delta})\n`;
    if (delta.score_changes.improved.length) notifText += `  📈 进步: ${delta.score_changes.improved.map(x => `${x.id}+${x.delta}%`).join(', ')}\n`;
    if (delta.score_changes.regressed.length) notifText += `  📉 退步: ${delta.score_changes.regressed.map(x => `${x.id}${x.delta}%`).join(', ')}\n`;
  }

  if (escalations.length > 0) {
    notifText += `\n🔴 趋势升级 (连续 3+ 次未修复)\n`;
    for (const e of escalations) notifText += `  🔴 ${e.key} — 连续${e.consecutive}次, 共${e.occurrences}次\n`;
  }

  // Save to history
  history.save({
    taskCount: checker.tasks.length,
    violationCount: checker.violations.length,
    warningCount: checker.warnings.length,
    statusSummary,
    completenessScores: checker.completeness,
    issueKeys: checker.issueKeys
  });

  // Save to memory file
  const memoryDir = path.resolve(__dirname, '../../.monitor');
  if (!fs.existsSync(memoryDir)) fs.mkdirSync(memoryDir, { recursive: true });
  const memoryFile = path.join(memoryDir, `patrol-${new Date().toISOString().substring(0, 10)}.log`);
  fs.appendFileSync(memoryFile, `\n--- [${now}] verdict=${verdict} v=${checker.violations.length} w=${checker.warnings.length} t=${checker.tasks.length}\n`);

  return {
    verdict,
    action,
    exit_code: exitCode,
    summary,
    notification_text: notifText.trim(),
    timestamp: new Date().toISOString(),
    report: {
      task_count: checker.tasks.length,
      status_summary: statusSummary,
      status_tasks: statusTasks,
      violations: checker.violations,
      warnings: checker.warnings,
      completeness_scores: checker.completeness,
      checks_run: 11
    },
    delta,
    escalations,
    alert_rate: alertRate
  };
}

// ============================================================
// CLI
// ============================================================
if (showHistory) { new HistoryManager().printHistory(); process.exit(0); }
if (showTrends) { new HistoryManager().printTrends(); process.exit(0); }

const checker = new PatrolChecker();
checker.runAll();
const result = buildReport(checker);

if (jsonOnly) {
  console.log(JSON.stringify(result, null, 2));
} else if (showDiff) {
  if (result.delta) {
    console.log(`🔄 变化: 违规 ${result.delta.violations.delta >= 0 ? '+' : ''}${result.delta.violations.delta}, 告警 ${result.delta.warnings.delta >= 0 ? '+' : ''}${result.delta.warnings.delta}`);
    if (result.delta.score_changes.improved.length) console.log(`📈 进步: ${result.delta.score_changes.improved.map(x => `${x.id}+${x.delta}%`).join(', ')}`);
    if (result.delta.score_changes.regressed.length) console.log(`📉 退步: ${result.delta.score_changes.regressed.map(x => `${x.id}${x.delta}%`).join(', ')}`);
  } else {
    console.log('ℹ️  无历史数据可对比');
  }
} else if (showNotify) {
  console.log(result.notification_text);
  console.log(`\n---`);
  console.log(`verdict: ${result.verdict}`);
  console.log(`action: ${result.action}`);
} else {
  // Default: human-readable
  console.log(result.notification_text);
  console.log(`\n---`);
  console.log(`verdict=${result.verdict} action=${result.action} exit_code=${result.exit_code}`);
}

process.exit(result.exit_code);
