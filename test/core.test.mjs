import assert from 'node:assert/strict';
import test from 'node:test';
import { classify, latestTag, pickTag, probeEngineFlags } from '../skills/agy-zh/scripts/lib/core.mjs';

test('pickTag selects highest 4-part tag matching first 3 version segments', () => {
  const tags = ['v2.33.0', 'v2.33.0.1', 'v2.34.0'];
  assert.equal(pickTag(tags, '2.33.0'), 'v2.33.0.1');
});

test('pickTag compares version segments numerically rather than lexicographically', () => {
  const tags = ['v2.33.0', 'v2.33.0.2', 'v2.33.0.10'];
  assert.equal(pickTag(tags, '2.33.0'), 'v2.33.0.10');
});

test('pickTag returns null when no tag matches and ignores non-version tags', () => {
  const tags = ['latest', 'v2.34.0-rc1', 'v2.33.0', 'v2.34.0'];
  assert.equal(pickTag(tags, '2.35.0'), null);
  assert.equal(pickTag(tags, '2.34.0'), 'v2.34.0');
  assert.equal(pickTag([], '2.34.0'), null);
});

test('latestTag returns the highest valid version tag', () => {
  assert.equal(latestTag(['v2.9.0', 'v2.33.0.1', 'v2.34.0', 'notes']), 'v2.34.0');
  assert.equal(latestTag(['v2.34.0', 'v2.34.0.2']), 'v2.34.0.2');
  assert.equal(latestTag(['notes', '']), null);
});

test('classify returns NOT_INSTALLED when asar is unpatched and bak is absent or matches version', () => {
  assert.equal(
    classify({
      asar: { exists: true, version: '2.34.0', patched: false },
      bak: { exists: false, version: null, patched: false },
    }),
    'NOT_INSTALLED'
  );
  assert.equal(
    classify({
      asar: { exists: true, version: '2.34.0', patched: false },
      bak: { exists: true, version: '2.34.0', patched: false },
    }),
    'NOT_INSTALLED'
  );
});

test('classify returns PATCHED when asar is patched and bak has the same version', () => {
  assert.equal(
    classify({
      asar: { exists: true, version: '2.34.0', patched: true },
      bak: { exists: true, version: '2.34.0', patched: false },
    }),
    'PATCHED'
  );
});

test('classify returns STALE_BACKUP when asar is unpatched and bak version differs', () => {
  assert.equal(
    classify({
      asar: { exists: true, version: '2.35.0', patched: false },
      bak: { exists: true, version: '2.34.0', patched: false },
    }),
    'STALE_BACKUP'
  );
});

test('classify returns INCONSISTENT for missing asar, missing bak on patched asar, or version mismatch on patched asar', () => {
  assert.equal(
    classify({
      asar: { exists: false, version: null, patched: false },
      bak: { exists: true, version: '2.34.0', patched: false },
    }),
    'INCONSISTENT'
  );
  assert.equal(
    classify({
      asar: { exists: true, version: '2.34.0', patched: true },
      bak: { exists: false, version: null, patched: false },
    }),
    'INCONSISTENT'
  );
  assert.equal(
    classify({
      asar: { exists: true, version: '2.35.0', patched: true },
      bak: { exists: true, version: '2.34.0', patched: false },
    }),
    'INCONSISTENT'
  );
});

test('probeEngineFlags detects current upstream flags and adapts to changed or missing flags', () => {
  const currentSample = `
    const mode = getOptionValue('--brand-title', 'english');
    if (args[i] === '--huifu') huifu = true;
    else if (args[i] === '--install-dir') manualDir = args[i + 1];
  `;
  assert.deepEqual(probeEngineFlags(currentSample), {
    installDirFlag: '--install-dir',
    brandTitleFlag: '--brand-title',
    restoreFlag: '--huifu',
  });

  const renamedSample = `
    if (arg === "--restore") restore();
    if (arg === "--dir") dir = next();
  `;
  assert.deepEqual(probeEngineFlags(renamedSample), {
    installDirFlag: '--dir',
    brandTitleFlag: null,
    restoreFlag: '--restore',
  });

  assert.deepEqual(probeEngineFlags('console.log("completely rewritten");'), {
    installDirFlag: null,
    brandTitleFlag: null,
    restoreFlag: null,
  });
});
