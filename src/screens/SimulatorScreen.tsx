import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Grid,
  Paper,
  Stack,
  TextInput,
  TagsInput,
  Select,
  Button,
  Text,
  Alert,
  Group,
  Badge,
  Table,
  Anchor,
  Code,
} from '@mantine/core';
import { IconPlayerPlay, IconCircleCheck, IconCircleX } from '@tabler/icons-react';
import { useStore, useCapabilityProfile } from '@/store';
import { PageHeader } from '@/components/States';
import { simulate, type SimRequest } from '@/lib/simulate';
import { simCases } from '@/data/fixtures';
import { tid } from '@/lib/testid';

const SCREEN = 'simulator';

export function SimulatorScreen() {
  const nav = useNavigate();
  const { policies, service } = useStore();
  const profile = useCapabilityProfile();
  const servicePolicies = useMemo(() => policies.filter((p) => p.service === service), [policies, service]);

  const [user, setUser] = useState('alice');
  const [groups, setGroups] = useState<string[]>(['analysts']);
  const [operation, setOperation] = useState('select');
  const [catalog, setCatalog] = useState('hive');
  const [schema, setSchema] = useState('sales');
  const [table, setTable] = useState('orders');
  const [column, setColumn] = useState('');

  const req: SimRequest = {
    identity: { user, groups },
    operation,
    resource: { catalog, schema, table, column: column || undefined },
  };
  const [result, setResult] = useState<ReturnType<typeof simulate> | null>(null);

  const run = () => setResult(simulate(servicePolicies, req));

  const loadCase = (id: string) => {
    const c = simCases.find((x) => x.id === id);
    if (!c) return;
    setUser(c.user);
    setGroups(c.groups);
    setOperation(c.operation);
    setCatalog(c.catalog);
    setSchema(c.schema);
    setTable(c.table);
    setColumn(c.column);
    setResult(simulate(servicePolicies, {
      identity: { user: c.user, groups: c.groups },
      operation: c.operation,
      resource: { catalog: c.catalog, schema: c.schema, table: c.table, column: c.column || undefined },
    }));
  };

  return (
    <div>
      <PageHeader
        title="Simulator"
        subtitle={`Allow-only union evaluation against ${service} — mirrors ${profile.pathLabel}.`}
      />
      <Grid gutter="lg">
        <Grid.Col span={{ base: 12, md: 5 }}>
          <Paper withBorder p="md" radius="md">
            <Stack gap="sm">
              <TextInput label="User" value={user} onChange={(e) => setUser(e.currentTarget.value)} {...tid(SCREEN, 'user', 'input')} />
              <TagsInput label="Groups" value={groups} onChange={setGroups} {...tid(SCREEN, 'groups', 'input')} />
              <Select
                label="Operation"
                data={profile.grantableVerbs}
                value={operation}
                onChange={(v) => v && setOperation(v)}
                {...tid(SCREEN, 'operation', 'select')}
              />
              <Group grow>
                <TextInput label="Catalog" value={catalog} onChange={(e) => setCatalog(e.currentTarget.value)} {...tid(SCREEN, 'catalog', 'input')} />
                <TextInput label="Schema" value={schema} onChange={(e) => setSchema(e.currentTarget.value)} {...tid(SCREEN, 'schema', 'input')} />
              </Group>
              <Group grow>
                <TextInput label="Table" value={table} onChange={(e) => setTable(e.currentTarget.value)} {...tid(SCREEN, 'table', 'input')} />
                <TextInput label="Column (optional)" value={column} onChange={(e) => setColumn(e.currentTarget.value)} {...tid(SCREEN, 'column', 'input')} />
              </Group>
              <Button leftSection={<IconPlayerPlay size={16} />} onClick={run} {...tid(SCREEN, 'run', 'button')}>
                Evaluate
              </Button>
            </Stack>
          </Paper>

          <Text fw={600} mt="lg" mb="xs">Saved cases</Text>
          <Table {...tid(SCREEN, 'cases', 'table')}>
            <Table.Tbody>
              {simCases.map((c) => (
                <Table.Tr key={c.id} {...tid(SCREEN, 'case', c.id)}>
                  <Table.Td>
                    <Anchor onClick={() => loadCase(c.id)}>{c.label}</Anchor>
                  </Table.Td>
                  <Table.Td>
                    <Badge size="xs" variant="light" color={c.expected === 'allow' ? 'green' : 'red'}>
                      expect {c.expected}
                    </Badge>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Grid.Col>

        <Grid.Col span={{ base: 12, md: 7 }}>
          <Paper withBorder p="md" radius="md" mih={200}>
            <Text fw={600} mb="sm">Result</Text>
            {!result ? (
              <Text size="sm" c="dimmed">Fill the request and press Evaluate, or load a saved case.</Text>
            ) : (
              <Stack gap="md" {...tid(SCREEN, 'result')}>
                <Alert
                  variant="light"
                  color={result.allowed ? 'green' : 'red'}
                  icon={result.allowed ? <IconCircleCheck size={18} /> : <IconCircleX size={18} />}
                  title={result.allowed ? 'ALLOW' : 'DENY'}
                  {...tid(SCREEN, 'result', result.allowed ? 'allow' : 'deny')}
                >
                  {result.reason}
                </Alert>
                {result.decidingPolicyGuid && (
                  <Group gap="xs">
                    <Text size="sm" c="dimmed">Deciding policy:</Text>
                    <Anchor size="sm" onClick={() => nav(`/policies/${result.decidingPolicyGuid}`)} {...tid(SCREEN, 'result', 'deciding-policy')}>
                      {result.decidingPolicyName}
                    </Anchor>
                  </Group>
                )}
                {result.denyAllElseCovered && (
                  <Badge color="orange" variant="light">covered by a deny-all-else policy</Badge>
                )}
                {result.matchedButNotGranted.length > 0 && (
                  <div>
                    <Text size="sm" c="dimmed" mb={4}>Matched the resource but did not grant the verb:</Text>
                    <Group gap={4}>
                      {result.matchedButNotGranted.map((g) => (
                        <Code key={g}>{g.slice(0, 8)}</Code>
                      ))}
                    </Group>
                  </div>
                )}
              </Stack>
            )}
          </Paper>
        </Grid.Col>
      </Grid>
    </div>
  );
}
