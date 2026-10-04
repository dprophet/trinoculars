// Fixture data in the real RangerPolicy shape (plan §Phase 0). Debranded: generic catalog
// names (hive, iceberg, pg), generic groups (analysts, data-eng, finance, public) and users
// (alice, bob, carol). Includes at least one instance of every §4.6 lint violation so the
// linter panel can be demonstrated rather than described.

import type { RangerPolicy } from '@/types/ranger';

export const SERVICE = 'trino-prod';

export interface ServiceInfo {
  name: string;
  label: string;
  cluster: string;
  capability: 'ranger-plugin' | 'ranger-rego';
}

export const services: ServiceInfo[] = [
  { name: 'trino-prod', label: 'Trino — Production', cluster: 'prod-east', capability: 'ranger-rego' },
  { name: 'trino-analytics', label: 'Trino — Analytics', cluster: 'prod-west', capability: 'ranger-rego' },
  { name: 'trino-eng', label: 'Trino — Engineering', cluster: 'dev-eng', capability: 'ranger-plugin' },
];

function base(over: Partial<RangerPolicy> & Pick<RangerPolicy, 'id' | 'guid' | 'name'>): RangerPolicy {
  return {
    service: SERVICE,
    serviceType: 'trino',
    policyType: 0,
    policyPriority: 0,
    description: '',
    isAuditEnabled: true,
    isEnabled: true,
    isDenyAllElse: false,
    version: 1,
    zoneName: '',
    resources: {},
    policyItems: [],
    denyPolicyItems: [],
    allowExceptions: [],
    denyExceptions: [],
    dataMaskPolicyItems: [],
    rowFilterPolicyItems: [],
    validitySchedules: [],
    policyLabels: [],
    options: {},
    ...over,
  };
}

