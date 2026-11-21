# agy-zh

Google Antigravity 桌面端中文汉化的安装、更新与还原工具。

## 与上游的关系

本仓库只包含包装工具与通用 agent 技能，不内置、也不再分发任何汉化引擎或词典文件。实际打补丁和还原操作在运行时从上游克隆调用：

- 上游引擎与词典：[Silas-02/antigravity-desktop-cn](https://github.com/Silas-02/antigravity-desktop-cn)
- 上游致谢原作者：[qqxpee/antigravity2-cn](https://github.com/qqxpee/antigravity2-cn)

不想用命令行的人，直接用上游仓库的双击安装脚本更省事。

## 解决的问题

直接运行上游脚本时，有几类常见隐患：

1. **避免官方更新后被打回旧版**：如果官方安装器更新后留下了旧的 `app.asar.bak`，上游引擎检测到它存在时就会直接基于备份打补丁，把旧版文件写回新版程序。`agy-zh` 会比对 `app.asar` 与 `app.asar.bak` 的版本号，发现过期备份时先将其改名（如 `app.asar.bak.2.34.0`），再由引擎重新备份新版官方包。
2. **按本机版本自动对齐 tag**：从本机 `app.asar` 读取版本号，在上游仓库匹配前三段一致的最高 tag（如本机 `2.33.0` 会自动选 `v2.33.0.1`），避免错用不兼容版本的词典。
3. **防止在应用内自杀**：打补丁和还原过程会关闭 Antigravity。如果检测到当前运行在 Antigravity 的子进程内，工具会拒绝执行（退出码 4）。
4. **单条命令看清状态**：`status` 只读查看安装路径、两个包的版本与汉化状态、状态分类以及上游 tag 匹配情况，不会改文件或拉取仓库。
5. **上游参数预检与自适应**：调用引擎前先探测目标 tag 中 `localization_engine.js` 支持的 CLI 参数，自动兼容参数改名或移除（例如 `--dir`、`--restore`、缺少 `--brand-title`），参数完全不匹配时提前中止，避免盲跑。

## 环境要求

- Node.js >= 18
- Git

## 用法

克隆本仓库后即可直接运行（无需 `npm install`）：

```bash
git clone https://github.com/zhang-Zz789/agy-zh.git
cd agy-zh

# 查看状态（只读）
node bin/agy-zh.mjs status

# 安装或更新汉化（需要在 Antigravity 外部终端运行）
node bin/agy-zh.mjs update

# 还原官方英文版
node bin/agy-zh.mjs restore
```

也可以直接运行 `skills/agy-zh/scripts/agy-zh.mjs`（例如 `node skills/agy-zh/scripts/agy-zh.mjs status`）。Windows 下也可以直接运行 `bin\agy-zh.cmd status` 等命令。`install` 是 `update` 的别名。

### 常用参数

- `--install-dir <路径>`：手动指定 Antigravity 安装目录。未指定时依次按环境变量 `AGY_INSTALL_DIR`、运行中的 Antigravity 进程、Windows 卸载注册表、默认安装路径查找。
- `--repo <路径>`：手动指定上游汉化仓库位置。未指定时按环境变量 `AGY_ZH_REPO`、系统本地应用数据目录（Windows 为 `%LOCALAPPDATA%\agy-zh\antigravity-desktop-cn`，macOS 为 `~/Library/Application Support/agy-zh/antigravity-desktop-cn`）查找，不存在时在 `update` 或 `restore` 阶段自动克隆。
- `--brand-title english|hidden`：设置左上角品牌标题模式，默认 `english`。
- `--dry-run`：预演状态检查、目标 tag 选择和即将执行的命令，不修改磁盘文件。
- `--allow-close`：跳过 Antigravity 父进程保护（会关闭当前运行的应用）。

### 环境变量

- `AGY_INSTALL_DIR`：默认安装目录覆盖项。
- `AGY_ZH_REPO`：默认上游仓库目录覆盖项。

## 让各家 agent 都能用

`skills/agy-zh` 目录内自带完整工具脚本（`scripts/agy-zh.mjs` 与 `scripts/lib/`），不依赖仓库其余文件，把整个 `skills/agy-zh` 文件夹复制或链接到任意 agent 的技能目录即可使用。推荐用目录链接，后续只需在仓库里执行 `git pull` 就能同步更新。

常见 agent 技能目录：

- Claude Code：`~/.claude/skills/`
- Codex：`~/.codex/skills/`
- Cursor：`~/.cursor/skills/`
- Gemini CLI：`~/.gemini/skills/`
- Antigravity：`~/.gemini/antigravity/skills/`
- 通用技能目录：`~/.agents/skills/`
- Grok：`~/.grok/skills/`

Windows（PowerShell）创建目录联接示例：

```powershell
New-Item -ItemType Junction -Path "$HOME\.claude\skills\agy-zh" -Target "<仓库路径>\skills\agy-zh"
```

macOS / Linux 创建软链接示例：

```bash
ln -s "<仓库路径>/skills/agy-zh" ~/.claude/skills/agy-zh
```

把路径中的 `.claude` 换成对应 agent 的目录即可，也可以用已链接的目录作为目标（单份正本供多个 agent 共用）。

## 平台支持

- Windows：已实测。
- macOS：包含路径兼容与进程检测逻辑，尚未实测。

## 风险提示

本工具会修改 Antigravity 安装目录下的官方 `app.asar`。官方每次更新都会覆盖已汉化的文件，届时需重新运行 `update`。使用前请自行确认风险并做好必要备份，一切后果由使用者自行承担。

## 开源许可

本仓库自研代码采用 [MIT License](LICENSE)。运行时克隆的上游引擎与词典归属原仓库所有，其授权以 [Silas-02/antigravity-desktop-cn](https://github.com/Silas-02/antigravity-desktop-cn) 为准。
