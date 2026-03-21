#!/usr/bin/env node
/**
 * Monitor Agent — SOP 合规巡检脚本 v2
 * 
 * Usage:
 *   node scripts/tasks/monitor-check.js              # 完整巡检
 *   node scripts/tasks/monitor-check.js --quick       # 快速检查（只看 ERROR）
 *   node scripts/tasks/monitor-check.js --task TASK-001  # 检查单个任务
 *   node scripts/tasks/monitor-check.js --history      # 查看巡检历史
 *   node scripts/tasks/monitor-check.js --trends       # 查看趋势分析
 * 
 * Features:
 *   - 11 项合规检查（格式/状态/超时/依赖/完成度）
 *   - 巡检历史持久化（JSON，可回溯对比）
 *   - TASK 完成度评分（字段填充率）
 *   - 趋势分析（连续未修复 → 自动升级严重度）
 * 
 * Exit codes:
 *   0 = 全部合规
 *   1 = 有违规（ERROR）
 *   2 = 有告警（WARNING）
 */

const fs = require('fs');
const path = require('path');

const tasksDir = path.resolve(__dirname, '../../tasks');
const historyDir = path.resolve(__dirname, '../../.monitor');
const historyFile = path.join(historyDir, 'patrol-history.json');

// Parse args
const args = process.argv.slice(2);
const hasFlag = (flag) => args.includes(flag);
const getArg = (flag) => { const i = args.indexOf(flag); return i >= 0 && i+1 < args.length ? args[i+1] : null; };

const quickMode = hasFlag('--quick');
const singleTask = getArg('--task');
const showHistory = hasFlag('--history');
const showTrends = hasFlag('--trends');

// 合法状态转换表
const ALLOWED_TRANSITIONS = {
  'PENDING':      ['IN_PROGRESS', 'BLOCKED', 'CANCELED'],
  'IN_PROGRESS':  ['REVIEW', 'BLOCKED', 'CANCELED', 'FAILED'],
  'REVIEW':       ['DONE', 'IN_PROGRESS'],
  'BLOCKED':      ['IN_PROGRESS', 'CANCELED'],
  'DONE':         ['IN_PROGRESS'],
  'FAILED':       ['IN_PROGRESS', 'CANCELED'],
  'CANCELED':     ['PENDING']
};

// ============================================================
// History Manager — 巡检历史持久化
// ============================================================
class HistoryManager {
  constructor() {
    this.history = this._load();
  }

  _load() {
    try {
      if (fs.existsSync(historyFile)) {
        return JSON.parse(fs.readFileSync(historyFile, 'utf8'));
      }
    } catch (e) { /* ignore */ }
    return { patrols: [], issue_tracker: {} };
  }

  save(patrolResult) {
    if (!fs.existsSync(historyDir)) {
      fs.mkdirSync(historyDir, { recursive: true });
    }

    const entry = {
      timestamp: new Date().toISOString(),
      task_count: patrolResult.taskCount,
      violations: patrolResult.violations,
      warnings: patrolResult.warnings,
      status_summary: patrolResult.statusSummary,
      completeness_scores: patrolResult.completenessScores,
      issue_keys: patrolResult.issueKeys
    };

    this.history.patrols.push(entry);
    // Keep last 100 patrols
    if (this.history.patrols.length > 100) {
      this.history.patrols = this.history.patrols.slice(-100);
    }

    // Update issue tracker (for trend analysis)
    for (const key of patrolResult.issueKeys) {
      if (!this.history.issue_tracker[key]) {
        this.history.issue_tracker[key] = {
          first_seen: new Date().toISOString(),
          last_seen: new Date().toISOString(),
          occurrences: 1,
          consecutive: 1,
          escalated: false
        };
      } else {
        const tracker = this.history.issue_tracker[key];
        tracker.last_seen = new Date().toISOString();
        tracker.occurrences += 1;
        tracker.consecutive += 1;
      }
    }

    // Reset consecutive count for issues NOT seen this patrol
    for (const [key, tracker] of Object.entries(this.history.issue_tracker)) {
      if (!patrolResult.issueKeys.includes(key)) {
        tracker.consecutive = 0;
      }
    }

    fs.writeFileSync(historyFile, JSON.stringify(this.history, null, 2));
  }

