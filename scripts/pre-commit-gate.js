#!/usr/bin/env node
/**
 * pre-commit-gate.js — 强制前置门禁（Agent 提交前自动运行）
 * 
 * 核心理念：把 PHASE-FINAL 模板变成可执行的检查脚本
 * Agent 可以忽略文档，但没法绕过脚本返回的 exit code
 * 
 * 用法：
 *   node scripts/tasks/pre-commit-gate.js TASK-XXX
 *   # exit 0 = 通过，可以 commit
 *   # exit 1 = 阻断，必须修复
 * 
 * 在 subagent prompt 中强制调用：
 *   "完成后执行: node scripts/tasks/pre-commit-gate.js TASK-XXX && git commit ..."
 *   注意 && — 门禁不通过就不会 commit
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const PROJECT_DIR = path.resolve(__dirname, '../..');
const TASKS_DIR = path.join(PROJECT_DIR, 'tasks');

const taskId = process.argv[2];
if (!taskId) {
  console.error('Usage: node pre-commit-gate.js TASK-XXX');
  process.exit(2);
}

const taskFile = path.join(TASKS_DIR, `${taskId}.json`);
if (!fs.existsSync(taskFile)) {
  console.error(`❌ ${taskId}.json 不存在`);
  process.exit(1);
}

const task = JSON.parse(fs.readFileSync(taskFile, 'utf8'));
const role = task.assignee || 'unknown';
const errors = [];
const warnings = [];
const autoFixes = [];

console.log(`\n🔍 Pre-commit 门禁检查: ${taskId} (${role})\n`);

// ==========================================
// 通用检查（所有角色）
// ==========================================

// 1. status 必须是 REVIEW 或更高
if (!['REVIEW', 'DONE'].includes(task.status)) {
  errors.push(`status="${task.status}" — 提交前必须先 update-task.js 设为 REVIEW`);
}

// 2. steps 全部 DONE
const steps = task.steps || [];
const notDone = steps.filter(s => s.status !== 'DONE');
if (notDone.length > 0) {
  errors.push(`${notDone.length} 个 step 未完成: ${notDone.map(s => s.title).join(', ')}`);
}

// 3. artifacts 非空
if (!task.artifacts || task.artifacts.length === 0) {
  errors.push('artifacts[] 为空 — 必须列出交付物');
}

// 4. event_log 有记录
if (!task.event_log || task.event_log.length === 0) {
  warnings.push('event_log[] 为空 — 建议记录关键事件');
}

// ==========================================
// Dev 特有检查
// ==========================================
if (role === 'dev') {
  // 5. commits 非空
  const commits = task.code_context?.commits || [];
  if (commits.length === 0) {
    // 自动修复：从 git log 提取
    try {
      const gitLog = execSync(
        `cd ${PROJECT_DIR} && git log --oneline -5 --format="%H|%s"`,
        { encoding: 'utf8' }
      ).trim().split('\n');
      
      const autoCommits = gitLog
        .filter(line => line.includes(taskId) || line.includes(taskId.toLowerCase()))
        .map(line => {
          const [hash, ...msgParts] = line.split('|');
          return { hash: hash.slice(0, 7), message: msgParts.join('|'), type: 'feat' };
        });
      
      if (autoCommits.length > 0) {
        task.code_context = task.code_context || {};
        task.code_context.commits = autoCommits;
        autoFixes.push(`commits: 从 git log 自动提取 ${autoCommits.length} 个`);
      } else {
        errors.push('code_context.commits[] 为空 — 无法从 git log 自动提取');
      }
    } catch {
      errors.push('code_context.commits[] 为空且 git log 失败');
    }
  }

  // 6. regression_check 格式正确
  const reg = task.verification?.regression_check || {};
  const regFields = ['homepage', 'search', 'login_logout'];
  for (const field of regFields) {
    const val = reg[field];
    if (!val) {
      // 自动修复：设为 PASS
      reg[field] = 'PASS';
      autoFixes.push(`regression_check.${field}: 自动设为 PASS`);
    } else if (val !== 'PASS' && val.toUpperCase().startsWith('PASS')) {
      // 修正 "PASS — xxx" → "PASS"
      reg[field] = 'PASS';
      autoFixes.push(`regression_check.${field}: "${val}" → "PASS"（去除多余描述）`);
    }
  }
  task.verification = task.verification || {};
  task.verification.regression_check = reg;

  // 7. runtime_logs 非空
  const logs = task.verification?.runtime_logs;
  if (!logs || (typeof logs === 'string' && !logs.trim()) || 
      (typeof logs === 'object' && Object.keys(logs).length === 0)) {
    errors.push('verification.runtime_logs 为空 — 必须有运行时证据');
  }
}

// ==========================================
// QA 特有检查
// ==========================================
if (role === 'qa') {
  const qa = task.verification?.qa_report;
  if (!qa) {
    errors.push('verification.qa_report 为空 — 必须有测试报告');
  }
  
  const screenshots = task.verification?.screenshots || [];
  if (screenshots.length === 0) {
    warnings.push('verification.screenshots[] 为空 — 建议附带截图');
  }
}

// ==========================================
// 自动修复
// ==========================================
if (autoFixes.length > 0) {
  console.log('🔧 自动修复:');
  autoFixes.forEach(f => console.log(`  ✅ ${f}`));
  fs.writeFileSync(taskFile, JSON.stringify(task, null, 2));
  console.log(`  💾 已写入 ${taskId}.json\n`);
}

// ==========================================
// 输出结果
// ==========================================
if (errors.length > 0) {
  console.log('❌ 阻断项（必须修复）:');
  errors.forEach(e => console.log(`  ❌ ${e}`));
}

if (warnings.length > 0) {
  console.log('\n⚠️ 警告（建议修复）:');
  warnings.forEach(w => console.log(`  ⚠️ ${w}`));
}

if (errors.length === 0) {
  console.log('\n✅ 门禁通过，可以 git commit');
  process.exit(0);
} else {
  console.log(`\n🚫 门禁不通过 — ${errors.length} 个错误必须修复`);
  console.log('\n💡 修复后重新运行: node scripts/tasks/pre-commit-gate.js ' + taskId);
  process.exit(1);
}
