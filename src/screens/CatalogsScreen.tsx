import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Table,
  Button,
  Group,
  Badge,
  Text,
  Alert,
  Modal,
  Stack,
  Autocomplete,
  TextInput,
  MultiSelect,
  ActionIcon,
  Tooltip,
  Anchor,
} from '@mantine/core';
import { IconPlus, IconPencil, IconTrash, IconInfoCircle } from '@tabler/icons-react';
import { useStore } from '@/store';
import { PageHeader, StateBlock } from '@/components/States';
import { directory, resourceLookup, type CatalogEntry } from '@/data/fixtures';
import { isDelegateAdmin, policiesInCatalog } from '@/lib/delegation';
import { tid } from '@/lib/testid';

// Catalogs and their delegate admins (§9). Delegation is set here, per catalog — not on
// individual policy rules. A delegate admin may create and edit any policy whose catalog
// resource names this catalog; Trinocular enforces that on save. Only global admins manage
// this list.

const SCREEN = 'catalogs';

interface Draft {
  name: string;
  description: string;
  users: string[];
  groups: string[];
}
const blank: Draft = { name: '', description: '', users: [], groups: [] };

function Chips({ values, color, empty }: { values: string[]; color: string; empty: string }) {
  if (values.length === 0) return <Text size="sm" c="dimmed">{empty}</Text>;
  return (
    <Group gap={4}>
      {values.map((v) => <Badge key={v} size="sm" variant="light" color={color}>{v}</Badge>)}
    </Group>
  );
}

