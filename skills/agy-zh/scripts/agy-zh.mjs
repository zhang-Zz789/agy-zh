#!/usr/bin/env node
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {
  classify,
  ensureRepo,
  findInstallDir,
  getHeadTag,
  insideAntigravity,
  inspect,
  latestTag,
  listTags,
  pickTag,
  probeEngineFlags,
  resolveRepoDir,
} from './lib/core.mjs';

const STATE_LABELS = {
  NOT_INSTALLED: '未安装汉化',
  PATCHED: '已汉化且备份一致',
  STALE_BACKUP: '官方已更新（存在旧版 app.asar.bak）',
  INCONSISTENT: '状态异常（需人工确认）',
};

function log(msg) {
  console.log(`[agy-zh] ${msg}`);
}

function logErr(msg) {
  console.error(`[agy-zh] ${msg}`);
}

function printHelp() {
  console.log(`用法:
  agy-zh <命令> [选项]

命令:
  status                  查看本机安装、汉化状态与上游仓库信息（只读）
  update (install)        自动匹配当前版本的 tag 并安装或更新汉化
  restore                 从 app.asar.bak 还原为官方英文版

选项:
  --install-dir <路径>    指定 Antigravity 安装目录（或 AGY_INSTALL_DIR）
  --repo <路径>           指定上游汉化仓库目录（或 AGY_ZH_REPO）
  --brand-title <模式>    左上角品牌标题: english | hidden（默认 english）
  --dry-run               仅预演将执行的步骤，不修改任何文件
  --allow-close           允许在 Antigravity 进程内执行（会自动关闭当前应用）
  -h, --help              显示此帮助信息`);
}

function parseArgs(argv) {
  const opts = {
    command: null,
    installDir: undefined,
    repo: undefined,
    brandTitle: 'english',
    dryRun: false,
    allowClose: false,
    help: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '-h' || arg === '--help') {
      opts.help = true;
      continue;
    }
    if (arg === '--dry-run') {
      opts.dryRun = true;
      continue;
    }
    if (arg === '--allow-close') {
      opts.allowClose = true;
      continue;
    }
    if (arg === '--install-dir' || arg.startsWith('--install-dir=')) {
      const val = arg.includes('=') ? arg.slice('--install-dir='.length) : argv[++i];
      if (!val) throw new Error('--install-dir 缺少路径参数');
      opts.installDir = val;
      continue;
    }
    if (arg === '--repo' || arg.startsWith('--repo=')) {
      const val = arg.includes('=') ? arg.slice('--repo='.length) : argv[++i];
      if (!val) throw new Error('--repo 缺少路径参数');
      opts.repo = val;
      continue;
    }
    if (arg === '--brand-title' || arg.startsWith('--brand-title=')) {
      const val = arg.includes('=') ? arg.slice('--brand-title='.length) : argv[++i];
      if (val !== 'english' && val !== 'hidden') {
        throw new Error('--brand-title 仅支持 english 或 hidden');
      }
      opts.brandTitle = val;
      continue;
    }
    if (arg.startsWith('-')) {
      throw new Error(`未知选项: ${arg}`);
    }
    if (!opts.command) {
      opts.command = arg;
    } else {
      throw new Error(`多余的参数: ${arg}`);
    }
  }
  return opts;
}

function formatArchive(info) {
  if (!info.exists) return '不存在';
  const ver = info.version || '未知版本';
  const patchText = info.patched ? '已汉化' : '未汉化';
  return `${ver}（${patchText}）`;
}

function formatStamp(date = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return (
    `${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}-` +
    `${p(date.getHours())}${p(date.getMinutes())}${p(date.getSeconds())}`
  );
}

