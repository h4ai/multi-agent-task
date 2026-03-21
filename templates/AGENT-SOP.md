# Agent 标准作业流程（SOP）

> 版本: v2.1 | 创建: 2026-03-21
> v1.1: 新增 Dev Runtime Verification Phase
> v1.2: 修复 QA 审查 P0 问题（状态机/SSOT/回滚/并行冲突/Hotfix）
> v2.0: 融合多Agent框架调研精华（Step子任务/守卫条件/事件日志/Artifacts）
> v2.1: 整合 Dev/PO 审查反馈（TDD分级/Verify分级/任务拆分/门禁脚本/证据迁移）
> 目的: 确保每个 Agent 读取和执行任务时完全符合流程，零偏差

---

## 通用规则（所有 Agent 必须遵守）

### 1. 任务生命周期与状态机

```
pending → in_progress → review → done
    ↘        ↘           ↘
  canceled   blocked     in_progress (打回)
               ↓
           in_progress (解除阻塞后)
```

**合法状态转换（严格执行，禁止跳转）：**

| 当前状态 | 允许转换到 | 条件 |
|----------|-----------|------|
| pending | in_progress | dependencies 全部 done |
| pending | blocked | 发现外部阻塞 |
| pending | canceled | PM 决定取消，需填 cancellation_reason |
| in_progress | review | 所有 AC 验证完成 |
| in_progress | blocked | 遇到阻塞 |
| in_progress | canceled | PM 决定取消，需 revert commits |
| review | done | PM 门禁通过 |
| review | in_progress | PM 门禁打回，需填 rejection_reason |
| blocked | in_progress | 阻塞解除，需清空 blocked_reason |
| done | in_progress | 仅限 hotfix/reopen，需填 reopen_reason |
| canceled | pending | 重新激活，需填 reactivation_reason |

**禁止的转换（绝对不允许）：**
- ❌ pending → done（跳过执行）
- ❌ pending → review（跳过执行）
- ❌ in_progress → done（跳过 review）
- ❌ blocked → done（跳过解除阻塞）

### 1.1 Step 子任务结构（v2.0 新增）

每个 Task 由多个有序 Steps 组成，形成 DAG（有向无环图）。Step 是执行的最小单位。

```
典型 Task 的 Step DAG：

S0:read_spec → S1:plan → S2:implement → S3:test → S4:runtime_verify → S5:self_check
                              ↑                          ↑
                          guard: S1 DONE            guard: S2+S3 DONE
```

**Step 类型（type）：**
- `read_spec` — 读取 Spec 原文和任务上下文
- `plan` — 生成 Implementation Checklist
- `implement` — 编码实现
- `test` — 编写和运行测试
- `runtime_verify` — Docker 构建 + API/浏览器验证 + 日志对照
- `review` — 代码/功能审查
- `deploy` — 部署到环境

**Step 状态（独立于 Task 状态）：**
```
PENDING → READY → RUNNING → DONE
                     ↘ FAILED (可重试 → READY)
                     ↘ WAITING_HUMAN (需人工审批)
```

**关键规则：**
- Step 的 `inputs` 和 `outputs` 必须是结构化数据（JSON），不能只是自然语言描述
- Step 进入 RUNNING 前必须检查 `depends_on_steps` 全部 DONE
- Step 进入 DONE 前必须检查 `outputs.actual` 非空

### 1.2 守卫条件（Guard Conditions）（v2.0 新增）

守卫条件是状态转换的**硬约束**，不满足则转换被拒绝。

**Task 级守卫：**
- `enter_REVIEW`：所有 implement/test/runtime_verify steps 必须 DONE
- `enter_DONE`：PM 门禁通过 + regression_check 全 PASS

**Step 级守卫：**
- `implement` 不能 DONE，除非对应的 `test` step PASS 或被 PM 明确豁免
- `runtime_verify` 不能 DONE，除非 Docker health check PASS + 至少 1 个 API 请求验证
- `deploy` 不能 RUNNING，除非 review step DONE

**豁免流程（仅限 PM/沈老板）：**
```
如果守卫条件需要豁免：
1. 在 event_log 记录 "guard_exemption" 事件
2. 必填 reason + approver
3. PM 在门禁检查时必须审查所有 exemption
```

### 1.3 Event Log 事件日志（v2.0 新增）

每个 TASK JSON 包含 `event_log[]`——一个 **append-only** 的事件数组。

**规则：**
- 每次状态变更必须追加一条事件（不修改已有事件）
- 事件类型见 SCHEMA.json 的 `event_log[].type`
- 每条事件必须包含：`actor`（谁）、`timestamp`（何时）、`payload`（什么）
- 事件日志是**系统真相**——当 JSON 字段和 event_log 矛盾时，以 event_log 为准

