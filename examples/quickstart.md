# Example: Quick Start with multi-agent-task

## 1. Setup

```bash
# Clone the repo
git clone https://github.com/h4ai/multi-agent-task.git
cd multi-agent-task

# Create a project directory
mkdir -p my-project/tasks my-project/.monitor
export MAT_PROJECT_DIR=$(pwd)/my-project
```

## 2. Create a Task

```bash
node scripts/create-task.js TASK-001 \
  --title "Implement login page" \
  --assignee dev \
  --class feature \
  --priority P0 \
  --timeout 60
```

## 3. Start Working

```bash
# Dev claims the task
node scripts/claim-task.js TASK-001

# Validate before execution
node scripts/validate-task.js --pre-execute TASK-001

# Mark as done (auto-records duration + resolves deps)
node scripts/update-task.js TASK-001 --status DONE --completed now
```

## 4. Monitor

```bash
# Health check
node scripts/health-check.js

# Stats
node scripts/stats.js

# Patrol (compliance)
node scripts/patrol.js
```

## 5. Inter-Agent Communication

```bash
# Initialize inbox
mkdir -p ~/.openclaw/shared/inbox/{pm,dev,qa,po,monitor,.events,.dead_letters}

# Dev notifies PM
node scripts/inbox.js send --to pm --from dev \
  --type task_done --task-id TASK-001 \
  --content "Login page done, 5/5 tests pass"

# PM checks inbox
node scripts/inbox.js receive --agent pm
```

## 6. Dashboard

```bash
./scripts/agent-board.sh start
./scripts/agent-board.sh attach
# Ctrl-B d to detach, Ctrl-B n/p to switch windows
```