function chooseBackupRenameTarget(resourcesDir, bakVersion) {
  const verLabel = bakVersion || 'unknown';
  const baseName = `app.asar.bak.${verLabel}`;
  if (!fs.existsSync(path.join(resourcesDir, baseName))) {
    return baseName;
  }
  const stamp = formatStamp();
  let candidate = `${baseName}.${stamp}`;
  let idx = 1;
  while (fs.existsSync(path.join(resourcesDir, candidate))) {
    candidate = `${baseName}.${stamp}-${idx++}`;
  }
  return candidate;
}

function explainInconsistent(state) {
  if (!state.asar.exists) {
    return '未找到 app.asar，无法确认当前应用版本。';
  }
  if (state.asar.patched && !state.bak.exists) {
    return 'app.asar 已汉化，但缺少 app.asar.bak，无法确认官方原包版本。';
  }
  return `app.asar（${state.asar.version || '未知'}）与 app.asar.bak（${state.bak.version || '未知'}）状态或版本不一致。`;
}

function cmdStatus(opts) {
  const found = findInstallDir({ cliDir: opts.installDir });
  if (!found) {
    logErr('未找到 Antigravity 安装目录，请使用 --install-dir 指定。');
    return 1;
  }

  const state = inspect(found.resourcesDir);
  const cls = classify(state);
  const repoDir = resolveRepoDir(opts.repo);

  log(`安装目录: ${found.installDir}`);
  log(`资源目录: ${found.resourcesDir}`);
  log(`app.asar: ${formatArchive(state.asar)}`);
  log(`app.asar.bak: ${formatArchive(state.bak)}`);
  log(`状态分类: ${cls}（${STATE_LABELS[cls]}）`);

  if (!fs.existsSync(repoDir)) {
    log(`上游仓库: ${repoDir}（未克隆）`);
    log('当前 HEAD tag: -');
    log('匹配 tag: -');
    log('最新 tag: -');
    return 0;
  }

  if (!fs.existsSync(path.join(repoDir, '.git'))) {
    log(`上游仓库: ${repoDir}（目录存在但不是 Git 仓库）`);
    return 0;
  }

  const headTag = getHeadTag(repoDir);
  const tags = listTags(repoDir);
  const matched = state.asar.version ? pickTag(tags, state.asar.version) : null;
  const latest = latestTag(tags);

  log(`上游仓库: ${repoDir}`);
  log(`当前 HEAD tag: ${headTag || '非 tag'}`);
  log(`匹配 tag: ${matched || '无匹配'}`);
  log(`最新 tag: ${latest || '无'}`);
  return 0;
}

function checkProcessProtection(opts) {
  if (!opts.allowClose && insideAntigravity()) {
    if (opts.dryRun) {
      log('提示: 当前运行在 Antigravity 进程内；实际执行时会被拒绝（退出码 4），需在外部终端运行或加 --allow-close。');
      return 0;
    }
    logErr('这个命令会关闭 Antigravity，请在 Antigravity 外面的终端运行。');
    return 4;
  }
  return 0;
}

