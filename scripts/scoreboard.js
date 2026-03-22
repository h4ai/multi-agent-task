#!/usr/bin/env node
/**
 * scoreboard.js — Agent 积分管理
 * 
 * 用法:
 *   node scoreboard.js show                           # 显示积分榜
 *   node scoreboard.js add <agent> <delta> "<reason>" # 加/扣分
 *   node scoreboard.js task-done <taskId> <agents...>  # 任务完成按 SOP 加分
 *   node scoreboard.js task-fail <taskId> <agents...>  # 任务未完成扣分
 */

const fs = require('fs');
const path = require('path');

const SCOREBOARD_FILE = path.join(__dirname, '../../tasks/SCOREBOARD.json');

function load() {
  return JSON.parse(fs.readFileSync(SCOREBOARD_FILE, 'utf-8'));
}

function save(data) {
  fs.writeFileSync(SCOREBOARD_FILE, JSON.stringify(data, null, 2) + '\n');
}

const [action, ...rest] = process.argv.slice(2);

if (!action || action === 'show') {
  const data = load();
  console.log('🏆 积分榜');
  console.log('═══════════════════════════════════');
  
  const sorted = Object.entries(data.agents)
    .sort((a, b) => b[1].score - a[1].score);
  
  let rank = 1;
  for (const [id, agent] of sorted) {
    const medal = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : '  ';
    const bar = '█'.repeat(Math.max(0, Math.floor(agent.score / 5)));
    console.log(`${medal} ${rank}. ${agent.name.padEnd(8)} ${String(agent.score).padStart(4)} 分  ${bar}`);
    rank++;
  }
  
  console.log('═══════════════════════════════════');
  console.log(`规则: 按 SOP 完成 → PM+2/其他+1 | 未完成 → -1`);
  
} else if (action === 'add') {
  const [agentId, deltaStr, ...reasonParts] = rest;
  const delta = parseInt(deltaStr);
  const reason = reasonParts.join(' ');
  
  if (!agentId || isNaN(delta) || !reason) {
    console.error('Usage: node scoreboard.js add <agent> <delta> <reason>');
    process.exit(1);
  }
  
  const data = load();
  if (!data.agents[agentId]) {
    console.error(`❌ Agent "${agentId}" not found. Available: ${Object.keys(data.agents).join(', ')}`);
    process.exit(1);
  }
  
  data.agents[agentId].score += delta;
  data.agents[agentId].history.push({
    timestamp: new Date().toISOString(),
    action: delta >= 0 ? 'reward' : 'penalty',
    delta,
    balance: data.agents[agentId].score,
    reason
  });
  
  save(data);
  const icon = delta >= 0 ? '✅' : '❌';
  console.log(`${icon} ${data.agents[agentId].name}: ${delta >= 0 ? '+' : ''}${delta} → ${data.agents[agentId].score} 分 (${reason})`);
  
} else if (action === 'task-done') {
  const [taskId, ...agents] = rest;
  if (!taskId || agents.length === 0) {
    console.error('Usage: node scoreboard.js task-done <taskId> <agent1> [agent2] ...');
    process.exit(1);
  }
  
  const data = load();
  const rules = data.rules.completion_with_sop;
  
  for (const agentId of agents) {
    if (!data.agents[agentId]) {
      console.error(`⚠️ Agent "${agentId}" not found, skipping`);
      continue;
    }
    const delta = rules[agentId] || 1;
    data.agents[agentId].score += delta;
    data.agents[agentId].history.push({
      timestamp: new Date().toISOString(),
      action: 'task_complete',
      delta,
      balance: data.agents[agentId].score,
      reason: `${taskId} 按 SOP 完成`
    });
    console.log(`✅ ${data.agents[agentId].name}: +${delta} → ${data.agents[agentId].score} 分 (${taskId})`);
  }
  
  save(data);
  
} else if (action === 'task-fail') {
  const [taskId, ...agents] = rest;
  if (!taskId || agents.length === 0) {
    console.error('Usage: node scoreboard.js task-fail <taskId> <agent1> [agent2] ...');
    process.exit(1);
  }
  
  const data = load();
  
  for (const agentId of agents) {
    if (!data.agents[agentId]) {
      console.error(`⚠️ Agent "${agentId}" not found, skipping`);
      continue;
    }
    data.agents[agentId].score -= 1;
    data.agents[agentId].history.push({
      timestamp: new Date().toISOString(),
      action: 'task_incomplete',
      delta: -1,
      balance: data.agents[agentId].score,
      reason: `${taskId} 未完成`
    });
    console.log(`❌ ${data.agents[agentId].name}: -1 → ${data.agents[agentId].score} 分 (${taskId} 未完成)`);
  }
  
  save(data);
  
} else {
  console.error(`Unknown action: ${action}`);
  console.error('Usage: show | add <agent> <delta> <reason> | task-done <taskId> <agents...> | task-fail <taskId> <agents...>');
  process.exit(1);
}
