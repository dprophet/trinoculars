import { useMemo, useState } from 'react';
import { Stack, Paper, Group, Button, Code, SegmentedControl, Text, CopyButton } from '@mantine/core';
import { IconCopy, IconCheck, IconDownload } from '@tabler/icons-react';
import { useStore, useCapabilityProfile } from '@/store';
import { PageHeader } from '@/components/States';
import { tid } from '@/lib/testid';

const SCREEN = 'export';

export function ExportScreen() {
  const { policies, service } = useStore();
  const profile = useCapabilityProfile();
  const [format, setFormat] = useState<'ranger' | 'rego-input'>('ranger');
  const servicePolicies = useMemo(() => policies.filter((p) => p.service === service), [policies, service]);

  const rangerExport = useMemo(
    () => JSON.stringify({ serviceName: service, policies: servicePolicies }, null, 2),
    [service, servicePolicies],
  );

  // A representative "what the Rego actually sees" projection — the allow-only subset, deny
  // and inert fields stripped. Illustrative, not the real bundler output (§5.5 / §8).
  const regoInput = useMemo(() => {
    const rules = servicePolicies
      .filter((p) => p.isEnabled && p.policyType === 0)
      .map((p) => ({
        id: p.guid,
        resource: p.resources,
        grants: p.policyItems.map((it) => ({
          users: it.users,
          groups: it.groups,
          verbs: it.accesses
            .filter((a) => a.isAllowed && profile.grantableVerbs.includes(a.type))
            .map((a) => a.type),
        })),
        denyAllElse: p.isDenyAllElse,
      }));
    return JSON.stringify({ service, rules }, null, 2);
  }, [service, servicePolicies, profile]);

  const content = format === 'ranger' ? rangerExport : regoInput;
  const filename = format === 'ranger' ? `${service}-ranger-export.json` : `${service}-rego-input.json`;

  const download = () => {
    const blob = new Blob([content], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div>
      <PageHeader
        title="Export / preview"
        subtitle={`See exactly what leaves Trinocular for ${service}.`}
        actions={
          <Group>
            <CopyButton value={content}>
              {({ copied, copy }) => (
                <Button variant="light" leftSection={copied ? <IconCheck size={16} /> : <IconCopy size={16} />} onClick={copy} {...tid(SCREEN, 'copy', 'button')}>
                  {copied ? 'Copied' : 'Copy'}
                </Button>
              )}
            </CopyButton>
            <Button leftSection={<IconDownload size={16} />} onClick={download} {...tid(SCREEN, 'download', 'button')}>
              Download
            </Button>
          </Group>
        }
      />
      <Stack gap="md">
        <SegmentedControl
          data={[
            { value: 'ranger', label: 'Ranger export (native)' },
            { value: 'rego-input', label: 'Rego input (what the engine sees)' },
          ]}
          value={format}
          onChange={(v) => setFormat(v as typeof format)}
          {...tid(SCREEN, 'format', 'control')}
        />
        {format === 'rego-input' && (
          <Text size="sm" c="dimmed">
            Deny/exception items, roles, validity schedules, and inert verbs are stripped — this is the
            allow-only projection the {profile.pathLabel} engine actually evaluates.
          </Text>
        )}
        <Paper withBorder p="md" radius="md">
          <Code block {...tid(SCREEN, 'content')}>{content}</Code>
        </Paper>
      </Stack>
    </div>
  );
}
