#!/usr/bin/env node
/**
 * TASK JSON Validator — SOP v2.1 合规检查
 * 
 * Usage:
 *   node scripts/tasks/validate-task.js TASK-001          # 验证单个
 *   node scripts/tasks/validate-task.js --all              # 验证全部
 *   node scripts/tasks/validate-task.js --pre-execute TASK-001  # Agent 执行前检查
 * 
 * Exit codes:
 *   0 = 全部通过
 *   1 = 有 ERROR（阻塞执行）
 *   2 = 有 WARNING（允许执行但需注意）
 */

const fs = require('fs');
const path = require('path');

// ============================================================
// Schema 定义
// ============================================================

const VALID_PRIORITIES = ['P0', 'P1', 'P2'];
const VALID_STATUSES = ['pending', 'PENDING', 'in_progress', 'IN_PROGRESS', 'blocked', 'BLOCKED', 'review', 'REVIEW', 'done', 'DONE', 'failed', 'FAILED', 'canceled', 'CANCELED'];
const VALID_ASSIGNEES = ['dev', 'qa', 'po', 'pm'];
const VALID_TASK_CLASSES = ['security', 'feature', 'migration', 'ui-only', 'bugfix', 'infra'];
const VALID_RUNTIME_LEVELS = ['local', 'docker'];
const VALID_STEP_TYPES = ['read_spec', 'research', 'plan', 'implement', 'test', 'runtime_verify', 'review', 'deploy', 'commit'];
const VALID_STEP_STATUSES = ['PENDING', 'READY', 'RUNNING', 'DONE', 'FAILED', 'WAITING_HUMAN'];

const ALLOWED_TRANSITIONS = {
  'pending': ['in_progress', 'blocked', 'canceled'],
  'PENDING': ['IN_PROGRESS', 'BLOCKED', 'CANCELED'],
  'in_progress': ['review', 'blocked', 'canceled', 'failed'],
  'IN_PROGRESS': ['REVIEW', 'BLOCKED', 'CANCELED', 'FAILED'],
  'review': ['done', 'in_progress'],
  'REVIEW': ['DONE', 'IN_PROGRESS'],
  'blocked': ['in_progress', 'canceled'],
  'BLOCKED': ['IN_PROGRESS', 'CANCELED'],
  'done': ['in_progress'],
  'DONE': ['IN_PROGRESS'],
  'failed': ['in_progress', 'canceled'],
  'FAILED': ['IN_PROGRESS', 'CANCELED'],
  'canceled': ['pending'],
  'CANCELED': ['PENDING']
};

const VALID_EXECUTION_MODES = ['subagent', 'inline'];

// ============================================================
// Validation Rules
// ============================================================

class TaskValidator {
  constructor(task, filename) {
    this.task = task;
    this.filename = filename;
    this.errors = [];    // 阻塞执行
    this.warnings = [];  // 允许执行但需注意
    this.info = [];      // 信息提示
  }

  error(field, msg) { this.errors.push({ level: 'ERROR', field, msg }); }
  warn(field, msg) { this.warnings.push({ level: 'WARN', field, msg }); }
  note(field, msg) { this.info.push({ level: 'INFO', field, msg }); }

  // --- 必填字段检查 ---
  checkRequired() {
    const required = ['id', 'title', 'priority', 'status', 'assignee', 'task_class', 'runtime_level', 'execution', 'spec_context', 'code_context', 'env_context', 'verification', 'steps', 'artifacts', 'event_log'];
    for (const field of required) {
      if (this.task[field] === undefined || this.task[field] === null) {
        this.error(field, `必填字段缺失`);
      }
    }
  }

  // --- 枚举值检查 ---
  checkEnums() {
    const t = this.task;
    if (t.priority && !VALID_PRIORITIES.includes(t.priority)) {
      this.error('priority', `无效值 "${t.priority}"，允许: ${VALID_PRIORITIES.join('/')}`);
    }
    if (t.status && !VALID_STATUSES.includes(t.status)) {
      this.error('status', `无效值 "${t.status}"，允许: ${VALID_STATUSES.join('/')}`);
    }
    if (t.assignee && !VALID_ASSIGNEES.includes(t.assignee)) {
      this.error('assignee', `无效值 "${t.assignee}"，允许: ${VALID_ASSIGNEES.join('/')}`);
    }
    if (t.task_class && !VALID_TASK_CLASSES.includes(t.task_class)) {
      this.error('task_class', `无效值 "${t.task_class}"，允许: ${VALID_TASK_CLASSES.join('/')}`);
    }
    if (t.runtime_level && !VALID_RUNTIME_LEVELS.includes(t.runtime_level)) {
      this.error('runtime_level', `无效值 "${t.runtime_level}"，允许: ${VALID_RUNTIME_LEVELS.join('/')}`);
    }
  }

