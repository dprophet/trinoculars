import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Table, TextInput, Group, Badge, Button, Anchor, Code, Switch, Tooltip, Tabs, Text } from '@mantine/core';
import { IconPlus, IconSearch, IconAlertTriangle } from '@tabler/icons-react';
import { useStore, useCapabilityProfile } from '@/store';
import { PageHeader, StateBlock } from '@/components/States';
import { lintPolicy, hasBlockingErrors } from '@/lib/lint';
import { resourcePath } from '@/lib/policy';
import { tid } from '@/lib/testid';
import type { RangerPolicy } from '@/types/ranger';

// Ranger's listing (docs/ranger-ui-reference): Access / Masking / Row Level Filter tabs, one
// table per type with ID, name, labels, status, audit and principals. Trinocular adds the
// resource path and the linter status.

const SCREEN = 'policy-list';
const TABS = [
  { value: '0', label: 'Access' },
  { value: '1', label: 'Masking' },
  { value: '2', label: 'Row Level Filter' },
];

function items(p: RangerPolicy) {
  return p.policyType === 1 ? p.dataMaskPolicyItems : p.policyType === 2 ? p.rowFilterPolicyItems : p.policyItems;
}
const uniq = (xs: string[]) => [...new Set(xs)];

function Chips({ values, color }: { values: string[]; color: string }) {
  if (values.length === 0) return <Text size="sm" c="dimmed">--</Text>;
  const shown = values.slice(0, 3);
  return (
    <Group gap={4}>
      {shown.map((v) => <Badge key={v} size="sm" variant="light" color={color}>{v}</Badge>)}
      {values.length > shown.length && (
        <Tooltip label={values.slice(3).join(', ')}>
          <Badge size="sm" variant="outline" color="gray">+{values.length - shown.length}</Badge>
        </Tooltip>
      )}
    </Group>
  );
}

