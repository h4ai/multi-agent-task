#!/bin/bash
# agent-board.sh — tmux Dashboard 实时监控多 Agent
#
# 借鉴 ClawTeam board 模块：tiled tmux view 实时观察所有 Agent。
# 适配 OpenClaw：监控 inbox、TASK 状态、日志。
#
# Usage:
#   ./agent-board.sh start      # 启动 dashboard
#   ./agent-board.sh stop       # 关闭 dashboard
#   ./agent-board.sh attach     # 进入 dashboard（Ctrl-B d 退出）
#   ./agent-board.sh status     # 查看是否运行中

SESSION="skillhub-board"
SCRIPTS_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPTS_DIR/../.." && pwd)"
SHARED_DIR="$HOME/.openclaw/shared"

case "${1:-help}" in
  start)
    if tmux has-session -t "$SESSION" 2>/dev/null; then
      echo "⚠️  Dashboard 已运行。用 '$0 attach' 进入。"
      exit 0
    fi

    echo "🚀 启动 Agent Dashboard..."

    # === Window 0: 总览 — 任务状态 + 健康检查 (每 30s 刷新) ===
    tmux new-session -d -s "$SESSION" -n "overview" \
      "watch -n 30 -c 'echo \"=== 任务状态 ===\"; node $SCRIPTS_DIR/stats.js; echo; echo \"=== 健康检查 ===\"; node $SCRIPTS_DIR/health-check.js; echo; echo \"=== 告警率 ===\"; node $SCRIPTS_DIR/patrol.js --json 2>/dev/null | node -e \"const d=JSON.parse(require(\\\"fs\\\").readFileSync(\\\"/dev/stdin\\\",\\\"utf8\\\")); console.log(\\\"Alert rate:\\\", d.alert_rate || \\\"N/A\\\")\" 2>/dev/null || echo \"patrol.js 未运行\"'"

    # === Window 1: Inbox 监控 — 所有 Agent 收件箱 (每 10s) ===
    tmux new-window -t "$SESSION" -n "inbox" \
      "watch -n 10 -c 'echo \"=== Agent 收件箱 ===\"; node $SCRIPTS_DIR/inbox.js count 2>/dev/null || echo \"inbox 未初始化\"; echo; echo \"=== 最近 10 条消息 ===\"; node $SCRIPTS_DIR/inbox.js history --limit 10 2>/dev/null || echo \"无历史\"'"

    # === Window 2: TASK JSON 变更监控 ===
    tmux new-window -t "$SESSION" -n "tasks" \
      "watch -n 15 -c 'echo \"=== TASK 状态 ===\"; for f in $PROJECT_DIR/tasks/TASK-*.json; do id=\$(basename \$f .json); status=\$(node -e \"console.log(JSON.parse(require(\\\"fs\\\").readFileSync(\\\"$f\\\",\\\"utf8\\\")).status)\" 2>/dev/null); printf \"%-12s %s\n\" \"\$id\" \"\$status\"; done'"

    # === Window 3: Git log 实时 ===
    tmux new-window -t "$SESSION" -n "git" \
      "watch -n 30 -c 'cd $PROJECT_DIR && git log --oneline -15 --decorate'"

    # === Window 4: Docker 容器状态 ===
    tmux new-window -t "$SESSION" -n "docker" \
      "watch -n 20 -c 'docker ps --format \"table {{.Names}}\t{{.Status}}\t{{.Ports}}\" 2>/dev/null || echo \"Docker 未运行\"'"

    # === Window 5: 后端日志（tail） ===
    tmux new-window -t "$SESSION" -n "backend-log" \
      "docker logs -f skillhub-backend --tail 50 2>&1 || echo '后端容器未运行。按 Ctrl-C 退出。' && sleep 9999"

    # 回到 overview
    tmux select-window -t "$SESSION:0"

    echo "✅ Dashboard 启动完成（6 个窗口）"
    echo "   用 '$0 attach' 进入查看"
    echo "   Ctrl-B d 退出（不关闭），Ctrl-B n/p 切换窗口"
    echo ""
    echo "窗口列表:"
    echo "  0:overview   — 任务统计 + 健康检查 + 告警率"
    echo "  1:inbox      — Agent 收件箱监控"
    echo "  2:tasks      — TASK JSON 状态一览"
    echo "  3:git        — 最近 Git 提交"
    echo "  4:docker     — 容器运行状态"
    echo "  5:backend-log — 后端实时日志"
    ;;

  stop)
    if tmux has-session -t "$SESSION" 2>/dev/null; then
      tmux kill-session -t "$SESSION"
      echo "✅ Dashboard 已关闭"
    else
      echo "ℹ️  Dashboard 未运行"
    fi
    ;;

  attach)
    if tmux has-session -t "$SESSION" 2>/dev/null; then
      tmux attach -t "$SESSION"
    else
      echo "⚠️  Dashboard 未运行。用 '$0 start' 启动。"
      exit 1
    fi
    ;;

  status)
    if tmux has-session -t "$SESSION" 2>/dev/null; then
      echo "✅ Dashboard 运行中"
      tmux list-windows -t "$SESSION" -F "  #{window_index}:#{window_name}"
    else
      echo "❌ Dashboard 未运行"
    fi
    ;;

  *)
    echo "Usage: $0 <start|stop|attach|status>"
    echo ""
    echo "  start   — 启动 6 窗口 tmux dashboard"
    echo "  stop    — 关闭 dashboard"
    echo "  attach  — 进入 dashboard (Ctrl-B d 退出)"
    echo "  status  — 检查是否运行中"
    ;;
esac
