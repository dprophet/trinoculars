# Trinocular — Implementation Plan

> **Trinocular** *(Trino + binocular)* — a standalone policy editor for Trino authorization.
>
> Companion to [`gemini_ranger_talking.md`](./gemini_ranger_talking.md). That document asks
> *"what does Ranger give us for Trino?"*. This one answers *"what do we actually have to
> build, and against what contract?"*
>
> Scope: replace **Apache Ranger Admin** (server + RDBMS + Solr) with a purpose-built React
> policy editor, while leaving the rest of the pipeline (policy puller → OPA bundler → OPA →
> Trino's `trino-opa` plugin) untouched.

### Goals

Trinocular has three jobs, in dependency order:

1. **Author** — create, edit, and manage Trino access policies. This is the core function and
   the thing that has to be excellent, not merely adequate.
2. **See** — make the effect of a policy legible *before* it ships. What can Alice actually do?
   Which policy granted it? What did this change just alter?
3. **Delegate** — put (1) and (2) in the hands of **data owners rather than engineers**. The
   central data platform team should not be authoring every grant in the organization.

**Delegation is the point.** Retiring the Ranger Admin / Solr / RDBMS footprint is a welcome
side effect, but the problem worth solving is the human bottleneck described in
`gemini_ranger_talking.md` §6: every access request routing through a team that has no context
on whether it should be approved.

### On the name

The pun is load-bearing, and it is about **goal 2 in service of goal 3**. The failure mode of
Ranger is not that policies are hard to write — it is that they are impossible to see.
Effective permissions are spread across four ordered evaluation lists, wildcard matching is
non-obvious, and an OPA-based enforcement path silently discards several constructs the Ranger
UI happily accepts (§4). Nobody can answer "what can Alice actually do?" without running the
query and finding out.

That is survivable for an engineer who can read Rego and replay a decision log. It is
disqualifying for a data owner, who has the domain knowledge to decide *whether* someone should
have access but no way to verify that the policy they just wrote does what they meant. **You
cannot safely delegate authorship of something nobody can see the effect of.** Visibility is not
in tension with delegation — it is the precondition for it.

So the simulator (§8) is a headline feature rather than a nice-to-have, the linter (§4.6) makes
the invisible visible at author time, and the allow-only model (§4.1) exists so that "what can
Alice do?" has a readable answer at all. Each of those exists to make the editor safe in
non-expert hands.

**The design tiebreaker:** a feature that only an engineer can operate safely has failed, however
powerful it is. Prefer the version a data owner can use unsupervised.

### Constraint: one policy model, one vocabulary

**No other policy engine or Rego package may be named anywhere in Trinocular's UI, API, data
model, configuration, or source.** Not in labels, not in enum values, not in table names, not in
comments. Trinocular speaks exactly one policy language — the Ranger-shaped model in §6 — and
Trino's own vocabulary (catalog, schema, table, column) on the surface.

This is not cosmetic. The moment a second engine's name appears in a column name or a dropdown,
the user is being asked to know which backend enforces their rule, and the tool has leaked its
implementation. Where a capability is enforced elsewhere today, the answer is to bring it into
the Ranger model (§5.5), not to expose the other system.

**Naming conventions:**

| Thing | Name |
| --- | --- |
| Repository | `trinocular` |
| Container image | `trinocular` |
| Frontend package | `@trinocular/ui` |
| Backend package | `trinocular` |

---

## 0. Executive summary

We do not need to reimplement Ranger. We need to reimplement **two REST endpoints and the form
that feeds them**.

Trinocular is a **Ranger Admin replacement**: it owns the policies and serves them to whatever
enforces them. There are two consumers (§2), and the split matters for anyone reading this as an
open-source project:

- **Path A — the Apache Ranger plugin for Trino.** The industry-standard deployment and the
  default for every adopter but us. It polls `GET /service/plugins/policies/download/{service}`
  and gets full Ranger semantics, including native masking and row filtering.
- **Path B — OPA.** A local variant: a puller fetches `exportJson`, a bundler mounts it as
  `data/ranger_data`, and a Rego policy reads `data.ranger_data.policies`. That Rego is also
  being open sourced, but it implements a deliberate subset (§4).

Nothing else about Ranger Admin is load-bearing for either path.

Therefore the plan for Trinocular is:

1. Build a React SPA + small backend that stores Trino policies in **exactly the Ranger
   `RangerPolicy` JSON shape**.
2. Serve both endpoints: the polling protocol a stock Ranger plugin expects, and the export
   document the puller consumes.
3. Point each consumer at Trinocular. **No change to the plugin, the bundler, the Rego, OPA, or
   Trino.**
4. Layer on what Ranger's UI does badly or not at all: a policy simulator, profile-aware
   guardrails (§4.8), git-backed history, and — the payoff — **scoped delegation to data
   owners**.

The high-value differentiator is **step 4**, not steps 1–3. Steps 1–3 retire the Ranger
footprint, which is worth doing but is not the point. Step 4 is: Ranger's UI will happily let
you author a policy that your enforcement path silently discards, which is exactly why nobody is
comfortable handing it to a non-engineer. Make the effects visible and the invalid states
unreachable, and delegation to data owners becomes safe.

---

## 1. Correction to a premise

It is easy to assume the Ranger **XML** export is the integration format. Two different
artifacts get conflated:

| Artifact | Format | What it is | Who reads it |
| --- | --- | --- | --- |
| `ranger-trino-security.xml` | **XML** | Plugin *configuration* — service name, policy source class, poll interval, cache dir | Trino's `trino-ranger` plugin only (`ranger.plugin.config.resource`, see `RangerConfig.java`) |
| `ServicePolicies` / export document | **JSON** | The actual *policy data* | `trino-ranger` (polls `/service/plugins/policies/download/<service>`) and any OPA path (pulls `/service/plugins/policies/exportJson`) |

Both plugins consume **JSON policy data**. The XML is *deployment* config for the Ranger plugin —
it tells the plugin where to poll — and is written by whoever operates the Trino cluster, not by
Trinocular. Trinocular emits JSON, and XML generation is out of scope.

This matters because it makes the integration smaller than it sounds: we are not writing an XML
serializer, we are serving JSON on two endpoints.

> A Path A deployment still needs that XML, pointed at Trinocular instead of Ranger Admin
> (`ranger.plugin.trino.policy.rest.url`). Shipping a documented example of it belongs in the
> project's install guide.

---

## 2. The as-is pipeline

There are **two** consumers of Ranger policy, and Trinocular has to serve both.

```
                    ┌──────────────────┐
                    │  Ranger Admin    │
                    │  + RDBMS + Solr  │
                    └───┬────────────┬─┘
                        │            │
   PATH A (industry)    │            │   PATH B (OPA)
   GET /policies/       │            │   GET /policies/exportJson
       download/<svc>   │            │
   poll, lastKnownVer   │            ▼
                        │   ┌────────┬─────────┐
                        │   │   policy puller  │  scheduled job
                        │   └────────┬─────────┘
                        │            │ PUT …/bundle_update/data/ranger_data
                        │            ▼
                        │   ┌────────┬───────────────┐
                        │   │      OPA bundler       │  + version-pinned Rego
                        │   └────────┬───────────────┘
                        │            │ bundle.tar.gz
                        │            ▼
                        │   ┌────────┬─────────┐
                        │   │       OPA        │
                        │   │   dispatcher     │
                        │   └────────▲─────────┘
                        │            │
                        ▼            │
             ┌─────────────────┐  ┌──┴──────────────┐
             │  trino-ranger   │  │   trino-opa     │
             │  plugin         │  │   plugin        │
             │  RangerBase-    │  │                 │
             │  Plugin, native │  │                 │
             │  mask + filter  │  │                 │
             └────────┬────────┘  └────────┬────────┘
                      └──────────┬─────────┘
                                 ▼
                             ┌───────┐
                             │ Trino │
                             └───────┘
```

**Path A — the Apache Ranger plugin.** The industry-standard deployment, and what any adopter of
Trinocular outside this deployment will run. `RangerSystemAccessControl` constructs a
`RangerBasePlugin` and polls the policy source configured in `ranger-trino-security.xml`
(`ranger.plugin.trino.policy.source.impl`, default `RangerAdminRESTClient`) against
`ranger.plugin.trino.policy.rest.url` every `pollIntervalMs`. It gets **full Ranger semantics**:
deny policies, exceptions, `impliedGrants`, policy priority, and native masking and row
filtering. Nothing in §4 constrains it.

**Path B — OPA.** A local variant, described below. The Rego that implements it is itself being
open sourced, but it will remain the minority deployment.

> Earlier drafts of this plan modelled only Path B and treated the `download/<service>` endpoint
> as a fallback. That was backwards: **Path A is the default for everyone but us.** The
> consequences run through §4.8 (two capability profiles), §7.2 (the endpoint is a protocol, not
> a serializer), and §12 (both paths get tested).

Relevant facts pinned from the code:

- The puller streams the response body straight through and PUTs it as `opa.json` — **it does
  not parse or transform the JSON**. Whatever the source returns is what lands in
  `data.ranger_data`.
- `ranger_policy.rego:8` → `import data.ranger_data.policies as ranger_policies`. So the served
  document needs a top-level `policies` array. Both `exportJson` (`{metaDataInfo, policies}`)
  and `download/<svc>` (`{serviceName, policies, serviceDef, …}`) satisfy this.
- The bundler manifest defines **per-cluster policy profiles**, and not every profile includes
  the Ranger-compatibility policy. Trinocular's blast radius is only the clusters whose profile
  loads it — confirm which before any cutover.

**Contract statement — two endpoints, not one.**

1. `GET /service/plugins/policies/download/{service}` must speak the **Ranger Admin polling
   protocol** well enough for a stock `RangerAdminRESTClient` to consume it: a `ServicePolicies`
   document carrying `policyVersion`, the embedded `serviceDef`, and correct
   `lastKnownVersion` / not-modified handling so plugins do not re-download unchanged policy on
   every poll. This is a protocol implementation, not a serializer.
2. `GET /service/plugins/policies/exportJson` must serve a document with a top-level `policies`
   array. The puller is a dumb pipe, so whatever is returned lands in the bundle verbatim.

Mimicking Ranger exactly on both costs little and is what makes Trinocular a drop-in replacement
rather than a local tool.

---

## 3. The target pipeline

```
┌────────────────────────────────────────────┐
│  Trinocular                                │
│  ┌──────────────┐   ┌───────────────────┐  │
│  │  React SPA   │◄─►│  API              │  │
│  └──────────────┘   └─────────┬─────────┘  │
│                               │            │
│                     ┌─────────▼─────────┐  │
│                     │ Postgres + git    │  │
│                     │ (policies + audit)│  │
│                     └───────────────────┘  │
│                                            │
│  GET /service/plugins/policies/exportJson ◄┼── puller (URL change only)
│  GET /api/v1/services/{svc}/policies       │
└────────────────────────────────────────────┘
```

Everything downstream of the puller is unchanged. The only production change to ship the MVP is
one line in the puller's configuration.

That also gives a trivially safe rollout: run both Ranger and Trinocular, diff the two
`exportJson` outputs on a schedule until they agree, then cut over.

---

## 4. Hard constraints imposed by the Rego

> **Scope of this section: Path B only.** Everything below describes limits of the Rego
> implementation. A deployment running the Apache Ranger plugin (Path A) has none of them — the
> plugin honours deny policies, exceptions, `impliedGrants`, priority, masking and row filtering
> natively. Read §4.8 first if you are building for Path A.

The Ranger-compatibility Rego implements a **deliberate subset** of Ranger. Some of that subset
is a design stance we intend to keep (§4.1); some of it is incidental and merits a decision
(§4.3, §4.4). Either way, the Ranger UI will let you author policies the OPA path does not
honour. Verified by reading `ranger_policy.rego` and `ranger_policy_helpers.rego`.

### 4.1 The allow-only model — intentional

`ranger_policy.rego:160-168` filters the policy list down to those where:

```rego
policy["allowExceptions"]  == []
policy["denyExceptions"]   == []
policy["denyPolicyItems"]  == []
policy["isEnabled"]        == true
```

**This is a deliberate design decision, not a gap — and it is a property of Trinocular, not of
the Rego.** The Rego's behaviour above is the *implementation* of a stance the product takes
independently: **Trinocular does not support negative policies, on any enforcement path.** It
does not matter that the Apache Ranger plugin (Path A, §4.8) evaluates them correctly. They are
not offered.

The reasoning is maintainability and blast radius, in that order:

- **Nobody can hold the model in their head.** Ranger evaluates four ordered lists —
  `denyPolicyItems` → `denyExceptions` → `policyItems` → `allowExceptions` — modulated by
  `policyPriority` and layered across overlapping wildcard resources. Answering "can Alice read
  this?" means simulating that whole machine. A data owner cannot, and in practice neither can
  an engineer without running it.
- **The edge cases fail catastrophically, not gracefully.** The failure mode of a
  misunderstood deny interaction is not a confusing error, it is silent over-permission or a
  silent outage, discovered later. §4.1's own wholesale-drop behaviour is a small example of
  exactly this genre.

So authorization is modelled as **pure allow, union semantics**: a user can do a thing if some
policy says so, and the only way to remove access is to remove the grant. That is a property you
can reason about locally — read the grants that match, union them, done — and it is the reason
the simulator can give a straight answer at all.

This is a considered product opinion and should be documented as one for adopters, not
apologised for as a missing feature.

Two consequences for the editor, and they point the same direction:

1. **Trinocular must not offer deny items or exceptions at all.** Not as a warning, not as an
   advanced tab — the fields do not exist in the UI. This is strictly better than Ranger, which
   exposes them and then lets the pipeline discard them.
2. Because the drop is *wholesale* — a policy carrying a deny item loses its allow items too —
   any such policy arriving via **import** is a correctness problem, not a stylistic one. The
   importer must hard-fail on them and force explicit resolution rather than quietly
   round-tripping something that grants nothing.

`isDenyAllElse` is the sanctioned escape valve and **is** honoured by the Rego
(`ranger_policy.rego:289`): it lets a policy assert "for this resource, these grants and nothing
else," which covers the legitimate use of a sweeping deny without introducing negative rules
into the evaluation order. Trinocular should surface it prominently as the answer to "how do I
lock this down?"

### 4.2 Fields the Rego never reads

| Field | Consequence |
| --- | --- |
| `policyType` | Masking (type 1) and row-filter (type 2) policies are inert. Not enforced. |
| `dataMaskPolicyItems` / `rowFilterPolicyItems` | Never evaluated **by this Rego**. Masking and row filtering are enforced, but by a separate policy with a different data model — see §4.7. Ranger-shaped mask/filter policies are inert. |
| `policyItems[].roles` | Only `users` and `groups` are matched (`ranger_policy.rego:315-317`). A policy item granted solely to a role grants **nothing**. |
| `validitySchedules` | Time-bound policies are not enforced — they are permanently active. |
| `policyItems[].conditions` | Ignored. |
| `policyPriority` | No override semantics. |
| `zoneName` | Security zones do not exist downstream. |
| `service` | **Not filtered on.** Every policy in the document applies to every cluster reading it. |
| `isRecursive` | Ignored. |
| `delegateAdmin`, `isAuditEnabled`, `policyLabels`, `options` | Metadata only. |

### 4.3 `all` does not imply anything

The Trino service definition (`ranger-servicedef-trino.json`) defines access type `all` with
`impliedGrants` covering all twelve verbs. **The Rego does not expand `impliedGrants`.** It
collects `perm.type` literally (`ranger_policy.rego:318-322`) and then checks
`requested_ranger_permission in permissions`, where the requested permission comes from
`action_map` and is always a concrete verb like `select`.

> A policy item granting `all` authorizes **nothing** on the OPA path, while authorizing
> everything on the real Ranger plugin.

There is no test coverage for `all` in the Rego's test suite — confirming it is untrodden ground
rather than a deliberate decision.

**Measured against a production corpus (§13.1): a latent trap, not a live outage.** `all` appears
on 102 policy items, but *every one of them also lists the concrete verbs alongside it* — the
Ranger UI emits the full verb list when you tick "select all". Zero policies depend on `all`
alone, so nothing is currently mis-authorized.

### 4.3.1 Decision: Trinocular never emits `all`

**`all` is not an option in Trinocular, on any enforcement path.** Like deny (§4.1), this is a
product decision rather than a Rego limitation — the Apache Ranger plugin expands
`impliedGrants` correctly and Trinocular still will not write the token.

What replaces it is a **"select all" affordance** in the access-type grid: one click, and the
grantable concrete verbs are ticked individually (the grantable set, not the inert
`grant`/`revoke`/`use` — §15). The stored policy contains the verbs, never the alias. The user
gets the convenience; the policy stays explicit.

Three reasons, in order of weight:

- **`all` means something different on each path.** Path A expands it, Path B takes it literally
  and grants nothing. A policy whose meaning depends on which enforcement engine reads it is not
  a policy, it is a bug waiting for a migration. Concrete verbs mean the same thing everywhere.
- **`all` silently widens.** Add a thirteenth access type to the service definition and every
  existing `all` grant expands to include it, retroactively, with no policy change and no
  review. An explicit verb list does not move. Note the corollary and accept it deliberately:
  "select all" means *all verbs known when you clicked it*, and picking up a new verb later is
  an edit someone makes on purpose.
- **It reads worse.** "What can this group do?" is answered by a list of verbs. `all` sends the
  reader to the service definition to find out what it currently expands to.

The production corpus already works this way — every `all` sits beside the full verb list — so
this codifies existing practice rather than changing it. **On import, expand `all` to the
concrete verbs** and record it in the import report; do not round-trip the token.

### 4.4 Resource keys that are reachable

`ranger_policy_helpers.rego:28-43` maps OPA input to Ranger resource keys. The reachable set is:

`catalog`, `schema`, `table`, `column`, `trinouser`, `systemproperty`, `sessionproperty`, `procedure`

Note what is **missing**: the service definition declares a `function` resource, but the helper
maps `function.functionName → procedure`. **The `function` resource key is unreachable** —
policies written against it never match. (Upstream Ranger has since renamed this to
`schemafunction`; see `divergences.md`.)

**This one is live.** The production corpus (§13.1) contains **3 enabled policies** whose only
resource is `function`. All three are dead — they have never granted anything and never will.
Unlike `all`, there is no compensating construct. These need triage during import.

### 4.5 Identity handling

- The `public` group is implicit for every user (`ranger_policy.rego:24`).
- The Rego performs **site-specific username normalization**: usernames carrying a structured
  prefix are parsed and an inner username component extracted (`ranger_policy.rego:28-36`).
  This is deployment-specific logic. Trinocular should treat the *normalized* username as the
  value entered in policy items, and the normalization rule itself as configuration rather than
  something baked into the editor.

### 4.6 Design consequence

Trinocular should be built around a **capability profile** — a declarative description of what
the target enforcement engine supports — rather than hardcoding one deployment's limits. **Ship
two from the start** (§4.8): `ranger-plugin` for Path A and `ranger-rego` for Path B. Building
the profile mechanism up front is far cheaper than retrofitting it once rules are hardcoded, and
with two real profiles the abstraction gets tested rather than assumed. This gives us:

- Fields the profile marks unsupported are hidden or hard-blocked in the UI.
- A **linter** that runs on every save and on import, emitting errors for §4.1/§4.3 violations
  and warnings for §4.2 fields.
- A clean path to a second profile later, if a deployment's Rego implements more.

Distinguish the two kinds of rule the profile encodes, because they age differently:

- **Model rules** express a decision we have made and intend to keep — no deny, no exceptions.
  These are enforced by *omission*: the UI has no field to fill in. The linter only fires on
  imported data.
- **Capability rules** express what the current Rego happens to implement. These are enforced by
  *validation*, and each one is a candidate for removal if the Rego gains the capability.

**Recommended MVP linter rules.** The *applies to* column is the profile mechanism doing its
job — a rule that fires on both paths is a model rule; one that fires only on B is a Rego
limitation that may lift later.

| Rule | Applies to | Severity | Rationale |
| --- | --- | --- | --- |
| `denyPolicyItems` / `allowExceptions` / `denyExceptions` non-empty | **both, permanently** | **error**, import-only | Product decision, not an enforcement limit (§4.1). Not authorable in the UI on any path; this rule never lifts. |
| Access type `all` used | **both, permanently** | **error**, import-only — auto-expand to the concrete verbs | Product decision (§4.3.1): means different things on the two paths, and silently widens when the service definition gains a verb. Not authorable in the UI; "select all" ticks the verbs instead. |
| `roles` non-empty on a policy item | B only | **error** | Ignored under B (§4.2) |
| `validitySchedules` non-empty | B only | **error** | Not enforced under B; false sense of expiry |
| `policyType != 0` | B until Workstream R lands (§5.5) | **error**, then allowed | Inert under B until the Rego enforces it; always fine under A |
| `dataMaskInfo.conditionExpr` non-empty | B only | **error** | Not implemented by R; would silently not apply |
| Resource key `function` used | **both** | **error** | Unreachable under B (§4.4); superseded upstream under A |
| `isExcludes: true` combined with value `*` | B only | **warning** | `ranger_policy.rego:222` drops the field from matching |
| Policy grants `*.*.*` to `public` | **both** | **warning** | Blast radius |
| No `policyItems` at all | **both** | **warning** | Dead policy |

### 4.7 Masking and row filtering live in a second policy

Worth stating plainly, because it is easy to get backwards: **column masking and row-level
filtering are implemented and enforced in production.** They are simply not driven by
Ranger-shaped data.

A **family of catalog-scoped Rego policies** — maintained independently of the
Ranger-compatibility one and loaded alongside it in the bundle — implements the `columnMask` and
`rowFilters` rules that Trino's OPA plugin calls, keyed on the `GetColumnMask` and
`GetRowFilters` operations. The dispatcher wires each one in for an explicit catalog list; a
given deployment may have several such providers.

Responsibility splits cleanly by rule, not by catalog: the Ranger policy answers `allow` /
`batchAllow` across all catalogs and is never consulted for masks or filters, while the
catalog-scoped policies additionally answer `columnMask` / `rowFilters` for the catalogs they
cover. The Ranger policy does not map the `GetColumnMask` / `GetRowFilters` operations at all.

Two dispatcher behaviours matter for the simulator (§8), because they are decided *above* any
individual policy:

- **Row filters union** across every applicable policy.
- **Column masks fail closed:** if more than one policy returns a mask for the same column, the
  dispatcher discards both and substitutes `{"expression": "NULL"}`. A simulator that asks a
  single policy directly will report the wrong mask whenever two providers overlap.

The consequence for Trinocular is that these are **two different data models**, not one model
with a missing feature:

| | Ranger-compat policy | Catalog-scoped mask/filter policies |
| --- | --- | --- |
| Data namespace | `data.ranger_data.policies` | one namespace per provider |
| Shape | flat list of `RangerPolicy` objects; `resources` + `policyItems` | nested `catalog → schemas → tables → { filters, masks }` |
| Principal matching | `users` / `groups` per policy item | a `target` expression per filter/mask |
| Answers | `allow`, `batchAllow` | `columnMask`, `rowFilters` (plus their own `allow`) |
| Scope | all catalogs | an explicit catalog list per provider |
| Count | one | several |

A mask expressed as a Ranger `dataMaskPolicyItem` will not be enforced no matter how correct it
looks, because nothing reads it. Conversely, the masking policy's data cannot be expressed in
the Ranger shape at all.

So this is a genuine scope decision, not a limitation to note and move past — see §5.4.

### 4.8 Two capability profiles

Because Trinocular serves both paths, the honest model is not "Ranger minus our limitations" but
**one policy model with two enforcement profiles**. What the editor permits depends on which the
deployment targets.

| Ranger construct | Path A — Apache Ranger plugin | Path B — OPA + Rego |
| --- | --- | --- |
| Allow policy items | ✅ | ✅ |
| **Deny items / exceptions** | ✅ native — **but not offered by Trinocular** (§4.1) | ❌ policy dropped wholesale — **and not offered** |
| **`all` → `impliedGrants`** | ✅ expanded — **but never emitted by Trinocular** (§4.3.1) | ❌ literal, grants nothing — **and never emitted** |
| **Column masking** | ✅ native — resolves the servicedef `transformer`, substitutes `{col}` / `{type}` | ⚠️ only after Workstream R (§5.5) |
| **Row filtering** | ✅ native — `rowFilterInfo.filterExpr` | ⚠️ only after Workstream R |
| `roles` on policy items | ✅ | ❌ ignored (§4.2) |
| `validitySchedules` | ✅ | ❌ ignored |
| `policyPriority` | ✅ | ❌ ignored |
| Security zones | ✅ | ❌ ignored |
| `isDenyAllElse` | ✅ | ✅ |
| Per-`service` scoping | ✅ plugin requests one service | ❌ not filtered (§4.2) |

Three things follow.

**Profiles describe enforcement, not permission.** A ✅ in the Path A column means *the plugin
would honour it*, not *Trinocular offers it*. Deny (§4.1) and `all` (§4.3.1) are the standing
examples: both fully supported by the plugin, both deliberately absent from the product.
Profiles widen what the editor can safely emit; they never override a product decision.

A useful test for which kind of rule you are looking at: **if a construct means different things
on the two paths, Trinocular should not emit it.** That is what disqualifies `all` — Path A
expands it, Path B ignores it. Portability across profiles is the point of having one policy
model.

**The linter is profile-parameterised, not fixed.** Every §4.6 rule carries the profiles it
applies to. `validitySchedules` is an error under B and legal under A; get that wrong in either
direction and the tool is either unusable for the industry or unsafe for us. Rules that encode a
product decision rather than an enforcement limit — deny, `all` — apply to *every* profile and
never lift.

**The plugin is Workstream R's reference implementation.** `RangerSystemAccessControl.getColumnMask`
already does exactly what R4 must do: pull `transformer` off the servicedef's mask type def,
special-case `MASK_NULL` → `NULL` and `MASK_CUSTOM` → the policy's masked value, then
`.replace("{col}", …).replace("{type}", …)`. R is not inventing semantics; it is porting known
ones. That also supplies a free oracle — run a policy through both paths and diff the resulting
SQL (§12).

> One detail worth matching deliberately: the plugin sets `ViewExpression.identity` to the
> querying user, while the Rego currently omits `identity` on its expressions. Same intent,
> different default. Decide once and make both agree, or masked queries will resolve under
> different identities on the two paths.

---

## 5. Feature scope

Mapped against `gemini_ranger_talking.md` §7.

### 5.1 In scope — MVP (Phase 1–3)

| Capability | Notes |
| --- | --- |
| Full `catalog → schema → table → column` hierarchy with wildcards and `isExcludes` | Mirrors the service definition's `resources` |
| `trinouser`, `systemproperty`, `sessionproperty`, `procedure` resources | With their `accessTypeRestrictions` enforced in the UI |
| Access types | The grantable verbs — `select insert create drop delete alter show impersonate execute` (+ `read_sysinfo` / `write_sysinfo` on the current plugin), plus a **"select all" affordance** that ticks them individually. The `all` alias is never stored (§4.3.1). `grant` / `revoke` / `use` are inert on the current plugin (import-only, not grantable) — see the verified mapping and drift notes in §15 |
| Allow policy items with users + groups | Roles blocked per §4.2 |
| **Column masking** (`policyType` 1) | **Requirement, not an extension.** Static, user/group-matched masks via `dataMaskPolicyItems`. Gated on Workstream R (§5.5) |
| **Row filtering** (`policyType` 2) | **Requirement.** Static, user/group-matched filters via `rowFilterPolicyItems`. Gated on Workstream R |
| `isDenyAllElse` | Honoured by the Rego (`ranger_policy.rego:289`). The allow-only model's answer to "lock this resource down" — surface it prominently (§4.1) |
| Policy enable/disable | `isEnabled` |
| Ranger-compatible export endpoint | The integration point |
| Import of an existing Ranger export | Bootstrap + parallel-run validation |
| Policy linter | §4.6 |
| Policy simulator | §8 — the headline feature |
| Audit trail of *policy changes* | Who changed what, when, diff |
| Search / filter / list view | Ranger's `RangerPolicyTableLayout` equivalent |

### 5.2 In scope — Phase 4+

| Capability | Notes |
| --- | --- |
| Scoped delegation (Global Admin / Catalog Admin) | `gemini_ranger_talking.md` §6.1, §7.1–7.3 |
| Approval workflow for policy changes (optional) | §7.4 — admin-to-admin only: a catalog delegate admin proposes, a global admin approves. Not an end-user request flow (§5.3). |
| Multi-service / multi-cluster targeting | See §4.2 caveat on `service` not being filtered |

### 5.3 Explicitly out of scope

| Capability | Why |
| --- | --- |
| ~~Column masking / row filtering~~ | **Moved in scope** — see §5.4 / §5.5. Gated on Workstream R (Rego support), not on demand. |
| **Deny policies and exceptions** | **Excluded by design, on every enforcement path** (§4.1) — including Path A, which supports them natively. Too hard to reason about to maintain, and the edge cases fail catastrophically rather than visibly. Pure allow, union semantics. `isDenyAllElse` covers the legitimate lock-down case. |
| **Tag-based policies (Atlas)** | No Atlas integration; would require a whole tag-sync plane. |
| **Time-bound policies** | §4.2. Would require a Rego change first. |
| **Query audit / decision logs** | Already handled by OPA decision logs shipped to whatever log store the deployment uses. Trinocular audits *policy changes*, not *access decisions*. Link out rather than reimplement. |
| **End-user access requests** | **Excluded by design.** Trinocular is an administrative tool: the people who log in are administrators — global admins and catalog delegate admins (§9). There is no "I need access to X" requester flow and no end-user login; data owners grant access directly, which is what removes the central team from the loop. |
| **Security Zones** | `zoneName` inert downstream (§4.2). Delegation is better solved in Trinocular's own RBAC (§9). |
| **Directory/user-group sync (UGSync)** | Policy principals are users and their **directory (LDAP) groups**, which arrive on the Trino identity at request time — Trinocular matches them but does not sync them. It needs a typeahead source for authoring, not a user store. How groups map to a directory is deployment plumbing (site-specific). |

> Two different reasons appear in that table, and they should not be conflated.
> **Deny policies and exceptions are a settled design decision** (§4.1) — build as though they
> do not exist, and carry no "someday" flag. **End-user access requests** are the same kind of
> decision: Trinocular is for administrators only. **Time-bound and tag-based policies are gated on
> enforcement** — absent because no Rego implements them, viable if one did. Masking and row
> filtering used to sit in the second group; they have been promoted to in-scope with a Rego
> workstream attached (§5.5), which is the template for how anything else leaves this table.

### 5.4 The second data model — decided: converge

Masking and row filtering are enforced today, by catalog-scoped policies with their own data
model (§4.7). Three ways to reconcile that with a Ranger-shaped editor were available:

| Option | What it means |
| --- | --- |
| **A. Ranger-shaped only** | Trinocular manages `allow` policies; masking stays where it is edited today. Data owners get partial self-service — they can grant a table but must still file a request to mask a column. |
| **B. Two models, one UI** | Trinocular gains a second store and editor for the other data model. Violates the one-vocabulary constraint above, and there are several such providers, so it is several namespaces, not one. |
| **C. Converge** | Extend the Ranger-compat Rego to honour `dataMaskPolicyItems` / `rowFilterPolicyItems`, so masks and filters are expressed in the same Ranger shape as everything else. Covers static, user/group-matched rules; **not** computed ones — see the expressibility limit in §5.5. |

**Decision: C, and masking is a product requirement — not an extension.** Trinocular must let a
data owner author column masks and row filters on the targeted clusters. Those clusters have no
mask/filter enforcement in use today (§13.1), so the capability has to be built, and it is built
in the Ranger model rather than by adopting a second one.

Two consequences follow, and they set the shape of the plan:

1. **Workstream R is on the critical path**, not a parallel nice-to-have. Nothing ships the
   masking requirement without it.
2. **The mask/filter UI belongs in the core build** — Phases 2 and 3 — not in a trailing phase.
   R completes around week 4; Phase 2 runs to about week 7. The dependency resolves naturally,
   so there is no reason to defer the UI.

C is still the largest option, and it is a Rego project. What it buys is that masking is part of
the same policy a data owner already understands — which is the whole of goal 3 — rather than a
capability they must leave the tool to exercise.

**Design constraint that follows:** keep `scope` and `scope_grant` (§6) keyed on
`(service, catalog, schema)` rather than joining to `policy` directly, so mask and row-filter
policies inherit the same delegation scopes as grant policies with no rework.

### 5.5 Workstream R — mask and row-filter support in the Ranger Rego

A Rego change, in the policy repo rather than in Trinocular, and the prerequisite for exposing
any mask or filter UI. It can run in parallel with phases 1–3.

**Goal:** make `policyType: 1` (masking) and `policyType: 2` (row filter) policies enforce, so
that the constructs Ranger's model already defines stop being inert (§4.2).

**Input/output contract** — from Trino's `trino-opa` plugin, verified against
`plugin/trino-opa/src/main/java/io/trino/plugin/opa/schema/`:

| Operation | Input resource | Expected response |
| --- | --- | --- |
| `GetRowFilters` | `table: {catalogName, schemaName, tableName}` | `rowFilters` → **array** of `{expression, identity?}` (`OpaRowFiltersQueryResult` holds `List<OpaViewExpression>`; absent ⇒ empty list) |
| `GetColumnMask` | `column: {catalogName, schemaName, tableName, columnName, columnType}` | `columnMask` → **single** `{expression, identity?}` or absent (`Optional<OpaViewExpression>`) |

`identity` is optional and has no Ranger equivalent — omit it, so expressions evaluate as the
querying user. Note the input carries `columnType`, which the mask transformers need.

**Ranger data contract** — field names from `RangerPolicy.java`:

```jsonc
// policyType: 2 — row filter
"resources": { "catalog": …, "schema": …, "table": … },
"rowFilterPolicyItems": [{
  "users": [...], "groups": [...],
  "accesses": [{ "type": "select", "isAllowed": true }],
  "rowFilterInfo": { "filterExpr": "region = 'EMEA'" }
}]

// policyType: 1 — column mask
"resources": { "catalog": …, "schema": …, "table": …, "column": … },
"dataMaskPolicyItems": [{
  "users": [...], "groups": [...],
  "accesses": [{ "type": "select", "isAllowed": true }],
  "dataMaskInfo": { "dataMaskType": "MASK_HASH", "valueExpr": "", "conditionExpr": "" }
}]
```

**Mask type → SQL.** The service definition's `dataMaskDef.maskTypes[].transformer` already
carries Trino-dialect templates using `{col}` and `{type}` placeholders — substitute the column
name and `columnType`:

| `dataMaskType` | Expression |
| --- | --- |
| `MASK` | the nested `regexp_replace` chain from the servicedef |
| `MASK_SHOW_FIRST_4` / `MASK_SHOW_LAST_4` | servicedef transformer |
| `MASK_HASH` | `cast(to_hex(sha256(to_utf8({col}))) as {type})` |
| `MASK_DATE_SHOW_YEAR` | `date_trunc('year', {col})` |
| `MASK_NULL` | `NULL` — no transformer in the servicedef, special-case it |
| `MASK_NONE` | emit **no** mask (not an empty one) |
| `CUSTOM` | `dataMaskInfo.valueExpr` verbatim |

Ship the transformer table as **bundle data**, not hardcoded Rego, so Trinocular's UI and the
Rego resolve masks from one source of truth. `conditionExpr` is unused in practice — reject it
in the linter rather than half-implementing it.

**Work items:**

| | Item | Notes |
| --- | --- | --- |
| **R1** | Honour `policyType` in policy selection | Today it is ignored (§4.2). Type-0 policies must not answer mask/filter queries, and type-1/2 must stop being filtered out as inert. |
| **R2** | Resource matching for mask/filter policies | The servicedef marks these resources `singleValue: true`, so this is simpler than the general matcher — but wildcards still apply. Reuse `policy_matchers` rather than forking the logic. |
| **R3** | `rowFilters` rule | Match user/groups per `rowFilterPolicyItems`, emit `{expression: filterExpr}`. |
| **R4** | `columnMask` rule | Match, resolve `dataMaskType` → expression via the transformer table, substitute `{col}`/`{type}`. |
| **R5** | **Conflict semantics — decide explicitly** | Ranger resolves to a single winning policy by priority; the dispatcher unions row filters and fails closed on multiple masks. Recommend matching the dispatcher: union row filters (AND), and if two policies mask the same column, return `NULL`. Document it either way — this is the kind of rule that must not be discovered from behaviour. |
| **R6** | Wire Ranger's `rowFilters` / `columnMask` into the targeted clusters' dispatcher policy map | **The gating change.** Ranger currently supplies only `allow` / `batchAllow`; the map must import and wire its two new rules. See the conflict note directly below — the existing data-driven provider is *already* wired for masks on these clusters, so after R6 there are two mask providers configured where there was effectively one. |
| **R7** | Tests | Per mask type, per conflict case, plus decision-equality against the existing provider on a real catalog. |

**Row filtering is in heavy production use — but not on the clusters Trinocular targets, and
not in a form the Ranger model can express.** Both halves of that matter (§13.1):

- On the **clusters Trinocular targets**, no masks or row filters are live. Their only
  mask/filter provider is data-driven, and its data carries none. So Workstream R is
  **additive there** — no migration, no cutover schedule, no provider to displace.
- On the **clusters Trinocular does not target**, row filtering runs at scale — tens of
  thousands of entitlement pairs — plus a pair of column masks.

The second point carries a design consequence that survives the scoping, because it bounds what
"converge" (§5.4) can mean:

> **Not every filter in the estate is expressible as a Ranger row filter.** The high-volume
> provider does not *store* SQL — it **computes** the expression per request: derive a role from
> the schema name, look up that role's entitlement pairs, drop the ones the requesting user
> cannot see, and assemble an `IN` list from what remains. A Ranger `rowFilterInfo.filterExpr`
> is a **static string matched by user/group**. It cannot express "the subset of forty thousand
> entitlement pairs *this* user may see" without either one policy per user or a dynamic
> expression facility the Ranger model does not have.
>
> So convergence is available for **static, user/group-matched** filters and masks — which is
> the common case and what data owners will author — and is **not** available for computed,
> entitlement-derived filters. Those stay in a purpose-built policy. §5.4's decision holds for
> what Trinocular is for; it is not a claim that every filter in the estate can move.

> **The conflict rule becomes live at R6.** The dispatcher discards *both* masks and substitutes
> `{"expression": "NULL"}` when two policies mask the same column
> (`main_dispatcher_policy.rego:218-233`). Today the targeted clusters have one mask provider
> wired and it returns nothing, so the branch is unreachable. **R6 wires a second.** From that
> moment the estate is one populated row away from silent data blanking: the day someone adds a
> mask to the older provider for a column Trinocular also masks, that column returns `NULL` with
> no error anywhere.
>
> Treat it as a **design invariant, asserted in CI**, not a procedure someone remembers: exactly
> one provider serves masks for a given catalog. The check is cheap — enumerate the mask
> providers in the policy map, intersect their catalog scopes, fail on any overlap. Write it in
> the same change as R6, not after.

---

## 6. Data model

The canonical stored object is the Ranger `RangerPolicy`. Verbatim example from Ranger's own
Trino plugin test fixtures (`plugin-trino/src/test/resources/trino-policies.json`):

```json
{
  "id": 51,
  "guid": "7ab96b62-6fd3-4193-bf49-af462c25784d",
  "service": "cl1_trino",
  "serviceType": "trino",
  "name": "checkCanImpersonateUser",
  "policyType": 0,
  "policyPriority": 0,
  "description": "",
  "isAuditEnabled": true,
  "isEnabled": true,
  "isDenyAllElse": false,
  "version": 1,
  "zoneName": "",
  "resources": {
    "trinouser": { "values": ["bob"], "isExcludes": false, "isRecursive": false }
  },
  "policyItems": [
    {
      "accesses": [{ "type": "impersonate", "isAllowed": true }],
      "users": ["admin"],
      "groups": [],
      "roles": [],
      "conditions": [],
      "delegateAdmin": false
    }
  ],
  "denyPolicyItems": [],
  "allowExceptions": [],
  "denyExceptions": [],
  "dataMaskPolicyItems": [],
  "rowFilterPolicyItems": [],
  "validitySchedules": [],
  "policyLabels": [],
  "options": {}
}
```

**Design decision: store the Ranger shape natively, not a nicer internal shape.**

Rationale: any internal model needs a lossless bidirectional mapping to this anyway. Keeping the
Ranger shape as the source of truth means the export endpoint is `SELECT`-and-serialize,
round-tripping an imported Ranger export is provably lossless, and the `trino-ranger` plugin
stays a viable fallback. The cost — a slightly awkward shape in the DB — is paid once, in one
TypeScript type.

Storage sketch:

```sql
CREATE TABLE policy (
  id          BIGSERIAL PRIMARY KEY,   -- becomes RangerPolicy.id
  guid        UUID NOT NULL UNIQUE,
  service     TEXT NOT NULL,
  name        TEXT NOT NULL,
  version     INT  NOT NULL DEFAULT 1,
  is_enabled  BOOLEAN NOT NULL DEFAULT TRUE,
  body        JSONB NOT NULL,          -- the full RangerPolicy
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by  TEXT NOT NULL,
  UNIQUE (service, name)
);

CREATE TABLE policy_revision (
  id          BIGSERIAL PRIMARY KEY,
  policy_id   BIGINT NOT NULL REFERENCES policy(id),
  version     INT NOT NULL,
  body        JSONB NOT NULL,
  changed_by  TEXT NOT NULL,
  changed_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  change_note TEXT
);

CREATE INDEX ON policy USING GIN (body jsonb_path_ops);

-- Delegation (§9). Created in Phase 1 even though it is not enforced until
-- Phase 5: retrofitting ownership onto a populated policy table means
-- reconstructing who owns what after the fact, which is guesswork.
CREATE TABLE scope (
  id       BIGSERIAL PRIMARY KEY,
  service  TEXT NOT NULL,
  catalog  TEXT NOT NULL,        -- no wildcards; a scope is always concrete
  schema   TEXT,                 -- NULL = whole catalog
  UNIQUE (service, catalog, schema)
);

CREATE TABLE scope_grant (
  scope_id   BIGINT NOT NULL REFERENCES scope(id),
  principal  TEXT NOT NULL,      -- user or group
  role       TEXT NOT NULL,      -- SCOPE_ADMIN | VIEWER
  PRIMARY KEY (scope_id, principal)
);

ALTER TABLE policy ADD COLUMN scope_id BIGINT REFERENCES scope(id);
```

The service definition (`ranger-servicedef-trino.json`) is checked into the repo and served to
the frontend as static JSON. The frontend **generates the resource form from it** rather than
hardcoding catalog/schema/table — same approach as Ranger's `RangerPolicyForm.js`, and it means
a service-definition change is a data change, not a code change.

---

## 7. Architecture

### 7.1 Stack

| Layer | Choice | Rationale |
| --- | --- | --- |
| Frontend | **React 18 + TypeScript**, Vite | TS is non-negotiable here — the policy model is deeply nested and the linter rules are type-driven |
| UI kit | **Mantine** (or MUI) | Ranger 2.3 is Backbone + RequireJS + Bootstrap; there is nothing to port, so pick a modern kit. Mantine's form + multiselect primitives fit the resource editor well |
| Forms | **react-hook-form** + **zod** | zod schema doubles as the linter and the API contract |
| Server state | **TanStack Query** | |
| Routing | **React Router** | |
| Backend | **Python 3.12 + FastAPI** | Matches the surrounding OPA tooling, which is Python; easy OPA sidecar integration |
| DB | **Postgres** | |
| Auth | Pluggable — OIDC by default, with a hook for deployment-specific SSO | |

> If a team would rather stay on the JVM to reuse Ranger's `RangerPolicy` /
> `RangerPolicyValidator` classes directly, that is a defensible alternative. The
> Python/FastAPI recommendation assumes the surrounding policy tooling is Python; revisit if
> that is not the deciding factor.

### 7.2 Backend API

```
# Ranger Admin compatibility surface — both are first-class (§2)
GET    /service/plugins/policies/download/{service}  → ServicePolicies. PATH A: the polling
                                                       protocol a stock RangerAdminRESTClient
                                                       speaks. Must carry policyVersion + the
                                                       embedded serviceDef and honour
                                                       lastKnownVersion / not-modified.
GET    /service/plugins/policies/exportJson          → {metaDataInfo, policies:[...]}. PATH B.

# Editor API
GET    /api/v1/servicedef                            → the Trino service definition
GET    /api/v1/services                              → configured Trino services/clusters
GET    /api/v1/policies?service=&q=&resource=&user=&group=&enabled=
POST   /api/v1/policies
GET    /api/v1/policies/{id}
PUT    /api/v1/policies/{id}
DELETE /api/v1/policies/{id}
GET    /api/v1/policies/{id}/revisions
POST   /api/v1/policies/{id}/revert/{version}

POST   /api/v1/lint                                  → run §4.6 rules against a draft
POST   /api/v1/simulate                              → §8
POST   /api/v1/import                                → ingest a Ranger export
GET    /api/v1/export                                → same as exportJson, for humans
GET    /api/v1/audit
GET    /api/v1/lookup/catalogs|schemas|tables|columns → typeahead via Trino JDBC
```

The typeahead endpoints mirror what Ranger's `RangerServiceTrino` / `TrinoResourceManager` do:
connect over the Trino JDBC driver and enumerate `information_schema`. Worth reading those
classes before implementing — they already handle the wildcard-prefix lookup semantics the UI
needs.

### 7.3 Frontend structure

```
src/
  api/            # TanStack Query hooks, generated types
  model/
    ranger.ts     # RangerPolicy TS types (mirrors §6)
    servicedef.ts # service-definition parsing → form schema
    lint.ts       # §4.6 rules, shared with backend via JSON output
  components/
    ResourceSelector/    # servicedef-driven: renders the catalog→schema→table→column
                         #   chain, wildcard toggle, exclude toggle, multi-value input
    PolicyItemEditor/    # users / groups / access-type checkbox grid
    AccessTypeGrid/
    LintPanel/           # inline errors + warnings, blocks save on error
    SimulatorPanel/      # §8
    PolicyDiff/          # revision comparison
  routes/
    PolicyList.tsx       # searchable table (≈ Ranger's RangerPolicyTableLayout)
    PolicyEdit.tsx       # create / edit (≈ RangerPolicyForm)
    PolicyView.tsx       # read-only (≈ RangerPolicyRO)
    Simulator.tsx        # standalone "can user X do Y?" page
    AuditLog.tsx
    Import.tsx
```

Reference reading in the Ranger source for UX (not code) parity:

- `security-admin/src/main/webapp/scripts/views/policies/RangerPolicyForm.js` — the form layout
  and resource cascade behaviour. **Skip its allow/deny/exception section toggles** — that
  four-section layout is the visual expression of the model we are rejecting (§4.1), and our
  form has exactly one grant section
- `.../views/policies/PermissionList.js` — the users/groups/permissions row editor, which is the
  single most-used widget and the one worth matching closely
- `.../templates/policies/RangerPolicyForm_tmpl.html` — field ordering

Dropping the deny/exception sections is a real simplification, not just a subtraction: Ranger's
policy form is dominated by four near-identical repeated blocks, and collapsing to one grant
list frees the vertical space that the linter panel and inline simulator want.

### 7.4 Designing for the data owner

Goal 3 constrains the UI from Phase 1, not from Phase 5. Retrofitting a non-expert audience
onto a tool built for engineers does not work — the vocabulary and defaults harden early.
Concretely:

- **Speak Trino, not Ranger.** The user is granting access to `hive.sales.orders`, not
  populating a `resources` map with `isExcludes` flags. Ranger's internal vocabulary should not
  surface in labels, errors, or empty states.
- **The simulator belongs in the edit form**, not only on its own page. The natural question
  after writing a grant is "did that do what I meant?", and the answer should be one panel away
  rather than one navigation away.
- **Show the diff in terms of access, not JSON.** "This change lets `analysts` SELECT 3 more
  tables" beats a JSON patch for a reviewer who is not an engineer. Computable from the
  simulator: evaluate a sample of resources before and after, and describe the delta.
- **Errors must say what to do.** The §4.6 linter fires on constructs a data owner has never
  heard of. "`all` grants nothing here — use these concrete verbs instead" with a fix button, not
  "impliedGrants not expanded."
- **Read-only by default.** A data owner landing on a catalog they do not own should see it,
  understand it, and find out who to ask — not get a 403.

Concentrating the domain vocabulary in `ResourceSelector` and `PolicyItemEditor` is what makes
this tractable: those two components are where Ranger's model either leaks to the user or
doesn't.

### 7.5 Labeling and element IDs

Every interactive element carries a stable, meaningful identifier and an accessible label. This
is a standing requirement from Phase 0 onward, not a hardening pass bolted on later — retrofitting
IDs across a built UI is tedious and always partial.

Three consumers justify it, and they want the same thing:

1. **Design review.** A data owner reporting "the catalog box on the edit screen does X" is
   ambiguous; `policy-edit-resource-catalog-input` is not.
2. **Test automation.** Playwright E2E (§12) and the Phase 0 smoke script select on
   `data-testid` only. Tests that select on CSS classes or visible text break on every restyle
   and every copy change — and the copy *will* change, because §7.4 says it must.
3. **Accessibility.** Screen-reader users are a real audience for an internal tool, and the same
   discipline serves all three.

**Convention:**

```
data-testid="<screen>-<component>-<element>[-<qualifier>]"     // kebab-case throughout
```

| Element | `data-testid` |
| --- | --- |
| Policy list search box | `policy-list-search-input` |
| Catalog filter dropdown | `policy-list-filter-catalog` |
| A policy row | `policy-list-row-<policyGuid>` |
| Catalog value input in the resource cascade | `policy-edit-resource-catalog-input` |
| Its wildcard / exclude toggles | `policy-edit-resource-catalog-wildcard-toggle`, `…-exclude-toggle` |
| A grant row's user field | `policy-edit-grant-<rowKey>-users` |
| Add-grant button | `policy-edit-grant-add-button` |
| "Select all" verbs control | `policy-edit-grant-<rowKey>-verbs-select-all` |
| An individual verb checkbox | `policy-edit-grant-<rowKey>-verb-<verb>` |
| Save | `policy-edit-save-button` |
| A linter finding | `lint-panel-finding-<ruleId>` |
| Simulator operation picker / verdict | `simulator-operation-select`, `simulator-verdict` |
| The policy that decided it | `simulator-deciding-policy` |
| Mask type picker | `mask-editor-type-select` |

**Rules:**

- **Identify what a thing *is*, never where it sits or what it currently says.** No
  `row-3`, no IDs derived from label text.
- **Repeated rows key on domain identity** — `policyGuid` for policies — or, where no domain key
  exists (an unsaved grant row), a client-generated key stable for that row's lifetime. Never
  the array index; reordering must not renumber IDs.
- **`<ruleId>` in the linter panel matches the §4.6 rule name exactly**, so a finding on screen,
  a rule in this document, and a test all use one identifier.
- **Every input has a real `<label htmlFor>`.** Placeholder text is not a label.
- **Icon-only controls carry `aria-label`;** validation messages link via `aria-describedby`.
- **IDs are API.** Changing one is a breaking change for the test suite — rename deliberately,
  not incidentally.

Enforce with an ESLint rule requiring `data-testid` on interactive elements, plus
`jsx-a11y` for the label requirements, both failing CI.

---

## 8. The policy simulator

This is what a purpose-built tool can do that Ranger cannot, and it is the strongest argument
for the whole project.

**Concept:** the user fills in an identity (`user`, `groups`), an operation (from `action_map`),
and a resource (catalog/schema/table/column). The backend constructs the exact `OpaQueryInput`
that `trino-opa` would send, evaluates it against the **real Rego** with the **current draft
policy set**, and reports allow/deny *plus which policy decided it*.

**Implementation:** run OPA as a sidecar (or use the Go/WASM build). On simulate:

1. Serialize the current draft policies to `data.ranger_data.policies`.
2. Build the bundle from the same Rego version pins the target cluster uses — this guarantees
   the simulator and production agree on Rego version.
3. POST the input to OPA's `/v1/data/...` endpoint for the Ranger policy package and read back
   `allow`, plus `matching_policy_ids_by_resource` and `permissions_by_policy` for
   explainability. The Rego already exposes these as named rules, so no Rego changes are needed.

**Input shape** — from Trino's `plugin/trino-opa/.../schema/OpaQueryInput*.java`:

```json
{
  "input": {
    "context": { "identity": { "user": "alice", "groups": ["analysts"] } },
    "action": {
      "operation": "SelectFromColumns",
      "resource": {
        "table": {
          "catalogName": "hive",
          "schemaName": "sales",
          "tableName": "orders",
          "columns": ["region", "amount"]
        }
      }
    }
  }
}
```

The operation list comes straight from `action_map` in `ranger_policy.rego:335-392` — expose it
as a dropdown, and mark the entries in `defaulted_action_map` (bulk-allow) and the
`divergences.md` bulk-deny list so users understand results that do not depend on their policy.

**Second use, and arguably the more valuable one — regression testing.** Store simulator cases
as fixtures ("alice must be able to SELECT `hive.sales.orders`"; "bob must NOT be able to DROP
it") and run the whole suite against the draft policy set on every save and in CI. This turns
policy editing from "hope" into "tested", which is something Ranger has never offered.

---

## 9. Delegated administration

Addresses `gemini_ranger_talking.md` §6 and §7.1–7.3. **This is goal 3 — the reason the project
exists** — even though it lands in Phase 5, because it depends on everything before it. The
sequencing is a dependency order, not a priority order.

Rather than porting Security Zones (inert downstream — §4.2), implement delegation in
Trinocular's **own RBAC**, where it is enforced at the API layer and cannot be bypassed:

```
Role: GLOBAL_ADMIN
  - full CRUD on all policies, manage scopes, manage users

Role: SCOPE_ADMIN
  - bound to one or more scopes: { service, catalog, schema? }
  - may CRUD only policies whose `resources.catalog.values` ⊆ their catalogs
    (and, if schema-scoped, whose `resources.schema.values` ⊆ their schemas)
  - may not create a policy with a wildcard that escapes their scope
  - may not grant access types beyond their own ceiling (the Ranger privilege-ceiling rule)

Role: VIEWER
  - read + simulate only
```

Enforcement lives in one server-side predicate — `policy_in_scope(policy, scope)` — applied on
read (filter), write (reject), and export (unfiltered; export is a service identity). Getting
the wildcard-escape check right is the subtle part: a `SCOPE_ADMIN` for catalog `hive` must not
be able to author `catalog: ["*"]`, and must not be able to author
`catalog: ["hive"], isExcludes: true`.

The approval workflow (§7.4 of the source doc) is an optional extension, between administrators
only: `SCOPE_ADMIN` proposes, `GLOBAL_ADMIN` approves, and the export only reflects merged
state. If the policy store is backed by git (§10), this is literally a pull request. There is no
end-user request flow (§5.3).

---

## 10. Storage, history, and rollout safety

**Postgres as the operational store, git as the durable audit log.** On every mutation, write
the full policy set to a git repo as one JSON file per policy, commit with the author identity
and change note, and push. This gives:

- Free, tamper-evident history and `git blame` on any grant.
- Trivial disaster recovery — the git repo alone can rebuild the export.
- A review workflow for §9 without building one.

**Rollout safety — the parallel run.** Before cutting the puller over:

1. Import the current Ranger export into Trinocular.
2. Stand up Trinocular's `exportJson` endpoint.
3. Run a scheduled job that fetches both Ranger's export and Trinocular's, normalizes (sort by
   `guid`, drop `id`/`version`/timestamps), and diffs.
   **Expect this to be non-empty and that is fine.** If the Ranger corpus contains any deny or
   exception policies, Trinocular will refuse them on import (§4.1) and its export will be
   legitimately smaller. Triage the diff once; it should reduce to exactly that set.
4. Replay a corpus of real OPA decision inputs (from OPA decision logs) against both policy sets
   and assert identical allow/deny. **This is the check that actually matters, and it should be
   clean even where step 3 is not** — the Rego already discards the policies Trinocular refuses,
   so dropping them changes no decision. Export equality is a proxy; decision equality is the
   requirement.
5. Cut over. Keep Ranger read-only for a deprecation window.

Because the only change is a URL in the puller's config, **rollback is that same one-line
change** — a property worth preserving deliberately as the design evolves.

---

## 11. Phased delivery

| Phase | Deliverable | Definition of done |
| --- | --- | --- |
| **0. Wireframe** (2 wk) | Pure React, no backend, no persistence. Every screen in the product, clickable, on fixture data | A data owner walks the full journey unaided and gives design feedback before anything is built |
| **C. Contract spike** (1 wk) | Stub server re-serving a saved Ranger export; point a *dev* puller at it. **Parallel with 0.** | A dev cluster behaves identically with the stub in the loop. Proves §2 with ~zero code. |
| **1. Read-only UI** (2 wk) | Schema (incl. scope tables), importer, policy list, search, read-only detail, servicedef-driven rendering | A **data owner** — not just an engineer — can answer "who can read `hive.sales.orders`?" without help |
| **2. Authoring** (3 wk) | Create/edit/delete, `ResourceSelector`, `PolicyItemEditor`, **mask + row-filter editors**, linter (§4.6), revisions, git backing. **Needs R.** | Round-trips losslessly; linter flags every §4 violation in the corpus; a mask and a row filter can be authored |
| **3. Simulator** (2 wk) | OPA sidecar, simulate endpoint, explainability, in-form panel, **mask/filter simulation incl. the fail-closed `NULL` collapse**, fixture suite in CI | Decision-equality harness (§10.4) green against production Ranger |
| **4. Cutover** (1 wk) | Parallel-run diffing, prod puller repoint, Ranger to read-only | Ranger Admin + Solr + RDBMS decommissionable |
| **5. Delegation** (3 wk) | RBAC, scopes, scope-aware filtering, access-terms diff view | A catalog owner authors and ships a grant with no engineer involved |
| **6. Change review** (optional, 2 wk) | Admin-to-admin propose/review/approve on top of git | A delegate admin's change can be held for global-admin approval before it is exported |
| **R. Mask/filter Rego** (4 wk) | Workstream R (§5.5) — R1–R7 in the policy repo. **Starts day one, on the critical path**: Phase 2 cannot finish without it. | `policyType` 1 and 2 enforce on the targeted clusters; single-provider invariant asserted in CI |

Dependencies:

```
0 ──► 1 ──► 2 ──► 3 ──► 4 ──► 5 ──► 6
      ▲     ▲
C ────┘     │
(stub)      │
            │
R ──────────┘
(separate repo — must land before 2 closes)
```

Three things start on day one: the wireframe (0), the contract spike (C), and the Rego
workstream (R). They share no code and no people. Phase 1 needs 0 and C; **Phase 2 cannot close
without R**, because masking and row filtering are product requirements (§5.4) and Phase 2 is
where authoring lands.

R runs weeks 1–4; Phase 2 runs to roughly week 7. The dependency resolves with slack — but R is
on the critical path, so slipping it slips the product, and it should be staffed accordingly
rather than treated as background work.

**Read this as a dependency order, not a priority order.** Phases 0–4 retire the Ranger
footprint; phases 5–6 retire the *human* bottleneck, which is the actual pain
(`gemini_ranger_talking.md` §6) and the reason to build at all. Delegation lands late only
because it needs authoring, guardrails, and the simulator underneath it — you cannot safely hand
policy authorship to a non-engineer before those exist.

---

### Phase 0 — Wireframe (2 wk)

**Goal:** put the entire product in front of a data owner before a line of backend exists.
Every screen, every configuration surface, clickable, on fixture data. Design feedback is
cheapest here and never gets cheaper.

**Depends on:** nothing.

**Shape:** pure React + TypeScript, Vite, the §7.1 UI kit. **No backend, no database, no API
calls, no persistence.** State is React state; a reload resets it. Fixture data is checked-in
JSON in the real `RangerPolicy` shape (§6) — derived from a sanitized production export so the
wireframe hits realistic wildcard, multi-value, and deep-hierarchy cases rather than three tidy
examples. Deployable as a static bundle so reviewers get a URL, not a screen share.

**Screens to build.** All of them, including phases we have not scheduled — seeing the whole
surface is the point:

| # | Screen | Must show |
| --- | --- | --- |
| 1 | Policy list | Search, filters (catalog / schema / table / user / group / enabled), sortable table, row actions, pagination |
| 2 | Policy detail (read-only) | Resources and grants in Trino vocabulary; revision/audit sidebar; "who owns this" |
| 3 | Policy create / edit | `ResourceSelector` cascade, wildcard + exclude toggles, `PolicyItemEditor` grant rows, `isDenyAllElse`, one grant section only (§4.1) |
| 4 | Linter panel | Inline errors blocking save vs warnings; a fix-it action; the §4.6 rules represented |
| 5 | Simulator panel (in-form) | Identity + operation + resource inputs, allow/deny verdict, which policy decided |
| 6 | Simulator (standalone page) | Same, plus saved fixture cases and a run-all result list |
| 7 | Revision history / diff | Version list, side-by-side diff, revert action |
| 8 | Access-terms diff | "This change lets `analysts` SELECT 3 more tables" — the reviewer view (§7.4) |
| 9 | Import | File picker, lint report, per-policy accept/reject, refusal cases from §4.1 |
| 10 | Export / preview | The `exportJson` document as it will be served |
| 11 | Audit log | Who changed what, when, filterable |
| 12 | Scopes & delegation admin | Scope list, scope editor `(service, catalog, schema)`, role assignment |
| 13 | Scoped (non-admin) view | The same app as a `SCOPE_ADMIN` — out-of-scope policies visible read-only with an owner shown, never a bare 403 |
| 14 | ~~Request / propose / review~~ | **Dropped** — no end-user requests (§5.3). If Phase 6 is taken up, admin review lives on screen 8. |
| 15 | Mask editor | Mask-type picker with a worked example per type, per §5.5's table |
| 16 | Row-filter editor | Expression input, validation affordance |
| 17 | Configuration | Services/clusters, service-definition viewer, capability profile showing what the target Rego supports (§4.6) |
| 18 | Identity / role indicator | Current user, role, active scopes |
| 19 | States | Empty, loading, error, permission-denied, and "no results" for every list |

**Work items**
- Route shell and navigation covering all screens above.
- Components from §7.3, built against fixtures.
- **Labeling and IDs per §7.5 — a hard requirement of this phase, not a follow-up.**
- Fixture set: sanitized policies plus at least one instance of every §4.6 lint violation, so
  the linter panel can be demonstrated rather than described.
- Static deploy for review.

**Exit criteria**
- Every screen in the table is reachable by clicking, from a cold load.
- **A data owner (not an engineer) walks two journeys unaided while someone watches silently:**
  grant a group SELECT on a table, and mask a column. Findings written down.
- Every interactive element satisfies the §7.5 convention, enforced by lint in CI.
- An automated smoke script drives the full journey by `data-testid` alone, with no CSS or
  text selectors — which proves the IDs are real and gives Phase 1 its E2E skeleton for free.

**Not in this phase:** no backend, no persistence, no real OPA, no auth. Nothing here is
throwaway *except* the fixture wiring — the components and IDs carry into Phase 1.

---

### Workstream C — Contract spike (1 wk, parallel with 0)

**Goal:** prove the §2 integration contract end to end before an application depends on it.

**Depends on:** nothing. No overlap with Phase 0 — this is a stub server and a config change.

**Work items**
- Stub service that loads a saved Ranger export from disk and serves it verbatim at
  `GET /service/plugins/policies/exportJson` (Path B) and as `ServicePolicies` at
  `download/{service}` (Path A).
- Point a **dev** puller at the stub; let the bundler build as normal.
- **Point a stock `trino-ranger` plugin at the stub** via `ranger.plugin.trino.policy.rest.url`
  and confirm it initialises and polls. This is the cheapest possible test of the Path A
  protocol, and finding out later that `RangerAdminRESTClient` rejects our document would be
  expensive.
- Capture a corpus of real OPA decision inputs from the dev cluster's decision logs.
- Replay the corpus against the pre-change and post-change bundles.

**Exit criteria**
- A dev cluster produces byte-identical decisions with the stub in the loop (Path B).
- A stock Ranger plugin loads policy from the stub and enforces it (Path A).
- The one-line puller config change, and its revert, are both exercised.
- The captured decision corpus is checked in — it is the input to the §12 decision-equality
  harness and to Phase 4's go/no-go gate.

**Not in this workstream:** no UI, no database, no editing. The stub itself is throwaway; the
decision corpus is not.

---

### Phase 1 — Read-only UI (2 wk)

**Goal:** make the *existing* policy set legible to someone who is not an engineer.

**Depends on:** 0 (components and IDs) and C (proven contract).

**Work items**
- Postgres schema per §6, **including the `scope` / `scope_grant` tables** (unused until 5).
- Importer: ingest a Ranger export → `policy` rows; hard-fail on §4.1 constructs with a report.
- Service definition served as static JSON; frontend form/render schema derived from it.
- Export endpoint (`exportJson` + `download/{service}`) serving from the database.
- **Swap the Phase 0 fixtures for real data** on the list, detail, and configuration screens —
  the components and their IDs are already built; this phase gives them a backend.
- Apply the Phase 0 design feedback. Budget for it explicitly: the wireframe is worthless if
  what it surfaced gets deferred here.
- AuthN; every authenticated user is a reader.

**Exit criteria**
- A data owner answers "who can read `hive.sales.orders`?" unaided, faster than in Ranger.
- Import → export round-trips the full production corpus losslessly (§12 contract test).
- The Phase 0 smoke script still passes, now against real data rather than fixtures.

**Not in this phase:** no editing, no simulator, no scope enforcement.

---

### Phase 2 — Authoring (3 wk)

**Goal:** create and edit policies safely, with invalid states unreachable rather than warned about.

**Depends on:** 1.

**Work items**
- `ResourceSelector` — servicedef-driven catalog→schema→table→column cascade, wildcard and
  exclude toggles, multi-value entry, typeahead against `information_schema` (or free text if
  question 7 lands the other way).
- `PolicyItemEditor` / `AccessTypeGrid` — users, groups, the grantable verbs (§15). **One grant section**, no
  deny or exception UI (§4.1). A **"select all" control that ticks the grantable verbs
  individually** — it is a bulk-edit convenience, never a stored value, and the grid must show
  the individual ticks afterwards so what is saved is what is seen (§4.3.1). No `all` checkbox,
  and the inert `grant` / `revoke` / `use` verbs (§15) are not among the grantable set.
- Create / edit / delete, with optimistic concurrency on `version`.
- **Mask editor** — `policyType` 1. Mask-type picker driven by the transformer table R publishes,
  with a worked example per type so the effect is visible before saving. `conditionExpr` stays
  rejected (§5.5).
- **Row-filter editor** — `policyType` 2. Expression input with syntax validation.
- Both gated behind a capability check so they light up when R lands, rather than blocking the
  rest of Phase 2 on it.
- Linter (§4.6) wired into save: errors block, warnings inform. Shared rule definitions between
  frontend and backend.
- `policy_revision` writes on every mutation; revision list and diff view.
- Git backing (§10) — one JSON file per policy, commit per change with author and note.
- Audit log view.

**Exit criteria**
- Full production export round-trips losslessly *through the editor* (import → edit → export).
- The linter flags every §4 violation present in the existing corpus, with counts recorded.
- Every mutation produces exactly one revision row and one git commit.
- No UI path exists that can author a deny item, exception, `all`, or role grant.
- "Select all" writes the grantable verbs individually, and a policy imported with `all` exports as the expanded concrete verbs (never the `all` token).
- **A mask and a row filter can be authored and exported** in valid `policyType` 1 / 2 shape.

**Depends on R** for the mask and row-filter editors — the rest of the phase does not.

**Not in this phase:** no scope enforcement (tables exist, unread); no simulator.

---

### Phase 3 — Simulator (2 wk)

**Goal:** answer "did that policy do what I meant?" before the policy ships.

**Depends on:** 2.

**Work items**
- OPA sidecar; bundle assembled from the **same Rego version pins production uses**.
- `POST /api/v1/simulate` — build the `OpaQueryInput` (§8), evaluate against draft policies.
- Explainability: surface `matching_policy_ids_by_resource` and `permissions_by_policy`, mapped
  back to policy names, so the answer is "allowed by *this* policy," not just "allowed."
- Operation dropdown from `action_map`, annotating bulk-allow and bulk-deny operations so users
  understand results that do not depend on their policy at all.
- `SimulatorPanel` embedded in the edit form, not only the standalone page (§7.4).
- Fixture store — named cases with expected allow/deny — plus a CI runner.
- **`GetColumnMask` / `GetRowFilters` simulation**, showing the resolved SQL expression — the
  only way an author sees what their mask actually does before it ships.
- **Reproduce the dispatcher's fail-closed `NULL` collapse** (§5.5). A simulator that queries one
  provider will confidently report a mask production would discard.

**Exit criteria**
- Decision-equality harness (§10, step 4) green against production Ranger.
- Fixture suite runs on every policy mutation and in CI.
- Simulator and production cannot drift: the pin source is shared, and a mismatch fails the build.
- Every mask type in §5.5's table renders its resolved expression in the simulator.

---

### Phase 4 — Cutover (1 wk)

**Goal:** retire Ranger Admin, Solr, and the RDBMS.

**Depends on:** 3.

**Work items**
- Scheduled export-diff job (§10 step 3), with the expected-difference set triaged and recorded.
- Decision replay against the production corpus (§10 step 4) as the go/no-go gate.
- Repoint the production puller; keep the old URL one revert away.
- Ranger Admin to read-only for a deprecation window; announce.
- Written rollback runbook, exercised at least once in dev.

**Exit criteria**
- Decision equality clean on the production corpus.
- Ranger Admin, Solr, and the RDBMS are decommissionable — sign-off from whoever owns them.

---

### Phase R — Mask/filter Rego (4 wk, starts day one, **critical path**)

**Goal:** make `policyType` 1 and 2 actually enforce, so masks and filters can live in the same
policy model as grants (§5.5). Masking is a product requirement (§5.4), so this is not optional
and not background work.

**Depends on:** nothing in Trinocular. Separate repo, can start on day one. **Phase 2 depends on
it** — the mask and row-filter editors cannot close without it.

**Work items:** R1–R7 as specified in §5.5.

**Exit criteria**
- `policyType` 1 and 2 enforce; `GetColumnMask` and `GetRowFilters` answered by the Ranger Rego.
- Conflict semantics (R5) decided, documented, and tested.
- Mask transformer table published as bundle data, consumable by both the Rego and the UI.
- Every mask type in §5.5's table produces the expected SQL against a real Trino query.
- CI asserts the single-provider-per-catalog invariant against the policy map (§5.5).

**Not in this phase:** no UI. **No data migration either** — the targeted clusters have no live
masks or filters (§13.1), so this adds a capability rather than replacing one. The 4-week
estimate is Rego work and stands on its own.

**Explicitly out of scope:** the computed, entitlement-derived row filters running on the
non-targeted clusters (§5.5). Those are not expressible in the Ranger model and are not a
migration candidate. Do not let R grow to cover them.

---

### Phase 5 — Delegation (3 wk)

**Goal:** a data owner manages their own catalog without an engineer. **This is goal 3.**

**Depends on:** 2 for the mechanics; 4 for it to matter in production.

**Work items**
- Roles and scope CRUD (§9); scope admin management for global admins.
- `policy_in_scope(policy, scope)` — one predicate, applied on read (filter), write (reject),
  and export (bypassed; export runs as a service identity).
- Wildcard-escape and privilege-ceiling checks, with the adversarial cases from §12 as tests.
- Scope-aware UI: out-of-scope policies visible read-only with "who owns this" surfaced, never a
  bare 403 (§7.4).
- Access-terms diff — "this change lets `analysts` SELECT 3 more tables" — computed from the
  simulator.

**Exit criteria**
- A catalog owner authors and ships a grant with no engineer involved, observed end to end.
- Every escape attempt in the test matrix is rejected: wildcard, exclude-inversion, verb ceiling.

---

### Phase 6 — Change review (optional, 2 wk)

**Goal:** let a global admin hold a delegate admin's change for approval before it ships.
Administrators only — Trinocular has no end-user request flow (§5.3). Delegation (Phase 5)
already removes the central team from day-to-day grants; this phase is only for deployments
that want a second pair of eyes.

**Depends on:** 5.

**Work items**
- Proposal state on policies; propose → review → approve/reject, backed by git branches.
- Reviewer view built on the access-terms diff from 5, not a JSON patch.
- Notifications to reviewers.

**Exit criteria**
- A delegate admin's change, when review is enabled, is exported only after a global admin approves it.

---

Three consequences worth holding onto through the early phases, when it will be tempting to
defer them:

- **Phases 1–3 must be built for the Phase 5 audience** (§7.4). Every phase-1 label and phase-2
  error message either serves a data owner or has to be rewritten later.
- **Phase 1 creates the scope tables even though nothing enforces them until 5** (§6). Ownership
  recorded as policies are authored is accurate; ownership reconstructed afterwards is guesswork.
- **Masking is a Phase 2 requirement, not an epilogue** (§5.4). There is no version of this
  product that grants tables but makes a data owner file a ticket to mask a column. If R slips,
  Phase 2 slips with it — that is the correct behaviour, not a problem to route around.

If the schedule slips, the things to protect are R and 5–6. Shipping 0–4 without masking
produces a nicer Ranger with the same bottleneck — real value, but not the point.

---

## 12. Testing

| Level | What |
| --- | --- |
| Unit (frontend) | Service-definition → form generation; linter rules; policy diff |
| Unit (backend) | Ranger JSON (de)serialization round-trip; scope predicate (§9) incl. wildcard escape |
| Contract | Import Ranger's own `trino-policies.json` fixture and every real Ranger export available; assert byte-identical re-export after normalization |
| Golden | Trinocular `exportJson` vs Ranger `exportJson`, normalized diff |
| **Decision-equality (Path B)** | Replay real OPA inputs against both policy sets; assert identical `allow`/`batchAllow`. **The acceptance gate for cutover.** |
| **Plugin conformance (Path A)** | Point a stock `trino-ranger` plugin at Trinocular's `download/{service}` endpoint and assert it initialises, polls, and honours `lastKnownVersion`. A drop-in replacement that a stock plugin cannot consume is not a replacement. |
| **Cross-path parity** | Run the same policy through both paths and diff the outcome — including the resolved mask SQL, since the plugin (§4.8) is Workstream R's reference implementation. Divergence is either an R bug or a §4.8 profile entry we failed to write down. |
| Regression fixtures | The simulator suite from §8, run in CI on every policy change |
| E2E | Playwright: author a policy → export → build bundle → query OPA → assert decision. Selects on `data-testid` only (§7.5); the Phase 0 smoke script is its skeleton |
| Accessibility | `jsx-a11y` lint plus the §7.5 label requirements, failing CI |

---

## 13. Findings and open questions

### 13.1 Production corpus census

Several questions in earlier drafts were marked "cheap to answer with a `jq`." They have now
been answered against **all five production bundles** — two clusters that load the Ranger policy,
and three that do not. Figures are aggregate; per-policy detail belongs in the internal companion
document.

> **Method note, because a first pass got this wrong.** Counting masks and filters by scanning
> stored policy data finds only the *data-driven* providers. At least one provider **synthesizes
> its expressions in Rego** from an entitlements dataset, so it has no `filters` key to count and
> a data scan reports zero. Any future census must enumerate providers from the **policy map**
> first — every rule that supplies `rowFilters` or `columnMask` — and then ask each one where its
> inputs live. Counting keys in one namespace is not a census.

| | Finding |
| --- | --- |
| **Cluster coverage** | **2 of 5** clusters run the Ranger policy (≈193 and ≈95 policies). The other three carry no Ranger data and no Ranger Rego at all. Trinocular's blast radius is two clusters, not five. |
| **Deny / exceptions** | **Zero.** No policy in the corpus has `denyPolicyItems`, `allowExceptions`, or `denyExceptions`. The allow-only model (§4.1) already holds in practice — no migration triage needed. |
| **`all` access type** | 102 occurrences, **all benign** — every one is accompanied by the concrete verbs (§4.3). Latent trap, not a live defect. |
| **`roles`** | Zero on Trino policies. (117 on non-Trino ones — see below.) |
| **`validitySchedules`** | Zero. |
| **Security zones** | Unused; `zoneName` empty throughout. |
| **`isDenyAllElse`** | Used by **14** policies — actively relied on. Confirms it deserves prominent UI treatment (§4.1). |
| **Unreachable `function` resource** | **3 enabled, permanently dead policies** (§4.4). Real, and needs triage. |
| **Disabled policies** | 6, carried in the export and correctly ignored. |
| **Masks / row filters — targeted clusters** | **None live.** Their only provider is data-driven and its data holds zero populated masks or filters. Workstream R is additive there, with no migration (§5.5). |
| **Masks / row filters — other clusters** | **In heavy use**, by a third provider that Trinocular does not target: ~38k and ~55k entitlement pairs across ~4k and ~5k table entries on two clusters, plus 2 column masks. Expressions are **computed in Rego**, not stored — see the expressibility limit in §5.5. |
| **Scale** | ~150 Trino policies over ~154 distinct catalogs on the largest cluster. Small enough that no part of this design is scale-constrained. |

Two findings need action independent of Trinocular:

**(a) Cross-service policy leakage — worth verifying promptly.** The largest cluster's bundle
carries policies for **three services**: its own (~146), a *different* Trino cluster's (9), and
an unrelated non-Trino service (38). Because the Rego does not filter on `service` (§4.2), the
other Trino cluster's policies are live here — and they are written against catalog `*`, so they
match. One of them grants the implicit `public` group `select` / `show` / `use` on every
catalog.

The catalog-level grant may well be intended on this cluster too, so this is not necessarily a
privilege escalation — but the *mechanism* is certainly unintended: policies scoped to one
cluster are silently in force on another. Confirm the effective grant is intentional, then fix
the coupling. The non-Trino service's 38 policies use entirely disjoint resource keys and
cannot match a Trino request, so they are inert — but they are 20% of the document.

**(b) The 3 dead `function` policies** (§4.4) express an intent that has never taken effect.

**How this lands in the plan.** Trinocular should serve **per-service documents** rather than one
undifferentiated export, which removes leakage by construction. That is a behaviour change, so
it needs sign-off — but the corpus makes the case, and the fix is cheaper before migration than
after.

### 13.2 Still open

None of these block starting Phase 0.

1. **Per-service export — confirm the behaviour change.** Finding (a) argues for it. The
   counter-argument is that some cross-service grant is load-bearing and nobody has noticed.
   Decision-equality replay (§12) will show exactly what changes. Note Path A gets this for
   free: the plugin requests one named service.
2. **Mask/filter conflict semantics (R5).** Ranger resolves to one winning policy by priority;
   the dispatcher unions row filters and fails closed on competing masks. §5.5 recommends
   matching the dispatcher, but this is a behavioural decision that outlives the code and
   should be signed off, not defaulted into.
3. **Were the `roles` / `validitySchedules` omissions intentional?** §4.1 and §4.3.1 are settled
   product decisions. It is still unclear whether these two are deliberate or incidental. The
   corpus says neither is causing harm today (§13.1), and Trinocular blocks both either way, so
   this gates nothing — it decides only whether each is a permanent *model rule* or a temporary
   *capability rule* in the profile (§4.6).

   *(`all` was previously in this list. It is now decided: never emitted, any path — §4.3.1.
   Whether the Rego's non-expansion was deliberate no longer matters to Trinocular, though it
   remains worth fixing in the Rego for anyone authoring policy by hand.)*
4. **Disposition of the 3 dead `function` policies** (§4.4, finding (b)). Delete, or re-express
   against `procedure`? Someone should establish what they were meant to do first.
5. **Trino connectivity for typeahead.** Does Trinocular get a Trino service account for
   `information_schema` lookups, or do we fall back to free-text entry?
6. **Backend language.** Python/FastAPI vs JVM (reuses Ranger's model and validator classes).
   §7.1 recommends Python; worth a 30-minute decision.
7. **The three non-Ranger clusters.** They run a different policy set entirely (§13.1). Out of
   scope for Trinocular as planned — confirm that is the intent rather than an oversight.

> The questions that were "cheap to answer with a `jq`" have been answered — see §13.1. The
> headline is that the corpus is **cleaner than the design assumed**: no deny policies, no
> roles, no validity schedules, no zones, and no masks to migrate. The two real problems it
> surfaced — cross-service leakage and 3 dead policies — are both pre-existing and independent
> of this project.

---

## 14. Reference index

Upstream sources this plan is derived from:

| Thing | Where |
| --- | --- |
| Trino service definition (drives the UI form) | Apache Ranger — `agents-common/src/main/resources/service-defs/ranger-servicedef-trino.json`. **Note:** the widely-deployed copy is stale vs. the current plugin — see the drift notes in §15 before treating it as the source of truth for access types |
| Sample Trino policies (canonical JSON shape) | Apache Ranger — `plugin-trino/src/test/resources/trino-policies.json` |
| Ranger policy form UX (Backbone) | Apache Ranger — `security-admin/src/main/webapp/scripts/views/policies/RangerPolicyForm.js` |
| Ranger permission-row widget | Apache Ranger — `.../scripts/views/policies/PermissionList.js` |
| Trino resource lookup (typeahead) | Apache Ranger — `plugin-trino/src/main/java/org/apache/ranger/services/trino/client/TrinoResourceManager.java` |
| Ranger export endpoint | Apache Ranger — `security-admin/src/main/java/org/apache/ranger/rest/ServiceREST.java` (`/policies/exportJson`) |
| OPA input schema (for the simulator) | Trino — `plugin/trino-opa/src/main/java/io/trino/plugin/opa/schema/` |
| Ranger plugin config (the XML, not policy data) | Trino — `plugin/trino-ranger/src/main/java/io/trino/plugin/ranger/RangerConfig.java` |

Deployment-side sources (site-specific; see the internal companion document):

| Thing | Where |
| --- | --- |
| The Rego that consumes the export | `ranger_policy.rego` |
| OPA↔Ranger field remapping | `ranger_policy_helpers.rego` |
| Known behaviour gaps vs upstream Ranger | `divergences.md` |
| Puller config (the one line to change) | the puller's config file |
| Bundler Rego version pins | the bundler manifest |

## 15. Appendix — Trino operation → access-type mapping (verified against Trino 484)

This table is the authoritative answer to *"if a data owner ticks `select`, which SQL
operations does that actually govern?"* — the human-facing grouping the access-type grid, its
tooltips, and the linter's verb model should mirror. It is extracted from the plugin that runs
inside Trino (`plugin/trino-ranger/src/main/java/io/trino/plugin/ranger/RangerSystemAccessControl.java`),
which keys every `SystemAccessControl` SPI check to exactly one access type. Verified against
`trino-root 484-SNAPSHOT`; re-verify on each Trino upgrade, because this mapping drifts (see the
drift notes below).

The principal on every check is the querying identity plus its **directory (LDAP) groups** — the
same `users` / `groups` a policy item matches. Group membership arrives on the Trino identity at
request time; how those groups are synced from a directory is deployment plumbing and out of
scope (§5.3).

| Access type | Trino operations it governs |
| --- | --- |
| `select` | `SelectFromColumns`, `CreateViewWithSelectFromColumns`, and — the deciding verb for — column masks (`getColumnMask`) and row filters (`getRowFilters`) |
| `insert` | `InsertIntoTable`, `UpdateTableColumns` |
| `delete` | `DeleteFromTable`, `TruncateTable` |
| `create` | `CreateCatalog`, `CreateSchema`, `CreateTable`, `CreateView`, `CreateMaterializedView`, `CreateFunction` |
| `drop` | `DropCatalog`, `DropSchema`, `DropTable`, `DropView`, `DropMaterializedView`, `DropFunction` |
| `alter` | `AddColumn`, `AlterColumn`, **`DropColumn`**, `RenameColumn`, `SetColumnComment`, `RenameSchema`, `RenameTable`, `RenameView`, `RenameMaterializedView`, `RefreshMaterializedView`, `RefreshView`, `SetTableComment`, `SetTableProperties`, `SetMaterializedViewProperties`, `SetViewComment`, `SetCatalogSessionProperty`, `SetSystemSessionProperty`, **`ExecuteTableProcedure`**, and every `Set{Schema,Table,View,MaterializedView}Authorization` |
| `execute` | `ExecuteQuery`, `ExecuteProcedure`, `ExecuteFunction`, **`CreateViewWithExecuteFunction`** |
| `impersonate` | `ImpersonateUser`, `ViewQueryOwnedBy`, `KillQueryOwnedBy`, `filterViewQueryOwnedBy` |
| `show` | `ShowCreateSchema`, `ShowCreateTable`, `ShowCreateFunction` |
| `read_sysinfo` | `ReadSystemInformation` — **not declared by the legacy servicedef this plan cites** (drift note 1) |
| `write_sysinfo` | `WriteSystemInformation` — same |
| *(any grant)* | `AccessCatalog`, `ShowSchemas`, `ShowTables`, `ShowColumns`, `ShowFunctions`, and every `filter*` list operation resolve to Ranger's `_any` — they succeed if the identity holds **any** access type on the resource. These are visibility / enumeration checks, not separately grantable verbs; the UI should not offer a checkbox for them. |

### Drift notes — the legacy servicedef vs. the current plugin

The service definition this plan builds the form from (`ranger-servicedef-trino.json`, §14)
declares twelve concrete access types plus `all`: `select insert create drop delete use alter
grant revoke show impersonate execute`. Against Trino 484 that list is **stale in four ways**,
and the UI/linter must account for each:

1. **Two access types are missing.** The current plugin enforces `read_sysinfo` and
   `write_sysinfo` on a `systeminformation` resource (and gates query control on a `queryid`
   resource). The legacy servicedef declares neither the types nor the resources, so a policy
   authored against it cannot grant graceful-shutdown or `/metrics` access. Adopt the current
   upstream servicedef, or add these types + resources when generating the form schema.
2. **Four declared access types are inert on the current plugin.**
   - `grant` / `revoke` — every `checkCanGrant*` / `checkCanRevoke*` / `checkCanDeny*` privilege
     check is now an empty no-op. Trino's own SQL-standard GRANT/REVOKE path no longer consults
     Ranger. (This aligns with the allow-only model — §4.1 — but means a `grant`/`revoke`
     checkbox governs nothing.)
   - `use` — no operation maps to it any more; `AccessCatalog` resolves to `_any`, not `use`.
   - `all` — present in the plugin's enum but referenced by no check, independent of the
     `impliedGrants`-expansion issue in §4.3. Trinocular already never emits `all` (§4.3.1).
   - **Consequence:** treat `grant`, `revoke`, `use`, and `all` as non-authoring verbs. Surface
     them read-only on import (so existing policies still round-trip and are visible) but do not
     offer them as grantable checkboxes; a linter rule should flag any imported policy that
     *depends* on one of them, since it grants nothing at runtime.
3. **Several verbs were re-bucketed.** `DropColumn` moved `drop → alter`; `ExecuteTableProcedure`
   moved `execute → alter`; `CreateViewWithExecuteFunction` moved `grant → execute`;
   `Set*Authorization` moved to `alter`. Any migration/linter logic that assumes the old
   bucketing will mis-report effective permissions.
4. **Roles and Iceberg branches are unenforced.** All role checks (`Create/DropRole`,
   `Grant/RevokeRoles`, `Show*Roles`) and all branch checks (`Create/Drop/FastForwardBranch`,
   `ShowBranches`) are no-ops — consistent with §4.2 (roles never matched) and requiring no UI
   surface.

### Additional upstream references

| Thing | Where |
| --- | --- |
| Access-control SPI (source of truth for what each verb gates) | Trino — `core/trino-spi/src/main/java/io/trino/spi/security/SystemAccessControl.java` |
| Operation → access-type mapping (the table above) | Trino — `plugin/trino-ranger/.../RangerSystemAccessControl.java` and `RangerTrinoAccessType.java` |
| `read_sysinfo` / `write_sysinfo` and the "required policies" set | Trino — `docs/src/main/sphinx/security/ranger-access-control.md` |
| Original open-sourcing of the trino-ranger plugin | Trino — PR `trinodb/trino#13297` |