  getLastPatrol() {
    return this.history.patrols.length > 0 
      ? this.history.patrols[this.history.patrols.length - 1] 
      : null;
  }

  getEscalations() {
    const escalations = [];
    for (const [key, tracker] of Object.entries(this.history.issue_tracker)) {
      if (tracker.consecutive >= 3 && !tracker.escalated) {
        escalations.push({ key, ...tracker });
      }
    }
    return escalations;
  }

  printHistory(limit = 10) {
    const patrols = this.history.patrols.slice(-limit);
    if (patrols.length === 0) {
      console.log('📜 暂无巡检历史');
      return;
    }
    console.log(`\n📜 最近 ${patrols.length} 次巡检历史:\n`);
    console.log('  时间                     任务数  违规  告警  状态');
    console.log('  ─────────────────────────────────────────────────');
    for (const p of patrols) {
      const t = p.timestamp.replace('T', ' ').substring(0, 19);
      const status = p.violations > 0 ? '❌' : p.warnings > 0 ? '⚠️' : '✅';
      console.log(`  ${t}   ${String(p.task_count).padStart(3)}    ${String(p.violations).padStart(2)}    ${String(p.warnings).padStart(2)}   ${status}`);
    }
  }

  printTrends() {
    const tracker = this.history.issue_tracker;
    const keys = Object.keys(tracker).filter(k => tracker[k].occurrences > 0);
    if (keys.length === 0) {
      console.log('📈 暂无趋势数据（需要多次巡检积累）');
      return;
    }
    console.log(`\n📈 问题趋势分析 (${keys.length} 个已知问题):\n`);
    console.log('  问题 Key                              出现次数  连续  首次发现              状态');
    console.log('  ────────────────────────────────────────────────────────────────────────────────');
    for (const key of keys.sort((a, b) => tracker[b].consecutive - tracker[a].consecutive)) {
      const t = tracker[key];
      const first = t.first_seen.substring(0, 10);
      const status = t.consecutive >= 3 ? '🔴 需升级' : t.consecutive >= 2 ? '🟡 关注' : t.consecutive === 0 ? '✅ 已修复' : '🔵 新发现';
      console.log(`  ${key.padEnd(40)} ${String(t.occurrences).padStart(4)}     ${String(t.consecutive).padStart(2)}   ${first}   ${status}`);
    }
  }
}

// ============================================================
// Completeness Scorer — TASK 完成度评分
// ============================================================
function scoreCompleteness(task) {
  let filled = 0;
  let total = 0;

  const check = (val, weight = 1) => {
    total += weight;
    if (val !== null && val !== undefined && val !== '' && 
        !(Array.isArray(val) && val.length === 0) &&
        !(typeof val === 'object' && !Array.isArray(val) && Object.keys(val).length === 0)) {
      filled += weight;
    }
  };

  // Core fields (weight 2)
  check(task.title, 2);
  check(task.priority, 2);
  check(task.assignee, 2);
  check(task.task_class, 2);

  // Spec context (weight 1.5)
  check(task.spec_context?.spec_id, 1.5);
  check(task.spec_context?.sections?.length > 0 ? task.spec_context.sections : null, 1.5);
  check(task.spec_context?.acceptance_criteria?.length > 0 ? task.spec_context.acceptance_criteria : null, 2);
  check(task.spec_context?.spec_file, 1);

  // Code context
  check(task.code_context?.files?.length > 0 ? task.code_context.files : null);
  check(task.code_context?.branch);

  // Env context
  check(task.env_context?.services?.length > 0 ? task.env_context.services : null);
  check(task.env_context?.docker_compose);

  // Steps (weight 2)
  check(task.steps?.length > 0 ? task.steps : null, 2);

  // Verification (conditional on status)
  const status = (task.status || '').toUpperCase();
  if (status === 'REVIEW' || status === 'DONE') {
    check(task.code_context?.commits?.length > 0 ? task.code_context.commits : null, 2);
    check(task.verification?.regression_check?.homepage, 1.5);
    if (task.assignee === 'qa') {
      check(task.verification?.screenshots?.length > 0 ? task.verification.screenshots : null, 2);
      check(task.verification?.qa_report, 1.5);
    }
  }

  // Event log (conditional)
  if (status !== 'PENDING') {
    check(task.event_log?.length > 0 ? task.event_log : null, 1.5);
  }

  // Notes (optional but nice)
  check(task.notes, 0.5);

  const score = total > 0 ? Math.round((filled / total) * 100) : 0;
  return { score, filled: Math.round(filled * 10) / 10, total: Math.round(total * 10) / 10 };
}

