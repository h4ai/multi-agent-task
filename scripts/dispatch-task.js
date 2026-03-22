#!/usr/bin/env node
/**
 * dispatch-task.js — PM 任务派发脚本
 * 
 * 替代 sessions_spawn 直接调用，改为 inbox 模式：
 * 1. 验证 TASK JSON 合规
 * 2. 更新状态 PENDING → IN_PROGRESS
 * 3. 往目标 Agent inbox 写入任务分配消息
 * 4. 系统 crontab → inbox-poll.sh 自动检测 → 唤醒 Agent
 * 
 * Usage:
 *   node scripts/dispatch-task.js TASK-016
 *   node scripts/dispatch-task.js TASK-016 TASK-017 TASK-018  # 批量派发
 *   node scripts/dispatch-task.js TASK-016 --priority urgent
 *   node scripts/dispatch-task.js TASK-016 --dry-run          # 只验证不派发
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

// #3: 从 TASK JSON 提取关键词用于 learnings 语义匹配
function extractKeywords(task) {
  const sources = [
    task.title || '',
    task.description || '',
    ...(task.acceptance_criteria || []),
    ...(task.steps || []).map(s => s.title || ''),
    ...(task.code_context?.files || []),
    task.spec_context?.spec_id || '',
  ];
  const text = sources.join(' ').toLowerCase();
  
  // 提取有意义的技术关键词（去掉 stop words）
  const stopWords = new Set([
    'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been',
    'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with',
    '的', '了', '是', '在', '和', '从', '到', '等', '中', '与', '及',
    'task', 'spec', 'should', 'must', 'will', 'can', 'need',
  ]);
  
  const words = text.match(/[a-z][a-z0-9_-]{2,}/g) || [];
  const unique = [...new Set(words)].filter(w => !stopWords.has(w));
  
  // 优先保留技术词汇（出现在文件路径、框架名等）
  const techBoost = ['prisma', 'docker', 'nest', 'react', 'auth', 'jwt', 'cookie',
    'guard', 'router', 'api', 'frontend', 'backend', 'test', 'deploy', 'build',
    'admin', 'dashboard', 'upload', 'review', 'version', 'template', 'search',
    'tanstack', 'query', 'mutation', 'component', 'service', 'controller'];
  
  const scored = unique.map(w => ({
    word: w,
    score: techBoost.includes(w) ? 2 : 1
  }));
  scored.sort((a, b) => b.score - a.score);
  
  return scored.slice(0, 15).map(s => s.word);
}

// Auto-detect config: try local config.js first, then build inline
let config;
try {
  config = require('./config');
} catch {
  // Fallback: derive paths from script location (scripts/tasks/)
  const scriptsDir = __dirname;
  const projectDir = path.resolve(scriptsDir, '../..');
  config = {
    scriptsDir,
    projectDir,
    tasksDir: path.join(projectDir, 'tasks'),
    loadTasks() {
      return fs.readdirSync(this.tasksDir)
        .filter(f => /^TASK-\d+[A-Z]?\.json$/.test(f))
        .map(f => { try { return JSON.parse(fs.readFileSync(path.join(this.tasksDir, f), 'utf8')); } catch { return null; } })
        .filter(Boolean);
    }
  };
}

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const priority = args.includes('--priority') 
  ? args[args.indexOf('--priority') + 1] 
  : 'normal';
const taskIds = args.filter(a => /^TASK-\d+[A-Z]?$/i.test(a));

if (taskIds.length === 0) {
  console.error('❌ Usage: node dispatch-task.js TASK-XXX [TASK-YYY ...] [--priority urgent] [--dry-run]');
  process.exit(1);
}

const results = { dispatched: [], failed: [] };

for (const taskId of taskIds) {
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`📋 ${taskId}`);
  console.log('═'.repeat(60));

  // Step 1: Load TASK JSON
  const taskFile = path.join(config.tasksDir, `${taskId}.json`);
  if (!fs.existsSync(taskFile)) {
    console.error(`  ❌ 文件不存在: ${taskFile}`);
    results.failed.push({ id: taskId, reason: 'file not found' });
    continue;
  }

  let task;
  try {
    task = JSON.parse(fs.readFileSync(taskFile, 'utf8'));
  } catch (e) {
    console.error(`  ❌ JSON 解析失败: ${e.message}`);
    results.failed.push({ id: taskId, reason: 'json parse error' });
    continue;
  }

  // Step 1.5: Idempotency check — skip if inbox already has message for this task
  const agent = task.assignee || task.assigned_to;
  if (agent) {
    const inboxDir = path.join(os.homedir(), '.openclaw', 'shared', 'inbox', agent);
    if (fs.existsSync(inboxDir)) {
      const pendingMsgs = fs.readdirSync(inboxDir).filter(f => f.endsWith('.json') && !f.startsWith('.'));
      const hasPending = pendingMsgs.some(f => {
        try {
          const msg = JSON.parse(fs.readFileSync(path.join(inboxDir, f), 'utf8'));
          return msg.task_id === taskId || (msg.metadata && msg.metadata.task_id === taskId);
        } catch { return false; }
      });
      if (hasPending) {
        console.log(`  ⏭️ 跳过 — ${agent} inbox 已有 ${taskId} 的未消费消息（幂等保护）`);
        results.skipped = results.skipped || [];
        results.skipped.push({ id: taskId, reason: 'inbox message already pending' });
        continue;
      }
    }
  }

  // Step 2: Validate status
  if (task.status !== 'PENDING' && task.status !== 'BLOCKED') {
    console.error(`  ❌ 状态 ${task.status} 不可派发（需要 PENDING 或 BLOCKED）`);
    results.failed.push({ id: taskId, reason: `invalid status: ${task.status}` });
    continue;
  }

  // Step 3: Run validate-task.js
  console.log('  🔍 Step 1: 验证 TASK JSON...');
  try {
    const validateScript = path.join(config.scriptsDir, 'validate-task.js');
    const result = execSync(`node "${validateScript}" --pre-execute ${taskId}`, { 
      cwd: config.projectDir, 
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe']
    });
    
    if (result.includes('ERROR')) {
      console.error(`  ❌ 验证失败 — 有 ERROR，请先修复`);
      console.error(result.split('\n').filter(l => l.includes('ERROR')).map(l => '    ' + l).join('\n'));
      results.failed.push({ id: taskId, reason: 'validation errors' });
      continue;
    }
    console.log('  ✅ 验证通过');
  } catch (e) {
    const output = (e.stdout || '') + (e.stderr || '');
    // exit code 1 = ERROR, exit code 2 = WARN only (pass)
    const hasRealError = output.split('\n').some(l => /\bERROR\b/.test(l) && !/0 ERROR/.test(l));
    if (hasRealError) {
      console.error(`  ❌ 验证失败`);
      console.error(output.split('\n').filter(l => /\bERROR\b/.test(l) && !/0 ERROR/.test(l)).slice(0, 5).map(l => '    ' + l).join('\n'));
      results.failed.push({ id: taskId, reason: 'validation errors' });
      continue;
    }
    // WARN only = pass (exit code 2)
    console.log('  ✅ 验证通过（有 WARN）');
  }

  if (dryRun) {
    console.log(`  🏁 [DRY RUN] 验证通过，跳过实际派发`);
    results.dispatched.push({ id: taskId, agent: task.assignee, dryRun: true });
    continue;
  }

  // Step 4: Update status → IN_PROGRESS
  console.log('  📝 Step 2: 更新状态 → IN_PROGRESS...');
  try {
    const updateScript = path.join(config.scriptsDir, 'update-task.js');
    execSync(`node "${updateScript}" ${taskId} --status IN_PROGRESS --actor pm --reason "PM dispatch via inbox"`, {
      cwd: config.projectDir,
      encoding: 'utf8',
      stdio: 'pipe'
    });
    console.log('  ✅ 状态已更新');
  } catch (e) {
    console.error(`  ❌ 状态更新失败: ${(e.stderr || e.message).trim()}`);
    results.failed.push({ id: taskId, reason: 'status update failed' });
    continue;
  }

  // Step 5: Send inbox message
  const agentTarget = task.assignee || 'dev';
  const taskPriority = task.priority === 'P0' ? 'urgent' : (priority || 'normal');
  
  console.log(`  📩 Step 3: 发送到 ${agentTarget} inbox (${taskPriority})...`);
  
  // Step 5a: Load relevant learnings for this agentTarget (L2 + L3 keyword matching)
  let learningsContext = '';
  try {
    const sharedDir = path.join(process.env.HOME || '/home/azureuser', '.openclaw/shared/learnings', agentTarget);
    const commonDir = path.join(process.env.HOME || '/home/azureuser', '.openclaw/shared/learnings/common');
    
    // #3: 从任务内容提取关键词用于语义匹配
    const taskKeywords = extractKeywords(task);
    
    const loadRelevant = (file, limit = 3) => {
      if (!fs.existsSync(file)) return '';
      const content = fs.readFileSync(file, 'utf8');
      const entries = content.split(/(?=^### )/m).filter(e => e.startsWith('### '));
      if (entries.length === 0) return '';
      
      // 如果有关键词，按相关性排序；否则取最近的
      if (taskKeywords.length > 0) {
        const scored = entries.map(entry => {
          const lower = entry.toLowerCase();
          const score = taskKeywords.reduce((s, kw) => s + (lower.includes(kw) ? 1 : 0), 0);
          return { entry, score };
        });
        scored.sort((a, b) => b.score - a.score);
        return scored.filter(s => s.score > 0).slice(0, limit).map(s => s.entry).join('\n').trim();
      }
      return entries.slice(-limit).join('\n').trim();
    };
    
    const agentErrors = loadRelevant(path.join(sharedDir, 'ERRORS.md'), 3);
    const agentLearnings = loadRelevant(path.join(sharedDir, 'LEARNINGS.md'), 3);
    const agentPatterns = loadRelevant(path.join(sharedDir, 'PATTERNS.md'), 2);
    const crossLearnings = loadRelevant(path.join(commonDir, 'CROSS-AGENT.md'), 2);
    
    const parts = [];
    if (agentErrors) parts.push(`⚠️ 相关踩坑（避免重蹈覆辙）:\n${agentErrors}`);
    if (agentLearnings) parts.push(`💡 相关最佳实践:\n${agentLearnings}`);
    if (agentPatterns) parts.push(`🔧 相关代码模式:\n${agentPatterns}`);
    if (crossLearnings) parts.push(`🔗 跨 Agent 经验:\n${crossLearnings}`);
    
    if (parts.length > 0) {
      learningsContext = '\n\n--- 历史经验（按任务相关性自动匹配）---\n' + parts.join('\n\n');
      console.log(`  📚 附带 ${parts.length} 类相关经验 (keywords: ${taskKeywords.slice(0,5).join(',')})`);
    }
  } catch (e) {
    // Learnings load failure is non-fatal
  }
  
  // Build rich content with context from TASK JSON
  const specRef = task.spec_context?.spec_id || task.spec || '';
  const acSummary = (task.acceptance_criteria || []).map((ac, i) => `  ${i+1}. ${ac}`).join('\n');
  const stepsSummary = (task.steps || []).map(s => `  - [${s.status}] ${s.title}`).join('\n');
  
  const content = [
    `📋 任务分配: ${taskId} — ${task.title}`,
    ``,
    `优先级: ${task.priority || 'P1'}`,
    specRef ? `关联 Spec: ${specRef}` : '',
    ``,
    `📖 请按以下步骤执行:`,
    `1. 读取 TASK JSON: tasks/${taskId}.json`,
    specRef ? `2. 读取 Spec 原文: specs/${specRef}.md` : '2. 检查 task description',
    `3. 按 steps 逐步实现`,
    ``,
    `⚠️ 完成后必须按顺序执行（不可跳过任何一步）:`,
    `4. 补全 TASK JSON 所有字段:`,
    `   - code_context.commits[] — 至少 1 个 (hash + message)`,
    `   - verification.runtime_logs — 运行时证据 (api_requests/browser_checks)`,
    `   - verification.regression_check — homepage/search/login_logout 精确填 "PASS"`,
    `   - artifacts[] — 交付物列表 (type + path + description)`,
    `   - steps[] — 所有 status 改为 "DONE"`,
    `5. node scripts/tasks/update-task.js ${taskId} --status REVIEW --actor ${agentTarget} --reason "AC X/X PASS"`,
    `6. 【强制门禁】node scripts/tasks/pre-commit-gate.js ${taskId} && git add -A && git commit -m "feat: ${taskId} ..."`,
    `   ⚡ pre-commit-gate.js 会自动检查+修复，不通过则阻断 commit`,
    `   ⚡ 如果阻断了，按提示修复后重新运行`,
    `7. node scripts/tasks/inbox.js send --to pm --from ${agentTarget} --type task_done --task-id ${taskId} --content "完成"`,
    ``,
    acSummary ? `验收标准:\n${acSummary}` : '',
    stepsSummary ? `\n步骤:\n${stepsSummary}` : '',
    learningsContext,
  ].filter(Boolean).join('\n');

  try {
    const inboxScript = path.join(config.scriptsDir, 'inbox.js');
    execSync(
      `node "${inboxScript}" send --to ${agentTarget} --from pm --type task_assign --task-id ${taskId} --priority ${taskPriority} --content "${content.replace(/"/g, '\\"')}"`,
      { cwd: config.projectDir, encoding: 'utf8', stdio: 'pipe' }
    );
    console.log(`  ✅ 已发送到 ${agentTarget} inbox`);
  } catch (e) {
    console.error(`  ❌ inbox 发送失败: ${(e.stderr || e.message).trim()}`);
    results.failed.push({ id: taskId, reason: 'inbox send failed' });
    continue;
  }

  results.dispatched.push({ id: taskId, agent: agentTarget, priority: taskPriority });
  console.log(`  🚀 ${taskId} → ${agentTarget} 派发完成`);
}

// Summary
console.log(`\n${'═'.repeat(60)}`);
console.log('📊 派发结果');
console.log('═'.repeat(60));
console.log(`  ✅ 成功: ${results.dispatched.length}`);
results.dispatched.forEach(d => console.log(`     ${d.id} → ${d.agent}${d.dryRun ? ' [DRY RUN]' : ''}`));
if (results.failed.length) {
  console.log(`  ❌ 失败: ${results.failed.length}`);
  results.failed.forEach(f => console.log(`     ${f.id}: ${f.reason}`));
}

process.exit(results.failed.length > 0 ? 1 : 0);
