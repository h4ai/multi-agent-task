#!/usr/bin/env node
/**
 * stats.js — 任务统计分析
 * 
 * 借鉴 ClawTeam tasks.py 的 get_stats()，扩展为完整统计报告。
 * 
 * Usage:
 *   node stats.js              # 人类可读
 *   node stats.js --json       # 结构化 JSON
 */

const fs = require('fs');
const path = require('path');
const config = require('./config');

const args = process.argv.slice(2);
const jsonMode = args.includes('--json');

function loadTasks() {
  return config.loadTasks();
}

function computeStats(tasks) {
  const statusCounts = {};
  const byRole = {};
  const durations = [];
  const slowest = [];
  let totalSteps = 0;
  let doneSteps = 0;

  for (const t of tasks) {
    const status = (t.status || 'UNKNOWN').toUpperCase();
    statusCounts[status] = (statusCounts[status] || 0) + 1;

    // 耗时统计
    if (t.duration_seconds) {
      const hours = t.duration_seconds / 3600;
      durations.push({ id: t.id, hours, title: t.title || '' });
    } else if (t.started_at && t.completed) {
      const start = new Date(t.started_at);
      const end = new Date(t.completed);
      if (!isNaN(start) && !isNaN(end)) {
        const hours = (end - start) / 3600000;
        durations.push({ id: t.id, hours, title: t.title || '' });
      }
    }

    // 按角色统计
    const role = t.assignee || t.task_class || 'unknown';
    if (!byRole[role]) byRole[role] = { count: 0, done: 0, durations: [] };
    byRole[role].count++;
    if (status === 'DONE') byRole[role].done++;

    // Steps 统计
    for (const step of (t.steps || [])) {
      totalSteps++;
      if ((step.status || '').toUpperCase() === 'DONE') doneSteps++;
    }
  }

  // 汇总
  const avgHours = durations.length > 0
    ? durations.reduce((s, d) => s + d.hours, 0) / durations.length
    : 0;

  // 按角色计算平均耗时
  for (const d of durations) {
    const task = tasks.find(t => t.id === d.id);
    const role = task?.assignee || task?.task_class || 'unknown';
    if (byRole[role]) byRole[role].durations.push(d.hours);
  }

  const byRoleStats = {};
  for (const [role, data] of Object.entries(byRole)) {
    const avgD = data.durations.length > 0
      ? data.durations.reduce((s, h) => s + h, 0) / data.durations.length
      : null;
    byRoleStats[role] = {
      count: data.count,
      done: data.done,
      avg_hours: avgD ? Math.round(avgD * 10) / 10 : null
    };
  }

  // Top 5 最慢
  const top5Slow = [...durations]
    .sort((a, b) => b.hours - a.hours)
    .slice(0, 5)
    .map(d => ({
      id: d.id,
      hours: Math.round(d.hours * 10) / 10,
      title: d.title
    }));

  return {
    total: tasks.length,
    status_counts: statusCounts,
    avg_duration_hours: Math.round(avgHours * 10) / 10,
    timed_tasks: durations.length,
    steps_total: totalSteps,
    steps_done: doneSteps,
    steps_completion_rate: totalSteps > 0
      ? Math.round(doneSteps / totalSteps * 100) + '%'
      : 'N/A',
    by_role: byRoleStats,
    slowest_tasks: top5Slow,
    timestamp: new Date().toISOString()
  };
}

const tasks = loadTasks();
const stats = computeStats(tasks);

if (jsonMode) {
  console.log(JSON.stringify(stats, null, 2));
} else {
  console.log('📊 任务统计报告');
  console.log('='.repeat(50));
  console.log(`总计: ${stats.total} 个任务`);
  for (const [status, count] of Object.entries(stats.status_counts)) {
    console.log(`  ${status}: ${count}`);
  }
  console.log(`\n⏱️  平均耗时: ${stats.avg_duration_hours}h (${stats.timed_tasks} 个有记录)`);
  console.log(`📋 Steps: ${stats.steps_done}/${stats.steps_total} 完成 (${stats.steps_completion_rate})`);
  
  console.log('\n👥 按角色:');
  for (const [role, data] of Object.entries(stats.by_role)) {
    const avgStr = data.avg_hours !== null ? `${data.avg_hours}h` : 'N/A';
    console.log(`  ${role}: ${data.done}/${data.count} done, avg ${avgStr}`);
  }

  if (stats.slowest_tasks.length > 0) {
    console.log('\n🐢 最慢任务:');
    for (const t of stats.slowest_tasks) {
      console.log(`  ${t.id}: ${t.hours}h — ${t.title}`);
    }
  }
}