// ============================================================
// ComplianceChecker — 核心巡检引擎
// ============================================================
class ComplianceChecker {
  constructor() {
    this.violations = [];
    this.warnings = [];
    this.info = [];
    this.tasks = [];
    this.completenessScores = {};
    this.issueKeys = [];
  }

  error(taskId, category, msg) {
    this.violations.push({ taskId, category, msg });
    this.issueKeys.push(`${taskId}:${category}`);
  }
  warn(taskId, category, msg) {
    this.warnings.push({ taskId, category, msg });
    this.issueKeys.push(`${taskId}:${category}`);
  }

  loadTasks() {
    const files = fs.readdirSync(tasksDir).filter(f => /^TASK-\d{3}[A-Z]?\.json$/.test(f));
    for (const file of files) {
      try {
        const raw = fs.readFileSync(path.join(tasksDir, file), 'utf8');
        const task = JSON.parse(raw);
        if ((task.status || '').toUpperCase() !== 'CANCELED') {
          this.tasks.push(task);
        }
      } catch (e) {
        this.error(file, 'JSON_PARSE', `文件解析失败: ${e.message}`);
      }
    }
  }

  // === Check 1: Event Log 同步 ===
  checkEventLogSync() {
    for (const t of this.tasks) {
      const status = (t.status || '').toUpperCase();
      if (status !== 'PENDING' && (!t.event_log || t.event_log.length === 0)) {
        this.error(t.id, 'EVENT_LOG_EMPTY', `status="${t.status}" 但 event_log 为空`);
      }
    }
  }

  // === Check 2: 状态大小写规范 ===
  checkStatusNormalization() {
    const VALID = ['PENDING', 'IN_PROGRESS', 'REVIEW', 'DONE', 'BLOCKED', 'CANCELED', 'FAILED'];
    for (const t of this.tasks) {
      if (!VALID.includes(t.status || '')) {
        if (VALID.includes((t.status || '').toUpperCase())) {
          this.warn(t.id, 'STATUS_CASE', `status="${t.status}" 应为 "${(t.status || '').toUpperCase()}"`);
        } else {
          this.error(t.id, 'INVALID_STATUS', `status="${t.status}" 不合法`);
        }
      }
    }
  }

  // === Check 3: 状态转换合法性 ===
  checkStateTransitions() {
    for (const t of this.tasks) {
      if (!t.event_log || !Array.isArray(t.event_log)) continue;
      for (const evt of t.event_log) {
        if (evt.type === 'status_changed' && evt.payload) {
          const from = (evt.payload.from_status || '').toUpperCase();
          const to = (evt.payload.to_status || '').toUpperCase();
          if (from && to) {
            const allowed = (ALLOWED_TRANSITIONS[from] || []).map(s => s.toUpperCase());
            if (!allowed.includes(to)) {
              this.error(t.id, 'ILLEGAL_TRANSITION', `${from} → ${to}（允许: ${allowed.join('/')}）`);
            }
          }
        }
      }
    }
  }

