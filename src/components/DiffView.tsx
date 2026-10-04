import { Box, Code, Group, Text } from '@mantine/core';
import { tid } from '@/lib/testid';

// A minimal line-level JSON diff for the revision-history and import screens. Not a real
// structural diff — good enough to show what changed between two policy versions in review.

function toLines(obj: unknown): string[] {
  return JSON.stringify(obj, null, 2).split('\n');
}

export function DiffView({
  before,
  after,
  screen = 'history',
}: {
  before: unknown;
  after: unknown;
  screen?: string;
}) {
  const a = toLines(before);
  const b = toLines(after);
  const beforeSet = new Set(a);
  const afterSet = new Set(b);
  const max = Math.max(a.length, b.length);
  const rows: { left?: string; right?: string; leftChanged: boolean; rightChanged: boolean }[] = [];
  for (let i = 0; i < max; i += 1) {
    const left = a[i];
    const right = b[i];
    rows.push({
      left,
      right,
      leftChanged: left !== undefined && !afterSet.has(left),
      rightChanged: right !== undefined && !beforeSet.has(right),
    });
  }

  return (
    <Box {...tid(screen, 'diff', 'view')}>
      <Group grow align="stretch" gap="md">
        <Box>
          <Text size="xs" c="dimmed" mb={4}>Before</Text>
          <Code block>
            {rows.map((r, i) => (
              <div
                key={`l-${i}`}
                style={{ background: r.leftChanged ? 'rgba(255,0,0,0.10)' : undefined }}
              >
                {r.left ?? ' '}
              </div>
            ))}
          </Code>
        </Box>
        <Box>
          <Text size="xs" c="dimmed" mb={4}>After</Text>
          <Code block>
            {rows.map((r, i) => (
              <div
                key={`r-${i}`}
                style={{ background: r.rightChanged ? 'rgba(0,200,0,0.12)' : undefined }}
              >
                {r.right ?? ' '}
              </div>
            ))}
          </Code>
        </Box>
      </Group>
    </Box>
  );
}