**Agent 写入事件的标准格式：**
```json
{
  "event_id": "EVT-{seq}",
  "type": "step_done",
  "actor": "dev",
  "step_id": "S2",
  "timestamp": "2026-03-21T15:30:00+08:00",
  "payload": {
    "from_status": "RUNNING",
    "to_status": "DONE",
    "evidence": "commit abc1234, tsc 0 errors"
  }
}
```

### 1.4 Artifacts 产物管理（v2.0 新增）

每个 TASK JSON 包含 `artifacts[]`——结构化记录所有产出物。

**产物类型（kind）：**
- `commit` — Git commit（uri 格式：`git:<hash>`）
- `diff` — 代码变更（uri 格式：文件路径）
- `test_report` — 测试报告（uri 格式：文件路径）
- `screenshot` — 截图（uri 格式：文件路径）
- `api_log` — API 请求/响应记录
- `pdf` — PDF 报告
- `backend_log` — 后端日志片段

**规则：**
- 每个 Step 完成后必须在 `artifacts[]` 注册其产出
- 关键产物建议附 `sha256` 校验（防篡改）
- PM 门禁检查时会验证：每个 AC 至少有 1 个对应 artifact

### 1.5 任务分级策略（v2.1 新增）

每个 TASK JSON 包含两个分级字段，决定 TDD 和 Runtime Verification 的执行力度：

**task_class（任务类型）→ 决定 TDD 策略：**

| task_class | 说明 | TDD 要求 |
|------------|------|---------|
| `security` | 权限/认证/路由守卫 | **必须 TDD**：先写测试再实现，每个 AC 至少 1 个单测 |
| `feature` | 新功能/业务逻辑 | **建议 TDD**：核心 AC 需单测，UI 展示类可用截图替代 |
| `migration` | 技术栈迁移/重构 | **允许 TAD**：先实现后补测试，需在 notes 中说明原因 |
| `ui-only` | 纯 UI/样式/文案 | **免单测**：Playwright 截图 + Console 无 Error 即可 |
| `bugfix` | Bug 修复 | **回归测试优先**：先写复现 Bug 的测试，再修复 |
| `infra` | 基础设施/CI/部署 | **允许 TAD**：以 Runtime Verify 结果为主要证据 |

**runtime_level（验证等级）→ 决定 Runtime Verification 力度：**

| runtime_level | 说明 | 触发条件 |
|---------------|------|---------|
| `local` | 本地 `pnpm dev` + curl smoke + tsc + test | 默认等级。纯前端 UI 改动、样式修复 |
| `docker` | Docker build + compose up + health check + 完整 API/浏览器验证 | 改了 Dockerfile/依赖/后端 API/跨域/Cookie/环境变量 |

**PM 在创建 TASK 时必须指定这两个字段。Dev 如认为分级不合理，可在 event_log 中提出调整请求。**

### 1.6 证据管理（v2.1 新增）

**所有证据产物存储到 repo 内可追溯位置**（不再用 /tmp）：

```
artifacts/
├── dev/
│   └── TASK-XXX/          ← Dev 运行时验证截图、API 日志
├── qa/
│   └── TASK-XXX/          ← QA Playwright 截图、PDF 报告
└── po/
    └── TASK-XXX/          ← PO 验收截图、UX 审查记录
```

**规则：**
- `artifacts/` 目录加入 `.gitignore`（截图/PDF 不进 Git，但目录结构保留）
- 在 TASK JSON 的 `artifacts[]` 中用相对路径引用
- 关键报告（QA report / PO acceptance）以 Markdown 形式提交到 `specs/reports/`

### 1.7 完成标准（v2.1 调整）

**Dev 完成标准（task_class 分级后）：**

```
所有 task_class 通用：
  □ 可编译: tsc --noEmit 通过
  □ 可部署: Docker/local 能正常运行（按 runtime_level）
  □ 无回归: 首页/搜索/登录未被破坏
  □ 每个 AC 至少 1 个证据（test/api-log/screenshot/backend-log 任一）

security/feature 额外要求：
  □ 核心业务 AC 必须有单测

migration/ui-only/infra 可放宽：
  □ 允许用 Playwright 截图 + API 日志替代单测
```

**AC 覆盖率定义（替代章节覆盖率）：**
```
覆盖率 = 已 PASS 的 AC 数 / 本任务涉及 AC 总数 × 100%
  ≥95% → PO PASS
  <95% → PO REJECT（除非延后的 AC 有 linked_tasks + 目标 Sprint）
```