  // === Check 4: 超时检测 ===
  checkTimeouts() {
    const now = Date.now();
    for (const t of this.tasks) {
      if ((t.status || '').toUpperCase() !== 'IN_PROGRESS') continue;
      const timeoutMin = t.execution?.timeout_minutes || 60;
      let lastTime = null;
      if (t.event_log?.length > 0) {
        const last = t.event_log[t.event_log.length - 1];
        if (last.timestamp) lastTime = new Date(last.timestamp).getTime();
      }
      if (!lastTime && t.updated) lastTime = new Date(t.updated).getTime();
      if (lastTime) {
        const elapsed = (now - lastTime) / 60000;
        if (elapsed > timeoutMin) {
          this.error(t.id, 'TIMEOUT', `IN_PROGRESS 超时: ${Math.round(elapsed)}m > ${timeoutMin}m`);
        } else if (elapsed > timeoutMin * 0.8) {
          this.warn(t.id, 'NEAR_TIMEOUT', `即将超时: ${Math.round(elapsed)}m / ${timeoutMin}m`);
        }
      }
    }
  }

  // === Check 5: 卡住检测 ===
  checkStuck() {
    const now = Date.now();
    for (const t of this.tasks) {
      if ((t.status || '').toUpperCase() !== 'IN_PROGRESS') continue;
      if (t.event_log?.length > 0) {
        const last = t.event_log[t.event_log.length - 1];
        if (last.timestamp) {
          const elapsed = now - new Date(last.timestamp).getTime();
          if (elapsed > 2 * 3600000) {
            this.warn(t.id, 'STUCK', `IN_PROGRESS 且最后 event 距今 ${Math.round(elapsed / 60000)}m`);
          }
        }
      }
    }
  }

  // === Check 6: 完成态合规 ===
  checkCompletionCompliance() {
    for (const t of this.tasks) {
      const status = (t.status || '').toUpperCase();
      if (status !== 'DONE' && status !== 'REVIEW') continue;
      if (t.assignee === 'dev') {
        if (!t.code_context?.commits?.length) {
          this.error(t.id, 'DEV_NO_COMMITS', 'Dev 完成但没有 commit');
        }
        const rl = t.verification?.runtime_logs;
        if (rl) {
          const total = (rl.api_requests?.length || 0) + (rl.browser_checks?.length || 0) + (rl.backend_logs?.length || 0);
          if (total === 0) this.error(t.id, 'DEV_NO_RUNTIME', 'Dev 完成但没有 runtime 证据');
        }
        const rc = t.verification?.regression_check;
        if (rc) {
          for (const key of ['homepage', 'search', 'login_logout']) {
            if (rc[key] !== 'PASS' && rc[key] !== null) {
              this.error(t.id, 'REGRESSION_FAIL', `regression_check.${key} = "${rc[key]}"（须为 PASS）`);
            }
          }
        }
      }
      if (t.assignee === 'qa') {
        if (!t.verification?.screenshots?.length) this.error(t.id, 'QA_NO_SCREENSHOTS', 'QA 完成但没有截图');
        if (!t.verification?.qa_report) this.warn(t.id, 'QA_NO_REPORT', 'QA 完成但没有 PDF 报告');
      }
    }
  }

  // === Check 7: Steps vs Artifacts ===
  checkStepsArtifacts() {
    for (const t of this.tasks) {
      if (!t.steps) continue;
      const done = t.steps.filter(s => (s.status || '').toUpperCase() === 'DONE');
      if (done.length > 0 && (!t.artifacts || t.artifacts.length === 0)) {
        this.warn(t.id, 'STEPS_NO_ARTIFACTS', `${done.length} 个 Step DONE 但 artifacts 为空`);
      }
    }
  }

  // === Check 8: 依赖一致性 ===
  checkDependencies() {
    const statusMap = {};
    for (const t of this.tasks) statusMap[t.id] = (t.status || '').toUpperCase();
    for (const t of this.tasks) {
      const status = (t.status || '').toUpperCase();
      if (status === 'PENDING') continue;
      const deps = t.prerequisites || t.dependencies || [];
      if (Array.isArray(deps)) {
        for (const dep of deps) {
          const depStatus = statusMap[dep];
          if (depStatus && depStatus !== 'DONE' && depStatus !== 'REVIEW') {
            if (['IN_PROGRESS', 'REVIEW', 'DONE'].includes(status)) {
              this.error(t.id, 'DEP_NOT_MET', `依赖 ${dep}(${depStatus}) 未完成但本任务已 ${status}`);
            }
          }
        }
      }
    }
  }

