import { useEffect, useState } from 'react';
import { Stack, Group, Select, TagsInput, Switch, Text, Code, Box } from '@mantine/core';
import type { PolicyType, ResourceMap, ServiceDefResource } from '@/types/ranger';
import { trinoServiceDef } from '@/data/servicedef';
import { resourceLookup } from '@/data/fixtures';
import { resourcePath } from '@/lib/policy';
import { tid } from '@/lib/testid';

// Ranger's resource block (docs/ranger-ui-reference): one row per servicedef level,
//   [resource-type select] [multi-value tag input] [Include/Exclude]
// The type select offers the resources whose parent is the one chosen a level up, plus
// "none" where the parent is a valid leaf. Values are creatable tags; `*` is an ordinary
// value. `function` is never offered — it is dead on both paths (§4.4).

const NONE = 'none';

function candidates(policyType: PolicyType): ServiceDefResource[] {
  const all = trinoServiceDef.resources.filter((r) => r.name !== 'function');
  if (policyType === 1) return all.filter((r) => trinoServiceDef.maskResources.includes(r.name));
  if (policyType === 2) return all.filter((r) => trinoServiceDef.rowFilterResources.includes(r.name));
  return all;
}

function optionsUnder(parent: string, pool: ServiceDefResource[]): string[] {
  const children = pool.filter((r) => r.parent === parent).map((r) => r.name);
  if (children.length === 0) return [];
  const parentDef = pool.find((r) => r.name === parent);
  return parentDef?.isValidLeaf ? [NONE, ...children] : children;
}

// Follow the first concrete child down from `chain`'s last entry (Ranger's default on change).
function extendWithDefaults(chain: string[], pool: ServiceDefResource[]): string[] {
  const out = [...chain];
  for (;;) {
    const last = out[out.length - 1];
    if (last === NONE) return out;
    const next = optionsUnder(last, pool).find((o) => o !== NONE);
    if (!next) return out;
    out.push(next);
  }
}

// Recover the chain from an existing resource map; fill the rest with defaults.
function initialChain(resources: ResourceMap, pool: ServiceDefResource[]): string[] {
  const chain: string[] = [];
  let parent = '';
  for (;;) {
    const opts = optionsUnder(parent, pool);
    if (opts.length === 0) return chain;
    const picked = opts.find((o) => o !== NONE && resources[o]);
    if (picked) {
      chain.push(picked);
      parent = picked;
      continue;
    }
    const firstConcrete = opts.find((o) => o !== NONE)!;
    // A new policy gets the default chain; an existing one that stops here shows "none".
    if (Object.keys(resources).length > 0 && opts.includes(NONE)) return [...chain, NONE];
    return extendWithDefaults([...chain, firstConcrete], pool);
  }
}

export function ResourceSelector({
  resources,
  onChange,
  onTypesChange,
  policyType = 0,
  screen = 'policy-edit',
}: {
  resources: ResourceMap;
  onChange: (next: ResourceMap) => void;
  // The chosen resource type per level (before any values are entered) — the permission
  // choices depend on it, as in Ranger.
  onTypesChange?: (types: string[]) => void;
  policyType?: PolicyType;
  screen?: string;
}) {
  const pool = candidates(policyType);
  const [chain, setChain] = useState<string[]>(() => initialChain(resources, pool));
  useEffect(() => {
    onTypesChange?.(chain.filter((n) => n !== NONE));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chain]);

  const changeType = (index: number, name: string) => {
    const nextChain = extendWithDefaults([...chain.slice(0, index), name], pool);
    setChain(nextChain);
    // Changing a level clears every deeper level (Ranger behaviour); keep values that survive.
    const next: ResourceMap = {};
    nextChain.forEach((n) => {
      if (n !== NONE && resources[n]) next[n] = resources[n];
    });
    onChange(next);
  };

  const setValues = (name: string, values: string[]) => {
    const next: ResourceMap = { ...resources };
    if (values.length === 0) delete next[name];
    else next[name] = { values, isExcludes: resources[name]?.isExcludes ?? false, isRecursive: false };
    onChange(next);
  };

  const setExcludes = (name: string, isExcludes: boolean) => {
    const existing = resources[name];
    if (!existing) return;
    onChange({ ...resources, [name]: { ...existing, isExcludes } });
  };

  const rows = chain.filter((n) => n !== NONE);

  return (
    <Stack gap="sm">
      {chain.map((name, index) => {
        const parent = index === 0 ? '' : chain[index - 1];
        if (parent === NONE) return null;
        const opts = optionsUnder(parent, pool);
        const def = pool.find((r) => r.name === name);
        const level = def?.level ?? (index + 1) * 10;
        const parentValue = index === 0 ? '' : resources[parent]?.values[0] ?? '';
        const suggestions = def ? resourceLookup[def.name]?.[parentValue] ?? [] : [];
        return (
          <Group key={`level-${index}`} align="flex-start" wrap="nowrap" gap="md">
            <Box w={170} pt={4}>
              {opts.length === 1 ? (
                <Text size="sm" fw={500} ta="right" pr="xs" {...tid(screen, 'resource', 'level', level, 'type')}>
                  {def?.label}
                </Text>
              ) : (
                <Select
                  size="sm"
                  allowDeselect={false}
                  searchable={false}
                  data={opts.map((o) => ({ value: o, label: o }))}
                  value={name}
                  onChange={(v) => v && changeType(index, v)}
                  aria-label={`Resource type, level ${index + 1}`}
                  {...tid(screen, 'resource', 'level', level, 'type')}
                />
              )}
            </Box>
            {def ? (
              <>
                <TagsInput
                  style={{ flex: 1 }}
                  placeholder={resources[name]?.values.length ? '' : `Add ${def.label.toLowerCase()} values (or *)`}
                  data={suggestions}
                  value={resources[name]?.values ?? []}
                  onChange={(v) => setValues(name, v)}
                  splitChars={[',', ' ']}
                  clearable
                  aria-label={`${def.label} values`}
                  {...tid(screen, 'resource', name, 'values')}
                />
                <Box w={110} pt={6}>
                  {def.excludesSupported && (
                    <Switch
                      size="lg"
                      onLabel="Include"
                      offLabel="Exclude"
                      checked={!(resources[name]?.isExcludes ?? false)}
                      disabled={!resources[name]}
                      onChange={(e) => setExcludes(name, !e.currentTarget.checked)}
                      aria-label={`Include or exclude ${def.label} values`}
                      {...tid(screen, 'resource', name, 'include-toggle')}
                    />
                  )}
                </Box>
              </>
            ) : (
              <Text size="sm" c="dimmed" pt={6}>Policy stops at the level above.</Text>
            )}
          </Group>
        );
      })}
      <Group gap="xs" pl={186}>
        <Text size="sm" c="dimmed">Resource:</Text>
        <Code {...tid(screen, 'resource', 'path-preview')}>{rows.length ? resourcePath(resources) : '—'}</Code>
      </Group>
    </Stack>
  );
}
