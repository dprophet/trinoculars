import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { TextInput, Group, Select, Table, Badge, Anchor } from '@mantine/core';
import { IconSearch } from '@tabler/icons-react';
import { PageHeader, StateBlock } from '@/components/States';
import { auditLog, type AuditEntry } from '@/data/fixtures';
import { useStore } from '@/store';
import { tid } from '@/lib/testid';

const SCREEN = 'audit';

const ACTION_COLOR: Record<AuditEntry['action'], string> = {
  create: 'green',
  update: 'blue',
  delete: 'red',
  import: 'grape',
  revert: 'orange',
};

export function AuditScreen() {
  const nav = useNavigate();
  const { getPolicy } = useStore();
  const [q, setQ] = useState('');
  const [action, setAction] = useState<string>('all');

  const rows = useMemo(
    () =>
      auditLog
        .filter((e) => (action === 'all' ? true : e.action === action))
        .filter((e) => {
          if (!q) return true;
          const hay = `${e.actor} ${e.policyName} ${e.note}`.toLowerCase();
          return hay.includes(q.toLowerCase());
        })
        .sort((a, b) => b.at.localeCompare(a.at)),
    [q, action],
  );

  return (
    <div>
      <PageHeader title="Audit log" subtitle="Every change to policy, who made it, and when." />
      <Group mb="md" gap="sm">
        <TextInput
          leftSection={<IconSearch size={16} />}
          placeholder="Search actor, policy, note…"
          value={q}
          onChange={(e) => setQ(e.currentTarget.value)}
          w={320}
          {...tid(SCREEN, 'search', 'input')}
        />
        <Select
          w={160}
          data={[
            { value: 'all', label: 'All actions' },
            { value: 'create', label: 'Create' },
            { value: 'update', label: 'Update' },
            { value: 'delete', label: 'Delete' },
            { value: 'import', label: 'Import' },
            { value: 'revert', label: 'Revert' },
          ]}
          value={action}
          onChange={(v) => setAction(v ?? 'all')}
          {...tid(SCREEN, 'action-filter', 'select')}
        />
      </Group>

      {rows.length === 0 ? (
        <StateBlock kind="no-results" screen={SCREEN} title="No matching audit entries" message="Try clearing the search or filter." />
      ) : (
        <Table striped {...tid(SCREEN, 'table')}>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>When</Table.Th>
              <Table.Th>Actor</Table.Th>
              <Table.Th>Action</Table.Th>
              <Table.Th>Policy</Table.Th>
              <Table.Th>Note</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {rows.map((e) => (
              <Table.Tr key={e.id} {...tid(SCREEN, 'row', e.id)}>
                <Table.Td>{new Date(e.at).toLocaleString()}</Table.Td>
                <Table.Td>{e.actor}</Table.Td>
                <Table.Td><Badge variant="light" color={ACTION_COLOR[e.action]}>{e.action}</Badge></Table.Td>
                <Table.Td>
                  {getPolicy(e.policyGuid) ? (
                    <Anchor onClick={() => nav(`/policies/${e.policyGuid}`)}>{e.policyName}</Anchor>
                  ) : (
                    e.policyName
                  )}
                </Table.Td>
                <Table.Td>{e.note}</Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      )}
    </div>
  );
}