export function CatalogsScreen() {
  const nav = useNavigate();
  const { catalogs, upsertCatalog, deleteCatalog, service, identity, policies } = useStore();
  const canManage = identity.role === 'GLOBAL_ADMIN';
  const rows = catalogs.filter((c) => c.service === service);

  const [editing, setEditing] = useState<string | null>(null); // catalog name, or '' for new
  const [draft, setDraft] = useState<Draft>(blank);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const open = (c?: CatalogEntry) => {
    setDraft(c ? { name: c.name, description: c.description, users: c.admins.users, groups: c.admins.groups } : blank);
    setEditing(c ? c.name : '');
  };
  const name = draft.name.trim();
  const duplicate = rows.some((c) => c.name === name && c.name !== editing);
  const nameError = !name ? 'Required' : name === '*' ? 'Delegation is per named catalog — not *' : duplicate ? 'Already listed' : undefined;

  const save = () => {
    if (nameError) return;
    upsertCatalog(
      { service, name, description: draft.description.trim(), admins: { users: draft.users, groups: draft.groups } },
      editing || undefined,
    );
    setEditing(null);
  };

  const suggestions = (resourceLookup.catalog[''] ?? []).filter((c) => !rows.some((r) => r.name === c));

  return (
    <div>
      <PageHeader
        title="Catalogs"
        subtitle={`Catalogs in ${service} and who may administer their policies.`}
        actions={
          <Tooltip label="Only global admins can add catalogs" disabled={canManage}>
            <Button leftSection={<IconPlus size={16} />} onClick={() => open()} disabled={!canManage} {...tid(SCREEN, 'add', 'button')}>
              Add Catalog
            </Button>
          </Tooltip>
        }
      />

      <Alert variant="light" color="blue" icon={<IconInfoCircle size={16} />} mb="md">
        <b>Delegate admins</b> can create and edit any policy whose catalog resource is that catalog — and
        nothing outside it. Policies on catalog <code>*</code> stay with global admins. Trinocular enforces this
        when a policy is saved; it does not change what anyone can query.
      </Alert>

      {rows.length === 0 ? (
        <StateBlock kind="empty" screen={SCREEN} title="No catalogs yet" message="Add a catalog to delegate its policies to a data owner." />
      ) : (
        <Table striped highlightOnHover withTableBorder {...tid(SCREEN, 'table')}>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Catalog</Table.Th>
              <Table.Th>Description</Table.Th>
              <Table.Th>Delegate admin groups</Table.Th>
              <Table.Th>Delegate admin users</Table.Th>
              <Table.Th>Policies</Table.Th>
              <Table.Th w={90} />
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {rows.map((c) => {
              const count = policiesInCatalog(policies, service, c.name).length;
              const mine = isDelegateAdmin(c, identity);
              return (
                <Table.Tr key={c.name} {...tid(SCREEN, 'row', c.name)}>
                  <Table.Td>
                    <Group gap={6}>
                      <Text fw={600} ff="monospace">{c.name}</Text>
                      {mine && <Badge size="xs" color="indigo">you administer</Badge>}
                    </Group>
                  </Table.Td>
                  <Table.Td><Text size="sm">{c.description || '—'}</Text></Table.Td>
                  <Table.Td><Chips values={c.admins.groups} color="teal" empty="—" /></Table.Td>
                  <Table.Td><Chips values={c.admins.users} color="blue" empty="—" /></Table.Td>
                  <Table.Td>
                    <Anchor size="sm" onClick={() => nav('/policies')} {...tid(SCREEN, 'row', c.name, 'policy-count')}>
                      {count}
                    </Anchor>
                  </Table.Td>
                  <Table.Td>
                    <Group gap={4} wrap="nowrap">
                      <ActionIcon variant="subtle" disabled={!canManage} onClick={() => open(c)} aria-label={`Edit ${c.name}`} {...tid(SCREEN, 'row', c.name, 'edit')}>
                        <IconPencil size={16} />
                      </ActionIcon>
                      <ActionIcon variant="subtle" color="red" disabled={!canManage} onClick={() => setConfirmDelete(c.name)} aria-label={`Remove ${c.name}`} {...tid(SCREEN, 'row', c.name, 'remove')}>
                        <IconTrash size={16} />
                      </ActionIcon>
                    </Group>
                  </Table.Td>
                </Table.Tr>
              );
            })}
          </Table.Tbody>
        </Table>
      )}

      <Modal opened={editing !== null} onClose={() => setEditing(null)} title={editing ? `Edit catalog — ${editing}` : 'Add catalog'} size="lg" {...tid(SCREEN, 'modal')}>
        <Stack gap="sm">
          <Autocomplete
            label="Catalog"
            withAsterisk
            placeholder="e.g. tpch"
            data={suggestions}
            value={draft.name}
            error={draft.name ? nameError : undefined}
            onChange={(v) => setDraft({ ...draft, name: v })}
            {...tid(SCREEN, 'modal', 'name')}
          />
          <TextInput
            label="Description"
            value={draft.description}
            onChange={(e) => setDraft({ ...draft, description: e.currentTarget.value })}
            {...tid(SCREEN, 'modal', 'description')}
          />
          <MultiSelect
            label="Delegate admin groups"
            description="Members can manage this catalog's policies"
            placeholder={draft.groups.length ? '' : 'Select groups'}
            data={[...new Set([...directory.groups.filter((g) => g !== 'public'), ...draft.groups])]}
            value={draft.groups}
            onChange={(v) => setDraft({ ...draft, groups: v })}
            searchable
            clearable
            nothingFoundMessage="Not in the directory"
            {...tid(SCREEN, 'modal', 'groups')}
          />
          <MultiSelect
            label="Delegate admin users"
            placeholder={draft.users.length ? '' : 'Select users'}
            data={[...new Set([...directory.users.filter((u) => u !== '{USER}'), ...draft.users])]}
            value={draft.users}
            onChange={(v) => setDraft({ ...draft, users: v })}
            searchable
            clearable
            nothingFoundMessage="Not in the directory"
            {...tid(SCREEN, 'modal', 'users')}
          />
          {draft.users.length + draft.groups.length === 0 && (
            <Text size="xs" c="dimmed">No delegate admins — only global admins will manage this catalog.</Text>
          )}
          <Group justify="flex-end" mt="sm">
            <Button variant="default" onClick={() => setEditing(null)} {...tid(SCREEN, 'modal', 'cancel')}>Cancel</Button>
            <Button onClick={save} disabled={!!nameError} {...tid(SCREEN, 'modal', 'save')}>Save</Button>
          </Group>
        </Stack>
      </Modal>

      <Modal opened={confirmDelete !== null} onClose={() => setConfirmDelete(null)} title="Remove catalog" {...tid(SCREEN, 'confirm-remove')}>
        {confirmDelete && (
          <Stack gap="sm">
            <Text size="sm">
              Remove <b>{confirmDelete}</b> and its delegate admins? Its{' '}
              {policiesInCatalog(policies, service, confirmDelete).length} policies are kept, but only global admins
              will be able to edit them.
            </Text>
            <Group justify="flex-end">
              <Button variant="default" onClick={() => setConfirmDelete(null)}>Cancel</Button>
              <Button
                color="red"
                onClick={() => {
                  deleteCatalog(service, confirmDelete);
                  setConfirmDelete(null);
                }}
                {...tid(SCREEN, 'confirm-remove', 'confirm')}
              >
                Remove
              </Button>
            </Group>
          </Stack>
        )}
      </Modal>
    </div>
  );
}
