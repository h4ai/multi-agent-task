# SPEC 覆盖矩阵 — Enterprise SkillHub 全量追踪

> 版本: v2.0 | 更新: 2026-03-23
> 防线 1 产出物：PM 对每个 SPEC 的每个章节进行 Sprint 归属标注
> v2.0 新增：AC → TASK → commit 反向追溯（SPEC-006 / SPEC-007 全量覆盖）
> 原则："没有被追踪的延后，就是被遗忘的承诺"

---

## 总览

| SPEC | 模块 | 总章节 | Sprint 1-5 | Sprint 6-8 | Sprint F1-F3 | 累计覆盖 |
|------|------|--------|-----------|-----------|-------------|---------|
| 001 | 认证 & AD | 8 | 7/8 (§5延后) | - | 1/8 (§5) | **8/8 = 100%** |
| 002 | Skill CRUD & 统计 | 9 | 7/9 (§5,§5.5延后) | 1/9 (§5.5 CLI) | 1/9 (§5) | **9/9 = 100%** |
| 003 | 版本管理 | 8 | 7/8 (§5延后) | - | 1/8 (§5) | **8/8 = 100%** |
| 004 | 搜索 & Embedding | 9 | 8/9 (§6延后) | - | 1/9 (§6) | **9/9 = 100%** |
| 005 | 审核工作流 | 8 | 7/8 (§5延后) | - | 1/8 (§5) | **8/8 = 100%** |
| 006 | 模板+命名空间+CLI | 7 | - | 7/7 | - | **7/7 = 100%** |
| 007 | 前端 Web UI | 8 | - | - | 8/8 | **8/8 = 100%** |

**计划完成后总覆盖率: 57 章节 / 57 章节 = 100%**

---

## SPEC-001: 用户认证 & AD 域集成

| 章节 | 内容 | Sprint 归属 | 状态 | 备注 |
|------|------|-----------|------|------|
| §1 概述 | 功能范围定义 | Sprint 1 | ✅ 已实现 | |
| §2 数据模型 | User Prisma Schema | Sprint 1 | ✅ 已实现 | |
| §3 API 接口 | /auth/login, /auth/me, /auth/logout | Sprint 1 | ✅ 已实现 | |
| §4 业务规则 | LDAP bind + JWT + role mapping | Sprint 1 | ✅ 已实现 | |
| **§5 前端组件** | **Login Page + UserProfileMenu** | **Sprint F1** | ⏭️ 延后 | SPEC-007 AC-F1 覆盖 |
| §6 安全要求 | LDAP 注入防护 + JWT 过期 | Sprint 1 | ✅ 已实现 | |
| §7 验收标准 | AC-1~5 | Sprint 1 | ✅ 已通过 | |
| §8 变更记录 | - | Sprint 1 | ✅ | |

**本 SPEC 当前覆盖率: 7/8 = 87.5% → Sprint F1 后 100%**

---

## SPEC-002: Skill 数据模型 & CRUD & 下载统计

| 章节 | 内容 | Sprint 归属 | 状态 | 备注 |
|------|------|-----------|------|------|
| §1 概述 | Skill 管理范围 | Sprint 2 | ✅ 已实现 | |
| §2 数据模型 | Skill/Version/File/DownloadLog Schema | Sprint 2 + Sprint 8 | ✅ 已实现 | Sprint 8 补了 DownloadLog |
| §3 API 接口 | Skills CRUD + Stats + Admin | Sprint 2 + Sprint 8 | ✅ 已实现 | Sprint 8 补了统计端点 |
| §4 业务规则 | 可见性/slug/分页/缓存 | Sprint 2 | ✅ 已实现 | |
| **§5 前端组件** | **Marketplace + Detail + My Skills + Stats** | **Sprint F1-F2** | ⏭️ 延后 | SPEC-007 AC-F2 覆盖 |
| §5.5 CLI 操作 | skillhub publish --git / install --git | Sprint 6 | ✅ 已实现 | |
| §6 安全要求 | IDOR 防范 + 部门可见性 Guard | Sprint 2 | ✅ 已实现 | |
| §7 验收标准 | AC 全部 | Sprint 2+8 | ✅ 已通过 | |
| §8 变更记录 | - | Sprint 2 | ✅ | |

