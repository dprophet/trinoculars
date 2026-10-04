import { useNavigate, useParams } from 'react-router-dom';
import {
  Stack,
  Paper,
  Group,
  Button,
  Text,
  Badge,
  Code,
  Table,
  Grid,
  Divider,
  Accordion,
  Menu,
  ActionIcon,
} from '@mantine/core';
import {
  IconEdit,
  IconHistory,
  IconTrash,
  IconTestPipe,
  IconDots,
} from '@tabler/icons-react';
import { useStore, useCapabilityProfile } from '@/store';
import { PageHeader, StateBlock } from '@/components/States';
import { LintPanel } from '@/components/LintPanel';
import { lintPolicy } from '@/lib/lint';
import { resourcePath, policyTypeLabel } from '@/lib/policy';
import { tid } from '@/lib/testid';

const SCREEN = 'policy-detail';

export function PolicyDetailScreen() {
  const { guid } = useParams();
  const nav = useNavigate();
  const { getPolicy, deletePolicy } = useStore();
  const profile = useCapabilityProfile();
  const policy = guid ? getPolicy(guid) : undefined;

  if (!policy) {
    return (
      <StateBlock
        kind="error"
        screen={SCREEN}
        title="Policy not found"
        message="It may have been deleted or the link is stale."
        action={<Button variant="light" onClick={() => nav('/policies')}>Back to policies</Button>}
      />
    );
  }

  const findings = lintPolicy(policy, profile);
  const items =
    policy.policyType === 1
      ? policy.dataMaskPolicyItems
      : policy.policyType === 2
        ? policy.rowFilterPolicyItems
        : policy.policyItems;

  const remove = () => {
    deletePolicy(policy.guid);
    nav('/policies');
  };

  return (
    <div>
      <PageHeader
        title={policy.name}
        subtitle={policy.description}
        actions={
          <Group>
            <Button
              variant="light"
              leftSection={<IconTestPipe size={16} />}
              onClick={() => nav('/simulator')}
              {...tid(SCREEN, 'simulate', 'button')}
            >
              Simulate
            </Button>
            <Button
              leftSection={<IconEdit size={16} />}
              onClick={() => nav(`/policies/${policy.guid}/edit`)}
              {...tid(SCREEN, 'edit', 'button')}
            >
              Edit
            </Button>
            <Menu position="bottom-end">
              <Menu.Target>
                <ActionIcon variant="default" size="lg" aria-label="More actions" {...tid(SCREEN, 'more', 'menu')}>
                  <IconDots size={18} />
                </ActionIcon>
              </Menu.Target>
              <Menu.Dropdown>
                <Menu.Item
                  leftSection={<IconHistory size={16} />}
                  onClick={() => nav(`/policies/${policy.guid}/history`)}
                  {...tid(SCREEN, 'history', 'menu-item')}
                >
                  Revision history
                </Menu.Item>
                <Menu.Item
                  color="red"
                  leftSection={<IconTrash size={16} />}
                  onClick={remove}
                  {...tid(SCREEN, 'delete', 'menu-item')}
                >
                  Delete policy
                </Menu.Item>
              </Menu.Dropdown>
            </Menu>
          </Group>
        }
      />

      <Grid gutter="lg">
        <Grid.Col span={{ base: 12, md: 8 }}>
          <Stack gap="lg">
            <Paper withBorder p="md" radius="md">
              <Group gap="xs" mb="sm">
                <Badge variant="light" color={policy.policyType === 0 ? 'blue' : policy.policyType === 1 ? 'grape' : 'teal'}>
                  {policyTypeLabel(policy.policyType)}
                </Badge>
                {!policy.isEnabled && <Badge color="gray" variant="light">disabled</Badge>}
                {policy.isDenyAllElse && <Badge color="orange" variant="light">deny all else</Badge>}
                {policy.isAuditEnabled && <Badge color="gray" variant="outline">audited</Badge>}
              </Group>
              <Group gap="xs">
                <Text size="sm" c="dimmed">Resource:</Text>
                <Code {...tid(SCREEN, 'resource', 'path')}>{resourcePath(policy.resources)}</Code>
              </Group>
            </Paper>

            <Paper withBorder p="md" radius="md">
              <Text fw={600} mb="sm">Grants</Text>
              {items.length === 0 ? (
                <StateBlock kind="empty" screen={SCREEN} title="No grants" message="This policy authorizes nothing." />
              ) : (
                <Table {...tid(SCREEN, 'grants', 'table')}>
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>Users</Table.Th>
                      <Table.Th>Groups</Table.Th>
                      <Table.Th>Roles</Table.Th>
                      <Table.Th>Permissions</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {items.map((it, i) => (
                      <Table.Tr key={i}>
                        <Table.Td>{it.users.join(', ') || '—'}</Table.Td>
                        <Table.Td>{it.groups.join(', ') || '—'}</Table.Td>
                        <Table.Td>
                          {it.roles.length > 0 ? (
                            <Badge color="red" variant="light">{it.roles.join(', ')}</Badge>
                          ) : '—'}
                        </Table.Td>
                        <Table.Td>
                          <Group gap={4}>
                            {it.accesses.filter((a) => a.isAllowed).map((a) => (
                              <Badge key={a.type} size="xs" variant="outline" color={a.type === 'all' ? 'red' : 'gray'}>
                                {a.type}
                              </Badge>
                            ))}
                          </Group>
                        </Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              )}
              {policy.policyType === 1 && policy.dataMaskPolicyItems[0] && (
                <>
                  <Divider my="sm" />
                  <Group gap="xs">
                    <Text size="sm" c="dimmed">Mask:</Text>
                    <Badge variant="light" color="grape">{policy.dataMaskPolicyItems[0].dataMaskInfo.dataMaskType}</Badge>
                  </Group>
                </>
              )}
              {policy.policyType === 2 && policy.rowFilterPolicyItems[0] && (
                <>
                  <Divider my="sm" />
                  <Group gap="xs">
                    <Text size="sm" c="dimmed">Filter:</Text>
                    <Code>{policy.rowFilterPolicyItems[0].rowFilterInfo.filterExpr}</Code>
                  </Group>
                </>
              )}
            </Paper>

            <Accordion variant="separated" {...tid(SCREEN, 'raw', 'accordion')}>
              <Accordion.Item value="json">
                <Accordion.Control>Raw RangerPolicy JSON</Accordion.Control>
                <Accordion.Panel>
                  <Code block {...tid(SCREEN, 'raw', 'json')}>{JSON.stringify(policy, null, 2)}</Code>
                </Accordion.Panel>
              </Accordion.Item>
            </Accordion>
          </Stack>
        </Grid.Col>

        <Grid.Col span={{ base: 12, md: 4 }}>
          <Paper withBorder p="md" radius="md">
            <Text fw={600} mb="sm">Linter</Text>
            <LintPanel findings={findings} screen={SCREEN} />
          </Paper>
        </Grid.Col>
      </Grid>
    </div>
  );
}
