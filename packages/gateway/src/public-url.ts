export function normalizePublicUrl(value: string): string {
  return /^[a-z][a-z\d+.-]*:\/\//i.test(value) ? value : `https://${value}`;
}