**本 SPEC 当前覆盖率: 8/9 = 88.9% → Sprint F1-F2 后 100%**

---

## SPEC-003: 版本管理 & 文件存储

| 章节 | 内容 | Sprint 归属 | 状态 | 备注 |
|------|------|-----------|------|------|
| §1 概述 | 版本管理范围 | Sprint 3 | ✅ 已实现 | |
| §2 数据模型 | SkillVersion + SkillFile | Sprint 3 | ✅ 已实现 | |
| §3 API 接口 | 版本 CRUD + 文件上传/下载 | Sprint 3 | ✅ 已实现 | |
| §4 业务规则 | semver 校验 + MinIO 存储 | Sprint 3 | ✅ 已实现 | |
| **§5 前端组件** | **VersionUploader + VersionHistory + FileListView** | **Sprint F2** | ⏭️ 延后 | SPEC-007 AC-F4 覆盖 |
| §6 安全要求 | ZIP 炸弹防护 + 文件大小限制 | Sprint 3 | ✅ 已实现 | |
| §7 验收标准 | AC 全部 | Sprint 3 | ✅ 已通过 | |
| §8 变更记录 | - | Sprint 3 | ✅ | |

**本 SPEC 当前覆盖率: 7/8 = 87.5% → Sprint F2 后 100%**

---

## SPEC-004: 向量搜索 & Embedding

| 章节 | 内容 | Sprint 归属 | 状态 | 备注 |
|------|------|-----------|------|------|
| §1 概述 | 搜索功能范围 | Sprint 4 | ✅ 已实现 | |
| §2 数据模型 | pgvector 向量字段 | Sprint 4 | ✅ 已实现 | |
| §3 BGE-M3 服务协议 | Embedding API 接口 | Sprint 4 | ✅ 已实现 | |
| §4 API 接口 | /search 端点 | Sprint 4 | ✅ 已实现 | |
| §5 业务规则 | 混合搜索策略 + 权重 | Sprint 4 | ✅ 已实现 | |
| **§6 前端组件** | **OmniSearchBar + SearchResults** | **Sprint F1** | ⏭️ 延后 | SPEC-007 AC-F3 覆盖 |
| §7 安全要求 | 搜索注入防护 | Sprint 4 | ✅ 已实现 | |
| §8 验收标准 | AC 全部 | Sprint 4 | ✅ 已通过 | |
| §9 变更记录 | - | Sprint 4 | ✅ | |

**本 SPEC 当前覆盖率: 8/9 = 88.9% → Sprint F1 后 100%**

---

## SPEC-005: 审核工作流引擎

| 章节 | 内容 | Sprint 归属 | 状态 | 备注 |
|------|------|-----------|------|------|
| §1 概述 | 审核流程范围 | Sprint 5 | ✅ 已实现 | |
| §2 数据模型 | SkillReview + ReviewPolicy | Sprint 5 | ✅ 已实现 | |
| §3 API 接口 | 审核 CRUD + 审批/驳回 | Sprint 5 | ✅ 已实现 | |
| §4 业务规则 | 4 阶段扫描 + 状态机 | Sprint 5 | ✅ 已实现 | |
| **§5 前端组件** | **ReviewDashboard + ScanReport + DecisionPanel + CodeDiff + Timeline** | **Sprint F2** | ⏭️ 延后 | SPEC-007 AC-F5 覆盖 |
| §6 安全要求 | 审核人权限隔离 | Sprint 5 | ✅ 已实现 | |
| §7 验收标准 | AC 全部 | Sprint 5 | ✅ 已通过 | |
| §8 变更记录 | - | Sprint 5 | ✅ | |

**本 SPEC 当前覆盖率: 7/8 = 87.5% → Sprint F2 后 100%**

---

## SPEC-006: 模板系统 + 命名空间 + CLI + AI 适配器

### 章节覆盖

