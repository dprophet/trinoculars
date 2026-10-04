// Catalog-level delegation (§9). A principal administers a catalog's policies when they are
// named as a delegate admin of it, directly or through one of their groups. Global admins
// administer everything, including policies on catalog `*`, which no delegate admin covers.

import type { CatalogEntry, Identity } from '@/data/fixtures';
import type { RangerPolicy } from '@/types/ranger';

export function isDelegateAdmin(catalog: CatalogEntry, identity: Identity): boolean {
  return (
    catalog.admins.users.includes(identity.user) ||
    catalog.admins.groups.some((g) => identity.groups.includes(g))
  );
}

export function catalogsAdministeredBy(catalogs: CatalogEntry[], identity: Identity, service: string): string[] {
  return catalogs.filter((c) => c.service === service && isDelegateAdmin(c, identity)).map((c) => c.name);
}

// Policies that name a catalog (exactly — wildcards belong to global admins).
export function policiesInCatalog(policies: RangerPolicy[], service: string, catalog: string): RangerPolicy[] {
  return policies.filter((p) => p.service === service && p.resources['catalog']?.values.includes(catalog));
}
