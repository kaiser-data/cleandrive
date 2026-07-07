#!/usr/bin/env node
// cleandrive — scan disk, plan cleanup, clean caches, archive to remote over SSH/Tailscale.
// This CLI is also the Claude Code connector: every command supports --json where useful.
import path from 'node:path';
import { DATA_DIR, readJson, fmtGB, loadConfig } from '../lib/util.js';
import { runScan, CATEGORIES } from '../lib/scan.js';
import { serve } from '../lib/server.js';
import { loadPlan, setPlanItem, approvedItems, executeItem, testRemote, archive } from '../lib/actions.js';

const [, , cmd, ...args] = process.argv;
const flag = (f) => args.includes(f);

function latest() {
  const scan = readJson(path.join(DATA_DIR, 'latest.json'));
  if (!scan) {
    console.error('no scan yet — run: cleandrive scan');
    process.exit(1);
  }
  return scan;
}

function printState() {
  const scan = latest();
  const plan = loadPlan();
  if (flag('--json')) {
    console.log(JSON.stringify({ scan, plan }, null, 2));
    return;
  }
  const d = scan.disk;
  console.log(`scan: ${scan.ts}`);
  console.log(`disk: ${fmtGB(d.usedKB)} used of ${fmtGB(d.sizeKB)} (${d.pct}%), ${fmtGB(d.availKB)} free\n`);
  for (const [key, meta] of Object.entries(CATEGORIES)) {
    const items = scan.items.filter((i) => i.category === key);
    if (!items.length) continue;
    const total = items.reduce((s, i) => s + i.kb, 0);
    console.log(`## ${meta.label} — ${fmtGB(total)} (risk: ${meta.risk})`);
    for (const i of items.slice(0, 15)) {
      const st = plan.items[i.id]?.status || '·';
      console.log(`  [${st.padEnd(8)}] ${i.id}  ${fmtGB(i.kb).padStart(8)}  ${i.suggest.padEnd(10)} ${i.path.replace(process.env.HOME, '~')}`);
    }
    if (items.length > 15) console.log(`  … ${items.length - 15} more`);
  }
}

switch (cmd) {
  case 'scan': {
    console.error('scanning…');
    const scan = await runScan((s) => console.error('  ' + s));
    if (flag('--json')) console.log(JSON.stringify(scan, null, 2));
    else console.log(`done: ${scan.items.length} items, disk at ${scan.disk.pct}%`);
    break;
  }
  case 'state':
    printState();
    break;
  case 'serve':
    serve();
    break;
  case 'approve': {
    const ids = args.filter((a) => !a.startsWith('--'));
    const action = (args.find((a) => a.startsWith('--action=')) || '').split('=')[1];
    for (const id of ids) {
      setPlanItem(id, { status: 'approved', ...(action && { action }) });
      console.log(`approved ${id}${action ? ' → ' + action : ''}`);
    }
    break;
  }
  case 'skip':
    for (const id of args.filter((a) => !a.startsWith('--'))) {
      setPlanItem(id, { status: 'skipped' });
      console.log(`skipped ${id}`);
    }
    break;
  case 'execute': {
    const items = approvedItems();
    if (!items.length) { console.log('nothing approved'); break; }
    const dry = flag('--dry-run');
    for (const item of items) {
      console.log(`${dry ? '[dry-run] would' : '▶'} ${item.plannedAction}: ${item.path} (${fmtGB(item.kb)})`);
      if (dry) continue;
      try {
        const r = await executeItem(item, { onData: (d) => process.stderr.write(d) });
        console.log(r.ok ? '  ✓ done' : `  ✗ failed: ${r.output.split('\n').pop()}`);
      } catch (e) {
        console.log(`  ✗ refused: ${e.message}`);
      }
    }
    break;
  }
  case 'offload-dryrun': {
    const items = approvedItems().filter((i) => (i.plannedAction || '').startsWith('archive'));
    for (const item of items) {
      console.log(`dry-run: ${item.path}`);
      const r = await archive(item, { dryRun: true, onData: (d) => process.stderr.write(d) });
      console.log(r.ok ? '  ✓ ok' : `  ✗ ${r.output}`);
    }
    break;
  }
  case 'remote-test': {
    const r = await testRemote();
    console.log((r.ok ? '✓ ' : '✗ ') + r.msg);
    process.exit(r.ok ? 0 : 1);
    break;
  }
  default:
    console.log(`cleandrive — disk cleanup planner & executor

usage:
  cleandrive scan [--json]          scan disk, categorize, write data/latest.json
  cleandrive state [--json]         show latest scan + plan status
  cleandrive serve                  start dashboard on http://localhost:${loadConfig().port || 4499}
  cleandrive approve <id…> [--action=rm|clean|archive|archive+rm]
  cleandrive skip <id…>
  cleandrive execute [--dry-run]    run all approved actions
  cleandrive offload-dryrun         rsync -n approved archive items to remote
  cleandrive remote-test            check SSH reachability of configured remote`);
}
