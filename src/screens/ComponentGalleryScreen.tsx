import { Stack, Paper, Text, SimpleGrid, Divider, Button } from '@mantine/core';
import { PageHeader, StateBlock } from '@/components/States';
import { LintPanel } from '@/components/LintPanel';
import { useCapabilityProfile } from '@/store';
import { lintPolicy, type LintFinding } from '@/lib/lint';
import { fixturePolicies } from '@/data/fixtures';
import { tid } from '@/lib/testid';

// A living catalogue of the shared states and components (plan §19). This screen exists so
// the standard empty/loading/error/denied/no-results blocks and the lint panel can be seen
// side by side and referenced in review, rather than hunted across the app.

const SCREEN = 'gallery';

export function ComponentGalleryScreen() {
  const profile = useCapabilityProfile();
  // Aggregate one of every finding across the fixture corpus for the panel demo.
  const seen = new Set<string>();
  const findings: LintFinding[] = [];
  for (const p of fixturePolicies) {
    for (const f of lintPolicy(p, profile)) {
      if (!seen.has(f.ruleId)) {
        seen.add(f.ruleId);
        findings.push(f);
      }
    }
  }

  return (
    <div>
      <PageHeader
        title="States & components"
        subtitle="The shared building blocks, in one place (§19)."
      />
      <Stack gap="xl">
        <div>
          <Text fw={600} mb="sm">Standard states</Text>
          <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }}>
            <Paper withBorder radius="md">
              <StateBlock kind="empty" screen={SCREEN} title="Nothing here yet" message="An empty collection." />
            </Paper>
            <Paper withBorder radius="md">
              <StateBlock kind="loading" screen={SCREEN} title="Loading…" />
            </Paper>
            <Paper withBorder radius="md">
              <StateBlock kind="error" screen={SCREEN} title="Something went wrong" message="An unexpected error." />
            </Paper>
            <Paper withBorder radius="md">
              <StateBlock kind="denied" screen={SCREEN} title="Not permitted" message="You lack rights for this scope." />
            </Paper>
            <Paper withBorder radius="md">
              <StateBlock kind="no-results" screen={SCREEN} title="No matches" message="Try a different search." />
            </Paper>
            <Paper withBorder radius="md">
              <StateBlock
                kind="empty"
                screen={SCREEN}
                title="With an action"
                message="States can carry a call to action."
                action={<Button size="xs" variant="light">Do the thing</Button>}
              />
            </Paper>
          </SimpleGrid>
        </div>

        <Divider />

        <div>
          <Text fw={600} mb="sm">Lint panel — every rule</Text>
          <Paper withBorder p="md" radius="md" {...tid(SCREEN, 'lint-demo')}>
            <LintPanel findings={findings} screen={SCREEN} />
          </Paper>
        </div>
      </Stack>
    </div>
  );
}