  // --- ID 格式检查 ---
  checkIdFormat() {
    const t = this.task;
    if (t.id && !/^TASK-\d{3}[A-Z]?$/.test(t.id)) {
      this.error('id', `格式不符 "${t.id}"，应为 TASK-XXX 或 TASK-XXXA`);
    }
    // 检查文件名与 ID 一致
    const expectedFile = `${t.id}.json`;
    if (this.filename && !this.filename.endsWith(expectedFile)) {
      this.warn('id', `文件名 "${this.filename}" 与 ID "${t.id}" 不匹配（期望 ${expectedFile}）`);
    }
  }

  // --- spec_context 检查 ---
  checkSpecContext() {
    const sc = this.task.spec_context;
    if (!sc) return;

    if (!sc.spec_id) this.error('spec_context.spec_id', '缺失');
    if (!sc.sections || !Array.isArray(sc.sections) || sc.sections.length === 0) {
      this.error('spec_context.sections', '必须是非空数组');
    }
    if (!sc.acceptance_criteria || !Array.isArray(sc.acceptance_criteria) || sc.acceptance_criteria.length === 0) {
      this.error('spec_context.acceptance_criteria', '必须是非空数组（AC 是验收标准，不能为空）');
    }
    if (!sc.spec_file) {
      this.warn('spec_context.spec_file', '建议填写 Spec 文件路径');
    }

    // AC 格式检查
    if (sc.acceptance_criteria) {
      for (let i = 0; i < sc.acceptance_criteria.length; i++) {
        const ac = sc.acceptance_criteria[i];
        if (!/^AC-/.test(ac)) {
          this.warn(`spec_context.acceptance_criteria[${i}]`, `建议以 "AC-" 前缀开头: "${ac.substring(0, 50)}..."`);
        }
      }
    }
  }

  // --- code_context 检查 ---
  checkCodeContext() {
    const cc = this.task.code_context;
    if (!cc) return;

    if (!cc.files || !Array.isArray(cc.files)) {
      this.error('code_context.files', '必须是数组');
    }
    if (!cc.branch) {
      this.warn('code_context.branch', '建议填写分支名');
    }
    if (!cc.commits || !Array.isArray(cc.commits)) {
      this.warn('code_context.commits', '应为数组（执行后填充）');
    }
  }

  // --- env_context 检查 ---
  checkEnvContext() {
    const ec = this.task.env_context;
    if (!ec) return;

    if (!ec.services || !Array.isArray(ec.services) || ec.services.length === 0) {
      this.warn('env_context.services', '建议列出涉及的服务');
    }
    if (!ec.urls || typeof ec.urls !== 'object') {
      this.warn('env_context.urls', '建议填写验证 URL');
    }
    if (!ec.test_accounts || typeof ec.test_accounts !== 'object') {
      this.warn('env_context.test_accounts', '建议填写测试账号');
    }
    if (!ec.docker_compose) {
      if (this.task.runtime_level === 'docker') {
        this.error('env_context.docker_compose', 'runtime_level=docker 时必须填写 docker_compose 路径');
      }
    }
  }