  // === Check 9: execution 字段 ===
  checkExecution() {
    for (const t of this.tasks) {
      if (!t.execution) { this.warn(t.id, 'NO_EXECUTION', '缺少 execution 字段'); continue; }
      if (!t.execution.mode) this.warn(t.id, 'NO_EXEC_MODE', 'execution.mode 缺失');
      if (!t.execution.parallel_group) this.warn(t.id, 'NO_WAVE', 'execution.parallel_group 缺失');
    }
  }

  // === Check 10: validate-task.js 集成 ===
  checkValidateTask() {
    try {
      const { execSync } = require('child_process');
      const output = execSync(`node ${path.resolve(__dirname, 'validate-task.js')} --all 2>&1`, {
        encoding: 'utf8', timeout: 15000
      });
      const errCount = (output.match(/❌/g) || []).length;
      if (errCount > 0) {
        this.warn('GLOBAL', 'SCHEMA_ERRORS', `validate-task.js 发现 ${errCount} 个格式错误`);
      }
    } catch (e) {
      const output = e.stdout || '';
      const errCount = (output.match(/❌/g) || []).length;
      if (errCount > 0) {
        this.warn('GLOBAL', 'SCHEMA_ERRORS', `validate-task.js 发现 ${errCount} 个格式错误`);
      }
    }
  }

  // === Check 11: 完成度评分 ===
  checkCompleteness() {
    for (const t of this.tasks) {
      const { score } = scoreCompleteness(t);
      this.completenessScores[t.id] = score;
      const status = (t.status || '').toUpperCase();
      // REVIEW/DONE 任务低于 70% 是问题
      if ((status === 'REVIEW' || status === 'DONE') && score < 70) {
        this.warn(t.id, 'LOW_COMPLETENESS', `完成度仅 ${score}%（REVIEW/DONE 要求 ≥70%）`);
      }
    }
  }

  // === 执行全部检查 ===
  runAll() {
    this.loadTasks();
    if (singleTask) {
      this.tasks = this.tasks.filter(t => t.id === singleTask);
      if (this.tasks.length === 0) {
        console.error(`❌ 未找到任务: ${singleTask}`);
        process.exit(2);
      }
    }
    this.checkEventLogSync();
    this.checkStatusNormalization();
    this.checkStateTransitions();
    this.checkTimeouts();
    this.checkStuck();
    this.checkCompletionCompliance();
    this.checkStepsArtifacts();
    this.checkDependencies();
    this.checkExecution();
    this.checkValidateTask();
    this.checkCompleteness();
    return this;
  }