### 1.8 SSOT 原则（单一事实来源）

**TASK-XXX.json 是唯一事实来源。** TRACKER.json 由脚本自动生成，Agent 不手动编辑 TRACKER。

```
Agent 只需要更新 TASK-XXX.json
  → PM 运行 sync-tracker 脚本自动生成 TRACKER.json
  → 消除双写冲突
```

同步命令（PM 执行）：
```bash
# 读取所有 tasks/TASK-*.json，生成 TRACKER.json
cd tasks && node -e "
const fs = require('fs');
const tasks = fs.readdirSync('.').filter(f => /^TASK-\d+\.json$/.test(f))
  .map(f => { const t = JSON.parse(fs.readFileSync(f)); return {id:t.id, title:t.title, priority:t.priority, status:t.status, assignee:t.assignee, spec:t.spec_context?.spec_id+' '+t.spec_context?.sections?.join(','), dependencies:t.dependencies, file:'tasks/'+f}; });
const summary = {total:tasks.length, by_status:{}, by_priority:{}, by_assignee:{}};
tasks.forEach(t => { summary.by_status[t.status]=(summary.by_status[t.status]||0)+1; summary.by_priority[t.priority]=(summary.by_priority[t.priority]||0)+1; summary.by_assignee[t.assignee]=(summary.by_assignee[t.assignee]||0)+1; });
fs.writeFileSync('TRACKER.json', JSON.stringify({project:'Enterprise SkillHub', updated:new Date().toISOString(), summary, tasks}, null, 2));
console.log('TRACKER.json synced:', summary);
"
```

### 1.6 并行任务冲突处理

**规则：改同一个文件的任务不能同时派发。**

PM 派发前必须检查：
```
Step 1: 读取待派发任务的 code_context.files
Step 2: 对比当前 in_progress 任务的 code_context.files
Step 3: 如果有重叠文件 → 设置依赖关系，串行执行
Step 4: 特别注意 App.tsx、api.ts 等"根文件"
```

如果已经并行且发生冲突：
```
1. 后完成的任务负责 rebase：git pull --rebase origin main
2. 解决冲突后重新走 Runtime Verification
3. 在 TASK JSON notes 中记录冲突处理过程
```

### 1.7 任务取消/回滚流程

当任务需要取消（方向错误、Spec 变更、重新拆分）：

```
Step 1: 更新 TASK-XXX.json:
  - status: "canceled"
  - cancellation_reason: "原因描述"
  - linked_tasks: ["TASK-YYY — 替代任务（如有）"]
Step 2: 如果已有 commits → git revert <commits> 或保留（根据影响评估）
Step 3: 清理临时文件和测试数据
Step 4: git commit -m "task(TASK-XXX): canceled - [原因]"
Step 5: 如有替代任务 → PM 创建新 TASK-YYY.json
```

### 1.8 紧急 Hotfix 流程

当遇到安全/线上 P0 问题，需要跳过完整 Sprint 流程：

```
Hotfix 触发条件:
  - 安全漏洞（如路由守卫缺失、XSS、权限绕过）
  - 线上阻塞（核心功能不可用）
  - PM 或沈老板明确标记为 Hotfix

Hotfix 流程（简化版 SOP）:
  Step 1: PM 创建 TASK，标记 priority=P0, hotfix=true
  Step 2: Dev 执行（Phase 0 + Phase 2 + Phase 3 Runtime Verify）
          → 可跳过 TDD 的完整 Red-Green-Refactor
          → 不可跳过 Runtime Verification
  Step 3: PM 快速门禁（只检查 runtime_logs + regression_check）
          → 可跳过 QA 完整报告
          → 可跳过 PO 验收
  Step 4: 部署 + 验证
  Step 5: 事后补测试 + 补 QA 报告（下一个工作日内）

Hotfix 记录:
  在 TASK JSON 中标记 "hotfix": true
  事后补充 "postmortem": "事后分析和根因"
```

### 2. 读取任务（标准步骤，每次必做）

```
Step 1: 读取 tasks/TASK-XXX.json → 获取完整上下文
Step 2: 检查 dependencies → 所有前置任务 status=done 才能开始
Step 3: 检查 blocked_by_tasks → 非空则不能开始，报告给 PM
Step 4: 检查状态转换合法性 → 当前 status 允许转换到 in_progress
Step 5: 更新 status: "pending" → "in_progress"
Step 6: 更新 updated 字段为当前 ISO 8601 datetime
Step 7: git commit -m "task(TASK-XXX): start - [任务标题]"
```

