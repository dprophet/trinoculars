import { useRef, type ReactNode } from 'react';
import { Table, MultiSelect, ActionIcon, Button, Group, Text, Tooltip } from '@mantine/core';
import { IconPlus, IconX } from '@tabler/icons-react';
import type { PolicyItem } from '@/types/ranger';
import type { CapabilityProfile } from '@/lib/capability';
import { directory } from '@/data/fixtures';
import { PermissionPicker } from '@/components/RulePickers';
import { testid, tid } from '@/lib/testid';

// Ranger's rule table (docs/ranger-ui-reference): one row per policy item,
//   Select Role | Select Group | Select User | Permissions | [extra] | ✕
// Principals are multi-selects over the directory (not free text, as in Ranger's React UI).
// Ranger's per-rule "Delegate Admin" box is deliberately absent: delegation is per catalog,
// on the Catalogs screen (§9).
// Allow-only: there is exactly one such table per policy — no exclude/deny tables (§4.1).

let keySeq = 0;
const nextKey = () => `rule-${(keySeq += 1)}`;

export interface ExtraColumn<T> {
  header: string;
  render: (item: T, update: (patch: Partial<T>) => void, rowKey: string) => ReactNode;
}

function PrincipalSelect({
  label,
  options,
  value,
  onChange,
  testidValue,
}: {
  label: string;
  options: string[];
  value: string[];
  onChange: (v: string[]) => void;
  testidValue: string;
}) {
  // Keep values that are no longer in the directory visible rather than silently dropping them.
  const data = [...new Set([...options, ...value])];
  return (
    <MultiSelect
      size="xs"
      miw={170}
      placeholder={value.length ? '' : `Select ${label}`}
      data={data}
      value={value}
      onChange={onChange}
      searchable
      clearable
      nothingFoundMessage="Not in the directory"
      aria-label={`Select ${label}`}
      data-testid={testidValue}
    />
  );
}

export function PolicyItemEditor<T extends PolicyItem>({
  items,
  onChange,
  newItem,
  verbs,
  profile,
  extra,
  screen = 'policy-edit',
}: {
  items: T[];
  onChange: (next: T[]) => void;
  newItem: () => T;
  verbs: string[];
  profile: CapabilityProfile;
  extra?: ExtraColumn<T>;
  screen?: string;
}) {
  // Stable row identity across edits, independent of position (§7.5).
  const keys = useRef<string[]>([]);
  if (keys.current.length !== items.length) {
    keys.current = items.map((_, i) => keys.current[i] ?? nextKey());
  }

  const update = (index: number, patch: Partial<T>) =>
    onChange(items.map((it, i) => (i === index ? { ...it, ...patch } : it)));
  const remove = (index: number) => {
    keys.current = keys.current.filter((_, i) => i !== index);
    onChange(items.filter((_, i) => i !== index));
  };
  const add = () => {
    keys.current = [...keys.current, nextKey()];
    onChange([...items, newItem()]);
  };

  // Roles are only shown where the engine matches them — or where data already uses them,
  // so the linter finding has something to point at.
  const showRoles = profile.rolesMatched || items.some((it) => it.roles.length > 0);

  return (
    <div>
      <Table withTableBorder withColumnBorders verticalSpacing="xs" {...tid(screen, 'rules', 'table')}>
        <Table.Thead>
          <Table.Tr>
            {showRoles && <Table.Th>Select Role</Table.Th>}
            <Table.Th>Select Group</Table.Th>
            <Table.Th>Select User</Table.Th>
            <Table.Th>Permissions</Table.Th>
            {extra && <Table.Th>{extra.header}</Table.Th>}
            <Table.Th w={44} />
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {items.length === 0 && (
            <Table.Tr>
              <Table.Td colSpan={6}>
                <Text size="sm" c="dimmed">No rules yet — add one below.</Text>
              </Table.Td>
            </Table.Tr>
          )}
          {items.map((item, index) => {
            const rowKey = keys.current[index];
            const base = testid(screen, 'rule', rowKey);
            return (
              <Table.Tr key={rowKey} data-testid={base}>
                {showRoles && (
                  <Table.Td>
                    <Tooltip label={`Roles are never matched on ${profile.pathLabel}`} disabled={profile.rolesMatched}>
                      <div>
                        <PrincipalSelect
                          label="Roles"
                          options={directory.roles}
                          value={item.roles}
                          onChange={(v) => update(index, { roles: v } as Partial<T>)}
                          testidValue={`${base}-roles`}
                        />
                      </div>
                    </Tooltip>
                  </Table.Td>
                )}
                <Table.Td>
                  <PrincipalSelect
                    label="Groups"
                    options={directory.groups}
                    value={item.groups}
                    onChange={(v) => update(index, { groups: v } as Partial<T>)}
                    testidValue={`${base}-groups`}
                  />
                </Table.Td>
                <Table.Td>
                  <PrincipalSelect
                    label="Users"
                    options={directory.users}
                    value={item.users}
                    onChange={(v) => update(index, { users: v } as Partial<T>)}
                    testidValue={`${base}-users`}
                  />
                </Table.Td>
                <Table.Td>
                  <PermissionPicker
                    accesses={item.accesses}
                    verbs={verbs}
                    onChange={(a) => update(index, { accesses: a } as Partial<T>)}
                    testid={`${base}-permissions`}
                  />
                </Table.Td>
                {extra && <Table.Td>{extra.render(item, (p) => update(index, p), rowKey)}</Table.Td>}
                <Table.Td>
                  <ActionIcon color="red" onClick={() => remove(index)} aria-label="Remove rule" data-testid={`${base}-remove`}>
                    <IconX size={14} />
                  </ActionIcon>
                </Table.Td>
              </Table.Tr>
            );
          })}
        </Table.Tbody>
      </Table>
      <Group mt="xs">
        <Button size="xs" variant="default" leftSection={<IconPlus size={14} />} onClick={add} {...tid(screen, 'rule', 'add-button')}>
          Add rule
        </Button>
      </Group>
    </div>
  );
}
