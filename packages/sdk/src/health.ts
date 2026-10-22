interface State {
  /** Exponentially weighted moving average of call latency. */
  latencyMs: number | null;
  failures: number;
  openUntil: number;
}

/**
 * Measured latency and a simple circuit breaker per provider.
 * After `maxFailures` consecutive failures a provider is skipped for `cooldownMs`.
 */
export class HealthTracker {
  private readonly state = new Map<string, State>();

  constructor(
    private readonly opts: { maxFailures?: number; cooldownMs?: number; alpha?: number; now?: () => number } = {},
  ) {}

  latency(providerId: string): number | null {
    return this.state.get(providerId)?.latencyMs ?? null;
  }

  healthy(providerId: string): boolean {
    const s = this.state.get(providerId);
    return !s || this.now() >= s.openUntil;
  }

  success(providerId: string, latencyMs: number): void {
    const s = this.get(providerId);
    const alpha = this.opts.alpha ?? 0.3;
    s.latencyMs = s.latencyMs === null ? latencyMs : Math.round(alpha * latencyMs + (1 - alpha) * s.latencyMs);
    s.failures = 0;
    s.openUntil = 0;
  }

  failure(providerId: string): void {
    const s = this.get(providerId);
    s.failures += 1;
    if (s.failures >= (this.opts.maxFailures ?? 3)) s.openUntil = this.now() + (this.opts.cooldownMs ?? 60_000);
  }

  /** Seed a latency, e.g. from an earlier session, before any call has been measured. */
  seed(providerId: string, latencyMs: number): void {
    this.get(providerId).latencyMs = latencyMs;
  }

  private get(providerId: string): State {
    let s = this.state.get(providerId);
    if (!s) {
      s = { latencyMs: null, failures: 0, openUntil: 0 };
      this.state.set(providerId, s);
    }
    return s;
  }

  private now(): number {
    return (this.opts.now ?? Date.now)();
  }
}
