export class ProviderError extends Error {
  constructor(
    readonly provider: string,
    readonly status: number,
    body: string,
  ) {
    super(`${provider} returned ${status}: ${body.slice(0, 200)}`);
    this.name = "ProviderError";
  }
}

export async function postJson<T>(
  provider: string,
  url: string,
  headers: Record<string, string>,
  body: unknown,
  signal: AbortSignal,
  fetchImpl: typeof fetch = fetch,
): Promise<T> {
  const res = await fetchImpl(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
    signal,
  });
  const text = await res.text();
  if (!res.ok) throw new ProviderError(provider, res.status, text);
  return JSON.parse(text) as T;
}

export function requireKey(name: string, value: string | undefined): string {
  if (!value) throw new Error(`${name} is not set`);
  return value;
}