export const fixturePolicies: RangerPolicy[] = [
  // 1. Clean happy-path SELECT grant.
  base({
    id: 1,
    guid: '7ab96b62-6fd3-4193-bf49-af462c25784d',
    name: 'analysts read sales orders',
    description: 'Analysts can read the orders table.',
    resources: {
      catalog: { values: ['hive'], isExcludes: false, isRecursive: false },
      schema: { values: ['sales'], isExcludes: false, isRecursive: false },
      table: { values: ['orders'], isExcludes: false, isRecursive: false },
      column: { values: ['*'], isExcludes: false, isRecursive: false },
    },
    policyItems: [
      {
        accesses: [
          { type: 'select', isAllowed: true },
          { type: 'show', isAllowed: true },
        ],
        users: [],
        groups: ['analysts'],
        roles: [],
        conditions: [],
        delegateAdmin: false,
      },
    ],
    policyLabels: ['sales'],
  }),

  // 2. isDenyAllElse lockdown (the allow-only answer to "lock this down").
  base({
    id: 2,
    guid: 'b2c1a0f9-1111-4222-8333-444455556666',
    name: 'finance schema lockdown',
    description: 'Only finance may touch the finance schema; deny-all-else.',
    isDenyAllElse: true,
    resources: {
      catalog: { values: ['iceberg'], isExcludes: false, isRecursive: false },
      schema: { values: ['finance'], isExcludes: false, isRecursive: false },
      table: { values: ['*'], isExcludes: false, isRecursive: false },
      column: { values: ['*'], isExcludes: false, isRecursive: false },
    },
    policyItems: [
      {
        accesses: [
          { type: 'select', isAllowed: true },
          { type: 'insert', isAllowed: true },
        ],
        users: [],
        groups: ['finance'],
        roles: [],
        conditions: [],
        delegateAdmin: false,
      },
    ],
  }),

  // 3. Column mask (policyType 1).
  base({
    id: 3,
    guid: 'c3d2e1f0-2222-4333-8444-555566667777',
    name: 'mask customer email',
    description: 'Show only the last 4 characters of email to analysts.',
    policyType: 1,
    resources: {
      catalog: { values: ['hive'], isExcludes: false, isRecursive: false },
      schema: { values: ['sales'], isExcludes: false, isRecursive: false },
      table: { values: ['customers'], isExcludes: false, isRecursive: false },
      column: { values: ['email'], isExcludes: false, isRecursive: false },
    },
    dataMaskPolicyItems: [
      {
        accesses: [{ type: 'select', isAllowed: true }],
        users: [],
        groups: ['analysts'],
        roles: [],
        conditions: [],
        delegateAdmin: false,
        dataMaskInfo: { dataMaskType: 'MASK_SHOW_LAST_4' },
      },
    ],
  }),

  // 4. Row filter (policyType 2).
  base({
    id: 4,
    guid: 'd4e3f2a1-3333-4444-8555-666677778888',
    name: 'row filter orders by region',
    description: 'Analysts see only EMEA rows.',
    policyType: 2,
    resources: {
      catalog: { values: ['hive'], isExcludes: false, isRecursive: false },
      schema: { values: ['sales'], isExcludes: false, isRecursive: false },
      table: { values: ['orders'], isExcludes: false, isRecursive: false },
    },
    rowFilterPolicyItems: [
      {
        accesses: [{ type: 'select', isAllowed: true }],
        users: [],
        groups: ['analysts'],
        roles: [],
        conditions: [],
        delegateAdmin: false,
        rowFilterInfo: { filterExpr: "region = 'EMEA'" },
      },
    ],
  }),

  // 5. Uses `all` (LINT: access-type-all) — but with concrete verbs alongside (benign in corpus).
  base({
    id: 5,
    guid: 'e5f4a3b2-4444-4555-8666-777788889999',
    name: 'data-eng full access staging',
    description: 'Data engineering owns the staging schema.',
    resources: {
      catalog: { values: ['hive'], isExcludes: false, isRecursive: false },
      schema: { values: ['staging'], isExcludes: false, isRecursive: false },
      table: { values: ['*'], isExcludes: false, isRecursive: false },
      column: { values: ['*'], isExcludes: false, isRecursive: false },
    },
    policyItems: [
      {
        accesses: [
          { type: 'all', isAllowed: true },
          { type: 'select', isAllowed: true },
          { type: 'insert', isAllowed: true },
          { type: 'create', isAllowed: true },
          { type: 'drop', isAllowed: true },
        ],
        users: [],
        groups: ['data-eng'],
        roles: [],
        conditions: [],
        delegateAdmin: true,
      },
    ],
  }),

  // 6. Deny items present (LINT: deny-or-exception) — imported, grants nothing.
  base({
    id: 6,
    guid: 'f6a5b4c3-5555-4666-8777-888899990000',
    name: 'legacy deny pii (imported)',
    description: 'Imported from a legacy Ranger export; uses deny items.',
    resources: {
      catalog: { values: ['hive'], isExcludes: false, isRecursive: false },
      schema: { values: ['sales'], isExcludes: false, isRecursive: false },
      table: { values: ['customers'], isExcludes: false, isRecursive: false },
      column: { values: ['ssn'], isExcludes: false, isRecursive: false },
    },
    policyItems: [
      {
        accesses: [{ type: 'select', isAllowed: true }],
        users: [],
        groups: ['finance'],
        roles: [],
        conditions: [],
        delegateAdmin: false,
      },
    ],
    denyPolicyItems: [
      {
        accesses: [{ type: 'select', isAllowed: true }],
        users: [],
        groups: ['contractors'],
        roles: [],
        conditions: [],
        delegateAdmin: false,
      },
    ],
  }),

  // 7. Roles non-empty (LINT: roles-nonempty).
  base({
    id: 7,
    guid: 'a7b6c5d4-6666-4777-8888-999900001111',
    name: 'reporting role grant',
    description: 'Grants to a role — never matched on Path B.',
    resources: {
      catalog: { values: ['pg'], isExcludes: false, isRecursive: false },
      schema: { values: ['reporting'], isExcludes: false, isRecursive: false },
      table: { values: ['*'], isExcludes: false, isRecursive: false },
      column: { values: ['*'], isExcludes: false, isRecursive: false },
    },
    policyItems: [
      {
        accesses: [{ type: 'select', isAllowed: true }],
        users: [],
        groups: [],
        roles: ['report_reader'],
        conditions: [],
        delegateAdmin: false,
      },
    ],
  }),

  // 8. Validity schedules (LINT: validity-schedules).
  base({
    id: 8,
    guid: 'b8c7d6e5-7777-4888-8999-000011112222',
    name: 'temp access with expiry',
    description: 'Has a validity schedule — inert on Path B.',
    resources: {
      catalog: { values: ['hive'], isExcludes: false, isRecursive: false },
      schema: { values: ['sales'], isExcludes: false, isRecursive: false },
      table: { values: ['promotions'], isExcludes: false, isRecursive: false },
      column: { values: ['*'], isExcludes: false, isRecursive: false },
    },
    policyItems: [
      {
        accesses: [{ type: 'select', isAllowed: true }],
        users: ['bob'],
        groups: [],
        roles: [],
        conditions: [],
        delegateAdmin: false,
      },
    ],
    validitySchedules: [{ startTime: '2026-01-01 00:00:00', endTime: '2026-03-31 00:00:00', timeZone: 'UTC' }],
  }),

  // 9. function resource (LINT: function-resource).
  base({
    id: 9,
    guid: 'c9d8e7f6-8888-4999-8000-111122223333',
    name: 'function grant (dead)',
    description: 'Uses the function resource — unreachable on Path B.',
    resources: {
      function: { values: ['my_udf'], isExcludes: false, isRecursive: false },
    },
    policyItems: [
      {
        accesses: [{ type: 'execute', isAllowed: true }],
        users: [],
        groups: ['data-eng'],
        roles: [],
        conditions: [],
        delegateAdmin: false,
      },
    ],
  }),

  // 10. isExcludes:true with '*' (LINT: excludes-star warning).
  base({
    id: 10,
    guid: 'd0e9f8a7-9999-4000-8111-222233334444',
    name: 'exclude-all misuse',
    description: 'Excludes "*" on the table level — dropped from matching.',
    resources: {
      catalog: { values: ['hive'], isExcludes: false, isRecursive: false },
      schema: { values: ['sales'], isExcludes: false, isRecursive: false },
      table: { values: ['*'], isExcludes: true, isRecursive: false },
      column: { values: ['*'], isExcludes: false, isRecursive: false },
    },
    policyItems: [
      {
        accesses: [{ type: 'select', isAllowed: true }],
        users: [],
        groups: ['analysts'],
        roles: [],
        conditions: [],
        delegateAdmin: false,
      },
    ],
  }),

  // 11. *.*.* to public (LINT: public-wildcard warning).
  base({
    id: 11,
    guid: 'e1f0a9b8-0000-4111-8222-333344445555',
    name: 'public catalog visibility',
    description: 'Grants a wildcard to public — big blast radius.',
    resources: {
      catalog: { values: ['*'], isExcludes: false, isRecursive: false },
      schema: { values: ['*'], isExcludes: false, isRecursive: false },
      table: { values: ['*'], isExcludes: false, isRecursive: false },
      column: { values: ['*'], isExcludes: false, isRecursive: false },
    },
    policyItems: [
      {
        accesses: [
          { type: 'select', isAllowed: true },
          { type: 'show', isAllowed: true },
          { type: 'use', isAllowed: true },
        ],
        users: [],
        groups: ['public'],
        roles: [],
        conditions: [],
        delegateAdmin: false,
      },
    ],
  }),

  // 12. No policy items (LINT: no-policy-items warning).
  base({
    id: 12,
    guid: 'f2a1b0c9-1111-4222-8333-444455556677',
    name: 'empty dead policy',
    description: 'No grants at all.',
    isEnabled: false,
    resources: {
      catalog: { values: ['hive'], isExcludes: false, isRecursive: false },
      schema: { values: ['scratch'], isExcludes: false, isRecursive: false },
      table: { values: ['*'], isExcludes: false, isRecursive: false },
      column: { values: ['*'], isExcludes: false, isRecursive: false },
    },
  }),

  // 13. Impersonate self (trinouser resource) — a required baseline policy.
  base({
    id: 13,
    guid: 'a3b2c1d0-2222-4333-8444-555566667788',
    name: 'users impersonate self',
    description: 'Every user may impersonate themselves (required for query execution).',
    resources: {
      trinouser: { values: ['{USER}'], isExcludes: false, isRecursive: false },
    },
    policyItems: [
      {
        accesses: [{ type: 'impersonate', isAllowed: true }],
        users: ['{USER}'],
        groups: [],
        roles: [],
        conditions: [],
        delegateAdmin: false,
      },
    ],
  }),
];