  // --- steps 检查 ---
  checkSteps() {
    const steps = this.task.steps;
    if (!steps || !Array.isArray(steps)) return;

    if (steps.length === 0) {
      this.error('steps', '不能为空数组（至少需要 1 个 Step）');
      return;
    }

    const stepIds = new Set();
    for (let i = 0; i < steps.length; i++) {
      const s = steps[i];
      const prefix = `steps[${i}]`;

      // 必填字段
      if (!s.step_id) this.error(`${prefix}.step_id`, '缺失');
      if (!s.type) this.error(`${prefix}.type`, '缺失');
      if (!s.title) this.error(`${prefix}.title`, '缺失');
      if (!s.status) this.error(`${prefix}.status`, '缺失');

      // 枚举检查
      if (s.type && !VALID_STEP_TYPES.includes(s.type)) {
        this.warn(`${prefix}.type`, `"${s.type}" 不在标准类型中: ${VALID_STEP_TYPES.join('/')}`);
      }
      if (s.status && !VALID_STEP_STATUSES.includes(s.status)) {
        this.error(`${prefix}.status`, `无效值 "${s.status}"，允许: ${VALID_STEP_STATUSES.join('/')}`);
      }

      // ID 唯一性
      if (s.step_id) {
        if (stepIds.has(s.step_id)) {
          this.error(`${prefix}.step_id`, `重复 step_id: "${s.step_id}"`);
        }
        stepIds.add(s.step_id);
      }

      // parallel 字段类型检查
      if (s.parallel !== undefined && typeof s.parallel !== 'boolean') {
        this.warn(`${prefix}.parallel`, `应为 boolean（当前: ${typeof s.parallel}）`);
      }

      // 依赖检查
      if (s.inputs?.depends_on_steps) {
        for (const dep of s.inputs.depends_on_steps) {
          if (!stepIds.has(dep) && !steps.some(x => x.step_id === dep)) {
            this.warn(`${prefix}.inputs.depends_on_steps`, `引用了不存在的 step: "${dep}"（可能定义在后面）`);
          }
        }
      }
    }

    // security 任务 + dev assignee 必须有 test 类型 step
    if (this.task.task_class === 'security' && this.task.assignee === 'dev') {
      const hasTest = steps.some(s => s.type === 'test');
      if (!hasTest) {
        this.error('steps', 'security + dev 任务必须包含 type="test" 的 Step（TDD 要求）');
      }
    }

    // 所有任务必须有 runtime_verify step（除非 CANCELED）
    const status = (this.task.status || '').toUpperCase();
    if (status !== 'CANCELED') {
      const hasVerify = steps.some(s => s.type === 'runtime_verify');
      if (!hasVerify) {
        this.warn('steps', '建议包含 type="runtime_verify" 的 Step');
      }
    }
  }

  // --- verification 检查 ---
  checkVerification() {
    const v = this.task.verification;
    if (!v) return;

    if (!v.runtime_logs) {
      this.error('verification.runtime_logs', '缺失（v2.1 必填）');
    } else {
      if (!v.runtime_logs.api_requests) this.warn('verification.runtime_logs.api_requests', '建议初始化为 []');
      if (!v.runtime_logs.browser_checks) this.warn('verification.runtime_logs.browser_checks', '建议初始化为 []');
      if (!v.runtime_logs.backend_logs) this.warn('verification.runtime_logs.backend_logs', '建议初始化为 []');
    }

    if (!v.regression_check) {
      this.error('verification.regression_check', '缺失（v2.1 必填）');
    } else {
      const rc = v.regression_check;
      if (!('homepage' in rc)) this.warn('verification.regression_check.homepage', '缺失');
      if (!('search' in rc)) this.warn('verification.regression_check.search', '缺失');
      if (!('login_logout' in rc)) this.warn('verification.regression_check.login_logout', '缺失');
    }
  }

  // --- artifacts 检查 ---
  checkArtifacts() {
    if (!Array.isArray(this.task.artifacts)) {
      this.error('artifacts', '必须是数组');
    }
  }

  // --- event_log 检查 ---
  checkEventLog() {
    if (!Array.isArray(this.task.event_log)) {
      this.error('event_log', '必须是数组');
    }
  }

  // --- execution 检查 ---
  checkExecution() {
    const ex = this.task.execution;
    if (!ex) return;

    if (!ex.mode) {
      this.error('execution.mode', '缺失（必须是 subagent 或 inline）');
    } else if (!VALID_EXECUTION_MODES.includes(ex.mode)) {
      this.error('execution.mode', `无效值 "${ex.mode}"，允许: ${VALID_EXECUTION_MODES.join('/')}`);
    }

    if (!ex.parallel_group) {
      this.warn('execution.parallel_group', '建议填写 parallel_group（如 wave-1）用于 PM 调度');
    }

    if (ex.timeout_minutes !== undefined) {
      if (typeof ex.timeout_minutes !== 'number' || ex.timeout_minutes <= 0) {
        this.error('execution.timeout_minutes', `必须是正数（当前: ${ex.timeout_minutes}）`);
      }
    } else {
      this.warn('execution.timeout_minutes', '建议设置超时时间（默认 60 分钟）');
    }

    if (ex.max_retries !== undefined) {
      if (typeof ex.max_retries !== 'number' || ex.max_retries < 0) {
        this.error('execution.max_retries', `必须是非负整数（当前: ${ex.max_retries}）`);
      }
    }
  }

