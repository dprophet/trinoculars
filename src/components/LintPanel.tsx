import { Stack, Alert, Group, Badge, Text, Button, Box } from '@mantine/core';
import { IconAlertCircle, IconAlertTriangle, IconCircleCheck } from '@tabler/icons-react';
import type { LintFinding } from '@/lib/lint';
import { tid } from '@/lib/testid';

// Renders §4.6 findings. Each finding keys on its ruleId (stable API), never its position.
// MODEL rules are product decisions (never lift); CAPABILITY rules are engine limits that
// may lift when Workstream R lands — the badge makes the distinction visible.

export function LintPanel({
  findings,
  onFix,
  screen = 'policy-edit',
}: {
  findings: LintFinding[];
  onFix?: (finding: LintFinding) => void;
  screen?: string;
}) {
  if (findings.length === 0) {
    return (
      <Alert
        variant="light"
        color="green"
        icon={<IconCircleCheck size={18} />}
        title="No issues"
        {...tid(screen, 'lint', 'clean')}
      >
        This policy passes every model and capability rule for the active engine.
      </Alert>
    );
  }

  const errors = findings.filter((f) => f.severity === 'error');
  const warnings = findings.filter((f) => f.severity === 'warning');

  return (
    <Stack gap="xs" {...tid(screen, 'lint', 'panel')}>
      <Group gap="xs">
        {errors.length > 0 && (
          <Badge color="red" variant="filled" {...tid(screen, 'lint', 'count', 'error')}>
            {errors.length} error{errors.length > 1 ? 's' : ''}
          </Badge>
        )}
        {warnings.length > 0 && (
          <Badge color="yellow" variant="filled" {...tid(screen, 'lint', 'count', 'warning')}>
            {warnings.length} warning{warnings.length > 1 ? 's' : ''}
          </Badge>
        )}
      </Group>
      {findings.map((f) => (
        <Alert
          key={f.ruleId}
          variant="light"
          color={f.severity === 'error' ? 'red' : 'yellow'}
          icon={f.severity === 'error' ? <IconAlertCircle size={18} /> : <IconAlertTriangle size={18} />}
          {...tid(screen, 'lint', 'finding', f.ruleId)}
        >
          <Group justify="space-between" align="flex-start" wrap="nowrap">
            <Box>
              <Group gap={6} mb={2}>
                <Text size="sm" fw={600}>{f.ruleId}</Text>
                <Badge
                  size="xs"
                  variant="outline"
                  color={f.kind === 'model' ? 'grape' : 'blue'}
                >
                  {f.kind === 'model' ? 'model rule' : 'capability rule'}
                </Badge>
              </Group>
              <Text size="sm">{f.message}</Text>
            </Box>
            {f.fixLabel && onFix && (
              <Button
                size="xs"
                variant="light"
                onClick={() => onFix(f)}
                {...tid(screen, 'lint', 'fix', f.ruleId)}
              >
                {f.fixLabel}
              </Button>
            )}
          </Group>
        </Alert>
      ))}
    </Stack>
  );
}
