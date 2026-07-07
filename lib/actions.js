import { appendFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import {
  HOME, DATA_DIR, loadConfig, readJson, writeJson, run, runShell, ensureDataDir,
} from './util.js';

const PLAN_FILE = path.join(DATA_DIR, 'plan.json');
const LOG_FILE = path.join(DATA_DIR, 'actions.log');

// Categories whose items may be deleted directly (regenerable data only).
const RM_ALLOWED = new Set(['pkgcache', 'cache', 'node_modules']);
// Never touch these paths or anything above them, whatever the plan says.
const DENY = ['~', '~/Documents', '~/Desktop', '~/Downloads', '~/Pictures', '~/Library']
  .map((p) => (p === '~' ? HOME : path.join(HOME, p.slice(2))));

export function loadPlan() {
  return readJson(PLAN_FILE, { items: {} });
}

export function savePlan(plan) {
  ensureDataDir();
  writeJson(PLAN_FILE, plan);
}

export function setPlanItem(id, patch) {
  const plan = loadPlan();
  plan.items[id] = { ...(plan.items[id] || {}), ...patch, updated: new Date().toISOString() };
  savePlan(plan);
  return plan.items[id];
}

export function log(entry) {
  ensureDataDir();
  appendFileSync(LOG_FILE, JSON.stringify({ ts: new Date().toISOString(), ...entry }) + '\n');
}

function latestScan() {
  return readJson(path.join(DATA_DIR, 'latest.json'));
}

// A path is only actionable if it came out of the scan (allowlist by construction),
// lives under $HOME, and is not a protected root.
function validateTarget(item) {
  const p = path.resolve(item.path);
  if (!p.startsWith(HOME + path.sep)) throw new Error(`refusing: ${p} is outside ${HOME}`);
  if (p.includes('..')) throw new Error('refusing: path traversal');
  if (DENY.includes(p)) throw new Error(`refusing: ${p} is a protected directory`);
  const protectedPaths = (loadConfig().protected || []).map((x) => path.resolve(x.replace(/^~/, HOME)));
  for (const pp of protectedPaths) {
    if (p === pp || p.startsWith(pp + path.sep)) throw new Error(`refusing: ${p} is user-protected (config.protected)`);
  }
  return p;
}

function remoteTarget(cfg) {
  const { host, user, path: rpath } = cfg.remote || {};
  if (!host || !rpath) throw new Error('remote not configured (set remote.host and remote.path in config.json)');
  return `${user ? user + '@' : ''}${host}:${rpath.replace(/\/$/, '')}/`;
}

export async function testRemote() {
  const cfg = loadConfig();
  const { host, user } = cfg.remote || {};
  if (!host) return { ok: false, msg: 'no remote host configured' };
  const dest = `${user ? user + '@' : ''}${host}`;
  const r = await run('ssh', ['-o', 'ConnectTimeout=5', '-o', 'BatchMode=yes', dest, 'true']);
  if (r.code === 0) {
    const df = await run('ssh', ['-o', 'ConnectTimeout=5', '-o', 'BatchMode=yes', dest, `df -h ${cfg.remote.path} 2>/dev/null | tail -1`]);
    return { ok: true, msg: `reachable — remote fs: ${df.out.trim() || 'path not found yet'}` };
  }
  return { ok: false, msg: (r.err || 'unreachable').trim().split('\n').pop() };
}

// rsync src into remote archive, preserving the path relative to $HOME.
// Returns { ok, verified, output }.
export async function archive(item, { dryRun = false, onData } = {}) {
  const cfg = loadConfig();
  const src = validateTarget(item);
  const rel = './' + path.relative(HOME, src);
  const dest = remoteTarget(cfg);
  const args = ['-aHR', '--partial', '--info=stats1,progress2'];
  if (dryRun) args.push('-n');
  const r = await run('rsync', [...args, rel, dest], { cwd: HOME, onData });
  if (r.code !== 0) return { ok: false, verified: false, output: r.err || r.out };
  if (dryRun) return { ok: true, verified: false, output: r.out };
  // Verify: checksum dry-run must report no differing files
  const v = await run('rsync', ['-aHRnc', '--itemize-changes', rel, dest], { cwd: HOME });
  const changes = v.out.trim().split('\n').filter((l) => l && !l.startsWith('.d..t')).length;
  const verified = v.code === 0 && changes === 0;
  return { ok: true, verified, output: r.out + (verified ? '\nVERIFIED: checksums match' : `\nVERIFY FAILED: ${changes} differences`) };
}

export async function executeItem(item, { onData = () => {} } = {}) {
  const p = validateTarget(item);
  const action = item.plannedAction || item.suggest;
  log({ event: 'start', id: item.id, path: p, action });

  let result;
  if (action === 'clean' && item.cleanCmd) {
    result = await runShell(item.cleanCmd, { onData });
    // Some caches keep residue after the official clean (e.g. npm _cacache logs) — that's fine.
    result = { ok: result.code === 0, output: (result.out + result.err).slice(-4000) };
  } else if (action === 'rm') {
    if (!RM_ALLOWED.has(item.category)) throw new Error(`refusing rm: category '${item.category}' is not deletable`);
    const r = await run('rm', ['-rf', p], { onData });
    result = { ok: r.code === 0, output: r.err || 'removed' };
  } else if (action === 'archive' || action === 'archive+rm') {
    const a = await archive(item, { onData });
    result = { ok: a.ok, verified: a.verified, output: a.output.slice(-4000) };
    if (action === 'archive+rm') {
      if (!a.ok || !a.verified) {
        result.output += '\nlocal copy KEPT (transfer not verified)';
      } else {
        const r = await run('rm', ['-rf', p]);
        result.output += r.code === 0 ? '\nlocal copy removed after verification' : `\nrm failed: ${r.err}`;
        result.ok = r.code === 0;
      }
    }
  } else {
    result = { ok: false, output: `no executable action for '${action}' (review items are manual)` };
  }

  log({ event: 'done', id: item.id, path: p, action, ok: result.ok, verified: result.verified });
  setPlanItem(item.id, { status: result.ok ? 'done' : 'failed', lastOutput: result.output.slice(-2000) });
  return result;
}

// Merge scan + plan into actionable approved items
export function approvedItems() {
  const scan = latestScan();
  const plan = loadPlan();
  if (!scan) return [];
  return scan.items
    .filter((it) => plan.items[it.id]?.status === 'approved')
    .map((it) => ({ ...it, plannedAction: plan.items[it.id].action || it.suggest }));
}