  // --- worktree 检查 ---
  checkWorktree() {
    const wt = this.task.worktree;
    if (!wt) {
      // v2.3 field, warn if missing
      if (this.task.assignee === 'dev') {
        this.warn('worktree', 'Dev 任务建议配置 worktree 分支隔离（v2.3）');
      }
      return;
    }

    if (this.task.assignee === 'dev' && wt.enabled) {
      if (!wt.branch) {
        this.error('worktree.branch', 'Dev 任务 worktree.enabled=true 但缺少 branch');
      } else if (!wt.branch.startsWith('task/')) {
        this.warn('worktree.branch', `分支名建议以 task/ 开头（当前: ${wt.branch}）`);
      }
      if (!wt.path) {
        this.error('worktree.path', 'Dev 任务 worktree.enabled=true 但缺少 path');
      }
      if (wt.merge_strategy && !['no-ff', 'rebase', 'squash'].includes(wt.merge_strategy)) {
        this.warn('worktree.merge_strategy', `无效值 "${wt.merge_strategy}"，允许: no-ff/rebase/squash`);
      }
    }
  }

  // --- dependencies 检查 ---
  checkDependencies() {
    const deps = this.task.dependencies;
    if (deps && Array.isArray(deps)) {
      for (const dep of deps) {
        if (!/^TASK-\d{3}[A-Z]?$/.test(dep)) {
          this.warn('dependencies', `"${dep}" 格式不符 TASK-XXX`);
        }
      }
    }
  }

  // --- 完成态检查（status=done/DONE 时的额外验证）---
  checkCompletionRequirements() {
    const status = (this.task.status || '').toUpperCase();
    if (status !== 'DONE' && status !== 'REVIEW') return;

    const assignee = this.task.assignee;

    // Dev 完成检查
    if (assignee === 'dev') {
      if (!this.task.code_context?.commits?.length) {
        this.error('code_context.commits', 'Dev 任务完成时必须有 commit 记录');
      }
      if (!this.task.event_log?.length) {
        this.error('event_log', '完成时 event_log 不能为空');
      }
      if (!this.task.artifacts?.length) {
        this.warn('artifacts', 'Dev 任务完成时建议有 artifacts');
      }

      // Runtime logs 检查
      const rl = this.task.verification?.runtime_logs;
      if (rl) {
        const total = (rl.api_requests?.length || 0) + (rl.browser_checks?.length || 0) + (rl.backend_logs?.length || 0);
        if (total === 0) {
          this.error('verification.runtime_logs', 'Dev 完成时必须有 runtime 证据（api/browser/backend 至少一项）');
        }
      }

      // Regression check
      const rc = this.task.verification?.regression_check;
      if (rc) {
        for (const key of ['homepage', 'search', 'login_logout']) {
          if (rc[key] !== 'PASS') {
            this.error(`verification.regression_check.${key}`, `必须为 PASS（当前: ${rc[key]}）`);
          }
        }
      }
    }

    // QA 完成检查
    if (assignee === 'qa') {
      if (!this.task.verification?.screenshots?.length) {
        this.error('verification.screenshots', 'QA 任务完成时必须有截图');
      }
      if (!this.task.event_log?.length) {
        this.error('event_log', '完成时 event_log 不能为空');
      }
    }
  }

  // --- 执行全部检查 ---
  validate() {
    this.checkRequired();
    this.checkEnums();
    this.checkIdFormat();
    this.checkSpecContext();
    this.checkCodeContext();
    this.checkEnvContext();
    this.checkSteps();
    this.checkVerification();
    this.checkArtifacts();
    this.checkEventLog();
    this.checkExecution();
    this.checkWorktree();
    this.checkDependencies();
    this.checkCompletionRequirements();
    return this;
  }

