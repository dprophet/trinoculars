import { useState, type ReactNode } from 'react';
import {
  Popover,
  Stack,
  Checkbox,
  Radio,
  TextInput,
  Group,
  ActionIcon,
  Badge,
  Anchor,
  Text,
  Tooltip,
  Code,
} from '@mantine/core';
import { IconCheck, IconX, IconPencil, IconPlus } from '@tabler/icons-react';
import type { DataMaskInfo, RangerAccess } from '@/types/ranger';
import { trinoServiceDef } from '@/data/servicedef';

// Ranger edits every rule cell the same way (docs/ranger-ui-reference): the saved value is shown
// as badges with a pencil; clicking opens a popover with a draft that is applied with ✓ or
// discarded with ✕. These three pickers follow that pattern.

function PopoverCell({
  display,
  empty,
  emptyLabel,
  title,
  children,
  onApply,
  onOpen,
  testid,
}: {
  display: ReactNode;
  empty: boolean;
  emptyLabel: string;
  title: string;
  children: ReactNode;
  onApply: () => void;
  onOpen: () => void;
  testid: string;
}) {
  const [opened, setOpened] = useState(false);
  const open = () => {
    onOpen();
    setOpened(true);
  };
  return (
    <Popover opened={opened} onChange={setOpened} position="bottom" withArrow shadow="md" trapFocus>
      <Popover.Target>
        <Group gap={6} wrap="wrap">
          {empty ? (
            <Anchor size="sm" c="red.7" fs="italic" onClick={open} data-testid={`${testid}-open`}>
              {emptyLabel}
            </Anchor>
          ) : (
            display
          )}
          <ActionIcon variant="default" size="sm" onClick={open} aria-label={title} data-testid={`${testid}-edit`}>
            {empty ? <IconPlus size={14} /> : <IconPencil size={14} />}
          </ActionIcon>
        </Group>
      </Popover.Target>
      <Popover.Dropdown data-testid={`${testid}-popover`}>
        <Stack gap="xs" miw={200}>
          <Text size="sm" fw={600}>{title}</Text>
          {children}
          <Group gap="xs">
            <ActionIcon
              color="blue"
              onClick={() => {
                onApply();
                setOpened(false);
              }}
              aria-label="Apply"
              data-testid={`${testid}-apply`}
            >
              <IconCheck size={16} />
            </ActionIcon>
            <ActionIcon variant="default" onClick={() => setOpened(false)} aria-label="Cancel" data-testid={`${testid}-cancel`}>
              <IconX size={16} />
            </ActionIcon>
          </Group>
        </Stack>
      </Popover.Dropdown>
    </Popover>
  );
}

const labelOf = (name: string) => trinoServiceDef.accessTypes.find((a) => a.name === name)?.label ?? name;

export function PermissionPicker({
  accesses,
  verbs,
  onChange,
  testid,
}: {
  accesses: RangerAccess[];
  verbs: string[]; // the verbs this rule may grant here
  onChange: (next: RangerAccess[]) => void;
  testid: string;
}) {
  const granted = accesses.filter((a) => a.isAllowed).map((a) => a.type);
  const [draft, setDraft] = useState<string[]>(granted);
  // Values outside `verbs` (e.g. `all` from an import) are kept and shown, never offered.
  const foreign = granted.filter((v) => !verbs.includes(v));
  const allTicked = verbs.length > 0 && verbs.every((v) => draft.includes(v));

  return (
    <PopoverCell
      testid={testid}
      title="Add / edit permissions"
      empty={granted.length === 0}
      emptyLabel="Add Permissions"
      onOpen={() => setDraft(granted.filter((v) => verbs.includes(v)))}
      onApply={() => onChange([...draft, ...foreign].map((type) => ({ type, isAllowed: true })))}
      display={granted
        .slice()
        .sort((a, b) => labelOf(a).localeCompare(labelOf(b)))
        .map((v) =>
          foreign.includes(v) ? (
            <Tooltip key={v} label="Not grantable here — see the linter">
              <Badge color="red" variant="outline" size="sm">{labelOf(v)}</Badge>
            </Tooltip>
          ) : (
            <Badge key={v} color="cyan" size="sm" data-testid={`${testid}-badge-${v}`}>{labelOf(v)}</Badge>
          ),
        )}
    >
      <Checkbox.Group value={draft} onChange={setDraft}>
        <Stack gap={6}>
          {verbs.map((v) => (
            <Checkbox key={v} value={v} label={labelOf(v)} data-testid={`${testid}-verb-${v}`} />
          ))}
        </Stack>
      </Checkbox.Group>
      {verbs.length > 1 && (
        <Checkbox
          label="Select/Deselect All"
          checked={allTicked}
          indeterminate={!allTicked && draft.length > 0}
          onChange={(e) => setDraft(e.currentTarget.checked ? [...verbs] : [])}
          data-testid={`${testid}-select-all`}
        />
      )}
    </PopoverCell>
  );
}

export function MaskOptionPicker({
  value,
  onChange,
  testid,
}: {
  value: DataMaskInfo | undefined;
  onChange: (next: DataMaskInfo) => void;
  testid: string;
}) {
  const [draft, setDraft] = useState<DataMaskInfo>(value ?? { dataMaskType: '' });
  const label = trinoServiceDef.maskTypes.find((m) => m.name === value?.dataMaskType)?.label;
  const customInvalid = draft.dataMaskType === 'CUSTOM' && !draft.valueExpr?.trim();
  return (
    <PopoverCell
      testid={testid}
      title="Select masking option"
      empty={!value?.dataMaskType}
      emptyLabel="Select Masking Option"
      onOpen={() => setDraft(value ?? { dataMaskType: '' })}
      onApply={() => !customInvalid && draft.dataMaskType && onChange(draft)}
      display={
        <Stack gap={2}>
          <Badge color="grape" size="sm">{label}</Badge>
          {value?.dataMaskType === 'CUSTOM' && <Code>{value.valueExpr}</Code>}
        </Stack>
      }
    >
      <Radio.Group value={draft.dataMaskType} onChange={(v) => setDraft({ ...draft, dataMaskType: v })}>
        <Stack gap={6}>
          {trinoServiceDef.maskTypes.map((m) => (
            <Radio key={m.name} value={m.name} label={m.label} data-testid={`${testid}-option-${m.name}`} />
          ))}
        </Stack>
      </Radio.Group>
      {draft.dataMaskType === 'CUSTOM' && (
        <TextInput
          size="xs"
          placeholder="Enter masked value or expression…"
          value={draft.valueExpr ?? ''}
          error={customInvalid ? 'Required' : undefined}
          onChange={(e) => setDraft({ ...draft, valueExpr: e.currentTarget.value })}
          data-testid={`${testid}-custom-expr`}
        />
      )}
    </PopoverCell>
  );
}

export function RowFilterPicker({
  value,
  onChange,
  testid,
}: {
  value: string;
  onChange: (next: string) => void;
  testid: string;
}) {
  const [draft, setDraft] = useState(value);
  return (
    <PopoverCell
      testid={testid}
      title="Enter filter expression"
      empty={!value.trim()}
      emptyLabel="Add Row Filter"
      onOpen={() => setDraft(value)}
      onApply={() => onChange(draft.trim())}
      display={<Code>{value}</Code>}
    >
      <TextInput
        size="xs"
        w={280}
        placeholder="e.g. shipmode = 'AIR'"
        value={draft}
        onChange={(e) => setDraft(e.currentTarget.value)}
        data-testid={`${testid}-expr`}
      />
    </PopoverCell>
  );
}
