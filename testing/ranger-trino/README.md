# Trino + Apache Ranger test rig

A disposable Docker Compose environment: **Trino 483** using **Apache Ranger 2.9.0** for access
control, with test users, groups and policies already in place. Use it to try policies against a
real Trino, or as the target when testing Trinocular's Path A (Ranger plugin).

```bash
docker compose up -d     # ~1-2 minutes on first start
./smoke-test.sh          # 10 checks that Trino enforces the Ranger policies
docker compose down      # stop and discard everything
```

| | URL | Login |
|---|---|---|
| Ranger Admin | http://localhost:6080 | `admin` / `rangerR0cks!` |
| Trino | http://localhost:8080 | no authentication — any user name, e.g. `--user alice` |

Query as a given user:

```bash
docker compose exec trino trino --user alice --execute "SELECT * FROM tpch.tiny.nation LIMIT 3"
```

## What's in it

| Service | Image | Role |
|---|---|---|
| `ranger-db` | `apache/ranger-db` | Postgres for Ranger |
| `ranger` | `apache/ranger` | Ranger Admin; creates the `dev_trino` service on first start |
| `ranger-bootstrap` | `apache/ranger` | One-shot: adds the test users, groups and policies, then exits |
| `trino` | `trinodb/trino` | Trino with `access-control.name=ranger` |

All images are the ones Apache and the Trino project publish. Trino ships the Ranger plugin, so
only configuration is mounted (`trino/`). Versions can be overridden with `RANGER_VERSION` and
`TRINO_VERSION`; ports with `RANGER_PORT` and `TRINO_PORT`.

## Users, groups and policies

Groups come from `trino/groups.txt` through Trino's file group provider — Ranger usersync is not
run. The same users and groups are created in Ranger so its user/group pickers can find them.

| User | Group | Can |
|---|---|---|
| `alice` | `analysts` | read `tpch.tiny.*` |
| `bob` | `data-eng` | read, write, create and drop in `memory.default` |
| `carol` | `finance` | nothing beyond the baseline |
| `admin` | `trino-admins` | everything (Ranger super group) |

Policies created in the `dev_trino` service by `ranger/bootstrap.py`:

- **Baseline, required by Trino** for anyone to run a query: execute on query ID `*` (added to
  Ranger's default `all - queryid` policy), impersonate self (`trinouser {USER}`), and kill own
  queries (`system.runtime.kill_query`).
- **Samples:** `analysts read tpch.tiny` and `data-eng owns memory.default`.

Ranger also creates its default `all - …` policies, which grant the `trino` service user
everything.

Trino polls Ranger every 5 seconds, so policy edits in the Ranger UI take effect within a few
seconds without a restart.

## Limits

- **Test only.** Credentials are fixed and in plain text; there is no TLS and no Trino
  authentication.
- **No auditing.** The Ranger audit store (Solr) is not run, so the Audit tab in Ranger Admin is
  empty and the plugin's auditing is switched off.
- **Nothing persists.** `docker compose down` discards all policies and data.
- The bootstrap logs in as `admin` / `rangerR0cks!`, which the `apache/ranger` image also
  assumes on first start; change both if you change the password.
