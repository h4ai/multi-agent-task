# multi-agent-task

Multi-Agent Task Orchestration Framework for [OpenClaw](https://github.com/openclaw/openclaw).

A file-based, script-driven infrastructure for coordinating multiple AI agents (PM, Dev, QA, PO, Monitor) in software development workflows. Inspired by [ClawTeam](https://github.com/HKUDS/ClawTeam)'s swarm intelligence, built for enterprise-grade quality assurance.

## Philosophy

> **Scripts do work, models make decisions.**

Every operation is a Node.js/Bash script that outputs structured JSON. AI agents call scripts and interpret results — no model tokens wasted on parsing files or checking status.

## Architecture

```
┌─────────┐     ┌──────────┐     ┌─────────┐
│   PM    │────▶│  inbox/  │◀────│   Dev   │
│ Agent   │     │ (files)  │     │ Agent   │
└────┬────┘     └──────────┘     └────┬────┘
     │               ▲                │
     │          ┌────┴─────┐          │
     ▼          │  tasks/  │          ▼
┌─────────┐    │  (JSON)  │    ┌─────────┐
│   QA    │    └──────────┘    │ Monitor │
│ Agent   │         ▲          │ Agent   │
└─────────┘         │          └─────────┘
                ┌───┴────┐
                │   PO   │
                │ Agent  │
                └────────┘
```

## Quick Start

### 1. Install

```bash
git clone https://github.com/h4ai/multi-agent-task.git
cd multi-agent-task
```

### 2. Setup for your project

```bash
# Option A: Set environment variable
export MAT_PROJECT_DIR=/path/to/your/project

# Option B: Symlink into your project
cd your-project
ln -s /path/to/multi-agent-task/scripts scripts/tasks
```

### 3. Initialize

```bash
# Create tasks directory
mkdir -p tasks .monitor

# Create first task
node scripts/create-task.js TASK-001 \
  --title "My first task" \
  --assignee dev \
  --class feature
```

## Scripts

### Task Lifecycle

| Script | Purpose |
|--------|---------|
| `create-task.js` | Create new TASK JSON (schema-compliant) |
| `update-task.js` | Safe updates with validation + auto-timing + dep resolution |
| `claim-task.js` | Agent claims a task (checks prerequisites) |
| `validate-task.js` | 30+ rule validation (pre-execution gate) |
| `gatecheck.sh` | Delivery gate check (artifacts/tests/docs) |

### Monitoring & Health

| Script | Purpose |
|--------|---------|
| `health-check.js` | Zombie task detection (timeout-based) |
| `patrol.js` | Compliance patrol with alert rate tracking |
| `pm-heartbeat.js` | PM heartbeat: gate check + auto-promote DONE |
| `monitor-check.js` | Full compliance check (11 rules) |
| `stats.js` | Task duration/role/status statistics |

### Communication & Infrastructure

| Script | Purpose |
|--------|---------|
| `inbox.js` | File-based inter-agent messaging (atomic, zero model calls) |
| `agent-board.sh` | tmux dashboard (6 monitoring windows) |
| `worktree-manage.sh` | Git worktree management for parallel tasks |

## TASK JSON Schema

Each task is a JSON file with 30+ structured fields:

```json
{
  "id": "TASK-001",
  "title": "Implement user auth",
  "status": "IN_PROGRESS",
  "task_class": "feature",
  "assignee": "dev",
  "priority": "P0",
  "timeout": 60,
  "prerequisites": ["TASK-000"],
  "steps": [
    { "step_id": "S1", "description": "Write tests", "status": "DONE" }
  ],
  "code_context": {
    "commits": ["abc1234"],
    "files": ["src/auth.ts"]
  },
  "verification": {
    "runtime_logs": { "api_requests": [...] },
    "regression_check": { "homepage": "PASS", "login_logout": "PASS" },
    "qa_report": "15/15 test cases passed"
  },
  "artifacts": [
    { "type": "code", "path": "src/auth.ts" }
  ],
  "event_log": [
    { "event_id": "EVT-1", "type": "status_changed", "timestamp": "..." }
  ]
}
```

See [templates/TASK-SCHEMA.json](templates/TASK-SCHEMA.json) for full schema.

## Status Transitions

```
PENDING → IN_PROGRESS → REVIEW → DONE
           ↕ BLOCKED ↕
PENDING/IN_PROGRESS → CANCELED
```

Illegal jumps (e.g., PENDING → DONE) are rejected by `update-task.js`.

## Inbox (Inter-Agent Messaging)

Zero-model-call communication between agents:

```bash
# Send
node scripts/inbox.js send --to pm --from dev \
  --type task_done --task-id TASK-001 \
  --content "5/5 AC PASS, 2.3h elapsed"

# Receive (consume)
node scripts/inbox.js receive --agent pm --json

# Peek (don't consume)
node scripts/inbox.js peek --agent pm

# Broadcast
node scripts/inbox.js broadcast --from pm \
  --content "Sprint complete" --exclude monitor

# Count
node scripts/inbox.js count
```

Implementation: atomic writes (tmp→rename), claim→consumed→ack pattern, dead letter queue. Adapted from [ClawTeam FileTransport](https://github.com/HKUDS/ClawTeam/blob/main/clawteam/transport/file.py).

## tmux Dashboard

```bash
./scripts/agent-board.sh start    # Launch 6-window dashboard
./scripts/agent-board.sh attach   # Enter (Ctrl-B d to detach)
./scripts/agent-board.sh stop     # Teardown
```

Windows:
- `overview` — Task stats + health check + alert rate (30s refresh)
- `inbox` — Agent inbox monitoring (10s refresh)
- `tasks` — TASK JSON status overview (15s refresh)
- `git` — Recent commits (30s refresh)
- `docker` — Container status (20s refresh)
- `backend-log` — Backend live logs

## Quality Gates (4-Layer Defense)

1. **PM Coverage Matrix** — Every spec section tracked
2. **Dev Checklist** — TDD + implementation verification
3. **QA AC Testing** — Spec AC cross-checked against dev claims
4. **PO Acceptance** — ≥95% coverage required

Gate scripts enforce file existence between phases:
```
Dev done → checklist exists? → QA
QA done → report exists? → PO
PO done → acceptance exists? → Next Sprint
```

## Inspired By

- **[ClawTeam](https://github.com/HKUDS/ClawTeam)** — File transport, dead letters, dep resolution, duration tracking, tmux board
- **OpenClaw** — Session management, agent routing, multi-channel delivery

## License

MIT
