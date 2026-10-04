// The canonical stored object is the Ranger RangerPolicy, stored natively (plan §6).
// Trinocular authors only the allow-only subset; the deny/exception fields exist in the
// type purely so an imported export round-trips and the linter can flag them (§4.1).

export type PolicyType = 0 | 1 | 2; // 0 = access, 1 = data mask, 2 = row filter

export interface RangerResource {
  values: string[];
  isExcludes: boolean;
  isRecursive: boolean;
}

export type ResourceMap = Record<string, RangerResource>;

export interface RangerAccess {
  type: string; // e.g. "select"
  isAllowed: boolean;
}

export interface DataMaskInfo {
  dataMaskType: string; // e.g. "MASK_SHOW_LAST_4" | "CUSTOM"
  conditionExpr?: string; // unsupported on Path B (§4.6) — flagged by linter
  valueExpr?: string; // for CUSTOM
}

export interface RowFilterInfo {
  filterExpr: string;
}

export interface PolicyItem {
  accesses: RangerAccess[];
  users: string[];
  groups: string[];
  roles: string[]; // never matched on Path B (§4.2) — linter flags non-empty
  conditions: unknown[];
  delegateAdmin: boolean;
}

export interface DataMaskPolicyItem extends PolicyItem {
  dataMaskInfo: DataMaskInfo;
}

export interface RowFilterPolicyItem extends PolicyItem {
  rowFilterInfo: RowFilterInfo;
}

export interface RangerPolicy {
  id: number;
  guid: string;
  service: string;
  serviceType: 'trino';
  name: string;
  policyType: PolicyType;
  policyPriority: number;
  description: string;
  isAuditEnabled: boolean;
  isEnabled: boolean;
  isDenyAllElse: boolean;
  version: number;
  zoneName: string;
  resources: ResourceMap;
  policyItems: PolicyItem[];
  denyPolicyItems: PolicyItem[]; // always [] when authored here (§4.1)
  allowExceptions: PolicyItem[]; // always []
  denyExceptions: PolicyItem[]; // always []
  dataMaskPolicyItems: DataMaskPolicyItem[];
  rowFilterPolicyItems: RowFilterPolicyItem[];
  validitySchedules: unknown[]; // inert on Path B (§4.2)
  policyLabels: string[];
  options: Record<string, unknown>;
}

// ---- Service definition (drives the resource cascade + access-type grid) ----

export interface ServiceDefResource {
  name: string;
  level: number;
  parent: string;
  label: string;
  lookupSupported: boolean;
  recursiveSupported: boolean;
  excludesSupported: boolean;
  mandatory: boolean;
  description: string;
  // A policy may stop at this resource; children then offer "none" (Ranger isValidLeaf).
  isValidLeaf?: boolean;
  // When this is the deepest chosen resource, only these verbs may be granted.
  accessTypeRestrictions?: string[];
}

export interface ServiceDefAccessType {
  name: string;
  label: string;
  impliedGrants: string[];
}

export interface ServiceDefMaskType {
  name: string;
  label: string;
  transformer: string;
}

export interface TrinoServiceDef {
  name: string;
  resources: ServiceDefResource[];
  accessTypes: ServiceDefAccessType[];
  maskTypes: ServiceDefMaskType[];
  maskResources: string[];
  rowFilterResources: string[];
}
