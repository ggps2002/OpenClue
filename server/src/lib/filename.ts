/** A file-name-safe version of a user-given name, e.g. "Q3 Launch!" -> "q3-launch". */
export function slug(name: string, fallback: string): string {
  return (
    name
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || fallback
  );
}
