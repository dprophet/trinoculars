import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Stack, Paper, Textarea, Button, Group, Table, Badge, Alert } from '@mantine/core';
import { IconFileImport, IconAlertTriangle } from '@tabler/icons-react';
import { useStore, useCapabilityProfile } from '@/store';
import { PageHeader } from '@/components/States';
import { lintPolicy, hasBlockingErrors } from '@/lib/lint';
import { tid } from '@/lib/testid';
import type { RangerPolicy } from '@/types/ranger';

const SCREEN = 'import';

interface Parsed {
  policy: RangerPolicy;
  ruleIds: string[];
  blocked: boolean;
}

export function ImportScreen() {
  const nav = useNavigate();
  const { importPolicies } = useStore();
  const profile = useCapabilityProfile();
  const [raw, setRaw] = useState('');
  const [parsed, setParsed] = useState<Parsed[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const analyze = () => {
    setError(null);
    try {
      const json = JSON.parse(raw);
      const list: RangerPolicy[] = Array.isArray(json) ? json : json.policies ?? [json];
      setParsed(
        list.map((policy) => {
          const findings = lintPolicy(policy, profile);
          return { policy, ruleIds: findings.map((f) => f.ruleId), blocked: hasBlockingErrors(findings) };
        }),
      );
    } catch (e) {
      setParsed(null);
      setError(e instanceof Error ? e.message : 'Invalid JSON');
    }
  };

  const doImport = () => {
    if (!parsed) return;
    // Import everything, warts and all — the linter surfaces refusals but does not block the
    // round-trip (a legacy export must land so it can be seen and fixed).
    importPolicies(parsed.map((p) => p.policy));
    nav('/policies');
  };

  const refused = parsed?.filter((p) => p.blocked).length ?? 0;

  return (
    <div>
      <PageHeader
        title="Import"
        subtitle="Paste a Ranger export. Every policy is linted against the active engine before import."
      />
      <Stack gap="md">
        <Paper withBorder p="md" radius="md">
          <Textarea
            label="RangerPolicy JSON (a single policy, an array, or { policies: [...] })"
            placeholder='{ "policies": [ ... ] }'
            autosize
            minRows={8}
            value={raw}
            onChange={(e) => setRaw(e.currentTarget.value)}
            styles={{ input: { fontFamily: 'monospace' } }}
            {...tid(SCREEN, 'json', 'input')}
          />
          <Group mt="sm">
            <Button variant="light" onClick={analyze} {...tid(SCREEN, 'analyze', 'button')}>Analyze</Button>
            <Button
              leftSection={<IconFileImport size={16} />}
              onClick={doImport}
              disabled={!parsed || parsed.length === 0}
              {...tid(SCREEN, 'import', 'button')}
            >
              Import {parsed ? `${parsed.length} ${parsed.length === 1 ? 'policy' : 'policies'}` : ''}
            </Button>
          </Group>
        </Paper>

        {error && (
          <Alert color="red" title="Could not parse" {...tid(SCREEN, 'parse-error')}>{error}</Alert>
        )}

        {parsed && (
          <Paper withBorder p="md" radius="md">
            {refused > 0 && (
              <Alert color="yellow" icon={<IconAlertTriangle size={16} />} mb="sm" {...tid(SCREEN, 'refusals')}>
                {refused} of {parsed.length} {refused === 1 ? 'policy has' : 'policies have'} blocking findings. They
                still import so you can see and fix them, but they grant nothing until corrected.
              </Alert>
            )}
            <Table {...tid(SCREEN, 'preview', 'table')}>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Name</Table.Th>
                  <Table.Th>Type</Table.Th>
                  <Table.Th>Findings</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {parsed.map((p, i) => (
                  <Table.Tr key={p.policy.guid ?? i} {...tid(SCREEN, 'preview', 'row', p.policy.guid ?? String(i))}>
                    <Table.Td>{p.policy.name}</Table.Td>
                    <Table.Td>{p.policy.policyType ?? 0}</Table.Td>
                    <Table.Td>
                      {p.ruleIds.length === 0 ? (
                        <Badge color="green" variant="light">clean</Badge>
                      ) : (
                        <Group gap={4}>
                          {p.ruleIds.map((r) => (
                            <Badge key={r} size="xs" variant="light" color={p.blocked ? 'red' : 'yellow'}>{r}</Badge>
                          ))}
                        </Group>
                      )}
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Paper>
        )}
      </Stack>
    </div>
  );
}
