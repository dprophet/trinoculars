import { AppShell, Group, Text, NavLink, Select, Badge, Stack, Divider, Box, Tooltip } from '@mantine/core';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  IconList,
  IconTestPipe,
  IconFileImport,
  IconFileExport,
  IconHistory,
  IconDatabase,
  IconSettings,
  IconComponents,
  IconBinoculars,
  type Icon,
} from '@tabler/icons-react';
import { useStore } from '@/store';
import { capabilityProfiles } from '@/lib/capability';
import { catalogsAdministeredBy } from '@/lib/delegation';
import { tid } from '@/lib/testid';

const NAV: { to: string; label: string; icon: Icon; key: string }[] = [
  { to: '/policies', label: 'Policies', icon: IconList, key: 'policies' },
  { to: '/catalogs', label: 'Catalogs', icon: IconDatabase, key: 'catalogs' },
  { to: '/simulator', label: 'Simulator', icon: IconTestPipe, key: 'simulator' },
  { to: '/import', label: 'Import', icon: IconFileImport, key: 'import' },
  { to: '/export', label: 'Export / preview', icon: IconFileExport, key: 'export' },
  { to: '/audit', label: 'Audit log', icon: IconHistory, key: 'audit' },
  { to: '/configuration', label: 'Configuration', icon: IconSettings, key: 'configuration' },
  { to: '/gallery', label: 'States & components', icon: IconComponents, key: 'gallery' },
];

export function AppLayout() {
  const nav = useNavigate();
  const loc = useLocation();
  const { services, service, setService, identity, identities, setIdentityUser, capability, catalogs } = useStore();
  const administers = catalogsAdministeredBy(catalogs, identity, service);
  const profile = capabilityProfiles[capability];

  return (
    <AppShell header={{ height: 56 }} navbar={{ width: 260, breakpoint: 'sm' }} padding="md">
      <AppShell.Header>
        <Group h="100%" px="md" justify="space-between">
          <Group gap="xs">
            <IconBinoculars size={24} />
            <Text fw={700} size="lg">Trinocular</Text>
            <Badge variant="light" color="gray" size="sm">wireframe</Badge>
          </Group>
          <Group gap="sm">
            <Tooltip label="Which enforcement engine this service targets (§4.8)">
              <Badge
                variant="light"
                color={capability === 'ranger-plugin' ? 'teal' : 'indigo'}
                {...tid('layout', 'capability', 'badge')}
              >
                {profile.pathLabel}: {profile.label}
              </Badge>
            </Tooltip>
            <Select
              size="xs"
              w={200}
              data={services.map((s) => ({ value: s.name, label: s.label }))}
              value={service}
              onChange={(v) => v && setService(v)}
              aria-label="Active Trino service"
              {...tid('layout', 'service', 'select')}
            />
            <Select
              size="xs"
              w={180}
              data={identities.map((i) => ({ value: i.user, label: `${i.user} · ${i.role}` }))}
              value={identity.user}
              onChange={(v) => v && setIdentityUser(v)}
              aria-label="Logged in as"
              {...tid('layout', 'identity', 'select')}
            />
          </Group>
        </Group>
      </AppShell.Header>

      <AppShell.Navbar p="sm">
        <Stack gap={2}>
          {NAV.map((item) => {
            const Icon = item.icon;
            const active = loc.pathname.startsWith(item.to);
            return (
              <NavLink
                key={item.key}
                active={active}
                label={item.label}
                leftSection={<Icon size={18} />}
                onClick={() => nav(item.to)}
                {...tid('nav', item.key)}
              />
            );
          })}
        </Stack>
        <Divider my="sm" />
        <Box px="xs">
          <Text size="xs" c="dimmed">
            Signed in as <b>{identity.user}</b> ({identity.role}).
          </Text>
          <Text size="xs" c="dimmed" mt={4}>
            {identity.role === 'GLOBAL_ADMIN'
              ? 'Administers every catalog.'
              : administers.length
                ? `Delegate admin of: ${administers.join(', ')}`
                : 'Not a delegate admin of any catalog.'}
          </Text>
        </Box>
      </AppShell.Navbar>

      <AppShell.Main>
        <Outlet />
      </AppShell.Main>
    </AppShell>
  );
}