// ---- Revisions (for policy #1) ----
export interface Revision {
  policyGuid: string;
  version: number;
  changedBy: string;
  changedAt: string;
  note: string;
  body: RangerPolicy;
}

const p1v1: RangerPolicy = { ...fixturePolicies[0], version: 1, policyItems: [{ ...fixturePolicies[0].policyItems[0], accesses: [{ type: 'select', isAllowed: true }] }] };
export const revisions: Revision[] = [
  { policyGuid: fixturePolicies[0].guid, version: 1, changedBy: 'carol', changedAt: '2026-08-01T10:12:00Z', note: 'Initial grant: analysts SELECT on orders', body: p1v1 },
  { policyGuid: fixturePolicies[0].guid, version: 2, changedBy: 'alice', changedAt: '2026-08-14T15:40:00Z', note: 'Added SHOW so analysts can list the table', body: fixturePolicies[0] },
];

// ---- Audit log ----
export interface AuditEntry {
  id: string;
  at: string;
  actor: string;
  action: 'create' | 'update' | 'delete' | 'import' | 'revert';
  policyName: string;
  policyGuid: string;
  note: string;
}
export const auditLog: AuditEntry[] = [
  { id: 'au-1', at: '2026-09-12T09:01:00Z', actor: 'alice', action: 'update', policyName: 'analysts read sales orders', policyGuid: fixturePolicies[0].guid, note: 'Added SHOW verb' },
  { id: 'au-2', at: '2026-09-11T16:22:00Z', actor: 'carol', action: 'create', policyName: 'mask customer email', policyGuid: fixturePolicies[2].guid, note: 'New column mask' },
  { id: 'au-3', at: '2026-09-10T11:03:00Z', actor: 'bob', action: 'import', policyName: 'legacy deny pii (imported)', policyGuid: fixturePolicies[5].guid, note: 'Imported legacy export — 1 refusal' },
  { id: 'au-4', at: '2026-09-09T14:47:00Z', actor: 'carol', action: 'delete', policyName: 'old temp grant', policyGuid: 'deleted-guid', note: 'Expired manual grant removed' },
];