export function PolicyListScreen() {
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();
  const { policies, service } = useStore();
  const profile = useCapabilityProfile();
  const [q, setQ] = useState('');
  const [onlyProblems, setOnlyProblems] = useState(false);
  const tab = params.get('type') ?? '0';

  const rows = useMemo(() => {
    return policies
      .filter((p) => p.service === service && String(p.policyType) === tab)
      .map((p) => ({ policy: p, findings: lintPolicy(p, profile) }))
      .filter(({ policy }) => {
        if (!q) return true;
        const its = items(policy);
        const hay = [
          policy.name,
          policy.description,
          resourcePath(policy.resources),
          ...policy.policyLabels,
          ...its.flatMap((it) => [...it.users, ...it.groups, ...it.roles]),
        ].join(' ').toLowerCase();
        return hay.includes(q.toLowerCase());
      })
      .filter(({ findings }) => (onlyProblems ? findings.length > 0 : true));
  }, [policies, service, profile, q, tab, onlyProblems]);

  const filtered = q !== '' || onlyProblems;

  return (
    <div>
      <PageHeader
        title={`${service} Policies`}
        subtitle={`Allow-only grants, evaluated by ${profile.pathLabel} (${profile.label})`}
        actions={
          <Button leftSection={<IconPlus size={16} />} onClick={() => nav(`/policies/new?type=${tab}`)} {...tid(SCREEN, 'new-policy', 'button')}>
            Add New Policy
          </Button>
        }
      />

      <Tabs value={tab} onChange={(v) => setParams(v && v !== '0' ? { type: v } : {})} mb="md" {...tid(SCREEN, 'tabs')}>
        <Tabs.List>
          {TABS.map((t) => (
            <Tabs.Tab key={t.value} value={t.value} {...tid(SCREEN, 'tab', t.value === '0' ? 'access' : t.value === '1' ? 'masking' : 'row-filter')}>
              {t.label}
            </Tabs.Tab>
          ))}
        </Tabs.List>
      </Tabs>

      <Group mb="md" gap="sm">
        <TextInput
          leftSection={<IconSearch size={16} />}
          placeholder="Search name, label, resource, user, group…"
          value={q}
          onChange={(e) => setQ(e.currentTarget.value)}
          w={360}
          {...tid(SCREEN, 'search', 'input')}
        />
        <Switch
          label="Only policies with issues"
          checked={onlyProblems}
          onChange={(e) => setOnlyProblems(e.currentTarget.checked)}
          {...tid(SCREEN, 'problems-filter', 'toggle')}
        />
      </Group>

      {rows.length === 0 ? (
        <StateBlock
          kind={filtered ? 'no-results' : 'empty'}
          screen={SCREEN}
          title={filtered ? 'No matching policies' : 'No policies of this type yet'}
          message={filtered ? 'Try clearing the search or filter.' : 'Create the first one for this service.'}
          action={
            <Button variant="light" onClick={() => nav(`/policies/new?type=${tab}`)} {...tid(SCREEN, 'empty', 'new-policy')}>
              Add New Policy
            </Button>
          }
        />
      ) : (
        <Table.ScrollContainer minWidth={1100}>
          <Table striped highlightOnHover {...tid(SCREEN, 'table')}>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Policy ID</Table.Th>
                <Table.Th>Policy Name</Table.Th>
                <Table.Th>Resource</Table.Th>
                <Table.Th>Policy Labels</Table.Th>
                <Table.Th>Status</Table.Th>
                <Table.Th>Audit Logging</Table.Th>
                <Table.Th>Groups</Table.Th>
                <Table.Th>Users</Table.Th>
                <Table.Th>Lint</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {rows.map(({ policy, findings }) => {
                const its = items(policy);
                return (
                  <Table.Tr key={policy.guid} {...tid(SCREEN, 'row', policy.guid)}>
                    <Table.Td>
                      <Anchor onClick={() => nav(`/policies/${policy.guid}/edit`)} {...tid(SCREEN, 'row', policy.guid, 'id')}>
                        {policy.id}
                      </Anchor>
                    </Table.Td>
                    <Table.Td>
                      <Anchor onClick={() => nav(`/policies/${policy.guid}`)} {...tid(SCREEN, 'row', policy.guid, 'name')}>
                        {policy.name}
                      </Anchor>
                    </Table.Td>
                    <Table.Td><Code>{resourcePath(policy.resources)}</Code></Table.Td>
                    <Table.Td><Chips values={policy.policyLabels} color="indigo" /></Table.Td>
                    <Table.Td>
                      <Badge color={policy.isEnabled ? 'green' : 'red'} variant="filled" size="sm">
                        {policy.isEnabled ? 'Enabled' : 'Disabled'}
                      </Badge>
                    </Table.Td>
                    <Table.Td>
                      <Badge color={policy.isAuditEnabled ? 'green' : 'red'} variant="filled" size="sm">
                        {policy.isAuditEnabled ? 'Enabled' : 'Disabled'}
                      </Badge>
                    </Table.Td>
                    <Table.Td><Chips values={uniq(its.flatMap((it) => it.groups))} color="teal" /></Table.Td>
                    <Table.Td><Chips values={uniq(its.flatMap((it) => it.users))} color="blue" /></Table.Td>
                    <Table.Td>
                      {findings.length > 0 ? (
                        <Tooltip label={findings.map((f) => f.ruleId).join(', ')}>
                          <Badge
                            color={hasBlockingErrors(findings) ? 'red' : 'yellow'}
                            variant="light"
                            leftSection={<IconAlertTriangle size={12} />}
                            {...tid(SCREEN, 'row', policy.guid, 'lint-badge')}
                          >
                            {findings.length}
                          </Badge>
                        </Tooltip>
                      ) : (
                        <Badge color="green" variant="light">ok</Badge>
                      )}
                    </Table.Td>
                  </Table.Tr>
                );
              })}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      )}
    </div>
  );
}
