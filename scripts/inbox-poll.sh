#!/bin/bash
# inbox-poll.sh — 系统级 crontab 轮询脚本（零 token）
#
# 检查各 Agent inbox 是否有新消息，有则触发对应 openclaw cron job。
# 纯文件系统操作，不消耗任何模型 token。
#
# 系统 crontab 配置（每 5 分钟）：
#   */5 * * * * /home/azureuser/multi-agent-task/scripts/inbox-poll.sh >> /var/log/inbox-poll.log 2>&1
#
# 环境变量：
#   MAT_SHARED_DIR — 共享目录（默认 ~/.openclaw/shared）
#   INBOX_POLL_LOG — 日志文件（默认 /var/log/inbox-poll.log）

set -euo pipefail

SHARED_DIR="${MAT_SHARED_DIR:-$HOME/.openclaw/shared}"
INBOX_ROOT="$SHARED_DIR/inbox"
SCRIPTS_DIR="$(cd "$(dirname "$0")" && pwd)"
LOG_DIR="$SHARED_DIR/inbox/.poll-log"
TIMESTAMP=$(date '+%Y-%m-%d %H:%M:%S')

mkdir -p "$LOG_DIR"

# === Agent → Cron Job 映射 ===
# 格式: AGENT_NAME:CRON_JOB_NAME
# cron job 需提前用 openclaw cron add 创建（disabled 状态）
declare -A AGENT_JOBS=(
  ["dev"]="dev-inbox-check"
  ["qa"]="qa-inbox-check"
  ["po"]="po-inbox-check"
  ["monitor"]="monitor-inbox-check"
)

# PM 走 heartbeat，不需要 inbox 触发
# ["pm"]="pm-inbox-check"

triggered=0
checked=0

for agent in "${!AGENT_JOBS[@]}"; do
  inbox_dir="$INBOX_ROOT/$agent"
  job_name="${AGENT_JOBS[$agent]}"
  
  # 计算待处理消息数（只看 .json，不看 .consumed）
  if [ -d "$inbox_dir" ]; then
    msg_count=$(find "$inbox_dir" -maxdepth 1 -name 'msg-*.json' -type f 2>/dev/null | wc -l)
  else
    msg_count=0
  fi
  
  checked=$((checked + 1))
  
  if [ "$msg_count" -gt 0 ]; then
    # 检查是否有 urgent 消息
    has_urgent=false
    for f in "$inbox_dir"/msg-*.json; do
      [ -f "$f" ] || continue
      if grep -q '"priority".*"urgent"' "$f" 2>/dev/null; then
        has_urgent=true
        break
      fi
    done
    
    priority_tag="normal"
    if [ "$has_urgent" = true ]; then
      priority_tag="URGENT"
    fi
    
    echo "[$TIMESTAMP] 📩 $agent: $msg_count 条新消息 ($priority_tag) → 触发 $job_name"
    
    # 触发 openclaw cron job
    if openclaw cron run "$job_name" 2>/dev/null; then
      echo "[$TIMESTAMP] ✅ $agent: $job_name 已触发"
      triggered=$((triggered + 1))
    else
      echo "[$TIMESTAMP] ❌ $agent: $job_name 触发失败（job 不存在或 gateway 未运行）"
      
      # Fallback: 直接用 openclaw agent 发消息
      echo "[$TIMESTAMP] 🔄 $agent: fallback → openclaw agent --agent $agent"
      openclaw agent --agent "$agent" \
        --message "你的 inbox 有 $msg_count 条新消息（$priority_tag），请执行: node scripts/tasks/inbox.js receive --agent $agent --json" \
        --timeout 300 \
        --session isolated \
        2>/dev/null &
      triggered=$((triggered + 1))
    fi
    
    # 写入触发记录
    echo "{\"timestamp\":\"$TIMESTAMP\",\"agent\":\"$agent\",\"messages\":$msg_count,\"priority\":\"$priority_tag\",\"job\":\"$job_name\"}" >> "$LOG_DIR/triggers.jsonl"
  fi
done

if [ "$triggered" -eq 0 ]; then
  # 完全静默，不写日志（节省磁盘）
  :
else
  echo "[$TIMESTAMP] 📊 检查 $checked 个 Agent, 触发 $triggered 个"
fi
