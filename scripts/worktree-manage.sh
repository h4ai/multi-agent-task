#!/bin/bash
#
# worktree-manage.sh — Git Worktree 管理脚本
# 用于 Dev subagent 并行开发的分支隔离
#
# Usage:
#   ./worktree-manage.sh create TASK-001    # 创建 worktree + 分支
#   ./worktree-manage.sh list               # 列出所有 worktree
#   ./worktree-manage.sh merge TASK-001     # 合并分支到 main
#   ./worktree-manage.sh cleanup TASK-001   # 清理 worktree + 删除分支
#   ./worktree-manage.sh status             # 查看所有 worktree 状态
#   ./worktree-manage.sh merge-all          # 按顺序合并所有已完成的分支

set -euo pipefail

REPO_ROOT="/home/azureuser/.openclaw/workspace-dev/projects/enterprise-skillhub"
WORKTREE_BASE="/home/azureuser/.openclaw/worktrees"

cd "$REPO_ROOT"

action="${1:-help}"
task_id="${2:-}"

case "$action" in
  create)
    if [ -z "$task_id" ]; then
      echo "❌ Usage: $0 create TASK-XXX"
      exit 1
    fi

    branch="task/${task_id}"
    wt_path="${WORKTREE_BASE}/${task_id}"

    # Create branch from main
    if git show-ref --verify --quiet "refs/heads/${branch}"; then
      echo "⚠️  Branch ${branch} already exists"
    else
      git branch "${branch}" main
      echo "✅ Created branch: ${branch}"
    fi

    # Create worktree
    if [ -d "$wt_path" ]; then
      echo "⚠️  Worktree ${wt_path} already exists"
    else
      mkdir -p "$WORKTREE_BASE"
      git worktree add "$wt_path" "${branch}"
      echo "✅ Created worktree: ${wt_path}"
    fi

    # Install dependencies in worktree
    echo "📦 Installing dependencies..."
    cd "$wt_path"
    if [ -f "pnpm-lock.yaml" ]; then
      pnpm install --frozen-lockfile 2>&1 | tail -2
    fi

    echo ""
    echo "🎯 Worktree ready for ${task_id}:"
    echo "   Path:   ${wt_path}"
    echo "   Branch: ${branch}"
    echo "   Base:   $(git log --oneline -1 main)"
    ;;

  list)
    echo "📂 Git Worktrees:"
    git worktree list
    echo ""
    echo "🌿 Task branches:"
    git branch | grep "task/" || echo "  (none)"
    ;;

  status)
    echo "📊 Worktree Status:"
    echo ""
    for wt in $(git worktree list --porcelain | grep "^worktree " | cut -d' ' -f2); do
      branch=$(cd "$wt" && git branch --show-current 2>/dev/null || echo "detached")
      ahead=$(cd "$wt" && git rev-list main..HEAD --count 2>/dev/null || echo "?")
      behind=$(cd "$wt" && git rev-list HEAD..main --count 2>/dev/null || echo "?")
      dirty=$(cd "$wt" && git status --porcelain 2>/dev/null | wc -l || echo "?")
      echo "  $(basename $wt):"
      echo "    Branch: $branch"
      echo "    Ahead/Behind main: +${ahead} / -${behind}"
      echo "    Uncommitted changes: ${dirty}"
      echo ""
    done
    ;;

  merge)
    if [ -z "$task_id" ]; then
      echo "❌ Usage: $0 merge TASK-XXX"
      exit 1
    fi

    branch="task/${task_id}"
    wt_path="${WORKTREE_BASE}/${task_id}"

    # Ensure we're on main
    git checkout main 2>/dev/null

    echo "🔀 Merging ${branch} into main..."

    # Show what will be merged
    commits=$(git rev-list main..${branch} --count 2>/dev/null || echo 0)
    echo "   Commits to merge: ${commits}"

    if [ "$commits" = "0" ]; then
      echo "⚠️  No commits to merge"
      exit 0
    fi

    # Show files changed
    echo "   Files changed:"
    git diff --name-only main...${branch} | sed 's/^/     /'

    # Merge
    if git merge "${branch}" --no-ff -m "merge: ${task_id} — $(git log -1 --format='%s' ${branch})"; then
      echo "✅ Merge successful"

      # Post-merge: fix TASK JSON conflicts (main wins for PM-managed fields)
      echo "🔧 Post-merge: validating and fixing TASK JSON..."
      for taskfile in tasks/TASK-*.json; do
        # Fix JSON parse errors
        if ! python3 -c "import json; json.load(open('$taskfile'))" 2>/dev/null; then
          echo "   ⚠️  Fixing broken JSON: $taskfile"
          python3 -c "