### 3. 完成任务（标准步骤，每次必做）

```
Step 1: 逐条检查 acceptance_criteria → 每条必须有证据
Step 2: 更新 TASK-XXX.json:
  - status: "in_progress" → "review"（提交给 PM 门禁检查）
  - completed: 当前 ISO 8601 datetime
  - updated: 当前 datetime
  - code_context.commits: 添加本次 commit hash
  - verification.screenshots: 添加截图路径（如果有）
  - verification.runtime_logs: 添加运行时证据（Dev 必填）
  - verification.regression_check: 回归检查结果（Dev 必填）
Step 3: git commit -m "task(TASK-XXX): review - [任务标题]"
Step 4: git push origin main
  注意: TRACKER.json 不需要手动更新，PM 会通过 sync 脚本自动生成
```

### 4. 遇到阻塞（标准步骤）

```
Step 1: 更新 TASK-XXX.json:
  - status: "blocked"
  - blocked_by: ["阻塞原因描述"]
  - notes: 追加阻塞详情
Step 2: 更新 TRACKER.json
Step 3: git commit + push
Step 4: 向 PM 报告阻塞（通过群聊消息）
```

---

## Dev Agent SOP

### 角色定义
全栈开发工程师，负责编码实现、单元测试、代码提交。

### 接收任务后的标准流程