// ---- Catalogs and their delegate admins (§9) ----
// Delegation is per catalog: a delegate admin may create and edit any policy whose catalog
// resource names this catalog. Enforced by Trinocular when a policy is saved — never by Trino.
export interface DelegateAdmins {
  users: string[];
  groups: string[];
}
export interface CatalogEntry {
  service: string;
  name: string;
  description: string;
  admins: DelegateAdmins;
}
export const catalogs: CatalogEntry[] = [
  { service: SERVICE, name: 'hive', description: 'Sales and staging data on HDFS', admins: { users: [], groups: ['sales-owners'] } },
  { service: SERVICE, name: 'iceberg', description: 'Finance ledger tables', admins: { users: [], groups: ['finance-owners'] } },
  { service: SERVICE, name: 'pg', description: 'Reporting replica', admins: { users: ['erin'], groups: [] } },
  { service: SERVICE, name: 'tpch', description: 'Built-in TPC-H test data', admins: { users: [], groups: [] } },
];

// ---- Saved simulator cases (§8) ----
export interface SimCase {
  id: string;
  label: string;
  user: string;
  groups: string[];
  operation: string;
  catalog: string;
  schema: string;
  table: string;
  column: string;
  expected: 'allow' | 'deny';
}
export const simCases: SimCase[] = [
  { id: 'sc-1', label: 'analyst reads orders', user: 'alice', groups: ['analysts'], operation: 'select', catalog: 'hive', schema: 'sales', table: 'orders', column: 'total', expected: 'allow' },
  { id: 'sc-2', label: 'analyst writes orders (should deny)', user: 'alice', groups: ['analysts'], operation: 'insert', catalog: 'hive', schema: 'sales', table: 'orders', column: '', expected: 'deny' },
  { id: 'sc-3', label: 'contractor reads finance (deny-all-else)', user: 'dave', groups: ['contractors'], operation: 'select', catalog: 'iceberg', schema: 'finance', table: 'ledger', column: 'amount', expected: 'deny' },
  { id: 'sc-4', label: 'data-eng creates in staging', user: 'bob', groups: ['data-eng'], operation: 'create', catalog: 'hive', schema: 'staging', table: 'tmp', column: '', expected: 'allow' },
];

// ---- Identities the "logged in as" switcher offers (§18) ----
export interface Identity {
  user: string;
  role: 'GLOBAL_ADMIN' | 'CATALOG_ADMIN' | 'VIEWER';
  groups: string[];
}
export const identities: Identity[] = [
  { user: 'alice', role: 'GLOBAL_ADMIN', groups: ['analysts'] },
  { user: 'carol', role: 'CATALOG_ADMIN', groups: ['sales-owners'] },
  { user: 'bob', role: 'VIEWER', groups: ['data-eng'] },
];

// ---- Directory (stands in for Ranger's xusers/lookup and roles/lookup endpoints) ----
// Principals must exist in the directory; Ranger's React UI does not accept free text here.
export const directory = {
  users: ['alice', 'bob', 'carol', 'dave', 'erin', '{USER}'],
  groups: ['analysts', 'contractors', 'data-eng', 'finance', 'finance-owners', 'public', 'sales-owners'],
  roles: ['report_reader', 'etl_writer'],
};

// ---- Resource lookup (stands in for POST plugins/services/lookupResource/{service}) ----
// Keyed by resource name; child values are keyed by the parent value.
export const resourceLookup: Record<string, Record<string, string[]>> = {
  catalog: { '': ['hive', 'iceberg', 'memory', 'pg', 'system', 'tpch'] },
  schema: {
    hive: ['sales', 'scratch', 'staging'],
    iceberg: ['finance'],
    memory: ['default'],
    pg: ['reporting'],
    tpch: ['tiny', 'sf1', 'sf100'],
  },
  table: {
    sales: ['customers', 'orders', 'promotions'],
    tiny: ['customer', 'lineitem', 'nation', 'orders', 'part', 'partsupp', 'region', 'supplier'],
    finance: ['ledger'],
  },
  column: {
    lineitem: ['orderkey', 'partkey', 'suppkey', 'quantity', 'extendedprice', 'discount', 'tax', 'shipdate', 'shipmode'],
    orders: ['orderkey', 'custkey', 'orderstatus', 'totalprice', 'orderdate'],
    customers: ['id', 'name', 'email', 'ssn'],
  },
};
