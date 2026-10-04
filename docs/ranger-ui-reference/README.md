# Ranger Admin policy UI — reference for Trinocular wireframes

Sources, cross-checked against each other:

- **Live Ranger 2.3 Admin** (Backbone + select2), driven with headless Chrome against a local
  instance seeded with a `trino-dev` service. Screenshots in this directory.
- **Ranger 2.3 source**: `security-admin/src/main/webapp/scripts/views/policies/`
  (`RangerPolicyForm.js`, `PermissionList.js`).
- **Apache Ranger master React UI** (`react-webapp`, @ `166f722`):
  `views/PolicyListing/AddUpdatePolicyForm.jsx`, `PolicyPermissionItem.jsx`,
  `views/Resources/ResourceComp.jsx`, `ResourceSelectComp.jsx`, `components/Editable.jsx`.

## Policy header

| Field | Ranger widget | Multi? | Notes |
|---|---|---|---|
| Policy Type | read-only badge | — | chosen by the listing tab (Access / Masking / Row Level Filter) |
| Policy ID | read-only badge | — | edit only |
| Policy Name * | text input | single | required |
| Enabled | on/off toggle beside the name | — | default on |
| Normal / Override | on/off toggle | — | `policyPriority` 0/1 |
| Policy Label | async **creatable multi** select | **multi** | free text allowed |
| Description | textarea | — | |
| Audit Logging | Yes/No toggle | — | default Yes |
| Validity Period | button → modal table (start, end, time zone) | rows | |

## Resources

One row per servicedef level: **`[resource-type select] [values] [Include/Exclude]`**.

- **Resource-type select** (single, not searchable). Options are the resources at that level
  whose parent is the resource chosen one level up; `none` is offered when the parent is a
  valid leaf. Changing it clears every deeper level. Trino (live):

  | Level | Options |
  |---|---|
  | 10 | catalog · trinouser · systemproperty · function |
  | 20 (under catalog) | none · schema · sessionproperty |
  | 30 (under schema) | none · table · procedure |
  | 40 (under table) | none · column |

  `trinouser`, `systemproperty`, `function` have no children — the form collapses to one row.
- **Values**: **creatable multi-value tag input** (select2 `tags`/react-select `CreatableSelect`).
  Multi unless the servicedef sets `uiHint {"singleValue":true}`. Free text always allowed;
  `*` is an ordinary tag. Lookup (`POST plugins/services/lookupResource/{service}`) runs on
  focus and is debounced 1000 ms in React. Space separates tags in 2.3.
- **Include/Exclude** toggle only where `excludesSupported` (catalog/schema/table/column).
  Recursive never shows for Trino.
- **Multiple resource sets** per policy ("+ Add Resource") in the React UI.
- **accessTypeRestrictions** narrow the permission choices to the deepest chosen resource:
  trinouser → impersonate · systemproperty, sessionproperty → alter ·
  function, procedure → execute, grant.

## Rule rows (Allow / Mask / Row filter)

Table, one row per policy item:
`Select Role | Select Group | Select User | Permissions | Delegate Admin | ✕` (+ drag handle).

| Column | Ranger widget | Multi? | Notes |
|---|---|---|---|
| Select Role / Group / User | async lookup select (`roles/lookup`, `xusers/lookup/groups`, `xusers/lookup/users`) | **multi** | three separate fields; React is **not creatable** (must exist in the directory) |
| Permissions | **popover checklist** + "Select/Deselect All"; ✓ apply / ✕ cancel | **multi** | saved values shown as badges + pencil; empty shows "Add Permissions +". `All` is just another box (no impliedGrants auto-tick) |
| Delegate Admin | checkbox | — | |
| Select Masking Option (mask rows) | popover **radio** list | **single** | "Custom" reveals a required expression input |
| Row Level Filter (filter rows) | popover text input | single | |

Rows: "+" adds, red ✕ removes, drag handle reorders. Sections start with one empty row.

## Listing

Tabs Access / Masking / Row Level Filter; structured `category:value` search (policy name,
label, user, group, role, status, one category per resource); columns Policy ID, Name,
Labels, Status, Audit, Roles, Groups, Users, Actions; server-side pagination (25/50/75/100).

## Where Trinocular deliberately differs

These are product decisions, not omissions (see `trinocular_claude_plan.md`):

- **Allow-only.** No "Exclude from Allow", "Deny", "Exclude from Deny" sections and no
  deny-all-else-hides-deny behaviour; `isDenyAllElse` is a plain toggle (§4.1).
- **No `all` checkbox.** The picker offers concrete verbs; "Select all" ticks the grantable
  verbs individually (§4.3.1).
- **Engine-aware choices.** The permission list is the active capability profile's grantable
  set, further narrowed by `accessTypeRestrictions`. The Roles column only appears where the
  engine matches roles (Path A); `function` is not offered as a level-10 resource on either path.