```
Phase 0: 读取上下文（强制，不可跳过）
  ├── 读取 TASK-XXX.json 中的 spec_context
  │   ├── 打开 spec_file 指定的 Spec 文件
  │   ├── 定位到 sections 指定的章节
  │   └── 逐条阅读 acceptance_criteria（这是验收标准，不是建议）
  ├── 读取 code_context
  │   ├── 打开 files 列出的每个文件，了解现有代码结构
  │   └── 打开 tests 列出的测试文件（如果存在）
  ├── 读取 doc_context
  │   └── 阅读 references 中的链接（外部文档/API 参考）
  └── 读取 env_context
      ├── 确认需要的 services 都在运行
      ├── 用 test_accounts 准备测试环境
      └── 记录 urls 用于后续验证

Phase 1: 生成 Implementation Checklist
  ├── 将每个 acceptance_criteria 转化为具体的代码改动项
  ├── 估算影响范围
  └── 检查是否有遗漏（对比 Spec 原文）

Phase 2: TDD 编码（严格 Red-Green-Refactor）
  ├── 🔴 Red: 写失败测试
  │   └── git commit -m "test(模块): add failing test for [AC 编号]"
  ├── 🟢 Green: 写最少代码通过测试
  │   └── git commit -m "feat(模块): implement [AC 编号]"
  └── 🔵 Refactor: 重构（可选）
      └── git commit -m "refactor(模块): clean [描述]"

Phase 3: ★ Runtime Verification（运行时验证 —— 不可跳过！）
  │
  │  ┌─────────────────────────────────────────────────────────┐
  │  │  核心原则：代码跑通 ≠ 功能正常                          │
  │  │  单元测试通过 ≠ 真实环境可用                            │
  │  │  必须把程序真正跑起来，用真实请求验证！                  │
  │  └─────────────────────────────────────────────────────────┘
  │
  ├── Step 3.1: Docker 构建 & 部署
  │   ├── 确认涉及的服务需要 rebuild（检查 TASK 的 env_context.services）
  │   ├── 执行 docker compose build <service> （只 rebuild 改动的服务）
  │   ├── 执行 docker compose up -d
  │   ├── 等待 health check 通过:
  │   │   └── curl -sf http://localhost:3000/api/v1/health
  │   └── 如果 build 失败 → 修复后重新 commit，不能跳过此步
  │
  ├── Step 3.2: API 级验证（后端改动时必做）
  │   ├── 对每个涉及的 API 端点执行真实请求:
  │   │   ├── 用 test_accounts 获取 JWT token
  │   │   │   └── TOKEN=$(curl -s -X POST http://localhost:3000/api/v1/auth/login \
  │   │   │         -H 'Content-Type: application/json' \
  │   │   │         -d '{"username":"<user>","password":"Test123!"}' | jq -r '.accessToken')
  │   │   ├── 对每个 AC 执行对应的 curl/HTTP 请求
  │   │   ├── 检查响应状态码 + 响应体结构 + 关键字段值
  │   │   └── 保存请求和响应到 verification.runtime_logs[]
  │   ├── 验证错误场景:
  │   │   ├── 未授权请求 → 应返回 401
  │   │   ├── 权限不足 → 应返回 403
  │   │   └── 无效参数 → 应返回 400 + 错误信息
  │   └── 检查后端日志:
  │       ├── docker logs skillhub-backend --tail 50
  │       └── 确认无 ERROR/WARN 级别异常（预期的 4xx 除外）
  │
  ├── Step 3.3: 浏览器级验证（前端改动时必做）
  │   ├── 用 Playwright 或手动浏览器访问:
  │   │   ├── 打开对应页面 URL（从 env_context.urls 获取）
  │   │   ├── 用 test_accounts 登录
  │   │   ├── 逐个 AC 操作并截图
  │   │   └── 截图保存到 /tmp/openclaw/dev-verify-{TASK-ID}/
  │   ├── 检查项（每项必须验证）:
  │   │   ├── 页面能正常渲染（不是白屏、不是 Error Boundary）
  │   │   ├── 数据从 API 正确加载（不是空列表、不是 mock 数据）
  │   │   ├── 交互按钮可点击且有响应（不是死按钮）
  │   │   ├── 空状态有友好提示（不是空白）
  │   │   ├── 错误状态有提示（网络断开、API 500 时不崩溃）
  │   │   └── 浏览器 Console 无 JS Error（打开 DevTools 检查）
  │   └── 截图命名规范:
  │       └── {TASK-ID}-runtime-{AC编号}-{描述}.png
  │
  ├── Step 3.4: 日志对照检查
  │   ├── 检查后端日志是否记录了预期的 HTTP 请求:
  │   │   └── docker logs skillhub-backend --tail 100 | grep "[HTTP]"
  │   ├── 对照 Spec 中描述的业务流程:
  │   │   ├── 请求路径是否匹配 Spec 定义的 API 端点
  │   │   ├── 状态码是否符合 Spec 定义的成功/失败响应
  │   │   └── 日志中是否有非预期的错误
  │   └── 保存关键日志片段到 verification.runtime_logs[]
  │
  └── Step 3.5: 回归检查（确保没破坏已有功能）
      ├── 访问首页 http://localhost → 正常加载
      ├── 搜索功能 http://localhost/search → 正常工作
      ├── 登录/登出流程 → 正常
      └── 如果有回归问题 → 修复后重新走 Step 3.1

Phase 4: 静态自检（Runtime Verification 之后）
  ├── pnpm -r typecheck → 0 errors
  ├── pnpm -r test → 全部通过
  ├── 逐条对照 acceptance_criteria:
  │   ├── 每条 AC 旁标注 ✅ + 证据类型:
  │   │   ├── [commit] commit hash
  │   │   ├── [api-log] curl 请求 + 响应截取
  │   │   ├── [screenshot] 浏览器截图路径
  │   │   ├── [backend-log] 后端日志片段
  │   │   └── [test] 单元测试名称
  │   └── 任何一条 AC 不满足 → 不能标记 done
  └── 运行 verification.commands 中的每个命令

Phase 5: 更新任务文件
  ├── **⚠️ 必须使用 update-task.js 更新 TASK JSON，禁止直接编辑！**
  │   ```bash
  │   # 状态变更（自动 event_log + 大写规范化）
  │   node scripts/tasks/update-task.js TASK-XXX --status REVIEW
  │   
  │   # 回归检查
  │   node scripts/tasks/update-task.js TASK-XXX --regression-check pass
  │   
  │   # 添加 commit
  │   node scripts/tasks/update-task.js TASK-XXX --add-commit abc123
  │   
  │   # Step 完成
  │   node scripts/tasks/update-task.js TASK-XXX --step S3 --step-status DONE --evidence "commit abc123"
  │   
  │   # 标记完成
  │   node scripts/tasks/update-task.js TASK-XXX --status DONE --completed now
  │   ```
  ├── 更新 TRACKER.json
  └── git commit + push

**⚠️ 禁止直接用 jq / 文本编辑器修改 TASK JSON！**
原因：直接编辑易导致 JSON 损坏、status 大小写不规范、regression_check 值不标准、event_log 不同步。
```

### Dev 完成标准（五条全满足才能打 ✅）

```
□ 可编译: tsc --noEmit 通过
□ 可测试: 至少每个 AC 有 1 个对应单元测试
□ 可部署: Docker build + up 成功，health check 通过
□ 可运行: 真实 HTTP 请求验证 API 返回正确，浏览器页面渲染正常
□ 无回归: 已有核心功能（首页/搜索/登录）未被破坏
```

### Dev 禁止事项

