#!/usr/bin/env node
/**
 * update-task.js — 安全更新 TASK JSON（写时校验 + 自动规范化）
 * 
 * 替代 Dev subagent 直接 jq/手写修改 TASK JSON。
 * 所有 TASK JSON 的修改必须通过此脚本，确保：
 * 1. status 自动大写
 * 2. regression_check 值严格为 "PASS" 或 null
 * 3. event_log 自动 append（status 变更时）
 * 4. 写入前 JSON 格式校验
 * 5. updated 时间自动更新
 * 
 * Usage:
 *   node update-task.js TASK-001 --status REVIEW
 *   node update-task.js TASK-001 --status DONE --completed now
 *   node update-task.js TASK-001 --regression-check pass
 *   node update-task.js TASK-001 --step S3 --step-status DONE --evidence "commit abc123"
 *   node update-task.js TASK-001 --add-commit abc123
 *   node update-task.js TASK-001 --add-artifact '{"type":"screenshot","path":"/tmp/x.png"}'
 *   node update-task.js TASK-001 --set 'notes=Fixed the bug'
 */

const fs = require('fs');
const path = require('path');

const tasksDir = process.env.MAT_TASKS_DIR || path.resolve(__dirname, '../../tasks');
// Fallback: try config.js if available
if (!fs.existsSync(tasksDir)) {
  try {
    const config = require('./config');
    if (config.tasksDir && fs.existsSync(config.tasksDir)) {
      // Override
    }
  } catch {}
}
const args = process.argv.slice(2);

const taskId = args[0];
if (!taskId || taskId.startsWith('--')) {
  console.error('Usage: node update-task.js TASK-XXX [options]');
  process.exit(2);
}

const getArg = (flag) => {
  const i = args.indexOf(flag);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : null;
};
const hasFlag = (flag) => args.includes(flag);

const filePath = path.join(tasksDir, `${taskId}.json`);
if (!fs.existsSync(filePath)) {
  console.error(`❌ ${filePath} 不存在`);
  process.exit(1);
}

let task;
try {
  task = JSON.parse(fs.readFileSync(filePath, 'utf8'));
} catch (e) {
  console.error(`❌ JSON 解析失败: ${e.message}`);
  process.exit(1);
}

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

let changed = false;

// === Status update ===
const newStatus = getArg('--status');
if (newStatus) {
  const normalized = newStatus.toUpperCase();
  if (!VALID_STATUSES.includes(normalized)) {
    console.error(`❌ 无效 status: ${newStatus}（允许: ${VALID_STATUSES.join('/')}）`);
    process.exit(1);
  }
  
  const currentStatus = (task.status || '').toUpperCase();
  if (currentStatus === normalized) {
    console.log(`ℹ️  status 已经是 ${normalized}，跳过`);
  } else {
    const allowed = ALLOWED_TRANSITIONS[currentStatus] || [];
    if (!allowed.includes(normalized)) {
      console.error(`❌ 非法状态转换: ${currentStatus} → ${normalized}（允许: ${allowed.join('/')}）`);
      process.exit(1);
    }
    
    task.status = normalized;
    
    // === Auto started_at (借鉴 ClawTeam tasks.py) ===
    if (normalized === 'IN_PROGRESS' && !task.started_at) {
      task.started_at = new Date().toISOString();
      console.log(`⏱️  started_at: ${task.started_at}`);
    }
    
    // === Auto duration_seconds (借鉴 ClawTeam tasks.py) ===
    if (normalized === 'DONE' && task.started_at) {
      try {
        const start = new Date(task.started_at);
        const duration = Math.round((Date.now() - start.getTime()) / 1000);
        task.duration_seconds = duration;
        const hours = Math.floor(duration / 3600);
        const mins = Math.floor((duration % 3600) / 60);
        console.log(`⏱️  耗时: ${hours}h ${mins}m (${duration}s)`);
      } catch {}
    }
    
    // Auto-append event_log
    if (!task.event_log) task.event_log = [];
    task.event_log.push({
      event_id: `EVT-${Date.now()}`,
      type: 'status_changed',
      actor: getArg('--actor') || task.assignee || 'unknown',
      step_id: null,
      timestamp: new Date().toISOString(),
      payload: {
        from_status: currentStatus,
        to_status: normalized,
        reason: getArg('--reason') || null,
        evidence: null
      }
    });
    
    console.log(`✅ status: ${currentStatus} → ${normalized}`);
    changed = true;
    
    // === Auto-resolve dependents (借鉴 ClawTeam _resolve_dependents_unlocked) ===
    if (normalized === 'DONE') {
      try {
        const allFiles = fs.readdirSync(tasksDir)
          .filter(f => /^TASK-\d+[A-Z]?\.json$/.test(f) && f !== `${taskId}.json`);
        const resolved = [];
        
        for (const f of allFiles) {
          const depPath = path.join(tasksDir, f);
          const depTask = JSON.parse(fs.readFileSync(depPath, 'utf8'));
          const prereqs = depTask.prerequisites || [];
          
          if (prereqs.includes(taskId)) {
            // 检查所有前置是否满足
            const allMet = prereqs.every(pid => {
              if (pid === taskId) return true;
              const pFile = path.join(tasksDir, `${pid}.json`);
              if (!fs.existsSync(pFile)) return true;
              const p = JSON.parse(fs.readFileSync(pFile, 'utf8'));
              return (p.status || '').toUpperCase() === 'DONE';
            });
            
            if (allMet) {
              resolved.push({
                id: depTask.id,
                title: depTask.title || '',
                status: (depTask.status || '').toUpperCase()
              });
            }
          }
        }
        
        if (resolved.length > 0) {
          console.log(`\n🔓 依赖已满足，可派发:`);
          for (const r of resolved) {
            console.log(`   → ${r.id} [${r.status}]: ${r.title}`);
          }
        }
      } catch (e) {
        // Best-effort, don't block the update
      }
    }
  }
}