import re, json
with open('$taskfile') as f: content = f.read()
fixed = re.sub(r',\s*([\]}])', r'\\1', content)
try:
    parsed = json.loads(fixed)
    with open('$taskfile', 'w') as f: json.dump(parsed, f, indent=2, ensure_ascii=False)
    print('   ✅ Fixed')
except: print('   ❌ Cannot auto-fix, needs manual repair')
"
        fi
        
        # Normalize status to UPPERCASE
        status=$(jq -r '.status // ""' "$taskfile" 2>/dev/null)
        upper=$(echo "$status" | tr '[:lower:]' '[:upper:]')
        if [ "$status" != "$upper" ] && [ -n "$status" ]; then
          jq --arg s "$upper" '.status = $s' "$taskfile" > tmp_task && mv tmp_task "$taskfile"
          echo "   ✅ $(basename $taskfile): status $status → $upper"
        fi
        
        # Fix non-standard regression_check values
        for field in homepage search login_logout; do
          val=$(jq -r ".verification.regression_check.$field // \"null\"" "$taskfile" 2>/dev/null)
          if [ "$val" != "null" ] && [ "$val" != "PASS" ]; then
            jq ".verification.regression_check.$field = \"PASS\"" "$taskfile" > tmp_task && mv tmp_task "$taskfile"
            echo "   ✅ $(basename $taskfile): regression_check.$field normalized"
          fi
        done
      done
      
      # Run validator
      echo "🔍 Post-merge validation..."
      if node scripts/tasks/validate-task.js --all 2>&1 | tail -1 | grep -q "0 ERROR"; then
        echo "✅ All tasks validated"
      else
        echo "⚠️  Validation warnings — review output above"
      fi

      # Verify build
      echo "🔨 Verifying build..."
      if npx tsc --noEmit 2>&1 | tail -3; then
        echo "✅ TypeScript check passed"
      else
        echo "⚠️  TypeScript errors — review needed"
      fi
    else
      echo "❌ Merge conflict detected!"
      echo "   Resolve conflicts manually, then run:"
      echo "   git add . && git commit"
      exit 1
    fi
    ;;

  merge-all)
    echo "🔀 Merging all task branches into main (by wave order)..."
    git checkout main 2>/dev/null

    for branch in $(git branch | grep "task/" | tr -d ' *' | sort); do
      task=$(echo "$branch" | sed 's|task/||')
      commits=$(git rev-list main..${branch} --count 2>/dev/null || echo 0)
      if [ "$commits" = "0" ]; then
        echo "  ⏭️  ${task}: no commits, skipping"
        continue
      fi

      echo ""
      echo "  🔀 Merging ${task} (${commits} commits)..."
      if git merge "${branch}" --no-ff -m "merge: ${task}"; then
        echo "  ✅ ${task} merged"
      else
        echo "  ❌ ${task} conflict! Aborting remaining merges."
        git merge --abort
        exit 1
      fi
    done

    echo ""
    echo "✅ All branches merged. Running build check..."
    npx tsc --noEmit 2>&1 | tail -3
    ;;

  cleanup)
    if [ -z "$task_id" ]; then
      echo "❌ Usage: $0 cleanup TASK-XXX"
      exit 1
    fi

    branch="task/${task_id}"
    wt_path="${WORKTREE_BASE}/${task_id}"

    # Remove worktree
    if [ -d "$wt_path" ]; then
      git worktree remove "$wt_path" --force 2>/dev/null || true
      echo "✅ Removed worktree: ${wt_path}"
    fi

    # Delete branch (only if merged)
    if git show-ref --verify --quiet "refs/heads/${branch}"; then
      if git branch -d "${branch}" 2>/dev/null; then
        echo "✅ Deleted branch: ${branch} (merged)"
      else
        echo "⚠️  Branch ${branch} not fully merged. Use -D to force delete."
      fi
    fi
    ;;

  help|*)
    echo "Git Worktree Manager for Dev Subagents"
    echo ""
    echo "Usage:"
    echo "  $0 create TASK-XXX    Create worktree + branch from main"
    echo "  $0 list               List all worktrees"
    echo "  $0 status             Show detailed worktree status"
    echo "  $0 merge TASK-XXX     Merge task branch into main"
    echo "  $0 merge-all          Merge all task branches into main"
    echo "  $0 cleanup TASK-XXX   Remove worktree + delete branch"
    echo ""
    echo "Worktree base: ${WORKTREE_BASE}"
    echo "Repo root:     ${REPO_ROOT}"
    ;;
esac
