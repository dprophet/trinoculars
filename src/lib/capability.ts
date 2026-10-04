// Capability profiles (plan §4.6 / §4.8). A profile is a declarative description of what
// the target enforcement engine supports. Two ship from the start:
//   - ranger-plugin : Path A, the industry-standard Apache Ranger plugin
//   - ranger-rego   : Path B, the local OPA/Rego variant
//
// Profiles describe what an engine ENFORCES, never what the product permits. Deny and `all`
// are absent from both regardless of engine support — those are product decisions (§4.1/§4.3.1).

import { trinoServiceDef } from '@/data/servicedef';

export type CapabilityId = 'ranger-plugin' | 'ranger-rego';

export interface CapabilityProfile {
  id: CapabilityId;
  label: string;
  pathLabel: string;
  description: string;
  // Masking / row filtering enforced?
  masking: boolean;
  rowFiltering: boolean;
  // Are these ever matched at runtime?
  rolesMatched: boolean;
  validitySchedulesEnforced: boolean;
  // Is the `function` resource reachable?
  functionResourceReachable: boolean;
  // Verbs that actually decide access on this engine (the grantable set the UI offers).
  grantableVerbs: string[];
  // Verbs the servicedef declares but that grant nothing on this engine (import-only).
  inertVerbs: string[];
}

// Inert verbs differ by engine — they are whatever no operation on that path maps to.
// Path A, the current trino-ranger plugin (§15): grant/revoke are no-ops, `use` maps to
// nothing, `all` is never referenced by a check.
const PLUGIN_INERT = ['grant', 'revoke', 'use', 'all'];
// Path B, trino-opa + the Ranger rego action map: AccessCatalog → use; Set*Authorization and
// CreateViewWithExecuteFunction → grant. Only `revoke` (privilege grants never reach OPA)
// and `all` (never expanded) grant nothing.
const REGO_INERT = ['revoke', 'all'];

const allDeclaredVerbs = trinoServiceDef.accessTypes.map((a) => a.name);
const grantableExcept = (inert: string[]) => allDeclaredVerbs.filter((v) => !inert.includes(v));

export const capabilityProfiles: Record<CapabilityId, CapabilityProfile> = {
  'ranger-plugin': {
    id: 'ranger-plugin',
    label: 'Apache Ranger plugin',
    pathLabel: 'Path A',
    description:
      'The industry-standard trino-ranger plugin, evaluated in-process by Trino. Enforces masking and row filtering natively. Grant/revoke/use/all are inert on the current plugin (§15).',
    masking: true,
    rowFiltering: true,
    rolesMatched: true,
    validitySchedulesEnforced: true,
    functionResourceReachable: false, // superseded upstream (§4.4)
    grantableVerbs: grantableExcept(PLUGIN_INERT),
    inertVerbs: PLUGIN_INERT,
  },
  'ranger-rego': {
    id: 'ranger-rego',
    label: 'OPA / Rego',
    pathLabel: 'Path B',
    description:
      'The local OPA variant (puller → bundler → OPA → trino-opa). Masking and row filtering require Workstream R (§5.5). Roles and validity schedules are never matched.',
    masking: false, // until Workstream R lands
    rowFiltering: false,
    rolesMatched: false,
    validitySchedulesEnforced: false,
    functionResourceReachable: false, // unreachable on Path B (§4.4)
    grantableVerbs: grantableExcept(REGO_INERT),
    inertVerbs: REGO_INERT,
  },
};

export const DEFAULT_CAPABILITY: CapabilityId = 'ranger-rego';
