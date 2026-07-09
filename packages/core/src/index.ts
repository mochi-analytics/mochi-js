export type MochiEventType =
  | "command"
  | "guild_join"
  | "guild_leave"
  | "error"
  | "custom";

export type MochiChannelType =
  | "guild_text"
  | "guild_voice"
  | "thread"
  | "dm"
  | "group_dm"
  | "other";

export interface MochiEvent {
  type: MochiEventType;
  /** Command name or custom event name. Required for command/custom/error. */
  name?: string;
  guildId?: string;
  /** Raw Discord user id — hashed server-side, never stored. */
  userId?: string;
  channelType?: MochiChannelType;
  shardId?: number;
  success?: boolean;
  durationMs?: number;
  meta?: Record<string, unknown>;
  /** ISO timestamp; defaults to now. */
  ts?: string;
}

export interface MochiSnapshot {
  guildCount: number;
  shardId?: number;
  totalShards?: number;
  approximateMemberSum?: number;
  wsPingMs?: number;
  ts?: string;
}

export interface MochiClientOptions {
  /** Base URL of your Mochi instance, e.g. https://mochi.example.com */
  url: string;
  apiKey: string;
  /** How often the queue is flushed. Default 5000ms. */
  flushIntervalMs?: number;
  /** Max events per request (server limit is 100). Default 100. */
  maxBatchSize?: number;
  /** Events beyond this are dropped oldest-first. Default 10000. */
  maxQueueSize?: number;
  /** Retry attempts for retryable failures (429/5xx/network). Default 3. */
  maxRetries?: number;
  /** Called when events are dropped or a request permanently fails. */
  onError?: (error: Error) => void;
  /** Injectable for testing. Defaults to global fetch (Node 18+). */
  fetch?: typeof fetch;
}

const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

/**
 * Batching, non-blocking analytics client. Failures never throw into the
 * caller: analytics must not be able to crash a bot.
 */
export class MochiClient {
  private readonly ingestUrl: string;
  private readonly snapshotUrl: string;
  private readonly apiKey: string;
  private readonly flushIntervalMs: number;
  private readonly maxBatchSize: number;
  private readonly maxQueueSize: number;
  private readonly maxRetries: number;
  private readonly onError: (error: Error) => void;
  private readonly fetchImpl: typeof fetch;

  private queue: MochiEvent[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private flushing: Promise<void> | null = null;
  private shutdownRequested = false;

  constructor(options: MochiClientOptions) {
    const base = options.url.replace(/\/+$/, "");
    this.ingestUrl = `${base}/api/v1/ingest`;
    this.snapshotUrl = `${base}/api/v1/snapshot`;
    this.apiKey = options.apiKey;
    this.flushIntervalMs = options.flushIntervalMs ?? 5000;
    this.maxBatchSize = Math.min(options.maxBatchSize ?? 100, 100);
    this.maxQueueSize = options.maxQueueSize ?? 10_000;
    this.maxRetries = options.maxRetries ?? 3;
    this.onError = options.onError ?? (() => {});
    this.fetchImpl = options.fetch ?? fetch;

    this.timer = setInterval(() => void this.flush(), this.flushIntervalMs);
    // Never keep the process alive just for analytics.
    this.timer.unref?.();
  }

  /** Queues an event. Returns immediately; sending happens in the background. */
  track(event: MochiEvent): void {
    if (this.shutdownRequested) return;
    if (!event.ts) event = { ...event, ts: new Date().toISOString() };
    this.queue.push(event);
    if (this.queue.length > this.maxQueueSize) {
      this.queue.splice(0, this.queue.length - this.maxQueueSize);
      this.report(new Error("mochi: event queue overflow, dropped oldest"));
    }
    if (this.queue.length >= this.maxBatchSize) {
      void this.flush();
    }
  }

  trackCommand(
    name: string,
    context: Omit<MochiEvent, "type" | "name"> = {},
  ): void {
    this.track({ type: "command", name, ...context });
  }

  /** Sends a guild-count/health snapshot immediately (with retries). */
  async snapshot(snapshot: MochiSnapshot): Promise<void> {
    try {
      await this.send(this.snapshotUrl, snapshot);
    } catch (error) {
      this.report(error);
    }
  }

  /** Drains the queue. Safe to call concurrently; flushes are serialized. */
  flush(): Promise<void> {
    if (this.flushing) return this.flushing;
    this.flushing = this.drain().finally(() => {
      this.flushing = null;
    });
    return this.flushing;
  }

  /** Stops the timer and flushes remaining events. Call on process exit. */
  async shutdown(): Promise<void> {
    this.shutdownRequested = true;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    await this.flush();
  }

  private async drain(): Promise<void> {
    while (this.queue.length > 0) {
      const batch = this.queue.splice(0, this.maxBatchSize);
      try {
        await this.send(this.ingestUrl, { events: batch });
      } catch (error) {
        this.report(error);
        return; // Batch is dropped; don't spin on a failing endpoint.
      }
    }
  }

  private async send(url: string, body: unknown): Promise<void> {
    let lastError: Error | null = null;
    let retryAfterMs: number | null = null;
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      if (attempt > 0) {
        // Honor a server-provided Retry-After (from a prior 429) in preference
        // to the computed backoff; otherwise use exponential backoff.
        await sleep(retryAfterMs ?? 500 * 2 ** (attempt - 1));
        retryAfterMs = null;
      }
      let response: Response;
      try {
        response = await this.fetchImpl(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${this.apiKey}`,
          },
          body: JSON.stringify(body),
        });
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        continue; // network error → retry
      }
      if (response.ok) return;
      if (!RETRYABLE_STATUS.has(response.status)) {
        const text = await response.text().catch(() => "");
        throw new Error(`mochi: request rejected (${response.status}) ${text}`);
      }
      if (response.status === 429) {
        retryAfterMs = parseRetryAfter(response.headers.get("retry-after"));
      }
      lastError = new Error(`mochi: server returned ${response.status}`);
    }
    throw lastError ?? new Error("mochi: request failed");
  }

  /** Routes an error to onError, guarding it: a handler must never crash the bot. */
  private report(error: unknown): void {
    try {
      this.onError(error instanceof Error ? error : new Error(String(error)));
    } catch {
      // An error handler must never take down the host bot.
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Parses a Retry-After header (delta-seconds or HTTP-date) into milliseconds. */
function parseRetryAfter(value: string | null): number | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const seconds = Number(trimmed);
  if (Number.isFinite(seconds)) return seconds >= 0 ? seconds * 1000 : null;
  const dateMs = Date.parse(trimmed);
  if (!Number.isNaN(dateMs)) return Math.max(dateMs - Date.now(), 0);
  return null;
}