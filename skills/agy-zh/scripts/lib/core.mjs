import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readAsarFile } from './asar.mjs';

export const UPSTREAM_URL = 'https://github.com/Silas-02/antigravity-desktop-cn';

/**
 * Parse a version or tag string like "2.34.0" or "v2.33.0.1" into 4 numeric segments.
 * Missing 4th segment defaults to 0. Returns null for non-version strings.
 */
export function parseVersionParts(input) {
  if (typeof input !== 'string') return null;
  const m = input.trim().match(/^v?(\d+)\.(\d+)\.(\d+)(?:\.(\d+))?$/);
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3]), m[4] !== undefined ? Number(m[4]) : 0];
}

function compareVersionParts(a, b) {
  for (let i = 0; i < 4; i++) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return 0;
}

/**
 * Pick the highest tag whose first three segments match `version`.
 */
export function pickTag(tags, version) {
  const target = parseVersionParts(version);
  if (!target || !Array.isArray(tags)) return null;

  let bestTag = null;
  let bestParts = null;
  for (const raw of tags) {
    const tag = String(raw || '').trim();
    const parts = parseVersionParts(tag);
    if (!parts) continue;
    if (parts[0] !== target[0] || parts[1] !== target[1] || parts[2] !== target[2]) continue;
    if (!bestParts || compareVersionParts(parts, bestParts) > 0) {
      bestTag = tag;
      bestParts = parts;
    }
  }
  return bestTag;
}

/**
 * Pick the highest version tag from a list of tags.
 */
export function latestTag(tags) {
  if (!Array.isArray(tags)) return null;

  let bestTag = null;
  let bestParts = null;
  for (const raw of tags) {
    const tag = String(raw || '').trim();
    const parts = parseVersionParts(tag);
    if (!parts) continue;
    if (!bestParts || compareVersionParts(parts, bestParts) > 0) {
      bestTag = tag;
      bestParts = parts;
    }
  }
  return bestTag;
}

function hasAsarOrBackup(dir) {
  return (
    fs.existsSync(path.join(dir, 'app.asar')) ||
    fs.existsSync(path.join(dir, 'app.asar.bak'))
  );
}

/**
 * Resolve { installDir, resourcesDir } from a candidate install or resources directory.
 */
