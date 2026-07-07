# cleandrive

Disk cleanup planner for this Mac: scans disk usage, categorizes items by risk,
lets the user approve actions in a web dashboard, then executes them (cache
cleans, deletes of regenerable data, rsync archives to a remote drive over
SSH/Tailscale with checksum verification).

Zero npm dependencies on purpose — do not add packages.

## How Claude Code should drive it (the connector)

The CLI and the JSON files in `data/` are the integration surface:

```
node bin/cleandrive.js scan            # rescan (~1–3 min), writes data/latest.json
node bin/cleandrive.js state [--json]  # current scan + plan, with item ids
node bin/cleandrive.js approve <id…> [--action=rm|clean|archive|archive+rm]
node bin/cleandrive.js skip <id…>
node bin/cleandrive.js execute [--dry-run]
node bin/cleandrive.js offload-dryrun  # rsync -n approved archive items
node bin/cleandrive.js remote-test     # SSH reachability of configured remote
node bin/cleandrive.js serve           # dashboard at http://localhost:4499
```

Typical planned-cleanup flow for a Claude session:
1. `state --json` → read items (id, path, kb, category, suggest, note).
2. Propose a plan to the user in chat (group by category, sum sizes).
3. On the user's explicit approval, `approve` the agreed ids, then
   `execute --dry-run`, show the output, then `execute`.
4. Never approve/execute without the user confirming the specific items.

Files:
- `data/latest.json` — last scan: `{ts, disk, items[]}`
- `data/plan.json` — approval state per item id
- `data/actions.log` — JSONL audit log of everything executed
- `config.json` — project roots, thresholds, remote `{host, user, path}`

## Safety model (do not weaken)

- Only paths produced by the scan are actionable; everything else is refused.
- `rm` is allowed only for categories `pkgcache`, `cache`, `node_modules`
  (regenerable data). `projects` can only be archived; local removal happens
  solely via `archive+rm` after an rsync checksum verification passes.
- `appdata` and `models` are review-only: the tool never deletes them.
- `config.protected` paths are hard-locked: flagged 🔒 in the scan, forced to
  `keep`, non-actionable in the UI, and refused at execution even if an action is
  forged. Currently protects Claude agent/vibe-coding history: the Claude desktop
  app data, `~/.claude` (Claude Code sessions), and `~/.claude-mem` (memory).
- Protected roots (~, ~/Documents, ~/Desktop, ~/Downloads, ~/Pictures,
  ~/Library) are refused as direct targets regardless of plan content.
- The dashboard binds to 127.0.0.1 only, and execution requires typing FREE.

## Categories

| key | risk | action space |
|---|---|---|
| pkgcache | low | official clean command (uv/npm/brew/pnpm/bun), or rm |
| cache | low | rm (apps rebuild) |
| node_modules | low | rm (reinstall per project) |
| projects | medium | archive / archive+rm / keep — stale = no file touched in `staleDays` |
| appdata | review | manual only |
| models | review | manual only (e.g. `ollama rm`) |