| 章节 | 内容 | Sprint 归属 | 状态 | 备注 |
|------|------|-----------|------|------|
| §1 概述 | 模板+命名空间范围 | Sprint 6 | ✅ 已实现 | |
| §2 数据模型 | Namespace/Template/TemplateVersion/TemplateSkill/GitCredential | Sprint 6 | ✅ 已实现 | |
| §3 API 设计 | 命名空间+模板+Git CRUD | Sprint 6-7 | ✅ 已实现 | |
| §4 业务逻辑 | 权限+继承+SemVer 同步 | Sprint 6-7 | ✅ 已实现 | |
| §5 脚手架引擎 | CLI init + 5 种 AI 适配 | Sprint 6 | ✅ 已实现 | |
| §6 融合点 | 与 Skill 系统的关联 | Sprint 7 | ✅ 已实现 | |
| §7 验收标准 | AC 全部 | Sprint 6-8 | ✅ 已通过 | |

**本 SPEC 当前覆盖率: 7/7 = 100% ✅**

### AC → TASK → Commit 反向追溯

| AC | AC 描述 | TASK(s) | 主要 Commit | 状态 |
|----|---------|---------|-------------|------|
| AC-1 | 数据模型: Namespace, Template, TemplateVersion Schema 正确 | TASK-101~106 (Sprint 6 基础) | `83f5079` | ✅ DONE |
| AC-2 | 命名空间权限: 非成员发布返回 403 | TASK-103 | `9118d8c` | ✅ DONE |
| AC-3 | CLI init 下载并展开脚手架文件 | TASK-104, TASK-107 | `7b42239`, `e1ef10c` | ✅ DONE |
| AC-4 | AI 适配 - Claude (.claude/rules/ 等) | (Sprint 6 基础实现) | - | ✅ DONE |
| AC-5 | AI 适配 - Cursor (.cursor/rules/ 等) | (Sprint 6 基础实现) | - | ✅ DONE |
| AC-6 | 变量替换: projectName → pom.xml/package.json | (Sprint 6 基础实现) | - | ✅ DONE |
| AC-7 | Skill 集成: 模板 Skill 依赖正确安装 | (Sprint 6 基础实现) | - | ✅ DONE |
| AC-8 | 审核流复用: PENDING_REVIEW→审批→可搜索 | TASK-106 | `25e83b6` | ✅ DONE |
| AC-9 | Navbar Tab 与 Skills 并列 | TASK-101 | `d374efb` | ✅ DONE |
| AC-11 | 模板列表查询: 按命名空间/关键词过滤 | TASK-101, TASK-102, TASK-105 | `d374efb`, `428a55f`, `15d1e7f` | ✅ DONE |
| AC-12 | 模板更新: update 保留用户修改+冲突处理 | (Sprint 6 基础实现) | - | ✅ DONE |
| AC-13 | Web 上传: 选命名空间→元数据→ZIP→解析 manifest | TASK-103 | `9118d8c` | ✅ DONE |
| AC-14 | Skill 自动同步: ^1.2.0 → resolvedVersion 1.3.0 | (Sprint 7 实现) | - | ✅ DONE |
| AC-15 | Major 变更通知: 2.0.0 不自动更新，发通知 | (Sprint 7 实现) | - | ✅ DONE |
| AC-16 | Git 来源发布: publish --git \<url\> --ref \<tag\> | (Sprint 6 基础实现) | - | ✅ DONE |
| AC-17 | Git 凭证管理: TOKEN 凭证创建+测试 | (Sprint 6 基础实现) | - | ✅ DONE |
| AC-18 | Git Webhook: tag 推送触发自动发布 | (Sprint 6 基础实现) | - | ✅ DONE |
| AC-19 | Git 安全: clone 超时 60s + 凭证加密存储 | (Sprint 6 基础实现) | - | ✅ DONE |
| AC-20 | 下载计数: downloadCount 递增+排序正确 | TASK-104 | `7b42239` | ✅ DONE |
| AC-21 | 下载日志: 管理员查询下载历史 | TASK-106 | `25e83b6` | ✅ DONE |
| AC-22 | 去重: 同一用户 1h 内重复下载只+1 | TASK-104 | `7b42239` | ✅ DONE |

> **说明**: AC-4~7, AC-12, AC-14~19 在 Sprint 6-7 的后端基础实现中完成，commit 分散在多个 Sprint 分支合并中，未在 commit message 中标注单独 TASK ID。

---

## SPEC-007: 前端 Web UI（新增）

### 章节覆盖

