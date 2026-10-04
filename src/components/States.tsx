import { Center, Loader, Stack, Text, ThemeIcon, Group, Title, Box } from '@mantine/core';
import { IconMoodEmpty, IconAlertTriangle, IconLock, IconSearchOff, type Icon } from '@tabler/icons-react';
import { tid } from '@/lib/testid';

type StateKind = 'empty' | 'loading' | 'error' | 'denied' | 'no-results';

const ICON: Record<Exclude<StateKind, 'loading'>, Icon> = {
  empty: IconMoodEmpty,
  error: IconAlertTriangle,
  denied: IconLock,
  'no-results': IconSearchOff,
};

const COLOR: Record<Exclude<StateKind, 'loading'>, string> = {
  empty: 'gray',
  error: 'red',
  denied: 'orange',
  'no-results': 'gray',
};

export function StateBlock({
  kind,
  title,
  message,
  screen,
  action,
}: {
  kind: StateKind;
  title: string;
  message?: string;
  screen: string;
  action?: React.ReactNode;
}) {
  return (
    <Center mih={180} p="xl" {...tid(screen, 'state', kind)}>
      <Stack align="center" gap="xs">
        {kind === 'loading' ? (
          <Loader />
        ) : (
          <ThemeIcon variant="light" size={48} radius="xl" color={COLOR[kind]}>
            {(() => {
              const Icon = ICON[kind];
              return <Icon size={28} />;
            })()}
          </ThemeIcon>
        )}
        <Text fw={600}>{title}</Text>
        {message && (
          <Text size="sm" c="dimmed" ta="center" maw={420}>
            {message}
          </Text>
        )}
        {action}
      </Stack>
    </Center>
  );
}

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
}) {
  return (
    <Group justify="space-between" align="flex-start" mb="md">
      <Box>
        <Title order={2}>{title}</Title>
        {subtitle && (
          <Text size="sm" c="dimmed" mt={4}>
            {subtitle}
          </Text>
        )}
      </Box>
      {actions && <Group>{actions}</Group>}
    </Group>
  );
}
