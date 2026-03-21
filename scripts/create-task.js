#!/usr/bin/env node
/**
 * create-task.js — TASK JSON 模板生成器
 * 
 * Usage:
 *   node scripts/tasks/create-task.js --id TASK-014 --title "xxx" --assignee dev --priority P1
 *   node scripts/tasks/create-task.js --id TASK-014 --interactive   # 交互式
 *   node scripts/tasks/create-task.js --template                     # 输出空模板
 * 
 * 自动填充 Schema v2.4 必需字段，避免手写 JSON 出错。
 */

const fs = require('fs');
const path = require('path');

const tasksDir = path.resolve(__dirname, '../../tasks');

// Parse args
const args = process.argv.slice(2);
const getArg = (flag) => {
  const idx = args.indexOf(flag);
  return idx >= 0 && idx + 1 < args.length ? args[idx + 1] : null;
};
const hasFlag = (flag) => args.includes(flag);

const id = getArg('--id');
const title = getArg('--title');
const assignee = getArg('--assignee') || 'dev';
const priority = getArg('--priority') || 'P1';
const taskClass = getArg('--task-class') || 'feature';
const runtimeLevel = getArg('--runtime-level') || 'local';
const specId = getArg('--spec');
const wave = getArg('--wave') || 'wave-1';
const prereqs = getArg('--prereqs')?.split(',').filter(Boolean) || [];
const worktreeEnabled = assignee === 'dev';
const templateMode = hasFlag('--template');

// Valid values
const VALID_TASK_CLASS = ['security', 'feature', 'migration', 'ui-only', 'bugfix', 'infra'];
const VALID_RUNTIME_LEVEL = ['local', 'docker', 'full'];
const VALID_PRIORITY = ['P0', 'P1', 'P2'];
const VALID_ASSIGNEE = ['dev', 'qa', 'po'];
const VALID_STEP_TYPES = ['read_spec', 'implement', 'unit_test', 'runtime_verify', 'commit', 'update_task'];

function createTemplate(taskId, taskTitle) {
  const now = new Date().toISOString();
  
  return {
    id: taskId,
    title: taskTitle || '任务标题',
    priority: priority,
    status: 'PENDING',
    assignee: assignee,
    created: now.split('T')[0],
    updated: now,
    completed: null,
    task_class: taskClass,
    runtime_level: runtimeLevel,
    spec_context: {
      spec_id: specId || 'SPEC-007',
      sections: ['§TODO'],
      acceptance_criteria: [
        'AC-XXX-1: Given ..., When ..., Then ...'
      ],
      spec_file: specId ? `specs/${specId}.md` : 'specs/SPEC-007.md'
    },
    code_context: {
      files: [],
      tests: [],
      commits: [],
      branch: 'main'
    },
    doc_context: {
      design_docs: [],
      api_docs: [],
      references: []
    },
    env_context: {
      services: ['skillhub-frontend', 'skillhub-backend'],
      urls: {
        frontend: 'http://localhost',
        api: 'http://localhost:3000'
      },
      test_accounts: {
        admin: 'testadmin / Test123! (ADMIN)',
        user: 'user01 / Test123! (USER)'
      },
      docker_compose: 'deploy/docker/docker-compose.yml'
    },
    verification: {
      screenshots: [],
      logs: [],
      qa_report: null,
      commands: [],
      runtime_logs: {
        api_requests: [],
        browser_checks: [],
        backend_logs: []
      },
      regression_check: {
        homepage: null,
        search: null,
        login_logout: null
      }
    },
    notes: '',
    prerequisites: prereqs,
    steps: [
      {
        step_id: 'S1',
        title: '读取 Spec + 现有代码',
        type: 'read_spec',
        status: 'PENDING',
        evidence: null
      },
      {
        step_id: 'S2',
        title: '编码实现',
        type: 'implement',
        status: 'PENDING',
        evidence: null
      },
      {
        step_id: 'S3',
        title: '单元测试',
        type: 'unit_test',
        status: 'PENDING',
        evidence: null
      },
      {
        step_id: 'S4',
        title: '运行时验证',
        type: 'runtime_verify',
        status: 'PENDING',
        evidence: null
      },
      {
        step_id: 'S5',
        title: 'Git commit + 更新 TASK JSON',
        type: 'commit',
        status: 'PENDING',
        evidence: null
      }
    ],
    artifacts: [],
    event_log: [],
    execution: {
      mode: 'subagent',
      parallel_group: wave,
      timeout_minutes: 30,
      max_retries: 1
    },
    worktree: {
      enabled: worktreeEnabled,
      branch: worktreeEnabled ? `task/${taskId}` : null,
      path: worktreeEnabled ? `/home/azureuser/.openclaw/worktrees/${taskId}` : null,
      merge_strategy: worktreeEnabled ? 'no-ff' : null
    }
  };
}

// === Main ===

if (templateMode) {
  console.log(JSON.stringify(createTemplate('TASK-XXX', '模板任务'), null, 2));
  process.exit(0);
}

if (!id) {
  console.error('❌ Usage: node create-task.js --id TASK-XXX --title "任务标题" [options]');
  console.error('');
  console.error('Options:');
  console.error('  --id TASK-XXX          任务 ID（必填）');
  console.error('  --title "xxx"          任务标题（必填）');
  console.error('  --assignee dev|qa|po   执行者（默认 dev）');
  console.error('  --priority P0|P1|P2    优先级（默认 P1）');
  console.error('  --task-class xxx       分类: ' + VALID_TASK_CLASS.join('/'));
  console.error('  --runtime-level xxx    验证等级: ' + VALID_RUNTIME_LEVEL.join('/'));
  console.error('  --spec SPEC-007        关联 Spec');
  console.error('  --wave wave-1          所属 Wave');
  console.error('  --prereqs "T001,T002"  前置任务（逗号分隔）');
  console.error('  --template             输出空模板');
  process.exit(2);
}

if (!title) {
  console.error('❌ --title 是必填参数');
  process.exit(2);
}

// Validate
if (!VALID_PRIORITY.includes(priority)) {
  console.error(`❌ 无效 priority: ${priority}，允许: ${VALID_PRIORITY.join('/')}`);
  process.exit(2);
}
if (!VALID_ASSIGNEE.includes(assignee)) {
  console.error(`❌ 无效 assignee: ${assignee}，允许: ${VALID_ASSIGNEE.join('/')}`);
  process.exit(2);
}
if (!VALID_TASK_CLASS.includes(taskClass)) {
  console.error(`❌ 无效 task-class: ${taskClass}，允许: ${VALID_TASK_CLASS.join('/')}`);
  process.exit(2);
}

const filePath = path.join(tasksDir, `${id}.json`);
if (fs.existsSync(filePath)) {
  console.error(`❌ ${filePath} 已存在。如需覆盖，请先删除。`);
  process.exit(1);
}

const task = createTemplate(id, title);
fs.writeFileSync(filePath, JSON.stringify(task, null, 2));

console.log(`✅ Created ${filePath}`);
console.log(`   ID: ${id}`);
console.log(`   Title: ${title}`);
console.log(`   Assignee: ${assignee}`);
console.log(`   Priority: ${priority}`);
console.log(`   Task Class: ${taskClass}`);
console.log(`   Prerequisites: ${prereqs.length > 0 ? prereqs.join(', ') : '无'}`);
console.log(`   Worktree: ${worktreeEnabled ? `task/${id}` : 'disabled'}`);
console.log('');
console.log('📝 Next: 编辑 TASK JSON 补充 spec_context/code_context/steps，然后运行:');
console.log(`   node scripts/tasks/validate-task.js --pre-execute ${id}`);
