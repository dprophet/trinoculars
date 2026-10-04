import type { TrinoServiceDef } from '@/types/ranger';

// Embedded copy of the Trino service definition (ranger-servicedef-trino.json),
// which drives the resource cascade and the access-type grid. In Phase 1 this is
// served by GET /api/v1/servicedef; here it is checked in (plan §Phase 0).
//
// NOTE: `all`, `grant`, `revoke`, `use` are present because the servicedef declares
// them, but the capability layer (lib/capability.ts) marks them non-grantable — the
// current trino-ranger plugin treats them as inert (plan §15). `execute` is added by
// the plugin even though older servicedefs omit it.

export const trinoServiceDef: TrinoServiceDef = {
  name: 'trino',
  resources: [
    { name: 'catalog', level: 10, parent: '', label: 'Catalog', lookupSupported: true, recursiveSupported: false, excludesSupported: true, mandatory: true, description: 'Trino catalog', isValidLeaf: true },
    { name: 'schema', level: 20, parent: 'catalog', label: 'Schema', lookupSupported: true, recursiveSupported: false, excludesSupported: true, mandatory: true, description: 'Schema within a catalog', isValidLeaf: true },
    { name: 'table', level: 30, parent: 'schema', label: 'Table', lookupSupported: true, recursiveSupported: false, excludesSupported: true, mandatory: true, description: 'Table within a schema', isValidLeaf: true },
    { name: 'column', level: 40, parent: 'table', label: 'Column', lookupSupported: true, recursiveSupported: false, excludesSupported: true, mandatory: true, description: 'Column within a table' },
    { name: 'trinouser', level: 10, parent: '', label: 'Trino User', lookupSupported: false, recursiveSupported: false, excludesSupported: false, mandatory: true, description: 'Target user (impersonation)', accessTypeRestrictions: ['impersonate'] },
    { name: 'systemproperty', level: 10, parent: '', label: 'System Property', lookupSupported: false, recursiveSupported: false, excludesSupported: false, mandatory: true, description: 'System session property', accessTypeRestrictions: ['alter'] },
    { name: 'sessionproperty', level: 20, parent: 'catalog', label: 'Session Property', lookupSupported: false, recursiveSupported: false, excludesSupported: false, mandatory: true, description: 'Catalog session property', accessTypeRestrictions: ['alter'] },
    { name: 'procedure', level: 30, parent: 'schema', label: 'Procedure', lookupSupported: false, recursiveSupported: false, excludesSupported: false, mandatory: true, description: 'Procedure or function (catalog.schema.name)', accessTypeRestrictions: ['execute', 'grant'] },
    { name: 'function', level: 10, parent: '', label: 'Function', lookupSupported: false, recursiveSupported: false, excludesSupported: false, mandatory: true, description: 'Function (unreachable on Path B — §4.4)', accessTypeRestrictions: ['execute', 'grant'] },
  ],
  accessTypes: [
    { name: 'select', label: 'Select', impliedGrants: [] },
    { name: 'insert', label: 'Insert', impliedGrants: [] },
    { name: 'create', label: 'Create', impliedGrants: [] },
    { name: 'drop', label: 'Drop', impliedGrants: [] },
    { name: 'delete', label: 'Delete', impliedGrants: [] },
    { name: 'use', label: 'Use', impliedGrants: [] },
    { name: 'alter', label: 'Alter', impliedGrants: [] },
    { name: 'grant', label: 'Grant', impliedGrants: [] },
    { name: 'revoke', label: 'Revoke', impliedGrants: [] },
    { name: 'show', label: 'Show', impliedGrants: [] },
    { name: 'impersonate', label: 'Impersonate', impliedGrants: [] },
    { name: 'execute', label: 'Execute', impliedGrants: [] },
    {
      name: 'all',
      label: 'All',
      impliedGrants: ['select', 'insert', 'create', 'delete', 'drop', 'use', 'alter', 'grant', 'revoke', 'show', 'impersonate', 'execute'],
    },
  ],
  maskTypes: [
    { name: 'MASK', label: 'Redact', transformer: "cast(regexp_replace(regexp_replace(regexp_replace({col},'([A-Z])', 'X'),'([a-z])','x'),'([0-9])','0') as {type})" },
    { name: 'MASK_SHOW_LAST_4', label: 'Partial mask: show last 4', transformer: "cast(regexp_replace({col}, '(.*)(.{4}$)', x -> regexp_replace(x[1], '.', 'X') || x[2]) as {type})" },
    { name: 'MASK_SHOW_FIRST_4', label: 'Partial mask: show first 4', transformer: "cast(regexp_replace({col}, '(^.{4})(.*)', x -> x[1] || regexp_replace(x[2], '.', 'X')) as {type})" },
    { name: 'MASK_HASH', label: 'Hash', transformer: 'cast(to_hex(sha256(to_utf8({col}))) as {type})' },
    { name: 'MASK_NULL', label: 'Nullify', transformer: '' },
    { name: 'MASK_DATE_SHOW_YEAR', label: 'Date: show only year', transformer: "date_trunc('year', {col})" },
    { name: 'CUSTOM', label: 'Custom', transformer: '' },
  ],
  maskResources: ['catalog', 'schema', 'table', 'column'],
  rowFilterResources: ['catalog', 'schema', 'table'],
};

// Verbs a mask or row-filter rule may carry (dataMaskDef / rowFilterDef accessTypes).
export const maskFilterAccessTypes = ['select'];

// Ordered resource chain for the cascade.
export const resourceChain = ['catalog', 'schema', 'table', 'column'] as const;
export type ResourceKey = (typeof trinoServiceDef.resources)[number]['name'];
