import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import type { RangerPolicy } from '@/types/ranger';
import {
  catalogs as fixtureCatalogs,
  fixturePolicies,
  identities,
  services,
  type CatalogEntry,
  type Identity,
  type ServiceInfo,
} from '@/data/fixtures';
import { capabilityProfiles, type CapabilityId } from '@/lib/capability';

// In-memory store only. A reload resets everything (plan §Phase 0: no persistence).

interface StoreValue {
  policies: RangerPolicy[];
  services: ServiceInfo[];
  service: string;
  setService: (s: string) => void;
  identity: Identity;
  setIdentityUser: (user: string) => void;
  identities: Identity[];
  capability: CapabilityId;
  setCapability: (c: CapabilityId) => void;
  getPolicy: (guid: string) => RangerPolicy | undefined;
  upsertPolicy: (p: RangerPolicy) => void;
  deletePolicy: (guid: string) => void;
  importPolicies: (ps: RangerPolicy[]) => void;
  catalogs: CatalogEntry[];
  // Insert or replace; `previousName` lets a rename replace the old entry.
  upsertCatalog: (c: CatalogEntry, previousName?: string) => void;
  deleteCatalog: (service: string, name: string) => void;
}

const StoreContext = createContext<StoreValue | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [policies, setPolicies] = useState<RangerPolicy[]>(fixturePolicies);
  const [service, setService] = useState<string>(services[0].name);
  const [capability, setCapability] = useState<CapabilityId>(
    services[0].capability,
  );
  const [identityUser, setIdentityUser] = useState<string>(identities[0].user);
  const [catalogs, setCatalogs] = useState<CatalogEntry[]>(fixtureCatalogs);

  const identity = useMemo(
    () => identities.find((i) => i.user === identityUser) ?? identities[0],
    [identityUser],
  );

  const value = useMemo<StoreValue>(
    () => ({
      policies,
      services,
      service,
      setService: (s) => {
        setService(s);
        const svc = services.find((x) => x.name === s);
        if (svc) setCapability(svc.capability);
      },
      identity,
      setIdentityUser,
      identities,
      capability,
      setCapability,
      getPolicy: (guid) => policies.find((p) => p.guid === guid),
      upsertPolicy: (p) =>
        setPolicies((prev) => {
          const idx = prev.findIndex((x) => x.guid === p.guid);
          if (idx === -1) return [...prev, p];
          const next = [...prev];
          next[idx] = p;
          return next;
        }),
      deletePolicy: (guid) =>
        setPolicies((prev) => prev.filter((p) => p.guid !== guid)),
      importPolicies: (ps) =>
        setPolicies((prev) => {
          const byGuid = new Map(prev.map((p) => [p.guid, p]));
          ps.forEach((p) => byGuid.set(p.guid, p));
          return [...byGuid.values()];
        }),
      catalogs,
      upsertCatalog: (c, previousName) =>
        setCatalogs((prev) => {
          const key = previousName ?? c.name;
          const rest = prev.filter((x) => !(x.service === c.service && x.name === key));
          return [...rest, c].sort((a, b) => a.name.localeCompare(b.name));
        }),
      deleteCatalog: (svc, name) =>
        setCatalogs((prev) => prev.filter((x) => !(x.service === svc && x.name === name))),
    }),
    [policies, service, identity, capability, catalogs],
  );

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore(): StoreValue {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error('useStore must be used within StoreProvider');
  return ctx;
}

export function useCapabilityProfile() {
  const { capability } = useStore();
  return capabilityProfiles[capability];
}
