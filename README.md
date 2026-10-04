# Trinocular

**A simple policy editor for Trino authorization — without the full Apache Ranger stack.**

*Trinocular* (Trino + binocular) lets you author, review and delegate Trino access policies. It
stores them in Apache Ranger's own policy format and serves them to whatever enforces them, so
Trino's Ranger plugin — or an OPA policy that reads Ranger policies — keeps working unchanged.

> **Status: Phase 0 wireframe.** This repository holds a clickable React prototype running on
> fixture data, the design and delivery plan, and a Trino + Ranger test rig. There is no backend
> yet. See [Status](#status).

## Why

Apache Ranger is the standard way to manage Trino access policies. It is also a platform built
for the whole Hadoop ecosystem, and running it for Trino means running all of it:

- **Ranger Admin** — a Java web application with its own user, role and zone management.
- **A relational database** for policies and users.
- **Solr (and ZooKeeper)** for the audit store.
- **Usersync** to copy users and groups from the directory, often **Kerberos**, and optionally
  tagsync and KMS.

Apache's own Docker setup for Ranger needs a KDC, ZooKeeper, Solr, a database and Ranger Admin
before it can serve a single policy.

Trino uses very little of this. Its Ranger plugin needs one thing from Ranger Admin: **policy data
in Ranger's JSON format, served over a small REST protocol.** Everything else — the audit store,
user sync, security zones, tag policies, the dozens of services Ranger supports — is either
unused by Trino or handled elsewhere. Query auditing, for example, usually already lives in the
engine's own logs or in OPA decision logs.

The bigger problem is the editor, not the footprint. Ranger's policy model is powerful and easy to
get wrong:

- **Four ordered rule lists** — allow, allow-exceptions, deny, deny-exceptions — plus policy
  priorities, layered over overlapping wildcards. Working out what a user can actually do means
  evaluating all of them in your head. Mistakes fail silently: too much access, or an outage.
- **Fields that look meaningful but do nothing** for a given engine. The UI happily accepts
  policies that the enforcement path ignores or that can never match.
- **No way to see the effect of a change** before it ships.

So in practice only the platform team edits policies, and every access change queues behind them —
even though the people who know whether a grant is right are the data owners.

## What Trinocular does

Trinocular replaces **Ranger Admin's job for Trino**, and nothing more:

1. **Author** Trino policies in Trino's vocabulary — catalog, schema, table, column — with a
   form modelled on Ranger's own policy editor, so it feels familiar.
2. **See** what a policy does before it ships: a linter that flags policies the target engine
   would ignore, and a simulator that answers "can `alice` `SELECT` from this table, and which
   policy decided it?"
3. **Delegate** each catalog to its data owners. Delegate admins manage their own catalog's
   policies and nothing outside it; global admins keep everything else.

Deliberate simplifications:

- **Allow-only.** No deny rules or exceptions — access exists if some policy grants it, and the
  only way to remove access is to remove the grant. "Deny all other accesses" covers the
  legitimate lock-down case.
- **Concrete permissions only.** No catch-all `all` verb, which means different things on
  different engines.
- **Engine-aware.** Each Trino service declares how it is enforced, and the editor only offers what
  that engine actually enforces.
- **Administrators only.** No end-user login and no access-request workflow; data owners grant
  access directly.

## How it fits

Trinocular stores policies in exactly Ranger's `RangerPolicy` JSON shape and serves the endpoints
Ranger Admin would. Nothing downstream changes — you repoint one URL.

```
                     ┌────────────────────────────────────┐
                     │             Trinocular             │
                     │  editor · linter · simulator ·     │
                     │  catalog delegation                │
                     └─────────┬──────────────────┬───────┘
          Ranger policy-download API          Ranger export JSON
                               │                  │
                               ▼                  ▼
            Path A: Trino + Ranger plugin    Path B: puller → OPA bundle
                    (built into Trino)              → OPA → Trino OPA plugin
```

- **Path A — Trino's built-in Ranger plugin.** It polls for policies and enforces full Ranger
  semantics, including column masking and row filtering. Point
  `ranger.plugin.trino.policy.rest.url` at Trinocular instead of Ranger Admin.
- **Path B — OPA.** A puller fetches the export document and an OPA policy (Rego) evaluates it
  for Trino's OPA plugin. That Rego implements a deliberate subset of Ranger's semantics, which is
  exactly why the editor needs to know which path it is writing for.

Because the stored format is Ranger's, a Ranger export can be imported as-is, and moving off
Trinocular means exporting the same JSON back.

## Try it

### The wireframe

```bash
npm install
npm run dev        # http://localhost:5173
```

Everything is in memory: reloading resets the data. Try **Policies → "analysts read sales
orders" → Edit**, the **Catalogs** screen, and the **Simulator**. The "logged in as" picker in the
header switches between a global admin, a catalog delegate admin and a viewer.

### Trino + Apache Ranger test rig

[`testing/ranger-trino/`](testing/ranger-trino/) brings up Trino 483 using Apache Ranger 2.9.0
for access control, with test users, groups and policies already in place:

```bash
cd testing/ranger-trino
docker compose up -d
./smoke-test.sh     # checks that Trino enforces the Ranger policies
```

It is the reference for what Trinocular has to replace on Path A.

## Repository layout

| Path | What |
|---|---|
| `src/` | The wireframe — React 18, TypeScript, Vite, Mantine |
| `docs/trinocular_claude_plan.md` | Design and delivery plan: the Ranger contract, the allow-only model, capability profiles, linter rules, simulator, delegation, phases |
| `docs/ranger-ui-reference/` | How Ranger Admin's policy form behaves, with screenshots — the model for the editor |
| `docs/images/trinocular_sql_parse_tree.svg` | Which Trino operations a query triggers and the access type each needs |
| `testing/ranger-trino/` | Docker Compose test rig: Trino + Apache Ranger |

## Status

| Phase | What | State |
|---|---|---|
| 0 | Clickable wireframe on fixture data | **In progress** — this repository |
| 1 | Read-only UI over imported Ranger policies | Planned |
| 2 | Authoring, linter, revision history | Planned |
| 3 | Simulator against real policy evaluation | Planned |
| 4 | Serve the Ranger endpoints; run alongside Ranger, then cut over | Planned |
| 5 | Catalog delegation enforced | Planned |

The plan in [`docs/`](docs/trinocular_claude_plan.md) has the detail, including the verified
mapping from Trino operations to Ranger access types.

## License

[Apache License 2.0](LICENSE).
