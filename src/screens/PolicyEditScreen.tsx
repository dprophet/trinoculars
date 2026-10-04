import { useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  Stack,
  TextInput,
  Textarea,
  Switch,
  SegmentedControl,
  Paper,
  Group,
  Button,
  Grid,
  Text,
  Alert,
  Badge,
  TagsInput,
  Title,
  Divider,
} from '@mantine/core';
import { IconDeviceFloppy, IconArrowLeft, IconInfoCircle, IconAlertCircle } from '@tabler/icons-react';
import { useStore, useCapabilityProfile } from '@/store';
import { PageHeader } from '@/components/States';
import { ResourceSelector } from '@/components/ResourceSelector';
import { PolicyItemEditor } from '@/components/PolicyItemEditor';
import { MaskOptionPicker, RowFilterPicker } from '@/components/RulePickers';
import { LintPanel } from '@/components/LintPanel';
import { lintPolicy, hasBlockingErrors, type LintFinding } from '@/lib/lint';
import { emptyPolicy, emptyPolicyItem, permittedVerbs, policyTypeLabel } from '@/lib/policy';
import { trinoServiceDef } from '@/data/servicedef';
import { testid, tid } from '@/lib/testid';
import type {
  DataMaskPolicyItem,
  PolicyItem,
  PolicyType,
  RangerPolicy,
  RowFilterPolicyItem,
} from '@/types/ranger';

const SCREEN = 'policy-edit';

// Ranger's row checks (PolicyPermissionItem.jsx): a row with principals needs permissions and
// vice versa. Fully empty rows are dropped on save.
function ruleErrors(items: PolicyItem[]): string[] {
  const errs = new Set<string>();
  items.forEach((it) => {
    const hasWho = it.users.length + it.groups.length + it.roles.length > 0;
    const hasWhat = it.accesses.some((a) => a.isAllowed);
    if (hasWho && !hasWhat) errs.add('Please select permission item for selected users/groups/roles');
    if (!hasWho && hasWhat) errs.add('Please select users/groups/roles for selected permission item');
  });
  return [...errs];
}
const isEmptyRule = (it: PolicyItem) =>
  it.users.length + it.groups.length + it.roles.length === 0 && !it.accesses.some((a) => a.isAllowed);

const SECTION_TITLE: Record<PolicyType, string> = {
  0: 'Allow Conditions',
  1: 'Mask Conditions',
  2: 'Row Filter Conditions',
};

function FieldRow({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <Group align="flex-start" wrap="nowrap" gap="md">
      <Text size="sm" fw={500} w={170} ta="right" pt={6}>
        {label}
        {required && <Text span c="red"> *</Text>}
      </Text>
      <div style={{ flex: 1 }}>{children}</div>
    </Group>
  );
}

