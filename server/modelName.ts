// Claude Code logs `claude-opus-5-5` / `claude-haiku-4-5-20251001`; Copilot logs `claude-opus-5.5`. Canonical form: dotted version, no date.
export function normalizeModel(name: string): string {
  const base = name.replace(/-(\d{8}|\d{4}-\d{2}-\d{2})$/, '')
  return base.startsWith('claude-') ? base.replace(/-(\d+)-(\d+)$/, '-$1.$2') : base
}