```
❌ 不读 Spec 原文就开始编码
❌ 骨架代码（有页面但 API 没接、数据 mock）标记为 done
❌ 跳过 Phase 0 直接写代码
❌ 没有 commit 就标记 done
❌ typecheck 有 error 就标记 done
❌ 偏离 Spec 技术选型但不记录（如 Spec 要求 Axios 但用了 fetch）
❌ 跳过 Phase 3 Runtime Verification（只跑 tsc + test 就标记 done）
❌ 没有 Docker rebuild 就声称"功能正常"
❌ 没有真实 HTTP 请求/浏览器截图就声称"API 可用"/"页面正常"
❌ 回归检查不做就标记 done
```

### Dev 偏离 Spec 的处理

```
如果实现时发现 Spec 要求不合理或需要调整：
1. 在 TASK-XXX.json 的 notes 中记录偏离原因
2. 在 specs/SPEC-COMPLIANCE-LOG.md 中记录（如果该文件存在）
3. status 标记为 "review" 而不是 "done"
4. 向 PM 报告偏离情况
```

---

## QA Agent SOP

### 角色定义
测试工程师，负责功能验证、截图取证、Bug 报告、测试报告。

### 接收任务后的标准流程

```
Phase 0: 读取上下文（强制，不可跳过）
  ├── 读取 TASK-XXX.json 全部内容
  ├── 读取 spec_context
  │   ├── 打开 Spec 原文对应章节
  │   └── 提取所有 acceptance_criteria
  ├── 读取 code_context
  │   └── 检查 commits 中列出的 commit 是否已 push
  ├── 读取 env_context
  │   ├── 确认所有 services 运行中
  │   ├── 准备 test_accounts
  │   └── 确认 urls 可访问
  └── 读取 verification
      └── 准备截图目录和验证命令

Phase 1: AC 逐条验证（核心步骤）
  对每个 acceptance_criteria:
  ├── 用 Playwright (viewport 1280×900) 执行 Given/When/Then
  ├── 截图命名: {TASK-ID}-AC-{编号}-{描述}.png
  ├── 记录实际结果
  └── 标记 PASS / FAIL

Phase 2: 技术合规检查
  ├── 运行 verification.commands 中的每个命令
  ├── 对照 Spec 要求的技术栈（grep 检查关键依赖）
  └── 检查残留标记: grep -r "TODO\|FIXME\|placeholder\|骨架" 涉及的文件

Phase 3: 交叉验证（如果前置是 Dev 任务）
  ├── 读取 Dev 任务的 TASK-XXX.json
  ├── 检查 Dev 标记 ✅ 的 AC → 验证是否真的实现
  └── 不一致 → 标记为 FAIL + 记录差异

Phase 4: 生成报告
  ├── 汇总表格: AC 编号 + 预期 + 实际 + 截图路径 + PASS/FAIL
  ├── 生成 PDF: /tmp/openclaw/qa-{task-id}/report.pdf
  └── 更新 TASK-XXX.json 的 verification 区块

Phase 5: 更新任务文件
  ├── 全部 PASS → status: "done"
  ├── 有 FAIL → status: "review" + notes 记录失败详情
  ├── 更新 TRACKER.json
  └── git commit + push
```

### QA 截图规范

```
目录: /tmp/openclaw/qa-{task-id}/
命名: {TASK-ID}-AC-{编号}-{描述}.png
    例: TASK-001-AC-SEC-1-anon-admin-redirect.png
viewport: 1280×900
工具: Playwright Python chromium (headless, --no-sandbox)
full_page: True（除非特别说明）
```

### QA 禁止事项

```
❌ 只看截图能不能生成就判 PASS（必须看截图内容）
❌ 不对照 Spec AC 就说"页面正常"
❌ 跳过技术合规检查
❌ FAIL 了但不记录具体原因
❌ 没有截图就标记 PASS
```

---

## PO Agent SOP

### 角色定义
产品经理（验收），负责从用户视角验收功能、审查 UX、确认 Spec 覆盖率。

### 接收任务后的标准流程

```
Phase 0: 读取上下文（强制，不可跳过）
  ├── 读取 TASK-XXX.json 全部内容
  ├── 读取 spec_context → 理解功能需求
  ├── 读取 QA 报告（verification.qa_report）
  └── 读取 verification.screenshots → 查看 QA 截图

Phase 1: 用户视角验收
  ├── 用 Playwright 模拟真实用户操作
  ├── 关注点: 可用性、直觉性、一致性、错误提示
  └── 截图记录任何 UX 问题

Phase 2: Spec 覆盖率审查
  ├── 对比 Spec AC 和实际实现
  ├── 计算覆盖率: ≥95% → PASS, <95% → REJECT
  └── 延后项必须有目标 Sprint，禁止"待定"

Phase 3: 验收决定
  ├── PASS → 更新 status: "done" + notes: "PO 验收通过"
  ├── CONDITIONAL PASS → status: "review" + notes 记录条件
  └── REJECT → status: "in_progress" + notes 记录原因

Phase 4: 更新任务文件 + 报告
```

