import { describe, expect, it } from "vitest";
import { MochiClient } from "../src/index";

type Call = { url: string; body: any; headers: Record<string, string> };

function mockFetch(
  responder: (call: Call, index: number) => { status: number },
) {
  const calls: Call[] = [];
  const impl = (async (url: any, init: any) => {
    const call: Call = {
      url: String(url),
      body: JSON.parse(init.body),
      headers: init.headers,
    };
    calls.push(call);
    const { status } = responder(call, calls.length - 1);
    return new Response(JSON.stringify({ ok: status < 400 }), { status });
  }) as typeof fetch;
  return { calls, impl };
}

function makeClient(fetchImpl: typeof fetch, extra = {}) {
  const errors: Error[] = [];
  const client = new MochiClient({
    url: "http://localhost:9999/",
    apiKey: "mochi_sk_test",
    flushIntervalMs: 60_000, // effectively disabled; tests flush manually
    maxRetries: 2,
    onError: (e) => errors.push(e),
    fetch: fetchImpl,
    ...extra,
  });
  return { client, errors };
}

describe("MochiClient", () => {
  it("batches queued events into one request with auth header", async () => {
    const { calls, impl } = mockFetch(() => ({ status: 202 }));
    const { client } = makeClient(impl);

    client.track({ type: "command", name: "play", userId: "1" });
    client.track({ type: "guild_join", guildId: "2" });
    await client.flush();

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("http://localhost:9999/api/v1/ingest");
    expect(calls[0].headers.Authorization).toBe("Bearer mochi_sk_test");
    expect(calls[0].body.events).toHaveLength(2);
    expect(calls[0].body.events[0].ts).toBeTruthy();
    await client.shutdown();
  });

  it("auto-flushes when the batch size is reached", async () => {
    const { calls, impl } = mockFetch(() => ({ status: 202 }));
    const { client } = makeClient(impl, { maxBatchSize: 5 });

    for (let i = 0; i < 5; i++) client.track({ type: "command", name: "x" });
    await client.flush();

    expect(calls).toHaveLength(1);
    expect(calls[0].body.events).toHaveLength(5);
    await client.shutdown();
  });

  it("splits oversized queues into multiple batches", async () => {
    const { calls, impl } = mockFetch(() => ({ status: 202 }));
    const { client } = makeClient(impl, { maxBatchSize: 10 });

    for (let i = 0; i < 25; i++) client.track({ type: "command", name: "x" });
    await client.flush();

    expect(calls.length).toBeGreaterThanOrEqual(3);
    const total = calls.reduce((sum, c) => sum + c.body.events.length, 0);
    expect(total).toBe(25);
    await client.shutdown();
  });

  it("retries retryable failures then succeeds", async () => {
    const { calls, impl } = mockFetch((_call, index) => ({
      status: index === 0 ? 503 : 202,
    }));
    const { client, errors } = makeClient(impl);

    client.track({ type: "command", name: "play" });
    await client.flush();

    expect(calls).toHaveLength(2);
    expect(errors).toHaveLength(0);
    await client.shutdown();
  });

  it("drops the batch and reports on non-retryable errors", async () => {
    const { calls, impl } = mockFetch(() => ({ status: 400 }));
    const { client, errors } = makeClient(impl);

    client.track({ type: "command", name: "play" });
    await client.flush();

    expect(calls).toHaveLength(1); // no retries on 400
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toContain("400");
    await client.shutdown();
  });

  it("drops oldest events on queue overflow", async () => {
    const { calls, impl } = mockFetch(() => ({ status: 202 }));
    const { client, errors } = makeClient(impl, {
      maxQueueSize: 3,
      maxBatchSize: 100,
    });

    for (let i = 0; i < 5; i++) {
      client.track({ type: "custom", name: `event-${i}` });
    }
    await client.flush();

    expect(errors.length).toBeGreaterThan(0);
    const names = calls.flatMap((c) => c.body.events.map((e: any) => e.name));
    expect(names).toEqual(["event-2", "event-3", "event-4"]);
    await client.shutdown();
  });

  it("sends snapshots immediately", async () => {
    const { calls, impl } = mockFetch(() => ({ status: 202 }));
    const { client } = makeClient(impl);

    await client.snapshot({ guildCount: 42, wsPingMs: 30 });

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("http://localhost:9999/api/v1/snapshot");
    expect(calls[0].body.guildCount).toBe(42);
    await client.shutdown();
  });

  it("honors Retry-After on a 429 over the computed backoff", async () => {
    const times: number[] = [];
    const impl = (async () => {
      times.push(Date.now());
      const status = times.length === 1 ? 429 : 202;
      return new Response("{}", {
        status,
        headers: status === 429 ? { "Retry-After": "1" } : {},
      });
    }) as typeof fetch;
    const { client, errors } = makeClient(impl);

    const start = Date.now();
    client.track({ type: "command", name: "play" });
    await client.flush();

    expect(times).toHaveLength(2);
    expect(errors).toHaveLength(0);
    // Retry-After: 1s must dominate the 500ms computed backoff.
    expect(Date.now() - start).toBeGreaterThanOrEqual(900);
    await client.shutdown();
  });

  it("never throws when the onError handler itself throws", async () => {
    const { impl } = mockFetch(() => ({ status: 202 }));
    const client = new MochiClient({
      url: "http://localhost:9999/",
      apiKey: "mochi_sk_test",
      flushIntervalMs: 60_000,
      maxQueueSize: 1,
      onError: () => {
        throw new Error("handler blew up");
      },
      fetch: impl,
    });

    // Overflow reports from inside track(); a throwing handler must not escape.
    expect(() => {
      client.track({ type: "custom", name: "a" });
      client.track({ type: "custom", name: "b" });
    }).not.toThrow();
    await client.shutdown();
  });
});