export function PolicyEditScreen({ mode }: { mode: 'create' | 'edit' }) {
  const nav = useNavigate();
  const { guid } = useParams();
  const [params] = useSearchParams();
  const { getPolicy, upsertPolicy, service, policies } = useStore();
  const profile = useCapabilityProfile();

  const initial = useMemo<RangerPolicy>(() => {
    if (mode === 'edit' && guid) {
      const found = getPolicy(guid);
      if (found) return structuredClone(found);
    }
    const p = emptyPolicy(service);
    const t = Number(params.get('type'));
    return t === 1 || t === 2 ? withType(p, t) : p;
  }, [mode, guid, getPolicy, service, params]);

  const [policy, setPolicy] = useState<RangerPolicy>(initial);
  const [resourceTypes, setResourceTypes] = useState<string[] | undefined>(undefined);
  const patch = (p: Partial<RangerPolicy>) => setPolicy((prev) => ({ ...prev, ...p }));

  const findings = lintPolicy(policy, profile);
  const verbs = permittedVerbs(policy, profile, resourceTypes);
  const activeItems: PolicyItem[] =
    policy.policyType === 1 ? policy.dataMaskPolicyItems : policy.policyType === 2 ? policy.rowFilterPolicyItems : policy.policyItems;
  const rowErrs = ruleErrors(activeItems);
  const blocked = hasBlockingErrors(findings) || rowErrs.length > 0 || !policy.name.trim();

  const allLabels = useMemo(() => [...new Set(policies.flatMap((p) => p.policyLabels))].sort(), [policies]);

  const applyFix = (f: LintFinding) => {
    if (f.ruleId === 'deny-or-exception') {
      patch({ denyPolicyItems: [], allowExceptions: [], denyExceptions: [] });
    } else if (f.ruleId === 'delegate-admin-item') {
      const clear = <T extends PolicyItem>(items: T[]): T[] => items.map((it) => ({ ...it, delegateAdmin: false }));
      patch({
        policyItems: clear(policy.policyItems),
        dataMaskPolicyItems: clear(policy.dataMaskPolicyItems),
        rowFilterPolicyItems: clear(policy.rowFilterPolicyItems),
      });
    } else if (f.ruleId === 'access-type-all') {
      const expand = <T extends PolicyItem>(items: T[]): T[] =>
        items.map((it) => ({
          ...it,
          accesses: it.accesses
            .filter((a) => a.type !== 'all')
            .concat(verbs.filter((v) => !it.accesses.some((a) => a.type === v)).map((v) => ({ type: v, isAllowed: true }))),
        }));
      patch({
        policyItems: expand(policy.policyItems),
        dataMaskPolicyItems: expand(policy.dataMaskPolicyItems),
        rowFilterPolicyItems: expand(policy.rowFilterPolicyItems),
      });
    }
  };

  const save = () => {
    const toSave: RangerPolicy = {
      ...policy,
      service,
      version: mode === 'edit' ? policy.version + 1 : 1,
      policyItems: policy.policyItems.filter((it) => !isEmptyRule(it)),
      dataMaskPolicyItems: policy.dataMaskPolicyItems.filter((it) => !isEmptyRule(it)),
      rowFilterPolicyItems: policy.rowFilterPolicyItems.filter((it) => !isEmptyRule(it)),
    };
    upsertPolicy(toSave);
    nav(`/policies/${toSave.guid}`);
  };

  return (
    <div>
      <PageHeader
        title={mode === 'create' ? 'Create Policy' : 'Edit Policy'}
        subtitle={`${service} — allow-only, evaluated by ${profile.pathLabel} (${profile.label}).`}
      />

      <Grid gutter="lg">
        <Grid.Col span={{ base: 12, lg: 8 }}>
          <Stack gap="lg">
            <Paper withBorder p="md" radius="md">
              <Title order={5} mb="sm">Policy Details</Title>
              <Divider mb="md" />
              <Stack gap="md">
                <FieldRow label="Policy Type">
                  {mode === 'create' ? (
                    <SegmentedControl
                      size="xs"
                      data={[
                        { value: '0', label: 'Access' },
                        { value: '1', label: 'Masking' },
                        { value: '2', label: 'Row Level Filter' },
                      ]}
                      value={String(policy.policyType)}
                      onChange={(v) => setPolicy((p) => withType(p, Number(v) as PolicyType))}
                      {...tid(SCREEN, 'policy-type', 'control')}
                    />
                  ) : (
                    <Badge mt={4} {...tid(SCREEN, 'policy-type', 'badge')}>{policyTypeLabel(policy.policyType)}</Badge>
                  )}
                </FieldRow>
                {mode === 'edit' && (
                  <FieldRow label="Policy ID">
                    <Badge mt={4} variant="light" {...tid(SCREEN, 'policy-id', 'badge')}>{policy.id}</Badge>
                  </FieldRow>
                )}
                <FieldRow label="Policy Name" required>
                  <Group wrap="nowrap" gap="md">
                    <TextInput
                      style={{ flex: 1 }}
                      value={policy.name}
                      error={!policy.name.trim() ? 'Required' : undefined}
                      onChange={(e) => patch({ name: e.currentTarget.value })}
                      {...tid(SCREEN, 'name', 'input')}
                    />
                    <Switch
                      size="lg"
                      onLabel="Enabled"
                      offLabel="Disabled"
                      checked={policy.isEnabled}
                      onChange={(e) => patch({ isEnabled: e.currentTarget.checked })}
                      aria-label="Enabled"
                      {...tid(SCREEN, 'enabled', 'toggle')}
                    />
                    <Switch
                      size="lg"
                      onLabel="Override"
                      offLabel="Normal"
                      checked={policy.policyPriority === 1}
                      onChange={(e) => patch({ policyPriority: e.currentTarget.checked ? 1 : 0 })}
                      aria-label="Override priority"
                      {...tid(SCREEN, 'priority', 'toggle')}
                    />
                  </Group>
                </FieldRow>
                <FieldRow label="Policy Label">
                  <TagsInput
                    placeholder={policy.policyLabels.length ? '' : 'Add policy labels'}
                    data={allLabels}
                    value={policy.policyLabels}
                    onChange={(v) => patch({ policyLabels: v })}
                    clearable
                    {...tid(SCREEN, 'labels', 'input')}
                  />
                </FieldRow>

                <ResourceSelector
                  key={policy.policyType}
                  resources={policy.resources}
                  onChange={(r) => patch({ resources: r })}
                  onTypesChange={setResourceTypes}
                  policyType={policy.policyType}
                  screen={SCREEN}
                />

                <FieldRow label="Description">
                  <Textarea
                    autosize
                    minRows={2}
                    value={policy.description}
                    onChange={(e) => patch({ description: e.currentTarget.value })}
                    {...tid(SCREEN, 'description', 'input')}
                  />
                </FieldRow>
                <FieldRow label="Audit Logging">
                  <Switch
                    size="lg"
                    mt={4}
                    onLabel="Yes"
                    offLabel="No"
                    checked={policy.isAuditEnabled}
                    onChange={(e) => patch({ isAuditEnabled: e.currentTarget.checked })}
                    aria-label="Audit logging"
                    {...tid(SCREEN, 'audit', 'toggle')}
                  />
                </FieldRow>
                {policy.policyType === 0 && (
                  <FieldRow label="Deny All Other Accesses">
                    <Switch
                      size="lg"
                      mt={4}
                      onLabel="True"
                      offLabel="False"
                      checked={policy.isDenyAllElse}
                      onChange={(e) => patch({ isDenyAllElse: e.currentTarget.checked })}
                      aria-label="Deny all other accesses"
                      {...tid(SCREEN, 'deny-all-else', 'toggle')}
                    />
                  </FieldRow>
                )}
                {policy.policyType !== 0 && !profile.masking && (
                  <Alert variant="light" color="yellow" icon={<IconInfoCircle size={16} />}>
                    {profile.pathLabel} answers masks and row filters through the mask/filter provider, not this policy (§5.5).
                  </Alert>
                )}
              </Stack>
            </Paper>

            <Paper withBorder p="md" radius="md">
              <Title order={5} mb="sm">{SECTION_TITLE[policy.policyType]}</Title>
              <Divider mb="md" />
              {policy.policyType === 0 && (
                <PolicyItemEditor
                  items={policy.policyItems}
                  onChange={(items) => patch({ policyItems: items })}
                  newItem={emptyPolicyItem}
                  verbs={verbs}
                  profile={profile}
                  screen={SCREEN}
                />
              )}
              {policy.policyType === 1 && (
                <PolicyItemEditor<DataMaskPolicyItem>
                  items={policy.dataMaskPolicyItems}
                  onChange={(items) => patch({ dataMaskPolicyItems: items })}
                  newItem={() => ({ ...emptyPolicyItem(), dataMaskInfo: { dataMaskType: '' } })}
                  verbs={verbs}
                  profile={profile}
                  screen={SCREEN}
                  extra={{
                    header: 'Select Masking Option',
                    render: (item, update, rowKey) => (
                      <MaskOptionPicker
                        value={item.dataMaskInfo}
                        onChange={(info) => update({ dataMaskInfo: info })}
                        testid={testid(SCREEN, 'rule', rowKey, 'mask')}
                      />
                    ),
                  }}
                />
              )}
              {policy.policyType === 2 && (
                <PolicyItemEditor<RowFilterPolicyItem>
                  items={policy.rowFilterPolicyItems}
                  onChange={(items) => patch({ rowFilterPolicyItems: items })}
                  newItem={() => ({ ...emptyPolicyItem(), rowFilterInfo: { filterExpr: '' } })}
                  verbs={verbs}
                  profile={profile}
                  screen={SCREEN}
                  extra={{
                    header: 'Row Level Filter',
                    render: (item, update, rowKey) => (
                      <RowFilterPicker
                        value={item.rowFilterInfo?.filterExpr ?? ''}
                        onChange={(expr) => update({ rowFilterInfo: { filterExpr: expr } })}
                        testid={testid(SCREEN, 'rule', rowKey, 'row-filter')}
                      />
                    ),
                  }}
                />
              )}
              {rowErrs.length > 0 && (
                <Alert mt="sm" color="red" variant="light" icon={<IconAlertCircle size={16} />} {...tid(SCREEN, 'rules', 'errors')}>
                  {rowErrs.map((e) => <div key={e}>{e}</div>)}
                </Alert>
              )}
            </Paper>

            <Group>
              <Button
                leftSection={<IconDeviceFloppy size={16} />}
                onClick={save}
                disabled={blocked}
                {...tid(SCREEN, 'save', 'button')}
              >
                Save
              </Button>
              <Button variant="default" leftSection={<IconArrowLeft size={16} />} onClick={() => nav(-1)} {...tid(SCREEN, 'cancel', 'button')}>
                Cancel
              </Button>
            </Group>
          </Stack>
        </Grid.Col>

        <Grid.Col span={{ base: 12, lg: 4 }}>
          <Stack gap="md" style={{ position: 'sticky', top: 72 }}>
            <Paper withBorder p="md" radius="md">
              <Text fw={600} mb="sm">Linter</Text>
              <LintPanel findings={findings} onFix={applyFix} screen={SCREEN} />
            </Paper>
          </Stack>
        </Grid.Col>
      </Grid>
    </div>
  );
}

// Switch a draft to another policy type: keep only resources that type allows, and make sure
// its rule list starts with one empty row (as Ranger does).
function withType(p: RangerPolicy, t: PolicyType): RangerPolicy {
  const allowed =
    t === 1 ? trinoServiceDef.maskResources : t === 2 ? trinoServiceDef.rowFilterResources : null;
  const resources = allowed
    ? Object.fromEntries(Object.entries(p.resources).filter(([k]) => allowed.includes(k)))
    : p.resources;
  return {
    ...p,
    policyType: t,
    resources,
    policyItems: t === 0 && p.policyItems.length === 0 ? [emptyPolicyItem()] : p.policyItems,
    dataMaskPolicyItems:
      t === 1 && p.dataMaskPolicyItems.length === 0
        ? [{ ...emptyPolicyItem(), dataMaskInfo: { dataMaskType: '' } }]
        : p.dataMaskPolicyItems,
    rowFilterPolicyItems:
      t === 2 && p.rowFilterPolicyItems.length === 0
        ? [{ ...emptyPolicyItem(), rowFilterInfo: { filterExpr: '' } }]
        : p.rowFilterPolicyItems,
  };
}