  // --- 输出报告 ---
  report() {
    const total = this.errors.length + this.warnings.length;
    const taskId = this.task.id || 'UNKNOWN';
    const status = this.task.status || 'UNKNOWN';

    console.log(`\n${'='.repeat(60)}`);
    console.log(`📋 ${taskId} (${status}) — ${this.task.title || 'No title'}`);
    console.log(`${'='.repeat(60)}`);

    if (this.errors.length === 0 && this.warnings.length === 0) {
      console.log('  ✅ 全部通过');
      return 0;
    }

    for (const e of this.errors) {
      console.log(`  ❌ ERROR  [${e.field}] ${e.msg}`);
    }
    for (const w of this.warnings) {
      console.log(`  ⚠️  WARN   [${w.field}] ${w.msg}`);
    }
    for (const i of this.info) {
      console.log(`  ℹ️  INFO   [${i.field}] ${i.msg}`);
    }

    console.log(`\n  Summary: ${this.errors.length} ERROR, ${this.warnings.length} WARN`);

    if (this.errors.length > 0) return 1;
    return 2; // warnings only
  }
}

// ============================================================
// CLI
// ============================================================

const tasksDir = path.resolve(__dirname, '../../tasks');
const args = process.argv.slice(2);

let mode = 'validate';  // validate | pre-execute | all
let targetIds = [];

for (const arg of args) {
  if (arg === '--all') {
    mode = 'all';
  } else if (arg === '--pre-execute') {
    mode = 'pre-execute';
  } else if (arg.startsWith('TASK-')) {
    targetIds.push(arg);
  } else if (arg === '--help' || arg === '-h') {
    console.log(`
TASK JSON Validator — SOP v2.1

Usage:
  node validate-task.js TASK-001              验证单个任务
  node validate-task.js TASK-001 TASK-002     验证多个任务
  node validate-task.js --all                 验证全部任务
  node validate-task.js --pre-execute TASK-001  Agent 执行前门禁检查

Exit codes:
  0 = 全部通过
  1 = 有 ERROR（阻塞执行）
  2 = 有 WARNING（允许执行但需注意）
`);
    process.exit(0);
  }
}

// 收集要验证的文件
let files = [];
if (mode === 'all') {
  files = fs.readdirSync(tasksDir)
    .filter(f => /^TASK-\d{3}[A-Z]?\.json$/.test(f))
    .map(f => path.join(tasksDir, f));
} else if (targetIds.length > 0) {
  for (const id of targetIds) {
    const f = path.join(tasksDir, `${id}.json`);
    if (fs.existsSync(f)) {
      files.push(f);
    } else {
      console.error(`❌ 文件不存在: ${f}`);
      process.exit(1);
    }
  }
} else {
  console.error('用法: node validate-task.js [--all | --pre-execute] TASK-XXX');
  process.exit(1);
}

// 执行验证
let maxExit = 0;
let totalErrors = 0;
let totalWarnings = 0;

console.log(`🔍 TASK JSON Validator (SOP v2.1)`);
console.log(`验证模式: ${mode} | 文件数: ${files.length}`);

for (const file of files) {
  let task;
  try {
    const raw = fs.readFileSync(file, 'utf8');
    task = JSON.parse(raw);
  } catch (e) {
    console.error(`\n❌ JSON 解析失败: ${file}`);
    console.error(`   ${e.message}`);
    maxExit = 1;
    totalErrors++;
    continue;
  }

  // 跳过 CANCELED 任务（除非显式指定）
  if (mode === 'all' && (task.status === 'CANCELED' || task.status === 'canceled')) {
    continue;
  }

  const validator = new TaskValidator(task, path.basename(file));
  validator.validate();
  const code = validator.report();
  totalErrors += validator.errors.length;
  totalWarnings += validator.warnings.length;
  maxExit = Math.max(maxExit, code);
}

// 总结
console.log(`\n${'='.repeat(60)}`);
console.log(`📊 总结: ${files.length} 文件, ${totalErrors} ERROR, ${totalWarnings} WARN`);

if (totalErrors > 0) {
  console.log(`\n🚫 验证失败 — 有 ${totalErrors} 个 ERROR 必须修复`);
  if (mode === 'pre-execute') {
    console.log(`⛔ Agent 不得执行此任务，先修复 ERROR 后重试`);
  }
} else if (totalWarnings > 0) {
  console.log(`\n⚠️  验证通过（有 ${totalWarnings} 个 WARNING 需注意）`);
  if (mode === 'pre-execute') {
    console.log(`✅ Agent 可以执行，但请关注 WARNING 项`);
  }
} else {
  console.log(`\n✅ 全部通过`);
}

process.exit(maxExit);
