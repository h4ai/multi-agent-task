#!/usr/bin/env node
/**
 * health-check.js — Subagent 死亡检测 + 僵尸任务回收
 * 
 * 借鉴 ClawTeam registry.py 的 is_agent_alive() + release_stale_locks()
 * 适配 OpenClaw session-based 架构：用 timeout + event_log 时间戳检测
 * 
 * Usage:
 *   node health-check.js              # 人类可读输出
 *   node health-check.js --json       # 结构化 JSON（供 pm-heartbeat.js 集成）
 *   node health-check.js --auto-block # 自动将 zombie 标记为 BLOCKED
 */

const fs = require('fs');
const path = require('path');
const config = require('./config');

const args = process.argv.slice(2);
const jsonMode = args.includes('--json');
const autoBlock = args.includes('--auto-block');

function loadTasks() {
  return config.loadTasks();
}

function getLastStatusChangeTime(task) {
  // 从 event_log 找最后一次变更到 IN_PROGRESS 的时间
  const events = (task.event_log || [])
    .filter(e => e.type === 'status_changed' && 
                 e.payload?.to_status === 'IN_PROGRESS')
    .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  
  if (events.length > 0) return new Date(events[0].timestamp);
  
  // fallback: started_at
  if (task.started_at) return new Date(task.started_at);
  
  // fallback: updated
  if (task.updated) return new Date(task.updated);
  
  return null;
}

function checkHealth(tasks) {
  const result = {
    zombies: [],
    warnings: [],
    healthy: [],
    timestamp: new Date().toISOString()
  };

  const inProgress = tasks.filter(t => 
    (t.status || '').toUpperCase() === 'IN_PROGRESS');

  for (const task of inProgress) {
    const timeout = task.timeout || 60; // 默认 60 分钟
    const lastChange = getLastStatusChangeTime(task);
    
    if (!lastChange) {
      result.warnings.push({
        task_id: task.id,
        title: task.title || '',
        reason: 'NO_TIMESTAMP',
        message: '无法确定开始时间，缺少 event_log 和 started_at'
      });
      continue;
    }

    const elapsedMin = Math.round(
      (Date.now() - lastChange.getTime()) / 60000);
    const warningThreshold = Math.round(timeout * 0.8);

    if (elapsedMin > timeout) {
      result.zombies.push({
        task_id: task.id,
        title: task.title || '',
        assignee: task.assignee || 'unknown',
        elapsed_min: elapsedMin,
        timeout_min: timeout,
        started_at: lastChange.toISOString(),
        action: elapsedMin > timeout * 2 ? 'CANCEL' : 'BLOCK'
      });
    } else if (elapsedMin > warningThreshold) {
      result.warnings.push({
        task_id: task.id,
        title: task.title || '',
        elapsed_min: elapsedMin,
        timeout_min: timeout,
        remaining_min: timeout - elapsedMin,
        reason: 'APPROACHING_TIMEOUT'
      });
    } else {
      result.healthy.push({
        task_id: task.id,
        elapsed_min: elapsedMin,
        timeout_min: timeout
      });
    }
  }

  return result;
}

function autoBlockZombies(result) {
  const updateScript = path.resolve(config.scriptsDir, 'update-task.js');
  const { execSync } = require('child_process');
  const blocked = [];

  for (const z of result.zombies) {
    const newStatus = z.action === 'CANCEL' ? 'CANCELED' : 'BLOCKED';
    try {
      execSync(
        `node "${updateScript}" ${z.task_id} --status ${newStatus} ` +
        `--reason "Auto-detected zombie: ${z.elapsed_min}min > ${z.timeout_min}min timeout"`,
        { stdio: 'pipe' }
      );
      blocked.push({ task_id: z.task_id, new_status: newStatus });
    } catch (e) {
      blocked.push({ task_id: z.task_id, error: e.message });
    }
  }
  return blocked;
}

// === Main ===
const tasks = loadTasks();
const result = checkHealth(tasks);

if (autoBlock && result.zombies.length > 0) {
  result.auto_blocked = autoBlockZombies(result);
}

if (jsonMode) {
  console.log(JSON.stringify(result, null, 2));
} else {
  if (result.zombies.length === 0 && result.warnings.length === 0) {
    console.log('✅ 所有 IN_PROGRESS 任务健康');
  }
  
  for (const z of result.zombies) {
    console.log(
      `🧟 ZOMBIE: ${z.task_id} — ${z.elapsed_min}min (超时 ${z.timeout_min}min) ` +
      `[${z.assignee}] → 建议 ${z.action}`);
  }
  
  for (const w of result.warnings) {
    if (w.reason === 'APPROACHING_TIMEOUT') {
      console.log(
        `⚠️  WARNING: ${w.task_id} — ${w.elapsed_min}min ` +
        `(还剩 ${w.remaining_min}min 超时)`);
    } else {
      console.log(`⚠️  WARNING: ${w.task_id} — ${w.message || w.reason}`);
    }
  }

  if (result.auto_blocked) {
    for (const b of result.auto_blocked) {
      if (b.error) {
        console.log(`❌ AUTO-BLOCK 失败: ${b.task_id} — ${b.error}`);
      } else {
        console.log(`🔒 AUTO-BLOCKED: ${b.task_id} → ${b.new_status}`);
      }
    }
  }

  console.log(
    `\n📊 IN_PROGRESS: ${result.zombies.length + result.warnings.length + result.healthy.length} ` +
    `(🧟${result.zombies.length} ⚠️${result.warnings.length} ✅${result.healthy.length})`);
}