  // === 生成报告 ===
  report() {
    const now = new Date().toISOString().replace('T', ' ').substring(0, 16);
    const statusCount = {};
    const statusTasks = {};
    for (const t of this.tasks) {
      const s = (t.status || 'UNKNOWN').toUpperCase();
      statusCount[s] = (statusCount[s] || 0) + 1;
      if (!statusTasks[s]) statusTasks[s] = [];
      statusTasks[s].push(t.id);
    }

    let overallStatus = '✅ 全部合规';
    let exitCode = 0;
    if (this.violations.length > 0) {
      overallStatus = `❌ 有 ${this.violations.length} 个违规`;
      exitCode = 1;
    } else if (this.warnings.length > 0) {
      overallStatus = `⚠️ 有 ${this.warnings.length} 个告警`;
      exitCode = 2;
    }

    console.log(`\n📊 巡检报告 [${now}]`);
    console.log(`状态: ${overallStatus}`);

    // === Status summary with task IDs ===
    console.log(`\n### 任务状态总览`);
    for (const [status, count] of Object.entries(statusCount).sort()) {
      const ids = statusTasks[status].join(', ');
      console.log(`  ${status}: ${count} 个 (${ids})`);
    }

    // === Violations ===
    if (this.violations.length > 0) {
      console.log(`\n### ❌ 违规项 (${this.violations.length})`);
      for (const v of this.violations) {
        console.log(`  ❌ [${v.taskId}] ${v.category}: ${v.msg}`);
      }
    }

    // === Warnings ===
    if (this.warnings.length > 0) {
      console.log(`\n### ⚠️ 告警项 (${this.warnings.length})`);
      for (const w of this.warnings) {
        console.log(`  ⚠️  [${w.taskId}] ${w.category}: ${w.msg}`);
      }
    }

    // === Completeness scores ===
    console.log(`\n### 📈 任务完成度评分`);
    const sorted = Object.entries(this.completenessScores).sort((a, b) => a[1] - b[1]);
    for (const [id, score] of sorted) {
      const bar = '█'.repeat(Math.floor(score / 5)) + '░'.repeat(20 - Math.floor(score / 5));
      const emoji = score >= 80 ? '🟢' : score >= 60 ? '🟡' : '🔴';
      console.log(`  ${emoji} ${id}: ${bar} ${score}%`);
    }

    // === Delta from last patrol ===
    const history = new HistoryManager();
    const last = history.getLastPatrol();
    if (last) {
      console.log(`\n### 🔄 与上次巡检对比`);
      const vDelta = this.violations.length - last.violations;
      const wDelta = this.warnings.length - last.warnings;
      const tDelta = this.tasks.length - last.task_count;
      console.log(`  任务数: ${this.tasks.length} (${tDelta >= 0 ? '+' : ''}${tDelta})`);
      console.log(`  违规数: ${this.violations.length} (${vDelta >= 0 ? '+' : ''}${vDelta})`);
      console.log(`  告警数: ${this.warnings.length} (${wDelta >= 0 ? '+' : ''}${wDelta})`);
      
      // Score deltas
      if (last.completeness_scores) {
        const improved = [];
        const regressed = [];
        for (const [id, score] of Object.entries(this.completenessScores)) {
          const prev = last.completeness_scores[id];
          if (prev !== undefined) {
            const delta = score - prev;
            if (delta > 5) improved.push(`${id} +${delta}%`);
            if (delta < -5) regressed.push(`${id} ${delta}%`);
          }
        }
        if (improved.length > 0) console.log(`  📈 进步: ${improved.join(', ')}`);
        if (regressed.length > 0) console.log(`  📉 退步: ${regressed.join(', ')}`);
      }
    }

    // === Trend escalations ===
    const escalations = history.getEscalations();
    if (escalations.length > 0) {
      console.log(`\n### 🔴 趋势升级（连续 3+ 次巡检未修复）`);
      for (const e of escalations) {
        console.log(`  🔴 ${e.key} — 连续 ${e.consecutive} 次，首次 ${e.first_seen.substring(0, 10)}，共 ${e.occurrences} 次`);
      }
    }

    if (this.violations.length === 0 && this.warnings.length === 0) {
      console.log(`\n✅ 全部 ${this.tasks.length} 个活跃任务合规`);
    }

    console.log(`\n总计: ${this.tasks.length} 任务, ${this.violations.length} 违规, ${this.warnings.length} 告警, 11 项检查`);

    // Save to history
    history.save({
      taskCount: this.tasks.length,
      violations: this.violations.length,
      warnings: this.warnings.length,
      statusSummary: statusCount,
      completenessScores: this.completenessScores,
      issueKeys: this.issueKeys
    });

    return exitCode;
  }
}

// ============================================================
// CLI Entry
// ============================================================
if (showHistory) {
  new HistoryManager().printHistory();
  process.exit(0);
}

if (showTrends) {
  new HistoryManager().printTrends();
  process.exit(0);
}

const checker = new ComplianceChecker();
checker.runAll();
const exitCode = checker.report();
process.exit(exitCode);
