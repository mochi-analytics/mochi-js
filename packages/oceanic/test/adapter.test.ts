import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import type { MochiClient } from "@mochi-analytics/core";
import type { Client } from "oceanic.js";
import { attachMochi, wrapHandler } from "../src/index.js";

/** Records events instead of sending them. */
function recorder() {
  const events: any[] = [];
  const snapshots: any[] = [];
  const mochi = {
    track: (event: any) => events.push(event),
    snapshot: async (snapshot: any) => void snapshots.push(snapshot),
  } as unknown as MochiClient;
  return { mochi, events, snapshots };
}

class FakeClient extends EventEmitter {
  ready = false;
  guilds = new Map<string, any>();
  shards = new Map<number, any>();
}

const guild = (id: string, shardId = 0, memberCount = 10) => ({
  id,
  name: `guild-${id}`,
  memberCount,
  shard: { id: shardId },
});

/** `subCommand` mirrors what InteractionOptionsWrapper.getSubCommand returns. */
const command = (
  name: string,
  subCommand?: string[],
  overrides: Record<string, unknown> = {},
) => ({
  type: 2, // APPLICATION_COMMAND
  data: {
    name,
    type: 1,
    options: { getSubCommand: () => subCommand },
  },
  guildID: "g1",
  user: { id: "u1" },
  channel: { type: 0 },
  ...overrides,
});

function fakeClient() {
  const client = new FakeClient();
  client.guilds.set("g1", guild("g1", 0, 10));
  client.guilds.set("g2", guild("g2", 1, 5));
  client.shards.set(0, { id: 0, latency: 42.4 });
  client.shards.set(1, { id: 1, latency: Infinity });
  return client;
}

const attach = (client: FakeClient, mochi: MochiClient, options = {}) =>
  attachMochi(client as unknown as Client, mochi, options);