function readEngineCode(repoDir, enginePath, tag = null) {
  if (tag) {
    try {
      return execFileSync('git', ['-C', repoDir, 'show', `${tag}:localization_engine.js`], {
        encoding: 'utf8',
        maxBuffer: 16 * 1024 * 1024,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch {
      // Fall back to working tree file if git show fails.
    }
  }
  if (fs.existsSync(enginePath)) {
    return fs.readFileSync(enginePath, 'utf8');
  }
  return null;
}

function formatArgsForDisplay(args) {
  return args.map((a) => (/\s|[\\"]/.test(a) ? `"${a}"` : a)).join(' ');
}

function cmdUpdate(opts) {
  const found = findInstallDir({ cliDir: opts.installDir });
  if (!found) {
    logErr('未找到 Antigravity 安装目录，请使用 --install-dir 指定。');
    return 1;
  }

  const guardCode = checkProcessProtection(opts);
  if (guardCode !== 0) return guardCode;

  const repoDir = resolveRepoDir(opts.repo);
  let repoStatus;
  try {
    repoStatus = ensureRepo(repoDir, { dryRun: opts.dryRun });
  } catch (err) {
    logErr(err.message);
    return 1;
  }

  const state = inspect(found.resourcesDir);
  const cls = classify(state);
  const targetVersion = state.asar.version;
  if (!targetVersion) {
    logErr('无法从 app.asar 读取版本号。');
    return 1;
  }

  if (!repoStatus.exists) {
    if (cls === 'INCONSISTENT') {
      logErr(`状态为 INCONSISTENT: ${explainInconsistent(state)}`);
      return 6;
    }
    if (cls === 'STALE_BACKUP') {
      const targetName = chooseBackupRenameTarget(found.resourcesDir, state.bak.version);
      log(`[dry-run] 检测到过期备份（${state.bak.version || '未知'}），将改名为: ${targetName}`);
    }
    log(`[dry-run] 目标版本: ${targetVersion}，仓库尚未克隆，无法预读 tag；实际执行时会匹配对应 tag 并运行引擎。`);
    log('[dry-run] 预演结束，未修改任何文件。');
    return 0;
  }

  const tags = listTags(repoDir);
  const tag = pickTag(tags, targetVersion);
  const latest = latestTag(tags);
  if (!tag) {
    logErr(`上游还没适配 ${targetVersion}，最新 tag 是 ${latest || '无'}`);
    return 5;
  }

  if (cls === 'INCONSISTENT') {
    logErr(`状态为 INCONSISTENT: ${explainInconsistent(state)} 请手动检查后再试。`);
    return 6;
  }

  const enginePath = path.join(repoDir, 'localization_engine.js');
  const engineCode = readEngineCode(repoDir, enginePath, tag);
  if (!engineCode) {
    logErr(`未找到上游引擎脚本: ${enginePath}`);
    return 1;
  }

  const flags = probeEngineFlags(engineCode);
  if (!flags.installDirFlag) {
    logErr('当前 tag 的 localization_engine.js 不支持安装目录参数（可能上游已重构 CLI），已中止执行。');
    return 1;
  }

  const engineArgs = [enginePath, flags.installDirFlag, found.installDir];
  if (flags.brandTitleFlag) {
    engineArgs.push(flags.brandTitleFlag, opts.brandTitle);
  } else {
    log('警告: 当前上游版本不支持 --brand-title，已自动忽略该参数。');
  }

  if (cls === 'STALE_BACKUP') {
    const newName = chooseBackupRenameTarget(found.resourcesDir, state.bak.version);
    const oldBak = path.join(found.resourcesDir, 'app.asar.bak');
    const newBak = path.join(found.resourcesDir, newName);
    if (opts.dryRun) {
      log(`[dry-run] 检测到过期备份（${state.bak.version || '未知'}），将把 app.asar.bak 改名为 ${newName}`);
    } else {
      fs.renameSync(oldBak, newBak);
      log(`检测到过期备份（${state.bak.version || '未知'}），已改名为: ${newName}`);
    }
  } else if (cls === 'PATCHED') {
    log(`当前已汉化（${targetVersion}），将使用 ${tag} 重新应用汉化。`);
  }

  if (opts.dryRun) {
    log(`[dry-run] 目标版本: ${targetVersion}，选中 tag: ${tag}`);
    log(`[dry-run] 将执行: git -C "${repoDir}" checkout --quiet ${tag}`);
    log(`[dry-run] 将执行: node ${formatArgsForDisplay(engineArgs)}`);
    log('[dry-run] 预演结束，未修改任何文件。');
    return 0;
  }

  execFileSync('git', ['-C', repoDir, 'checkout', '--quiet', tag], { stdio: 'inherit' });
  log(`已切换到上游 tag: ${tag}`);

  if (!fs.existsSync(enginePath)) {
    logErr(`未找到上游引擎脚本: ${enginePath}`);
    return 1;
  }

  const res = spawnSync(process.execPath, engineArgs, { stdio: 'inherit' });
  if (res.error) {
    logErr(`启动汉化引擎失败: ${res.error.message}`);
    return 1;
  }
  if (res.status !== 0) {
    return res.status || 1;
  }

  const afterState = inspect(found.resourcesDir);
  const afterCls = classify(afterState);
  if (afterCls !== 'PATCHED') {
    logErr(`复查失败: 安装后状态为 ${afterCls}，而非 PATCHED。`);
    return 1;
  }

  log(`完成: Antigravity ${afterState.asar.version} 已处于 PATCHED 状态。`);
  return 0;
}

function cmdRestore(opts) {
  const found = findInstallDir({ cliDir: opts.installDir });
  if (!found) {
    logErr('未找到 Antigravity 安装目录，请使用 --install-dir 指定。');
    return 1;
  }

  const state = inspect(found.resourcesDir);
  if (!state.bak.exists) {
    logErr('没有 app.asar.bak，不能还原');
    return 1;
  }

  const cls = classify(state);
  if (
    cls === 'STALE_BACKUP' ||
    (state.asar.version && state.bak.version && state.asar.version !== state.bak.version)
  ) {
    logErr(
      `app.asar.bak（${state.bak.version || '未知'}）与当前 app.asar（${state.asar.version || '未知'}）版本不一致，还原会导致降级，已拒绝。`
    );
    return 6;
  }

  const guardCode = checkProcessProtection(opts);
  if (guardCode !== 0) return guardCode;

  const repoDir = resolveRepoDir(opts.repo);
  let repoStatus;
  try {
    repoStatus = ensureRepo(repoDir, { dryRun: opts.dryRun });
  } catch (err) {
    logErr(err.message);
    return 1;
  }

  const enginePath = path.join(repoDir, 'localization_engine.js');
  if (!repoStatus.exists) {
    log('[dry-run] 还原前需先克隆上游仓库以获取引擎脚本。');
    log(`[dry-run] 将执行: node "${enginePath}" --huifu --install-dir "${found.installDir}"`);
    log('[dry-run] 预演结束，未修改任何文件。');
    return 0;
  }

  const engineCode = readEngineCode(repoDir, enginePath);
  if (!engineCode) {
    logErr(`未找到上游引擎脚本: ${enginePath}`);
    return 1;
  }

  const flags = probeEngineFlags(engineCode);
  if (!flags.installDirFlag || !flags.restoreFlag) {
    logErr('当前上游版本的 localization_engine.js 参数已变更，无法安全调用还原命令，已中止执行。');
    return 1;
  }

  const engineArgs = [enginePath, flags.restoreFlag, flags.installDirFlag, found.installDir];
  if (opts.dryRun) {
    log(`[dry-run] 将执行: node ${formatArgsForDisplay(engineArgs)}`);
    log('[dry-run] 预演结束，未修改任何文件。');
    return 0;
  }

  const res = spawnSync(process.execPath, engineArgs, { stdio: 'inherit' });
  if (res.error) {
    logErr(`启动还原引擎失败: ${res.error.message}`);
    return 1;
  }
  if (res.status !== 0) {
    return res.status || 1;
  }

  log('已还原为官方英文版。');
  return 0;
}

function main() {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (err) {
    logErr(err.message);
    printHelp();
    process.exit(1);
  }

  if (opts.help || opts.command === 'help') {
    printHelp();
    process.exit(0);
  }

  if (!opts.command) {
    printHelp();
    process.exit(1);
  }

  let code = 0;
  if (opts.command === 'status') {
    code = cmdStatus(opts);
  } else if (opts.command === 'update' || opts.command === 'install') {
    code = cmdUpdate(opts);
  } else if (opts.command === 'restore') {
    code = cmdRestore(opts);
  } else {
    logErr(`未知命令: ${opts.command}`);
    printHelp();
    code = 1;
  }
  process.exit(code);
}

main();
