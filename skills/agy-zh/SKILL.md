---
name: agy-zh
description: Google Antigravity 2.x 桌面端的简体中文汉化管理。用户说「agy 汉化」「Antigravity 中文」「更新汉化」「还原英文」时使用。
user-invocable: true
---

# Antigravity 桌面端汉化

只处理 Google Antigravity 2.x 桌面端，不处理 Antigravity IDE 和命令行工具 `agy`。

下面命令中的 `<技能目录>` 指本 `SKILL.md` 所在的文件夹。工具脚本已自带在 `<技能目录>/scripts/agy-zh.mjs`，无需额外安装依赖（要求本机有 Node.js >= 18 和 Git）。

## 1. 检查当前状态

先运行只读检查：

```bash
node <技能目录>/scripts/agy-zh.mjs status
```

常见状态分类：
- `NOT_INSTALLED`：当前为官方英文原版，可直接安装汉化。
- `PATCHED`：当前已汉化且 `app.asar.bak` 版本一致，可重打以同步词典。
- `STALE_BACKUP`：官方桌面端已更新，但 `app.asar.bak` 还是旧版；`update` 会先把它改名备份再打补丁。
- `INCONSISTENT`：状态异常（例如已汉化但缺少 `app.asar.bak`，或两份包版本不一致），停下来向用户说明，不要擅自覆盖。

## 2. 安装或更新汉化

```bash
node <技能目录>/scripts/agy-zh.mjs update
```

可选参数：`--brand-title english|hidden`（默认 `english`）、`--install-dir <路径>`、`--repo <路径>`、`--dry-run`。

**警告**：`update` 会关闭正在运行的 Antigravity 桌面端。如果当前 agent 就运行在 Antigravity 进程内，不要执行 `update`（也不要加 `--allow-close`），直接把命令交给用户在外部终端运行。工具检测到祖先进程包含 Antigravity 时会拒绝执行并返回退出码 4。

## 3. 还原英文

```bash
node <技能目录>/scripts/agy-zh.mjs restore
```

同样会关闭 Antigravity；在 Antigravity 进程内不要执行，交给用户在外部终端运行。

## 4. 退出码说明

- `1`：参数错误、未找到安装目录、缺少 `app.asar.bak`，或上游本地仓库有未处理改动。按提示补 `--install-dir` 或处理仓库改动后重试。
- `4`：当前进程运行在 Antigravity 内，被进程保护拦截。停止执行，请用户在外部终端运行该命令。
- `5`：上游仓库尚未发布匹配当前桌面端版本的 tag。告知用户本机版本和上游最新 tag，等待上游适配后再更新。
- `6`：状态为 `INCONSISTENT` 或备份版本不一致（`restore` 时存在降级风险）。把检查结果报告给用户，由用户确认后再处理。

## 5. 漏译与翻译边界

- 本工具不自带词典，补漏译请直接向上游仓库 `Silas-02/antigravity-desktop-cn` 提交。
- 界面翻译不涉及用户输入、对话内容、代码、文件路径、终端命令、模型名与报错堆栈。
