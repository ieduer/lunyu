# AI 论语 operations

Last normalized: 2026-08-10 PDT
Owner: suen
Lifecycle: active
Data class: student_owned
Documentation status: generated from local source, Git/GitHub audit, project catalog, and live Cloudflare inventory; unresolved facts remain fail-closed.

## Quick start

- Canonical local path: `/Users/ylsuen/CF/lunyu`
- Git authority: `ieduer/lunyu`
- Current local branch/HEAD: `main` / `511174e109513b52f79e8750c4f1324bb0885e90`
- Runtime config: `lunyu/wrangler.toml` (name `lunyu`)
- Current state: [PROJECT_STATE.md](../PROJECT_STATE.md)
- Workspace resource routing: [project resource index](../../reports/operations/project_resource_index.md)
- Documentation standard: [project operations standard](../../runbooks/project_operations_documentation_standard.md)
- Production mutation is forbidden until exact owner, target, bindings, backup, verification, and rollback have fresh readback.

## Existing project documentation relationship

This `docs/OPERATIONS.md` is the single project-local operations entrypoint.
Existing detailed manuals remain authoritative annexes for their exact scope;
historical handovers and ledgers are evidence, not current state.

- No earlier operational handbook was detected.

## Project and runtime inventory

| Project ID | Runtime type | Resource | Domains |
| --- | --- | --- | --- |
| `kz-bdfz-net` | `pages` | `lunyu` | kz.bdfz.net |

Live Cloudflare matching is metadata-only and does not prove application health:

| Resource | Live type | Readback | Detail |
| --- | --- | --- | --- |
| `lunyu` | Pages | verified 2026-08-10 | production branch `main`; canonical deployment `0d4ee651-c763-409b-bd2e-b2a100eef110` |

## Authority and dependencies

- Project names: AI 论语
- Catalog owner: suen
- Data classes: student_owned
- Identity modes: central
- User Center required: true
- Pulse measurement: zone_host
- Runtime bindings: 0 names cataloged; names are intentionally omitted from this general handbook. Inspect the exact project config and live binding types under task-scoped authority.
- Shared User Center, APIS, nav, image, Pulse, App, clone-family, and VPS effects must be checked through workspace topic runbooks; this file does not weaken those gates.

## Resource location and restore

- Source authority: `/Users/ylsuen/CF/lunyu`; Git/GitHub authority above.
- External/local build inputs, archived paths, receipts, retention, and hydrate commands not stated below are `review_required` and block deletion.

Catalog backup evidence:
- Cloudflare immutable Pages deployments: current=497c8742-12f1-4c06-9918-d0d610a33632, previous=6ee7df3a-b683-4cf2-baf4-00b4bc44a370

Catalog restore evidence:
- restore code/assets by rolling back to production deployment 6ee7df3a-b683-4cf2-baf4-00b4bc44a370

Before deleting any local resource, satisfy the workspace path-preserving archive, remote readback, isolated restore, receipt, handbook, and project-state gates.

## Preflight and AI ownership

1. Read `/Users/ylsuen/CF/AGENTS.md`, this file, `PROJECT_STATE.md`, and linked annexes.
2. Inspect `git -C "/Users/ylsuen/CF/lunyu" status --short` when Git-backed.
3. Inspect recent `reports/agent_action_log.jsonl` ownership.
4. Resolve the exact source, Worker/Pages/VPS/App target, domains, bindings, data, and rollback live.
5. Append a scoped `start` row before the first mutation.
6. Preserve unrelated dirty work; never reset, clean, broad-checkout, or stash another task's changes.

## Build, test, and local verification entrypoints

Detected package entrypoints (presence is not proof they currently pass):

- `npm --prefix "/Users/ylsuen/CF/lunyu" run build`
- `npm --prefix "/Users/ylsuen/CF/lunyu" run build:learning-manifest`
- `npm --prefix "/Users/ylsuen/CF/lunyu" run check`
- `npm --prefix "/Users/ylsuen/CF/lunyu" run check:learning-manifest`
- `npm --prefix "/Users/ylsuen/CF/lunyu" run test`
- `npm --prefix "/Users/ylsuen/CF/lunyu" run test:growth-evidence`

Run only commands supported by the current project toolchain and verify expected outputs in the project before using them as release evidence.

## Health and business-path verification

Catalog health probes:
- curl -sS -o /dev/null -w '%{http_code}\n' https://kz.bdfz.net/ # expected 2xx/3xx

Catalog contract checks:
- jq '.projects[] | select(.project_id=="kz-bdfz-net")' platform/project_verification_evidence.json

Also verify authentication boundaries, data read/write behavior, browser/device path, monitoring, clone-family and shared-hub regressions as applicable. HTTP 200 or a build alone is insufficient.

## Preview, deployment, and rollback

Catalog deploy commands (not authorization; fresh preflight remains mandatory):
- git -C "/Users/ylsuen/CF/lunyu" push origin main

Rollback/failback authorities:
- curl -sS -X POST -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" "https://api.cloudflare.com/client/v4/accounts/da810f08b63347a01d3db7fd42619972/pages/projects/lunyu/deployments/6ee7df3a-b683-4cf2-baf4-00b4bc44a370/rollback"

For data-backed projects, immutable code rollback does not restore D1/KV/R2/DO/Queue state. Use backup/restore or backward-compatible forward-fix procedures verified for the exact resource.

## Monitoring, privacy, cost, and incidents

- Monitoring coverage: required
- Measurement: zone_host
- Never record secret values, cookies, sessions, private keys, raw student content, or sensitive payloads.
- Verify current logs, errors, cost/usage, limits, owner, stop condition, and incident runbook before representing runtime health.

## Verification standard

1. Source of truth: local/Git/GitHub authority above, refreshed before mutation.
2. Health probe: catalog probes above plus expected response semantics.
3. Contract/business path: catalog checks plus auth/data/UI/device behavior.
4. Deploy and forbidden actions: catalog command above; no deploy from dirty, duplicate, reconstruction, archive, or unverified source.
5. Dependency regression: matrix fan-out, shared hubs, clone family, App/VPS as applicable.
6. Backup/restore: catalog evidence above; missing exact evidence is blocking for writes/deletion.
7. Rollback/failback: catalog authority above, refreshed live before release.
8. Last verified: 2026-07-15T10:45:14.366Z.

## Synchronized documentation and handoff

Any change to source authority, architecture, dependencies, runtime resources,
deployment, data, backup/restore, verification, monitoring, incidents, rollback,
or ownership must update this manual in the same task. Accepted version,
objective, blockers, deployment state, rollback anchor, and next action must
update `PROJECT_STATE.md` in the same task.

Every AI closeout must record changed files, generated artifacts, tests, live
version/deployment, rollback, dirty-tree state, unresolved follow-ups, and the
manual/state updates in `reports/agent_action_log.jsonl`. Chat is not a durable handoff.
