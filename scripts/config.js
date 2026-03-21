/**
 * config.js — 共享配置模块
 * 
 * 所有脚本通过此模块获取路径配置。
 * 支持两种模式：
 *   1. 独立使用：通过环境变量 MAT_PROJECT_DIR 或 MAT_TASKS_DIR 指定
 *   2. 嵌入项目：自动检测 ../../tasks 相对路径
 * 
 * 环境变量:
 *   MAT_PROJECT_DIR  — 项目根目录（包含 tasks/ 子目录）
 *   MAT_TASKS_DIR    — 直接指定 tasks 目录
 *   MAT_SHARED_DIR   — 共享目录（默认 ~/.openclaw/shared）
 *   MAT_MONITOR_DIR  — 监控数据目录（默认 {project}/.monitor）
 */

const path = require('path');
const os = require('os');
const fs = require('fs');

function resolveProjectDir() {
  // 1. 环境变量优先
  if (process.env.MAT_PROJECT_DIR) return process.env.MAT_PROJECT_DIR;
  
  // 2. 检测 ../../tasks（嵌入项目模式）
  const embedded = path.resolve(__dirname, '../..');
  if (fs.existsSync(path.join(embedded, 'tasks'))) return embedded;
  
  // 3. 检测 ../tasks（直接在 scripts/ 同级）
  const sibling = path.resolve(__dirname, '..');
  if (fs.existsSync(path.join(sibling, 'tasks'))) return sibling;
  
  // 4. 当前目录
  if (fs.existsSync(path.join(process.cwd(), 'tasks'))) return process.cwd();
  
  return null;
}

const projectDir = resolveProjectDir();

module.exports = {
  projectDir,
  tasksDir: process.env.MAT_TASKS_DIR || (projectDir ? path.join(projectDir, 'tasks') : null),
  monitorDir: process.env.MAT_MONITOR_DIR || (projectDir ? path.join(projectDir, '.monitor') : null),
  sharedDir: process.env.MAT_SHARED_DIR || path.join(os.homedir(), '.openclaw', 'shared'),
  scriptsDir: __dirname,
  
  // 工具函数
  requireTasksDir() {
    const dir = this.tasksDir;
    if (!dir || !fs.existsSync(dir)) {
      console.error('❌ 未找到 tasks 目录。请设置 MAT_PROJECT_DIR 或 MAT_TASKS_DIR 环境变量。');
      console.error('   或将脚本放在项目的 scripts/tasks/ 子目录下。');
      process.exit(2);
    }
    return dir;
  },
  
  loadTasks() {
    const dir = this.requireTasksDir();
    return fs.readdirSync(dir)
      .filter(f => /^TASK-\d+[A-Z]?\.json$/.test(f))
      .map(f => {
        try {
          return JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
        } catch { return null; }
      })
      .filter(Boolean);
  }
};