export function resolveResourcesFromCandidate(candidate) {
  if (!candidate || typeof candidate !== 'string') return null;
  const cleaned = candidate.trim().replace(/^["']|["']$/g, '').trim();
  if (!cleaned) return null;

  const base = path.resolve(cleaned);
  const winResources = path.join(base, 'resources');
  if (hasAsarOrBackup(winResources)) {
    return { installDir: base, resourcesDir: winResources };
  }

  const macResources = path.join(base, 'Contents', 'Resources');
  if (hasAsarOrBackup(macResources)) {
    return { installDir: base, resourcesDir: macResources };
  }

  if (hasAsarOrBackup(base)) {
    if (/[\\/]Contents[\\/]Resources$/i.test(base)) {
      return { installDir: path.dirname(path.dirname(base)), resourcesDir: base };
    }
    if (path.basename(base).toLowerCase() === 'resources') {
      return { installDir: path.dirname(base), resourcesDir: base };
    }
    return { installDir: base, resourcesDir: base };
  }

  return null;
}

function runPowerShell(script) {
  const fullScript = `$ProgressPreference = 'SilentlyContinue'\n${script}`;
  const encoded = Buffer.from(fullScript, 'utf16le').toString('base64');
  return execFileSync('powershell', ['-NoProfile', '-EncodedCommand', encoded], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function extractDirFromExeField(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  const quoted = trimmed.match(/^"([^"]+)"/);
  if (quoted) {
    return path.dirname(quoted[1]);
  }
  const exeMatch = trimmed.match(/^(.*?\.exe)(?:,|\s|$)/i);
  if (exeMatch) {
    return path.dirname(exeMatch[1]);
  }
  return null;
}

function detectWindowsRunningProcess() {
  try {
    const out = runPowerShell(
      'Get-Process Antigravity -EA SilentlyContinue | Select-Object -ExpandProperty Path -EA SilentlyContinue'
    );
    const lines = out.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    for (const exePath of lines) {
      const resolved = resolveResourcesFromCandidate(path.dirname(exePath));
      if (resolved) return resolved;
    }
  } catch {
    // Ignore process lookup errors and fall back to registry/default paths.
  }
  return null;
}

function detectWindowsRegistry() {
  try {
    const ps = [
      "Get-ItemProperty 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*','HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*','HKLM:\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*' -EA SilentlyContinue",
      "| Where-Object { $_.DisplayName -like 'Antigravity*' -and $_.DisplayName -notlike '*IDE*' }",
      '| Select-Object InstallLocation,DisplayIcon,UninstallString',
      '| ConvertTo-Json -Compress',
    ].join(' ');
    const out = runPowerShell(ps).trim();
    if (!out) return null;
    const parsed = JSON.parse(out);
    const entries = Array.isArray(parsed) ? parsed : [parsed];
    for (const entry of entries) {
      const dirs = [
        entry?.InstallLocation,
        extractDirFromExeField(entry?.DisplayIcon),
        extractDirFromExeField(entry?.UninstallString),
      ];
      for (const dir of dirs) {
        const resolved = resolveResourcesFromCandidate(dir);
        if (resolved) return resolved;
      }
    }
  } catch {
    // Ignore registry lookup errors and fall back to default paths.
  }
  return null;
}

/**
 * Locate the Antigravity desktop installation and resources directories.
 */
export function findInstallDir({ cliDir } = {}) {
  if (cliDir !== undefined && cliDir !== null && String(cliDir).trim() !== '') {
    return resolveResourcesFromCandidate(String(cliDir));
  }

  if (process.env.AGY_INSTALL_DIR) {
    const envMatch = resolveResourcesFromCandidate(process.env.AGY_INSTALL_DIR);
    if (envMatch) return envMatch;
  }

  if (process.platform === 'win32') {
    const running = detectWindowsRunningProcess();
    if (running) return running;

    const reg = detectWindowsRegistry();
    if (reg) return reg;

    const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
    const defaults = [
      path.join(localAppData, 'Programs', 'Antigravity'),
      path.join(localAppData, 'Programs', 'antigravity'),
    ];
    for (const candidate of defaults) {
      const resolved = resolveResourcesFromCandidate(candidate);
      if (resolved) return resolved;
    }
    return null;
  }

  if (process.platform === 'darwin') {
    const macCandidates = [
      '/Applications/Antigravity.app/Contents/Resources',
      path.join(os.homedir(), 'Applications', 'Antigravity.app', 'Contents', 'Resources'),
    ];
    for (const candidate of macCandidates) {
      const resolved = resolveResourcesFromCandidate(candidate);
      if (resolved) return resolved;
    }
    return null;
  }

  const linuxCandidates = [
    '/usr/share/antigravity/resources',
    '/opt/Antigravity/resources',
  ];
  for (const candidate of linuxCandidates) {
    const resolved = resolveResourcesFromCandidate(candidate);
    if (resolved) return resolved;
  }
  return null;
}

function inspectArchive(asarPath) {
  if (!fs.existsSync(asarPath)) {
    return { exists: false, version: null, patched: false };
  }

  let version = null;
  const pkgBuf = readAsarFile(asarPath, 'package.json');
  if (pkgBuf) {
    try {
      const pkg = JSON.parse(pkgBuf.toString('utf8'));
      if (pkg && typeof pkg.version === 'string') {
        version = pkg.version;
      }
    } catch {
      version = null;
    }
  }

  const preloadBuf = readAsarFile(asarPath, 'dist/preload.js');
  const patched = preloadBuf ? /[\u4e00-\u9fff]/.test(preloadBuf.toString('utf8')) : false;

  return { exists: true, version, patched };
}

/**
 * Inspect app.asar and app.asar.bak inside resourcesDir.
 */
export function inspect(resourcesDir) {
  return {
    asar: inspectArchive(path.join(resourcesDir, 'app.asar')),
    bak: inspectArchive(path.join(resourcesDir, 'app.asar.bak')),
  };
}

/**
 * Classify localization state into NOT_INSTALLED, PATCHED, STALE_BACKUP, or INCONSISTENT.
 */
export function classify(state) {
  const asar = state?.asar;
  const bak = state?.bak;
  if (!asar?.exists) {
    return 'INCONSISTENT';
  }

  if (asar.patched) {
    if (bak?.exists && asar.version && bak.version && bak.version === asar.version) {
      return 'PATCHED';
    }
    return 'INCONSISTENT';
  }

  if (!bak?.exists) {
    return 'NOT_INSTALLED';
  }
  if (asar.version && bak.version && bak.version === asar.version) {
    return 'NOT_INSTALLED';
  }
  return 'STALE_BACKUP';
}

/**
 * Return true if the current process is running as a descendant of Antigravity.
 */
export function insideAntigravity() {
  try {
    if (process.platform === 'win32') {
      const out = runPowerShell(
        'Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name | ConvertTo-Json -Compress'
      ).trim();
      if (!out) return false;
      const parsed = JSON.parse(out);
      const list = Array.isArray(parsed) ? parsed : [parsed];
      const byPid = new Map(list.map((p) => [Number(p.ProcessId), p]));

      let pid = process.pid;
      const seen = new Set();
      while (pid && !seen.has(pid) && byPid.has(pid)) {
        seen.add(pid);
        const proc = byPid.get(pid);
        if (pid !== process.pid && /^antigravity(\.exe)?$/i.test(String(proc.Name || '').trim())) {
          return true;
        }
        pid = Number(proc.ParentProcessId);
      }
      return false;
    }

    let pid = process.ppid;
    const seen = new Set();
    while (pid > 1 && !seen.has(pid)) {
      seen.add(pid);
      const line = execFileSync('ps', ['-o', 'ppid=,comm=', '-p', String(pid)], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      }).trim();
      if (!line) break;
      const m = line.match(/^(\d+)\s+(.+)$/);
      if (!m) break;
      const ppid = Number(m[1]);
      const base = path.basename(m[2].trim());
      if (/^antigravity(\.exe)?(\s+helper.*)?$/i.test(base)) {
        return true;
      }
      pid = ppid;
    }
    return false;
  } catch (err) {
    console.warn(`[agy-zh] 警告: 无法检测父进程，已跳过进程保护 (${err.message})`);
    return false;
  }
}

/**
 * Resolve upstream repository path: --repo -> AGY_ZH_REPO -> OS data directory.
 */
export function resolveRepoDir(cliRepo) {
  if (cliRepo !== undefined && cliRepo !== null && String(cliRepo).trim() !== '') {
    return path.resolve(String(cliRepo).trim());
  }
  if (process.env.AGY_ZH_REPO) {
    return path.resolve(process.env.AGY_ZH_REPO.trim());
  }
  if (process.platform === 'win32') {
    const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
    return path.join(localAppData, 'agy-zh', 'antigravity-desktop-cn');
  }
  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', 'agy-zh', 'antigravity-desktop-cn');
  }
  const xdgData = process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share');
  return path.join(xdgData, 'agy-zh', 'antigravity-desktop-cn');
}

/**
 * Ensure the upstream repository exists locally, is clean, and has fetched tags.
 */
export function ensureRepo(repoDir, { dryRun = false } = {}) {
  if (!fs.existsSync(repoDir)) {
    if (dryRun) {
      console.log(`[agy-zh] [dry-run] 将克隆上游仓库 ${UPSTREAM_URL} -> ${repoDir}`);
      return { exists: false, cloned: false };
    }
    fs.mkdirSync(path.dirname(repoDir), { recursive: true });
    console.log(`[agy-zh] 正在克隆上游仓库到: ${repoDir}`);
    execFileSync('git', ['clone', UPSTREAM_URL, repoDir], { stdio: 'inherit' });
    return { exists: true, cloned: true };
  }

  if (!fs.existsSync(path.join(repoDir, '.git'))) {
    throw new Error(`目录已存在但不是 Git 仓库: ${repoDir}`);
  }

  const dirty = execFileSync('git', ['-C', repoDir, 'status', '--porcelain'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
  if (dirty) {
    throw new Error('上游仓库有本地改动，先自行处理');
  }

  try {
    execFileSync('git', ['-C', repoDir, 'fetch', '--tags'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (err) {
    console.warn(`[agy-zh] 警告: git fetch --tags 失败，将继续使用本地已有 tag (${err.message.split('\n')[0]})`);
  }

  return { exists: true, cloned: false };
}

/**
 * List tags from an existing local git repository.
 */
export function listTags(repoDir) {
  const out = execFileSync('git', ['-C', repoDir, 'tag'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return out.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
}

/**
 * Get the exact tag pointing at HEAD, or null if HEAD is not on a tag.
 */
export function getHeadTag(repoDir) {
  try {
    const tag = execFileSync('git', ['-C', repoDir, 'describe', '--tags', '--exact-match', 'HEAD'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
    return tag || null;
  } catch {
    return null;
  }
}

/**
 * Probe supported CLI flags from upstream localization_engine.js source code.
 */
export function probeEngineFlags(engineCode) {
  const code = typeof engineCode === 'string' ? engineCode : '';
  const hasFlag = (flag) => new RegExp(`['"\`]${flag}['"\`=]`).test(code);

  let installDirFlag = null;
  if (hasFlag('--install-dir')) {
    installDirFlag = '--install-dir';
  } else if (hasFlag('--dir')) {
    installDirFlag = '--dir';
  }

  const brandTitleFlag = hasFlag('--brand-title') ? '--brand-title' : null;

  let restoreFlag = null;
  for (const candidate of ['--huifu', '--restore', '--uninstall']) {
    if (hasFlag(candidate)) {
      restoreFlag = candidate;
      break;
    }
  }

  return { installDirFlag, brandTitleFlag, restoreFlag };
}