| 章节 | 内容 | Sprint 归属 | 状态 | 备注 |
|------|------|-----------|------|------|
| §1 概述 | 前端 Web UI 范围 | Sprint F1 | ✅ 已实现 | |
| §2 技术选型 | TanStack Start + React + Tailwind | Sprint F1 | ✅ 已实现 | 框架搭建 |
| §3 页面清单 & 路由 | 10 页面完整路由表 | Sprint F1-F3 | ✅ 已实现 | |
| §4 组件设计 | 全局+业务组件 | Sprint F1-F3 | ✅ 已实现 | |
| §5 数据层 | Axios + TanStack Query + Zustand | Sprint F1 | ✅ 已实现 | |
| §6 安全要求 | JWT Cookie + CSRF + XSS + 路由守卫 | Sprint F1 | ✅ 已实现 | |
| §7 验收标准 | AC-F1~F6 | Sprint F1-F3 | ✅ 已通过 | |
| §8 Sprint 拆分 | F1(1w) + F2(1.5w) + F3(1w) | - | 📋 规划文档 | |

**本 SPEC 当前覆盖率: 8/8 = 100% ✅**

### AC → TASK → Commit 反向追溯

| AC | AC 描述 | TASK(s) | 主要 Commit | 状态 |
|----|---------|---------|-------------|------|
| AC-F1 | Login Page: 重定向 /login + LDAP 登录 + 顶部导航显示用户名 | TASK-001, TASK-002, TASK-014 | `5e8e39f`, `1a4039b`, `4a913bf` | ✅ DONE |
| AC-F2 | Marketplace: 热门/最新 Skill 列表 + 分类筛选 + 分页 | TASK-003A, TASK-003B, TASK-005, TASK-006, TASK-007 | `a823f22`, `33552f2`, `5a84386` | ✅ DONE |
| AC-F3 | OmniSearchBar: 搜索框 → /api/v1/search → 卡片结果 | TASK-105, TASK-107 | `15d1e7f`, `e1ef10c` | ✅ DONE |
| AC-F4 | VersionUploader: 拖拽 ZIP + 版本信息 + 上传进度 + PENDING_AUTO | TASK-016, TASK-003C | `b902a67`, `76fbcb3` | ✅ DONE |
| AC-F5 | Review Dashboard & Decision: ScanReportView + DecisionPanel + Approve | TASK-017, TASK-009, TASK-003C | `4f2df6b`, `43c7d2e`, `76fbcb3` | ✅ DONE |
| AC-F6 | Admin Dashboard: /admin 图表 + 活跃用户数 + Top Skill 下载量 | TASK-018, TASK-003D | `cdf860e`, `1496704` | ✅ DONE |

### 补充: QA/PO 验收 TASK 追溯

| 验收轮次 | TASK | 角色 | 覆盖 AC | Commit | 状态 |
|----------|------|------|---------|--------|------|
| Sprint F1-F3 QA | TASK-019 | QA | AC-F1~F6 全量 | `ce5b32d` | ✅ DONE |
| Sprint F1-F3 PO | TASK-020 | PO | 全功能验收 | `5216971` | ✅ DONE |
| Bug Fix | TASK-021 | Dev | 5 个 Bug 修复 | `7a2f8d3` | ✅ DONE |
| 回归测试 | TASK-022 | QA | SPEC-001~007 全量回归 | `7a2f8d3` | ✅ DONE |

### 补充: Templates Sprint TASK 追溯 (SPEC-006 专项)

| TASK | 角色 | 覆盖 AC | 主要 Commit | 状态 |
|------|------|---------|-------------|------|
| TASK-101 | Dev | AC-9, AC-11 | `d374efb` | ✅ DONE |
| TASK-102 | Dev | AC-11 (详情页) | `428a55f` | ✅ DONE |
| TASK-103 | Dev | AC-13, AC-2 | `9118d8c` | ✅ DONE |
| TASK-104 | Dev | AC-3, AC-20, AC-22 | `7b42239` | ✅ DONE |
| TASK-105 | Dev | AC-11 (搜索过滤) | `15d1e7f` | ✅ DONE |
| TASK-106 | Dev | AC-8, AC-21 | `25e83b6` | ✅ DONE |
| TASK-107 | Dev | UI 优化 (Navbar + Search + CLI init) | `e1ef10c` | ✅ DONE |
| TASK-108 | SA | AC 编号标准化 (SPEC-001~005) | `8c41a97` | ✅ DONE |
| TASK-109 | QA | QA 报告模板 + AC→TC 矩阵 | `26dfbfa` | ✅ DONE |

