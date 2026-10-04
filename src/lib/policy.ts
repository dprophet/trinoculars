import type { PolicyItem, RangerPolicy, ResourceMap } from '@/types/ranger';
import { maskFilterAccessTypes, resourceChain, trinoServiceDef } from '@/data/servicedef';
import type { CapabilityProfile } from '@/lib/capability';

let guidCounter = 1000;
export function newGuid(): string {
  guidCounter += 1;
  // Deterministic pseudo-guid — good enough for a wireframe, stable within a session.
  return `wf-${guidCounter.toString(16)}-0000-4000-8000-${Date.now().toString(16)}`;
}

export function emptyPolicyItem(): PolicyItem {
  return { accesses: [], users: [], groups: [], roles: [], conditions: [], delegateAdmin: false };
}

export function emptyPolicy(service: string): RangerPolicy {
  return {
    id: 0,
    guid: newGuid(),
    service,
    serviceType: 'trino',
    name: '',
    policyType: 0,
    policyPriority: 0,
    description: '',
    isAuditEnabled: true,
    isEnabled: true,
    isDenyAllElse: false,
    version: 1,
    zoneName: '',
    resources: {},
    policyItems: [emptyPolicyItem()],
    denyPolicyItems: [],
    allowExceptions: [],
    denyExceptions: [],
    dataMaskPolicyItems: [],
    rowFilterPolicyItems: [],
    validitySchedules: [],
    policyLabels: [],
    options: {},
  };
}

// Render a resource map as a Trino-vocabulary path, e.g. "hive.sales.orders.email".
export function resourcePath(resources: ResourceMap): string {
  const parts: string[] = [];
  for (const key of resourceChain) {
    const r = resources[key];
    if (!r) break;
    const val = r.values.join(', ');
    parts.push(r.isExcludes ? `!(${val})` : val);
  }
  // Non-hierarchical resources (trinouser, systemproperty, ...) shown separately.
  const extras = Object.keys(resources).filter(
    (k) => !(resourceChain as readonly string[]).includes(k),
  );
  const base = parts.join('.');
  if (extras.length === 0) return base || '—';
  const extraStr = extras.map((k) => `${k}=${resources[k].values.join(', ')}`).join(' ');
  return base ? `${base}  (${extraStr})` : extraStr;
}

export function policyTypeLabel(t: number): string {
  return t === 1 ? 'Column mask' : t === 2 ? 'Row filter' : 'Access';
}

// Distinct verbs granted across a policy's items, for the list view.
export function grantedVerbs(policy: RangerPolicy): string[] {
  const set = new Set<string>();
  policy.policyItems.forEach((it) => it.accesses.forEach((a) => a.isAllowed && set.add(a.type)));
  return [...set];
}

export function principals(policy: RangerPolicy): string[] {
  const set = new Set<string>();
  policy.policyItems.forEach((it) => {
    it.users.forEach((u) => set.add(u));
    it.groups.forEach((g) => set.add(`@${g}`));
  });
  return [...set];
}

// Verbs a rule in this policy may grant: the engine's grantable set, narrowed by the
// accessTypeRestrictions of the deepest chosen resource (as Ranger does). Mask and row-filter
// rules may only carry `select`.
// `resourceTypes` is the resource chosen at each level (it may not have values yet); without
// it, the resources that have values are used.
export function permittedVerbs(policy: RangerPolicy, profile: CapabilityProfile, resourceTypes?: string[]): string[] {
  if (policy.policyType !== 0) return maskFilterAccessTypes;
  const names = resourceTypes ?? Object.keys(policy.resources);
  const chosen = trinoServiceDef.resources.filter((r) => names.includes(r.name));
  const deepest = chosen.sort((a, b) => b.level - a.level)[0];
  const restriction = deepest?.accessTypeRestrictions;
  return profile.grantableVerbs.filter((v) => !restriction || restriction.includes(v));
}
