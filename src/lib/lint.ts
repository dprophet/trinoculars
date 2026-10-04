// The §4.6 linter. Runs on every save and on import. Rules are parameterized by the
// active capability profile (§4.8): a rule that fires on both paths is a MODEL rule
// (a product decision, never lifts); one that fires only on Path B is a CAPABILITY rule
// (a Rego limitation that may lift when Workstream R lands).
//
// ruleId matches the plan §4.6 rule name exactly, so a finding on screen, a rule in the
// document, and a test all use one identifier (plan §7.5).

import type { RangerPolicy } from '@/types/ranger';
import type { CapabilityProfile } from '@/lib/capability';

export type Severity = 'error' | 'warning';
export type RuleKind = 'model' | 'capability';

export interface LintFinding {
  ruleId: string;
  severity: Severity;
  kind: RuleKind;
  message: string;
  fixLabel?: string; // presence signals a fix-it action is available
}

const ALL_TOKEN = 'all';

export function lintPolicy(policy: RangerPolicy, profile: CapabilityProfile): LintFinding[] {
  const findings: LintFinding[] = [];
  const push = (f: LintFinding) => findings.push(f);

  const allItems = [
    ...policy.policyItems,
    ...policy.dataMaskPolicyItems,
    ...policy.rowFilterPolicyItems,
  ];

  // MODEL: deny / exception lists — never authorable on any path (§4.1).
  if (
    policy.denyPolicyItems.length > 0 ||
    policy.allowExceptions.length > 0 ||
    policy.denyExceptions.length > 0
  ) {
    push({
      ruleId: 'deny-or-exception',
      severity: 'error',
      kind: 'model',
      message:
        'Deny policies and exceptions are excluded by design on every path (§4.1). This policy grants nothing until they are removed.',
      fixLabel: 'Drop deny/exception items',
    });
  }

  // MODEL: access type `all` — means different things on each path and silently widens (§4.3.1).
  const usesAll = allItems.some((it) => it.accesses.some((a) => a.type === ALL_TOKEN));
  if (usesAll) {
    push({
      ruleId: 'access-type-all',
      severity: 'error',
      kind: 'model',
      message: '`all` grants nothing on Path B and silently widens on Path A. Use the concrete verbs instead.',
      fixLabel: 'Expand `all` to concrete verbs',
    });
  }

  // CAPABILITY: roles never matched on Path B (§4.2).
  if (!profile.rolesMatched && allItems.some((it) => it.roles.length > 0)) {
    push({
      ruleId: 'roles-nonempty',
      severity: 'error',
      kind: 'capability',
      message: `Roles are never matched on ${profile.pathLabel}. A grant to a role alone authorizes no one.`,
    });
  }

  // CAPABILITY: validity schedules inert on Path B (§4.2).
  if (!profile.validitySchedulesEnforced && policy.validitySchedules.length > 0) {
    push({
      ruleId: 'validity-schedules',
      severity: 'error',
      kind: 'capability',
      message: `Validity schedules are not enforced on ${profile.pathLabel} — a false sense of expiry.`,
    });
  }

  // CAPABILITY: mask/filter policy types inert until Workstream R (§5.5).
  if (policy.policyType === 1 && !profile.masking) {
    push({
      ruleId: 'policytype-mask-unsupported',
      severity: 'error',
      kind: 'capability',
      message: `Column masking is not enforced on ${profile.pathLabel} until Workstream R lands (§5.5).`,
    });
  }
  if (policy.policyType === 2 && !profile.rowFiltering) {
    push({
      ruleId: 'policytype-rowfilter-unsupported',
      severity: 'error',
      kind: 'capability',
      message: `Row filtering is not enforced on ${profile.pathLabel} until Workstream R lands (§5.5).`,
    });
  }

  // CAPABILITY: conditionExpr on a mask not implemented by R (§4.6).
  if (
    policy.dataMaskPolicyItems.some((it) => it.dataMaskInfo?.conditionExpr?.trim())
  ) {
    push({
      ruleId: 'mask-condition-expr',
      severity: 'error',
      kind: 'capability',
      message: 'Conditional masks (`conditionExpr`) are not implemented — the mask would silently not apply.',
    });
  }

  // MODEL/both: `function` resource unreachable on B, superseded on A (§4.4).
  if (policy.resources['function']) {
    push({
      ruleId: 'function-resource',
      severity: 'error',
      kind: 'model',
      message: 'The `function` resource is unreachable on Path B and superseded upstream on Path A.',
    });
  }

  // WARNING: isExcludes:true combined with value `*` — dropped from matching on B.
  if (!profile.masking /* proxy for path B */) {
    for (const [key, res] of Object.entries(policy.resources)) {
      if (res.isExcludes && res.values.includes('*')) {
        push({
          ruleId: 'excludes-star',
          severity: 'warning',
          kind: 'capability',
          message: `Resource "${key}" excludes "*" — the Rego drops this field from matching.`,
        });
      }
    }
  }

  // WARNING: *.*.* granted to public — blast radius.
  const grantsEverythingToPublic = policy.policyItems.some(
    (it) =>
      it.groups.includes('public') &&
      (policy.resources['catalog']?.values.includes('*') ?? false),
  );
  if (grantsEverythingToPublic) {
    push({
      ruleId: 'public-wildcard',
      severity: 'warning',
      kind: 'model',
      message: 'This grants a wildcard resource to the implicit `public` group — very large blast radius.',
    });
  }

  // WARNING: Ranger's per-rule delegateAdmin — Trinocular delegates per catalog instead (§9).
  if (allItems.some((it) => it.delegateAdmin)) {
    push({
      ruleId: 'delegate-admin-item',
      severity: 'warning',
      kind: 'model',
      message:
        'A rule is marked Delegate Admin. Trinocular ignores this flag — delegate a catalog on the Catalogs screen instead.',
      fixLabel: 'Clear the flag',
    });
  }

  // WARNING: no policy items at all — dead policy.
  if (allItems.length === 0) {
    push({
      ruleId: 'no-policy-items',
      severity: 'warning',
      kind: 'model',
      message: 'This policy has no grants and authorizes nothing.',
    });
  }

  return findings;
}

export function hasBlockingErrors(findings: LintFinding[]): boolean {
  return findings.some((f) => f.severity === 'error');
}
