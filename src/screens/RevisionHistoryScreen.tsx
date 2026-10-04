import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Paper, Group, Text, Badge, Button, Timeline, Anchor } from '@mantine/core';
import { IconArrowLeft, IconGitCommit, IconRotateClockwise } from '@tabler/icons-react';
import { useStore } from '@/store';
import { PageHeader, StateBlock } from '@/components/States';
import { DiffView } from '@/components/DiffView';
import { revisions } from '@/data/fixtures';
import { tid } from '@/lib/testid';

const SCREEN = 'history';

export function RevisionHistoryScreen() {
  const { guid } = useParams();
  const nav = useNavigate();
  const { getPolicy, upsertPolicy } = useStore();
  const policy = guid ? getPolicy(guid) : undefined;
  const revs = revisions.filter((r) => r.policyGuid === guid).sort((a, b) => b.version - a.version);
  const [compareVersion, setCompareVersion] = useState<number | null>(revs.length > 1 ? revs[1].version : null);

  if (!policy) {
    return (
      <StateBlock kind="error" screen={SCREEN} title="Policy not found"
        action={<Button variant="light" onClick={() => nav('/policies')}>Back to policies</Button>} />
    );
  }

  if (revs.length === 0) {
    return (
      <div>
        <PageHeader title={`History — ${policy.name}`} actions={
          <Button variant="subtle" leftSection={<IconArrowLeft size={16} />} onClick={() => nav(-1)}>Back</Button>
        } />
        <StateBlock kind="empty" screen={SCREEN} title="No revisions recorded" message="This policy has not been changed since it was created." />
      </div>
    );
  }

  const latest = revs[0];
  const compare = revs.find((r) => r.version === compareVersion) ?? revs[revs.length - 1];

  return (
    <div>
      <PageHeader
        title={`History — ${policy.name}`}
        subtitle="Every save is a new version. Compare any prior version with the latest, then revert."
        actions={<Button variant="subtle" leftSection={<IconArrowLeft size={16} />} onClick={() => nav(-1)}>Back</Button>}
      />
      <Group align="flex-start" gap="xl" wrap="nowrap">
        <Timeline active={0} bulletSize={22} lineWidth={2} {...tid(SCREEN, 'timeline')} style={{ minWidth: 280 }}>
          {revs.map((r) => (
            <Timeline.Item
              key={r.version}
              bullet={<IconGitCommit size={12} />}
              title={
                <Group gap="xs">
                  <Text fw={600}>v{r.version}</Text>
                  {r.version === latest.version && <Badge size="xs" color="green">latest</Badge>}
                </Group>
              }
              {...tid(SCREEN, 'revision', r.version)}
            >
              <Text size="sm">{r.note}</Text>
              <Text size="xs" c="dimmed">{r.changedBy} · {new Date(r.changedAt).toLocaleString()}</Text>
              {r.version !== latest.version && (
                <Group gap="sm" mt={4}>
                  <Anchor size="xs" onClick={() => setCompareVersion(r.version)} {...tid(SCREEN, 'revision', r.version, 'compare')}>
                    Compare with latest
                  </Anchor>
                  <Anchor
                    size="xs"
                    c="orange"
                    onClick={() => { upsertPolicy({ ...r.body, version: latest.version + 1 }); nav(`/policies/${guid}`); }}
                    {...tid(SCREEN, 'revision', r.version, 'revert')}
                  >
                    <Group gap={2}><IconRotateClockwise size={12} /> Revert to this</Group>
                  </Anchor>
                </Group>
              )}
            </Timeline.Item>
          ))}
        </Timeline>

        <Paper withBorder p="md" radius="md" style={{ flex: 1 }}>
          <Text fw={600} mb="sm">v{compare.version} → v{latest.version}</Text>
          <DiffView before={compare.body} after={latest.body} screen={SCREEN} />
        </Paper>
      </Group>
    </div>
  );
}
