// The policy simulator (plan §8). Allow-only, union semantics: access exists if some
// enabled access policy (policyType 0) grants the requested verb to the identity or one of
// its groups on a matching resource. Default is deny. isDenyAllElse does not change a
// positive result — it only formalizes "these grants and nothing else" (§4.1).
//
// This mirrors the Path B evaluation shape closely enough for design review; the real
// simulator runs the actual OPA bundle (plan §8).

import type { RangerPolicy } from '@/types/ranger';

export interface SimIdentity {
  user: string;
  groups: string[];
}

export interface SimResource {
  catalog?: string;
  schema?: string;
  table?: string;
  column?: string;
}

export interface SimRequest {
  identity: SimIdentity;
  operation: string; // a concrete verb, e.g. "select"
  resource: SimResource;
}

export interface SimResult {
  allowed: boolean;
  decidingPolicyGuid?: string;
  decidingPolicyName?: string;
  reason: string;
  matchedButNotGranted: string[]; // guids that matched the resource but did not grant the verb
  denyAllElseCovered: boolean;
}

// Glob match supporting exact, "*", and trailing "prefix*".
function valueMatches(patterns: string[], value: string | undefined): boolean {
  if (value === undefined) return true; // level not requested → matches
  return patterns.some((p) => {
    if (p === '*') return true;
    if (p.endsWith('*')) return value.startsWith(p.slice(0, -1));
    return p === value;
  });
}

const LEVELS: (keyof SimResource)[] = ['catalog', 'schema', 'table', 'column'];

function resourceMatches(policy: RangerPolicy, req: SimResource): boolean {
  for (const level of LEVELS) {
    const res = policy.resources[level];
    if (!res) continue; // policy doesn't constrain this level → matches anything
    const matched = valueMatches(res.values, req[level]);
    const effective = res.isExcludes ? !matched : matched;
    if (!effective) return false;
  }
  return true;
}

function identityMatches(users: string[], groups: string[], id: SimIdentity): boolean {
  if (users.includes(id.user)) return true;
  if (groups.includes('public')) return true; // implicit for every user
  return groups.some((g) => id.groups.includes(g));
}

export function simulate(policies: RangerPolicy[], req: SimRequest): SimResult {
  const matchedButNotGranted: string[] = [];
  let denyAllElseCovered = false;

  for (const policy of policies) {
    if (!policy.isEnabled) continue;
    if (policy.policyType !== 0) continue;
    if (!resourceMatches(policy, req.resource)) continue;

    if (policy.isDenyAllElse) denyAllElseCovered = true;

    let grantedHere = false;
    for (const item of policy.policyItems) {
      const grantsVerb = item.accesses.some(
        (a) => a.isAllowed && (a.type === req.operation || a.type === 'all'),
      );
      if (grantsVerb && identityMatches(item.users, item.groups, req.identity)) {
        grantedHere = true;
        break;
      }
    }

    if (grantedHere) {
      return {
        allowed: true,
        decidingPolicyGuid: policy.guid,
        decidingPolicyName: policy.name,
        reason: `Granted by "${policy.name}" — ${req.identity.user} (or a group) has ${req.operation} on the matching resource.`,
        matchedButNotGranted,
        denyAllElseCovered,
      };
    }
    matchedButNotGranted.push(policy.guid);
  }

  return {
    allowed: false,
    reason: denyAllElseCovered
      ? 'Denied — a matching policy sets "deny all else" and no grant applies to this identity.'
      : 'Denied by default — no policy grants this verb to this identity on this resource (allow-only model).',
    matchedButNotGranted,
    denyAllElseCovered,
  };
}
