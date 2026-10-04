// data-testid convention (plan §7.5):
//   <screen>-<component>-<element>[-<qualifier>]   (kebab-case throughout)
//
// IDs are API. They identify what a thing IS, never where it sits or what it says.
// Never derive from array index or label text.

export function testid(...parts: (string | number)[]): string {
  return parts
    .map((p) => String(p).trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''))
    .filter(Boolean)
    .join('-');
}

// Convenience for spreading onto an element: {...tid('policy-list','search','input')}
export function tid(...parts: (string | number)[]): { 'data-testid': string } {
  return { 'data-testid': testid(...parts) };
}
