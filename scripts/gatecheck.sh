#!/bin/bash
# Gate Check Script — 自动验证 TASK JSON 交付物完整性
# Usage: ./scripts/tasks/gatecheck.sh TASK-XXX

set -e

TASK_ID="${1:?Usage: gatecheck.sh TASK-XXX}"
TASK_FILE="tasks/${TASK_ID}.json"

if [ ! -f "$TASK_FILE" ]; then
  echo "❌ ERROR: $TASK_FILE not found"
  exit 1
fi

echo "🔍 Gate Check: $TASK_ID"
echo "================================"

STATUS=$(jq -r '.status' "$TASK_FILE")
ASSIGNEE=$(jq -r '.assignee' "$TASK_FILE")
TASK_CLASS=$(jq -r '.task_class // "unknown"' "$TASK_FILE")
RUNTIME_LEVEL=$(jq -r '.runtime_level // "unknown"' "$TASK_FILE")

echo "Status: $STATUS | Assignee: $ASSIGNEE | Class: $TASK_CLASS | Runtime: $RUNTIME_LEVEL"
echo ""

PASS=0
FAIL=0
WARN=0

check() {
  local desc="$1"
  local result="$2"
  if [ "$result" = "true" ]; then
    echo "  ✅ $desc"
    PASS=$((PASS + 1))
  else
    echo "  ❌ $desc"
    FAIL=$((FAIL + 1))
  fi
}

warn() {
  local desc="$1"
  echo "  ⚠️  $desc"
  WARN=$((WARN + 1))
}

# --- Common checks ---
echo "📋 Common Checks:"
check "status is REVIEW or DONE" "$(jq -r '.status == "REVIEW" or .status == "DONE" or .status == "review" or .status == "done"' "$TASK_FILE")"
check "updated field is set" "$(jq -r '.updated != null and .updated != ""' "$TASK_FILE")"

AC_COUNT=$(jq -r '.spec_context.acceptance_criteria | length' "$TASK_FILE")
check "has acceptance_criteria ($AC_COUNT)" "$([ "$AC_COUNT" -gt 0 ] && echo true || echo false)"

EVENT_COUNT=$(jq -r '.event_log // [] | length' "$TASK_FILE")
check "has event_log entries ($EVENT_COUNT)" "$([ "$EVENT_COUNT" -gt 0 ] && echo true || echo false)"

# --- Dev-specific checks ---
if [ "$ASSIGNEE" = "dev" ]; then
  echo ""
  echo "🔧 Dev Checks:"
  
  COMMIT_COUNT=$(jq -r '.code_context.commits | length' "$TASK_FILE")
  check "has commits ($COMMIT_COUNT)" "$([ "$COMMIT_COUNT" -gt 0 ] && echo true || echo false)"
  
  ARTIFACT_COUNT=$(jq -r '.artifacts // [] | length' "$TASK_FILE")
  check "has artifacts ($ARTIFACT_COUNT)" "$([ "$ARTIFACT_COUNT" -gt 0 ] && echo true || echo false)"
  
  # Runtime logs check
  API_LOG_COUNT=$(jq -r '.verification.runtime_logs.api_requests // [] | length' "$TASK_FILE")
  BROWSER_COUNT=$(jq -r '.verification.runtime_logs.browser_checks // [] | length' "$TASK_FILE")
  BACKEND_LOG_COUNT=$(jq -r '.verification.runtime_logs.backend_logs // [] | length' "$TASK_FILE")
  TOTAL_EVIDENCE=$((API_LOG_COUNT + BROWSER_COUNT + BACKEND_LOG_COUNT))
  check "has runtime evidence ($TOTAL_EVIDENCE entries)" "$([ "$TOTAL_EVIDENCE" -gt 0 ] && echo true || echo false)"
  
  # Regression check
  HOMEPAGE=$(jq -r '.verification.regression_check.homepage // "null"' "$TASK_FILE")
  SEARCH=$(jq -r '.verification.regression_check.search // "null"' "$TASK_FILE")
  LOGIN=$(jq -r '.verification.regression_check.login_logout // "null"' "$TASK_FILE")
  
  if [ "$HOMEPAGE" = "PASS" ] && [ "$SEARCH" = "PASS" ] && [ "$LOGIN" = "PASS" ]; then
    check "regression_check all PASS" "true"
  else
    check "regression_check all PASS (homepage=$HOMEPAGE search=$SEARCH login=$LOGIN)" "false"
  fi
fi

# --- QA-specific checks ---
if [ "$ASSIGNEE" = "qa" ]; then
  echo ""
  echo "🧪 QA Checks:"
  
  SCREENSHOT_COUNT=$(jq -r '.verification.screenshots // [] | length' "$TASK_FILE")
  check "has screenshots ($SCREENSHOT_COUNT)" "$([ "$SCREENSHOT_COUNT" -gt 0 ] && echo true || echo false)"
  
  QA_REPORT=$(jq -r '.verification.qa_report // ""' "$TASK_FILE")
  check "has qa_report path" "$([ -n "$QA_REPORT" ] && echo true || echo false)"
fi

echo ""
echo "================================"
echo "Results: ✅ $PASS PASS | ❌ $FAIL FAIL | ⚠️  $WARN WARN"

if [ "$FAIL" -gt 0 ]; then
  echo "🚫 GATE CHECK FAILED — 请补全缺失项后重新提交"
  exit 1
else
  echo "✅ GATE CHECK PASSED"
  exit 0
fi
