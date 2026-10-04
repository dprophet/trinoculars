import { Grid, Paper, Stack, Text, Badge, Group, Table, SegmentedControl, Code, Divider } from '@mantine/core';
import { IconCheck, IconX } from '@tabler/icons-react';
import { PageHeader } from '@/components/States';
import { useStore } from '@/store';
import { capabilityProfiles, type CapabilityId } from '@/lib/capability';
import { tid } from '@/lib/testid';

const SCREEN = 'configuration';

function YesNo({ value }: { value: boolean }) {
  return value ? (
    <Badge color="green" variant="light" leftSection={<IconCheck size={12} />}>enforced</Badge>
  ) : (
    <Badge color="gray" variant="light" leftSection={<IconX size={12} />}>not enforced</Badge>
  );
}

export function ConfigurationScreen() {
  const { services, service, capability, setCapability } = useStore();
  const svc = services.find((s) => s.name === service);
  const profile = capabilityProfiles[capability];

  return (
    <div>
      <PageHeader
        title="Configuration"
        subtitle="The active service, and the capability profile that decides what the linter enforces."
      />
      <Grid gutter="lg">
        <Grid.Col span={{ base: 12, md: 5 }}>
          <Paper withBorder p="md" radius="md">
            <Stack gap="sm">
              <Text fw={600}>Service</Text>
              <Group gap="xs">
                <Text size="sm" c="dimmed">Name:</Text><Code>{svc?.name}</Code>
              </Group>
              <Group gap="xs">
                <Text size="sm" c="dimmed">Cluster:</Text><Code>{svc?.cluster}</Code>
              </Group>
              <Divider my="xs" />
              <Text fw={600}>Enforcement engine (capability profile)</Text>
              <SegmentedControl
                fullWidth
                data={(Object.keys(capabilityProfiles) as CapabilityId[]).map((id) => ({
                  value: id,
                  label: `${capabilityProfiles[id].pathLabel}: ${capabilityProfiles[id].label}`,
                }))}
                value={capability}
                onChange={(v) => setCapability(v as CapabilityId)}
                {...tid(SCREEN, 'capability', 'control')}
              />
              <Text size="sm" c="dimmed">{profile.description}</Text>
            </Stack>
          </Paper>
        </Grid.Col>

        <Grid.Col span={{ base: 12, md: 7 }}>
          <Paper withBorder p="md" radius="md">
            <Text fw={600} mb="sm">What {profile.pathLabel} enforces</Text>
            <Table {...tid(SCREEN, 'capability', 'table')}>
              <Table.Tbody>
                <Table.Tr>
                  <Table.Td>Column masking</Table.Td>
                  <Table.Td><YesNo value={profile.masking} /></Table.Td>
                </Table.Tr>
                <Table.Tr>
                  <Table.Td>Row filtering</Table.Td>
                  <Table.Td><YesNo value={profile.rowFiltering} /></Table.Td>
                </Table.Tr>
                <Table.Tr>
                  <Table.Td>Roles matched at runtime</Table.Td>
                  <Table.Td><YesNo value={profile.rolesMatched} /></Table.Td>
                </Table.Tr>
                <Table.Tr>
                  <Table.Td>Validity schedules</Table.Td>
                  <Table.Td><YesNo value={profile.validitySchedulesEnforced} /></Table.Td>
                </Table.Tr>
                <Table.Tr>
                  <Table.Td><Code>function</Code> resource reachable</Table.Td>
                  <Table.Td><YesNo value={profile.functionResourceReachable} /></Table.Td>
                </Table.Tr>
              </Table.Tbody>
            </Table>
            <Divider my="sm" />
            <Group gap="xs" mb={4}>
              <Text size="sm" fw={600}>Grantable verbs</Text>
            </Group>
            <Group gap={4} mb="sm">
              {profile.grantableVerbs.map((v) => (
                <Badge key={v} variant="outline" size="sm" {...tid(SCREEN, 'grantable', v)}>{v}</Badge>
              ))}
            </Group>
            <Text size="sm" fw={600} mb={4}>Inert verbs (import-only — §15)</Text>
            <Group gap={4}>
              {profile.inertVerbs.map((v) => (
                <Badge key={v} variant="light" color="gray" size="sm" {...tid(SCREEN, 'inert', v)}>{v}</Badge>
              ))}
            </Group>
          </Paper>
        </Grid.Col>
      </Grid>
    </div>
  );
}