// === Completed time ===
const completed = getArg('--completed');
if (completed) {
  task.completed = completed === 'now' ? new Date().toISOString() : completed;
  console.log(`✅ completed: ${task.completed}`);
  changed = true;
}

// === Regression check ===
const regCheck = getArg('--regression-check');
if (regCheck) {
  const val = regCheck.toUpperCase() === 'PASS' ? 'PASS' : null;
  if (!task.verification) task.verification = {};
  task.verification.regression_check = {
    homepage: val,
    search: val,
    login_logout: val
  };
  console.log(`✅ regression_check: all → ${val || 'null'}`);
  changed = true;
}

// === Step status update ===
const stepId = getArg('--step');
const stepStatus = getArg('--step-status');
if (stepId && stepStatus) {
  const normalized = stepStatus.toUpperCase();
  const step = (task.steps || []).find(s => s.step_id === stepId);
  if (!step) {
    console.error(`❌ Step ${stepId} 不存在`);
    process.exit(1);
  }
  step.status = normalized;
  const evidence = getArg('--evidence');
  if (evidence) step.evidence = evidence;
  
  // Auto-append event_log
  if (!task.event_log) task.event_log = [];
  task.event_log.push({
    event_id: `EVT-${Date.now()}`,
    type: 'step_done',
    actor: getArg('--actor') || task.assignee || 'unknown',
    step_id: stepId,
    timestamp: new Date().toISOString(),
    payload: {
      from_status: 'PENDING',
      to_status: normalized,
      evidence: evidence || null
    }
  });
  
  console.log(`✅ Step ${stepId}: → ${normalized}${evidence ? ' (evidence: ' + evidence.substring(0, 50) + ')' : ''}`);
  changed = true;
}

// === Add commit ===
const addCommit = getArg('--add-commit');
if (addCommit) {
  if (!task.code_context) task.code_context = {};
  if (!task.code_context.commits) task.code_context.commits = [];
  if (!task.code_context.commits.includes(addCommit)) {
    task.code_context.commits.push(addCommit);
    console.log(`✅ commit: +${addCommit}`);
    changed = true;
  }
}

// === Add artifact ===
const addArtifact = getArg('--add-artifact');
if (addArtifact) {
  try {
    const artifact = JSON.parse(addArtifact);
    if (!task.artifacts) task.artifacts = [];
    task.artifacts.push(artifact);
    console.log(`✅ artifact: +${artifact.type || 'unknown'}`);
    changed = true;
  } catch (e) {
    console.error(`❌ artifact JSON 解析失败: ${e.message}`);
    process.exit(1);
  }
}

// === Generic set ===
const setVal = getArg('--set');
if (setVal) {
  const [key, ...rest] = setVal.split('=');
  const value = rest.join('=');
  task[key] = value;
  console.log(`✅ ${key}: ${value.substring(0, 80)}`);
  changed = true;
}

// === Auto-update timestamp ===
if (changed) {
  task.updated = new Date().toISOString();
  
  // Final JSON validation
  try {
    const output = JSON.stringify(task, null, 2);
    JSON.parse(output); // Verify roundtrip
    fs.writeFileSync(filePath, output);
    console.log(`\n💾 Saved ${filePath}`);
  } catch (e) {
    console.error(`❌ JSON 序列化失败: ${e.message}`);
    process.exit(1);
  }
} else {
  console.log('ℹ️  无变更');
}
