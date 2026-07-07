// Generates a synthetic, privacy-safe scan fixture used only for the demo
// screenshots and video — so the public repo shows realistic data without
// exposing any real machine's paths, projects, or app inventory.
//   node media/make-demo-fixture.mjs > data/latest.json
import { createHash } from 'node:crypto';
const id = (p) => createHash('sha1').update(p).digest('hex').slice(0, 10);
const MB = 1024, GB = 1024 * 1024;

const items = [];
const add = (path, category, kb, extra = {}) => items.push({ id: id(path), path, category, kb, ...extra });

// 1. Package caches (universal tool names — not private)
add('~/.cache/uv', 'pkgcache', 15.2 * GB, { suggest: 'clean', cleanCmd: 'uv cache clean', note: 'runs: uv cache clean' });
add('~/.npm', 'pkgcache', 8.4 * GB, { suggest: 'clean', cleanCmd: 'npm cache clean --force', note: 'runs: npm cache clean --force' });
add('~/Library/pnpm', 'pkgcache', 3.3 * GB, { suggest: 'clean', cleanCmd: 'pnpm store prune', note: 'runs: pnpm store prune' });
add('~/Library/Caches/Homebrew', 'pkgcache', 2.9 * GB, { suggest: 'clean', cleanCmd: 'brew cleanup -s --prune=all', note: 'runs: brew cleanup -s --prune=all' });
add('~/.bun/install/cache', 'pkgcache', 512 * MB, { suggest: 'clean', cleanCmd: 'bun pm cache rm', note: 'runs: bun pm cache rm' });

// 2. Generic caches
for (const [n, kb] of [['huggingface', 1.6 * GB], ['ms-playwright', 1.0 * GB], ['puppeteer', 640 * MB], ['electron', 420 * MB], ['JetBrains', 690 * MB], ['node-gyp', 210 * MB]])
  add(`~/.cache/${n}`, 'cache', kb, { suggest: 'rm', note: 'rebuilt automatically by the app' });

// 3. node_modules (synthetic project names)
for (const [proj, kb] of [['acme-dashboard', 1.9 * GB], ['portfolio-site', 820 * MB], ['invoice-api', 610 * MB], ['ml-notebooks', 540 * MB], ['side-quest-game', 730 * MB], ['docs-astro', 480 * MB]])
  add(`~/code/${proj}/node_modules`, 'node_modules', kb, { suggest: 'rm', note: "reinstall with the project's package manager" });

// 4. Projects (some stale, some active)
add('~/code/data-platform', 'projects', 4.8 * GB, { active: false, daysIdle: 210, suggest: 'archive', note: 'no changes in 60+ days — archive candidate' });
add('~/code/acme-dashboard', 'projects', 2.6 * GB, { active: true, suggest: 'keep', note: 'touched within 60 days' });
add('~/code/ml-experiments', 'projects', 3.1 * GB, { active: false, daysIdle: 134, suggest: 'archive', note: 'no changes in 60+ days — archive candidate' });
add('~/code/portfolio-site', 'projects', 1.2 * GB, { active: true, suggest: 'keep', note: 'touched within 60 days' });
add('~/code/side-quest-game', 'projects', 2.0 * GB, { active: false, daysIdle: 302, suggest: 'archive', note: 'no changes in 60+ days — archive candidate' });

// 5. App data (Claude protected — a feature to show; other names are common apps)
add('~/Library/Application Support/Claude', 'appdata', 9.4 * GB, { protected: true, suggest: 'keep', note: 'protected in config.json — never touched by cleandrive' });
add('~/Library/Application Support/com.apple.wallpaper', 'appdata', 8.9 * GB, { suggest: 'review', note: 'inspect before touching — may hold chats, settings, licenses' });
for (const [n, kb] of [['Notion', 2.2 * GB], ['Slack', 1.3 * GB], ['Steam', 1.2 * GB], ['zoom.us', 1.0 * GB]])
  add(`~/Library/Application Support/${n}`, 'appdata', kb, { suggest: 'review', note: 'inspect before touching — may hold chats, settings, licenses' });

// 6. Applications (size + last-used + data footprint)
const app = (name, kb, daysIdle, dataMb) => add(`/Applications/${name}.app`, 'apps', kb, {
  daysIdle, dataKb: (dataMb || 0) * MB, suggest: 'review',
  note: `last opened ${daysIdle}d ago` + (dataMb ? ` · +${dataMb}MB app data` : '') + (daysIdle >= 120 ? ' · idle 120d+ — uninstall candidate' : ''),
});
app('Google Chrome', 1.36 * GB, 0, 2058);
app('Blender', 814 * MB, 153, 0);
app('GIMP', 790 * MB, 163, 0);
app('Visual Studio Code', 824 * MB, 0, 615);
app('Xcode', 6.2 * GB, 240, 0);
app('Figma', 460 * MB, 41, 320);
app('OBS', 435 * MB, 188, 0);
app('Canva', 219 * MB, 341, 560);

// 7. Models
add('~/.ollama', 'models', 3.8 * GB, { suggest: 'review', note: 'ollama list && ollama rm <model>' });

items.sort((a, b) => b.kb - a.kb);
const usedKB = 191 * GB, availKB = 12 * GB;
const scan = {
  ts: '2026-07-07T18:40:00.000Z',
  disk: { sizeKB: 228 * GB, usedKB, availKB, pct: Math.round(usedKB / (usedKB + availKB) * 100) },
  staleDays: 60,
  items: items.map((i) => ({ ...i, kb: Math.round(i.kb) })),
};
process.stdout.write(JSON.stringify(scan, null, 2) + '\n');
