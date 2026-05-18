/**
 * Shared rate-limit primitives for provider modules.
 *
 * Three concerns, three primitives:
 *
 *   1. `RateLimitError` — a typed error any provider can throw so the
 *      tag/popularity/audio-feature routers can detect "I was rate-limited"
 *      without string-matching on `message`.
 *
 *   2. `createThrottle({ minIntervalMs })` — proactive client-side spacing
 *      that serializes outbound calls so consecutive ones are at least
 *      `minIntervalMs` apart. This is what keeps us *under* a provider's
 *      rate cap so we never hit 429 in the first place. Same pattern as
 *      the inline throttle in `musicbrainz.ts`, factored out.
 *
 *   3. `createCooldown({ provider, defaultCooldownMs })` — reactive
 *      in-process cooldown that short-circuits subsequent calls during a
 *      known rate-limit window. After a 429 we know the provider is angry
 *      for ~N seconds (often communicated via `Retry-After`); during that
 *      window every additional outbound call is doomed and wastes part of
 *      the next minute's budget. The cooldown throws a `RateLimitError`
 *      *before* the HTTP call instead.
 *
 * Why both throttle *and* cooldown? Throttle is the steady-state floor
 * that should keep us out of trouble. Cooldown is the safety net when
 * something pushes us over anyway — another instance sharing the IP, a
 * provider tightening their limits, a clock skew, whatever.
 */

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

export class RateLimitError extends Error {
  readonly provider: string;
  /** Server-suggested retry window in milliseconds, if known. */
  readonly retryAfterMs: number | null;

  constructor(provider: string, retryAfterMs: number | null = null) {
    // The legacy code throws `new Error("RATE_LIMIT:<provider>")` and the
    // router string-matches on the prefix; keep that wire format so a
    // partial migration still works.
    super(`RATE_LIMIT:${provider}`);
    this.name = "RateLimitError";
    this.provider = provider;
    this.retryAfterMs = retryAfterMs;
  }
}

/**
 * True for both `RateLimitError` instances and the legacy
 * `new Error("RATE_LIMIT:...")` shape used by older provider code. The
 * router checks this to decide whether to halt the provider chain.
 */
export const isRateLimitError = (error: unknown): boolean => {
  if (error instanceof RateLimitError) return true;
  if (error && typeof error === "object" && "message" in error) {
    const msg = (error as { message?: unknown }).message;
    if (typeof msg === "string" && msg.startsWith("RATE_LIMIT")) return true;
  }
  return false;
};

/**
 * Read an axios `Retry-After` response header and convert it to
 * milliseconds. Returns null if the header is missing or unparseable.
 *
 * The HTTP spec allows either a delta-seconds integer ("60") or an
 * HTTP-date ("Wed, 21 Oct 2026 07:28:00 GMT"). Discogs and Spotify use
 * delta-seconds in practice; we handle both for safety.
 */
export const parseRetryAfterMs = (headerValue: unknown): number | null => {
  if (typeof headerValue !== "string" && typeof headerValue !== "number") return null;
  const raw = String(headerValue).trim();
  if (!raw) return null;

  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.round(seconds * 1000);
  }

  const date = Date.parse(raw);
  if (Number.isFinite(date)) {
    return Math.max(0, date - Date.now());
  }

  return null;
};

export type Throttle = () => Promise<void>;

/**
 * Create a serial throttle. Every call to the returned function awaits
 * the previous one and then waits until at least `minIntervalMs` has
 * elapsed since the previous slot. Safe to call concurrently — pending
 * calls form a FIFO queue.
 *
 * `minIntervalMs <= 0` disables the throttle (useful for tests).
 */
export const createThrottle = ({ minIntervalMs }: { minIntervalMs: number }): Throttle => {
  let lastSlotAt = 0;
  let gate: Promise<void> = Promise.resolve();

  return async function throttle(): Promise<void> {
    if (minIntervalMs <= 0) return;

    const previous = gate;
    let release: () => void = () => {};
    gate = new Promise<void>(resolve => {
      release = resolve;
    });

    try {
      await previous;
      const waitMs = Math.max(0, lastSlotAt + minIntervalMs - Date.now());
      if (waitMs > 0) await sleep(waitMs);
      lastSlotAt = Date.now();
    } finally {
      release();
    }
  };
};

export type Cooldown = {
  /**
   * Throws `RateLimitError` if currently in a cooldown window. Otherwise
   * returns immediately. Call this at the top of a provider entrypoint
   * so we short-circuit before incurring an HTTP round-trip.
   */
  check(): void;
  /**
   * Start (or extend) the cooldown. Pass the server-suggested retry
   * window in ms if known (e.g. parsed from `Retry-After`); otherwise
   * the provider's default cooldown is used.
   *
   * Calling `trigger` with a shorter window than what's already pending
   * is a no-op — we never *shrink* an active cooldown.
   */
  trigger(retryAfterMs?: number | null): void;
  /** True while a cooldown is active. */
  isActive(): boolean;
  /** ms remaining on the active cooldown, 0 if not active. */
  remainingMs(): number;
};

/**
 * In-process per-provider cooldown. Cleared on container restart, which
 * is fine for the providers that use a published rate-limit window
 * (Discogs, Last.fm) — the throttle will keep the next run inside the
 * cap, and any residual rate-limit will trigger a fresh cooldown on the
 * first 429. Persist via the `SystemState` table (see `spotify.ts`) if
 * you need cross-restart survival.
 */
export const createCooldown = ({
  provider,
  defaultCooldownMs = 60_000,
}: {
  provider: string;
  defaultCooldownMs?: number;
}): Cooldown => {
  let cooldownUntil = 0;

  return {
    check() {
      if (Date.now() < cooldownUntil) {
        throw new RateLimitError(provider, Math.max(0, cooldownUntil - Date.now()));
      }
    },
    trigger(retryAfterMs: number | null = null) {
      const ms = retryAfterMs ?? defaultCooldownMs;
      const target = Date.now() + Math.max(0, ms);
      if (target > cooldownUntil) cooldownUntil = target;
    },
    isActive() {
      return Date.now() < cooldownUntil;
    },
    remainingMs() {
      return Math.max(0, cooldownUntil - Date.now());
    },
  };
};