### PO 禁止事项

```
❌ 不读 Spec 就验收
❌ 不看 QA 报告就验收
❌ 覆盖率 <95% 还 PASS
```

---

## PM Agent SOP

### 角色定义
项目经理，负责任务拆分、派发、追踪、门禁检查、汇报。

### 派发任务的标准流程

```
Phase 0: 任务准备
  ├── 创建 TASK-XXX.json（按 SCHEMA.json 格式）
  ├── 填充所有 7 大上下文区块
  │   ├── spec_context: 必须包含 Spec 原文中的 AC（直接复制，不转述）
  │   ├── code_context: 列出所有涉及的文件
  │   ├── doc_context: 关联设计文档和 API 文档
  │   ├── env_context: 服务 URL、测试账号、Docker 配置
  │   ├── verification: 预填验证命令
  │   ├── dependencies: 标明前置任务
  │   └── notes: 补充说明和注意事项
  └── 更新 TRACKER.json

Phase 1: 构建 Agent Prompt
  ├── 模板（见下方）
  ├── 核心原则: Spec 原文直入，不经 PM 转述
  └── 必须包含: 任务文件路径 + 完成标准 + 禁止事项

Phase 2: 派发
  ├── 使用 sessions_spawn 派发给对应 Agent
  └── 在 TASK-XXX.json 中记录 agent session 信息

Phase 3: 门禁检查（任务标记 review 或 done 后）
  ├── 读取 TASK-XXX.json
  ├── 检查清单:
  │   □ status 已更新
  │   □ commits 非空（Dev 任务）
  │   □ screenshots 非空（QA 任务）
  │   □ 每个 AC 有对应证据
  │   □ typecheck 通过（Dev 任务）
  │   □ runtime_logs 非空（Dev 任务 — 必须有真实请求证据）
  │   □ regression_check 全部 PASS（Dev 任务）
  │   □ 无 TODO/FIXME 残留
  └── 门禁不通过 → 打回，status 改为 "in_progress"
```

### PM 派发 Dev 任务模板

```
## 任务: {TASK-XXX} — {标题}

### 第一步: 读取任务上下文（强制！不可跳过！）
读取 `tasks/TASK-XXX.json`，了解完整上下文。

### 第二步: 读取 Spec 原文（强制！）
打开 `{spec_file}`，定位到 {sections} 章节。
以下是必须实现的验收标准（直接从 Spec 抄）：
{acceptance_criteria 逐条列出}

### 第三步: 了解现有代码
涉及的文件：
{code_context.files 逐个列出}

### 第四步: TDD 实现
按 Red-Green-Refactor 循环：
- 🔴 先写失败测试 → commit
- 🟢 写最少代码通过 → commit
- 🔵 重构 → commit

### 第五步: ★ Runtime Verification（运行时验证 — 不可跳过！）

代码写完后，必须把程序真正跑起来验证：

**5a. Docker 构建 & 部署**
- docker compose -f deploy/docker/docker-compose.yml build {rebuild_targets}
- docker compose -f deploy/docker/docker-compose.yml up -d
- 等待健康检查: {health_check}

**5b. API 级验证（后端改动时）**
- 用测试账号获取 token:
  TOKEN=$(curl -s -X POST http://localhost:3000/api/v1/auth/login \
    -H 'Content-Type: application/json' \
    -d '{"username":"<user>","password":"Test123!"}' | jq -r '.accessToken')
- 对每个 AC 执行 curl 请求，检查状态码 + 响应体
- 检查后端日志: docker logs skillhub-backend --tail 50
- 把请求/响应保存到 verification.runtime_logs.api_requests[]

**5c. 浏览器级验证（前端改动时）**
- 用 Playwright 或浏览器打开对应页面
- 登录 → 执行 AC 操作 → 截图
- 检查项: 页面渲染正常、数据从 API 加载、按钮可点击、空状态有提示、Console 无 JS Error
- 截图保存到 /tmp/openclaw/dev-verify-{TASK-ID}/
- 把结果保存到 verification.runtime_logs.browser_checks[]

**5d. 日志对照**
- docker logs skillhub-backend --tail 100 | grep "[HTTP]"
- 检查请求路径和状态码是否符合 Spec
- 保存关键日志到 verification.runtime_logs.backend_logs[]

**5e. 回归检查**
- 访问首页 / 搜索 / 登录登出 → 确认没被破坏
- 记录到 verification.regression_check
- **⚠️ 值必须精确为 `"PASS"` 或 `null`（未测试）**
- **禁止**: `"200 OK ✅"` / `"PASS ✅"` / `"通过"` 等变体
- 示例: `{ "homepage": "PASS", "search": "PASS", "login_logout": "PASS" }`

### 第六步: 静态自检
- [ ] pnpm -r typecheck → 0 errors
- [ ] pnpm -r test → 全通过
- [ ] 逐条 AC 对照，每条附证据类型: [commit] / [api-log] / [screenshot] / [backend-log] / [test]

### 第七步: 更新任务文件
更新 `tasks/TASK-XXX.json`:
- status → "done"
- completed → 当前时间
- code_context.commits → 添加 commit hash
- verification.runtime_logs → API 请求/响应 + 浏览器截图 + 后端日志
- verification.regression_check → PASS/FAIL
- verification.screenshots → 浏览器截图路径

更新 `tasks/TRACKER.json` 中对应任务 status。

git add tasks/ && git commit && git push

### 完成标准（五条全满足）
□ 可编译: tsc 通过
□ 可测试: 每个 AC 至少 1 个单元测试
□ 可部署: Docker build + up 成功，health check 通过
□ 可运行: 真实 HTTP 请求验证 API 正确，浏览器页面渲染正常
□ 无回归: 首页/搜索/登录未被破坏

### 禁止
❌ 不读 Spec 就编码
❌ 骨架代码标记 done
❌ typecheck 有 error 标记 done
❌ 偏离 Spec 但不记录
❌ 只跑 tsc + test 就标记 done（必须 Runtime Verification）
❌ 没有 Docker rebuild 就说"功能正常"
❌ 没有真实请求证据（curl/截图/日志）就说"API 可用"
```