---

## 前端 Sprint 详细覆盖计划

### Sprint F1: 发现与认证闭环 (1 周)

| 来源 SPEC | 章节 | 要实现的内容 | AC |
|----------|------|-----------|-----|
| SPEC-001 §5 | Login Page + UserProfileMenu | AC-F1 |
| SPEC-002 §5 | Marketplace 列表 + SkillCard + CategoryFilter | AC-F2 |
| SPEC-002 §5 | Skill 详情页 | AC-F2 |
| SPEC-004 §6 | OmniSearchBar + SearchResults | AC-F3 |
| SPEC-007 §2 | 框架搭建 + 项目结构 + Axios Client | - |
| SPEC-007 §5 | 数据层（TanStack Query + Zustand） | - |
| SPEC-007 §6 | JWT 拦截器 + 路由守卫 | - |

**Sprint F1 覆盖率增量**: +4 章节 (SPEC-001§5 + SPEC-002§5 + SPEC-004§6 + SPEC-007 基础)

### Sprint F2: 发布与审核闭环 (1.5 周)

| 来源 SPEC | 章节 | 要实现的内容 | AC |
|----------|------|-----------|-----|
| SPEC-003 §5 | VersionUploader + VersionHistory + FileListView | AC-F4 |
| SPEC-005 §5 | ReviewDashboard + ScanReportView + DecisionPanel | AC-F5 |
| SPEC-002 §5 | My Skills (我的发布) | AC-F2 扩展 |

**Sprint F2 覆盖率增量**: +2 章节 (SPEC-003§5 + SPEC-005§5)

### Sprint F3: 模板与管理后台 (1 周)

| 来源 SPEC | 章节 | 要实现的内容 | AC |
|----------|------|-----------|-----|
| SPEC-007 §3 | 模板市场 + 模板详情 | AC-F6 扩展 |
| SPEC-007 §3 | Admin Dashboard + 用户管理 | AC-F6 |
| SPEC-005 §5 | CodeDiffViewer (P2, 进阶) | - |

**Sprint F3 覆盖率增量**: 剩余 SPEC-007 章节全部完成

---

## 覆盖率趋势

| 时间点 | 已覆盖章节 | 总章节 | 覆盖率 |
|--------|----------|--------|--------|
| Sprint 1-5 完成 | 43 | 57 | **75.4%** |
| Sprint 6-8 完成 | 51 | 57 | **89.5%** |
| Sprint F1 完成后 | 55 | 57 | **96.5%** |
| Sprint F2 完成后 | 57 | 57 | **100%** |
| Sprint F3 完成后 | 57 | 57 | **100% + P2 增强** |

---

## 延后项追踪（全量）

| # | 延后项 | 原始 SPEC | 原计划 Sprint | 实际延后到 | Owner | 状态 |
|---|--------|----------|-------------|----------|-------|------|
| 1 | Login Page + UserProfileMenu | SPEC-001 §5 | Sprint 1 | Sprint F1 | Dev (前端) | ✅ 已完成 |
| 2 | Marketplace + Detail + My Skills | SPEC-002 §5 | Sprint 2 | Sprint F1-F2 | Dev (前端) | ✅ 已完成 |
| 3 | VersionUploader + History + FileList | SPEC-003 §5 | Sprint 3 | Sprint F2 | Dev (前端) | ✅ 已完成 |
| 4 | OmniSearchBar + SearchResults | SPEC-004 §6 | Sprint 4 | Sprint F1 | Dev (前端) | ✅ 已完成 |
| 5 | ReviewDashboard + ScanReport + Decision | SPEC-005 §5 | Sprint 5 | Sprint F2 | Dev (前端) | ✅ 已完成 |
| 6 | Template Pages + Admin Dashboard | SPEC-007 §3 | 首次定义 | Sprint F3 | Dev (前端) | ✅ 已完成 |

**延后项总计: 6 项，全部已完成 ✅**