describe("attachMochi", () => {
  it("tracks an application command with its subcommand path", () => {
    const client = fakeClient();
    const { mochi, events } = recorder();
    attach(client, mochi);

    client.emit("interactionCreate", command("config", ["set"]));

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: "command",
      name: "config set",
      guildId: "g1",
      userId: "u1",
      channelType: "guild_text",
      shardId: 0,
      meta: { source: "slash" },
    });
  });

  it("joins a nested group and subcommand", () => {
    const client = fakeClient();
    const { mochi, events } = recorder();
    attach(client, mochi);

    client.emit("interactionCreate", command("config", ["channel", "set"]));

    expect(events[0].name).toBe("config channel set");
  });

  it("reads the shard id from the interaction's guild", () => {
    const client = fakeClient();
    const { mochi, events } = recorder();
    attach(client, mochi);

    client.emit("interactionCreate", command("ping", undefined, { guildID: "g2" }));

    expect(events[0].shardId).toBe(1);
  });

  it("handles a DM interaction", () => {
    const client = fakeClient();
    const { mochi, events } = recorder();
    attach(client, mochi);

    client.emit(
      "interactionCreate",
      command("ping", undefined, { guildID: null, channel: { type: 1 } }),
    );

    expect(events[0]).toMatchObject({ userId: "u1", channelType: "dm", shardId: 0 });
    expect(events[0].guildId).toBeUndefined();
  });

  it("maps threads, voice and unknown channels", () => {
    const client = fakeClient();
    const { mochi, events } = recorder();
    attach(client, mochi);

    for (const type of [11, 13, 4]) {
      client.emit("interactionCreate", command("ping", undefined, { channel: { type } }));
    }

    expect(events.map((e) => e.channelType)).toEqual(["thread", "guild_voice", "other"]);
  });

  it("labels context-menu commands", () => {
    const client = fakeClient();
    const { mochi, events } = recorder();
    attach(client, mochi);

    client.emit("interactionCreate", {
      ...command("Report"),
      data: { name: "Report", type: 3, options: { getSubCommand: () => undefined } },
    });

    expect(events[0].meta).toEqual({ source: "context_menu" });
  });

  it("ignores non-command interactions", () => {
    const client = fakeClient();
    const { mochi, events } = recorder();
    attach(client, mochi);

    client.emit("interactionCreate", { type: 3, data: { name: "button" } });

    expect(events).toEqual([]);
  });

  it("skips ignored commands", () => {
    const client = fakeClient();
    const { mochi, events } = recorder();
    attach(client, mochi, { ignoreCommands: ["ping"] });

    client.emit("interactionCreate", command("ping"));

    expect(events).toEqual([]);
  });

  it("records nothing when autoTrackCommands is false", () => {
    const client = fakeClient();
    const { mochi, events } = recorder();
    attach(client, mochi, { autoTrackCommands: false });

    client.emit("interactionCreate", command("ping"));

    expect(events).toEqual([]);
  });

  it("tracks guild joins and leaves", () => {
    const client = fakeClient();
    const { mochi, events } = recorder();
    attach(client, mochi, { includeGuildNames: true });

    client.emit("guildCreate", guild("g9", 1, 3));
    client.emit("guildDelete", guild("g9", 1));

    expect(events.map((e) => e.type)).toEqual(["guild_join", "guild_leave"]);
    expect(events[0]).toMatchObject({
      guildId: "g9",
      shardId: 1,
      meta: { name: "guild-g9", memberCount: 3 },
    });
    expect(events[1].meta).toEqual({ name: "guild-g9" });
  });

  it("omits guild names by default", () => {
    const client = fakeClient();
    const { mochi, events } = recorder();
    attach(client, mochi);

    client.emit("guildCreate", guild("g9", 0, 3));

    expect(events[0].meta).toEqual({ memberCount: 3 });
  });

  it("survives an uncached guild on leave", () => {
    const client = fakeClient();
    const { mochi, events } = recorder();
    attach(client, mochi, { includeGuildNames: true });

    client.emit("guildDelete", { id: "g9" });

    expect(events[0]).toMatchObject({ type: "guild_leave", guildId: "g9", shardId: 0 });
    expect(events[0].meta).toBeUndefined();
  });

  it("sends one snapshot per shard on ready", () => {
    const client = fakeClient();
    const { mochi, snapshots } = recorder();
    attach(client, mochi);

    client.emit("ready");

    expect(snapshots).toEqual([
      {
        guildCount: 1,
        shardId: 0,
        totalShards: 2,
        approximateMemberSum: 10,
        wsPingMs: 42,
      },
      {
        // Latency is Infinity until the shard's first heartbeat.
        guildCount: 1,
        shardId: 1,
        totalShards: 2,
        approximateMemberSum: 5,
        wsPingMs: 0,
      },
    ]);
  });

  it("snapshots immediately when the client is already ready", () => {
    const client = fakeClient();
    client.ready = true;
    const { mochi, snapshots } = recorder();
    attach(client, mochi);

    expect(snapshots).toHaveLength(2);
  });

  it("detaches every listener", () => {
    const client = fakeClient();
    const { mochi, events } = recorder();
    const detach = attach(client, mochi);

    detach();
    client.emit("interactionCreate", command("ping"));
    client.emit("guildCreate", guild("g9"));

    expect(events).toEqual([]);
    expect(client.listenerCount("interactionCreate")).toBe(0);
    expect(client.listenerCount("guildCreate")).toBe(0);
    expect(client.listenerCount("guildDelete")).toBe(0);
  });
});

describe("wrapHandler", () => {
  it("records success and duration", async () => {
    const { mochi, events } = recorder();
    const handler = wrapHandler(mochi, async () => "ok");

    await handler(command("play") as any);

    expect(events[0]).toMatchObject({ name: "play", success: true });
    expect(events[0].durationMs).toBeGreaterThanOrEqual(0);
  });

  it("records failure and rethrows", async () => {
    const { mochi, events } = recorder();
    const handler = wrapHandler(mochi, async () => {
      throw new Error("boom");
    });

    await expect(handler(command("play") as any)).rejects.toThrow("boom");
    expect(events[0].success).toBe(false);
  });
});