### PM 派发 QA 任务模板

```
## 任务: {TASK-XXX} — {标题}

### 第一步: 读取任务上下文（强制！）
读取 `tasks/TASK-XXX.json`。

### 第二步: 读取 Spec + Dev 报告
- Spec 文件: {spec_file}
- 前置 Dev 任务: {dependencies}（读取其 TASK-XXX.json 了解实现情况）

### 第三步: AC 逐条验证
{acceptance_criteria 逐条列出}

每条 AC:
1. Playwright 执行 Given/When/Then
2. 截图: /tmp/openclaw/qa-{task-id}/{命名}.png
3. 记录实际结果
4. PASS / FAIL

### 第四步: 技术合规检查
运行以下命令:
{verification.commands}

### 第五步: 生成 PDF 报告
/tmp/openclaw/qa-{task-id}/report.pdf

### 第六步: 更新任务文件
同 Dev 任务，更新 JSON + TRACKER + commit + push。

### 禁止
❌ 只看截图能否生成就判 PASS
❌ 不对照 AC 就说"正常"
❌ 没有截图标记 PASS
```

---

## 流程图

```
PM 创建 TASK-XXX.json
  ↓
PM 构建 prompt（Spec 原文直入）
  ↓
PM sessions_spawn → Dev/QA/PO Agent
  ↓
Agent Phase 0: 读取 TASK-XXX.json（强制）
  ↓
Agent Phase 0: 读取 Spec 原文（强制）
  ↓
Agent Phase 0: 检查 dependencies（全部 done 才继续）
  ↓
Agent 更新 status → "in_progress" + commit
  ↓
Agent 执行任务（按各自 SOP）
  ↓
Agent 逐条验证 AC（必须有证据）
  ↓
Agent 更新 TASK-XXX.json + TRACKER.json + commit + push
  ↓
PM 门禁检查（读取 JSON，验证交付物完整性）
  ↓
通过 → 派发下游任务（QA/PO）
不通过 → 打回，status 改为 "in_progress"
```

---

## 文件列表

| 文件 | 用途 | 谁读 | 谁写 |
|------|------|------|------|
| `tasks/SCHEMA.json` | 任务 JSON 格式定义 | 所有 | PM |
| `tasks/TRACKER.json` | 全局任务看板 | 所有 | 所有（各自更新状态）|
| `tasks/TASK-XXX.json` | 单任务完整上下文 | 所有 | PM 创建，执行者更新 |
| `specs/SPEC-XXX.md` | 需求规格书 | 所有 | PM（只读参考）|
| `specs/SPEC-COMPLIANCE-LOG.md` | Spec 偏差记录 | PM/PO | Dev/PM |
