import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import type { MochiClient } from "@mochi-analytics/core";
import type { SapphireClient } from "@sapphire/framework";
import { attachMochi } from "../src/index.js";

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

/**
 * SapphireClient extends the discord.js Client, and the underlying discord.js
 * adapter reads guild/shard state off it, so the fake has to satisfy both.
 */
class FakeClient extends EventEmitter {
  guilds = { cache: { size: 0, reduce: (_fn: unknown, initial: number) => initial } };
  ws = { ping: 30 };
  options = { shardCount: 1 };
  shard = undefined;
  isReady() {
    return false;
  }
}

const chatInput = (commandName: string, overrides: Record<string, unknown> = {}) => ({
  commandName,
  guildId: "g1",
  user: { id: "u1" },
  channel: {
    isDMBased: () => false,
    isThread: () => false,
    isVoiceBased: () => false,
  },
  isChatInputCommand: () => true,
  options: {
    getSubcommandGroup: () => null,
    getSubcommand: () => null,
  },
  ...overrides,
});

const contextMenu = (commandName: string) => ({
  ...chatInput(commandName),
  isChatInputCommand: () => false,
});

const attach = (client: FakeClient, mochi: MochiClient, options = {}) =>
  attachMochi(client as unknown as SapphireClient, mochi, options);

describe("attachMochi", () => {
  it("records success and duration from chatInputCommandFinish", () => {
    const client = new FakeClient();
    const { mochi, events } = recorder();
    attach(client, mochi);

    client.emit(
      "chatInputCommandFinish",
      chatInput("play"),
      { name: "play" },
      { success: true, duration: 12.7 },
    );

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: "command",
      name: "play",
      guildId: "g1",
      userId: "u1",
      channelType: "guild_text",
      success: true,
      durationMs: 13, // Sapphire reports fractional milliseconds.
      meta: { source: "slash" },
    });
  });

  it("records a failed command", () => {
    const client = new FakeClient();
    const { mochi, events } = recorder();
    attach(client, mochi);

    client.emit(
      "chatInputCommandFinish",
      chatInput("play"),
      { name: "play" },
      { success: false, duration: 4 },
    );

    expect(events[0].success).toBe(false);
  });

  it("includes the subcommand path", () => {
    const client = new FakeClient();
    const { mochi, events } = recorder();
    attach(client, mochi);

    const interaction = chatInput("config", {
      options: {
        getSubcommandGroup: () => "channel",
        getSubcommand: () => "set",
      },
    });
    client.emit("chatInputCommandFinish", interaction, { name: "config" }, {
      success: true,
      duration: 1,
    });

    expect(events[0].name).toBe("config channel set");
  });

  it("labels context-menu commands", () => {
    const client = new FakeClient();
    const { mochi, events } = recorder();
    attach(client, mochi);

    client.emit(
      "contextMenuCommandFinish",
      contextMenu("Report"),
      { name: "Report" },
      { success: true, duration: 2 },
    );

    expect(events[0]).toMatchObject({ name: "Report", meta: { source: "context_menu" } });
  });

  it("skips ignored commands", () => {
    const client = new FakeClient();
    const { mochi, events } = recorder();
    attach(client, mochi, { ignoreCommands: ["ping"] });

    client.emit("chatInputCommandFinish", chatInput("ping"), { name: "ping" }, {
      success: true,
      duration: 1,
    });

    expect(events).toEqual([]);
  });

  it("records nothing when autoTrackCommands is false", () => {
    const client = new FakeClient();
    const { mochi, events } = recorder();
    attach(client, mochi, { autoTrackCommands: false });

    client.emit("chatInputCommandFinish", chatInput("ping"), { name: "ping" }, {
      success: true,
      duration: 1,
    });

    expect(events).toEqual([]);
  });

  it("does not emit error events by default", () => {
    const client = new FakeClient();
    const { mochi, events } = recorder();
    attach(client, mochi);

    client.emit("chatInputCommandError", new Error("boom"), {
      interaction: chatInput("play"),
      command: { name: "play" },
      duration: 3,
    });

    expect(events).toEqual([]);
  });

  it("emits an error event when trackErrors is on", () => {
    const client = new FakeClient();
    const { mochi, events } = recorder();
    attach(client, mochi, { trackErrors: true });

    client.emit("chatInputCommandError", new Error("boom"), {
      interaction: chatInput("play"),
      command: { name: "play" },
      duration: 3,
    });

    expect(events[0]).toMatchObject({
      type: "error",
      name: "play",
      guildId: "g1",
      userId: "u1",
      meta: { message: "boom" },
    });
  });

  it("stringifies a non-Error rejection", () => {
    const client = new FakeClient();
    const { mochi, events } = recorder();
    attach(client, mochi, { trackErrors: true });

    client.emit("contextMenuCommandError", "kaboom", {
      interaction: contextMenu("Report"),
      command: { name: "Report" },
      duration: 3,
    });

    expect(events[0].meta).toEqual({ message: "kaboom" });
  });

  it("detaches its own and the discord.js listeners", () => {
    const client = new FakeClient();
    const { mochi, events } = recorder();
    const detach = attach(client, mochi);

    detach();
    client.emit("chatInputCommandFinish", chatInput("ping"), { name: "ping" }, {
      success: true,
      duration: 1,
    });

    expect(events).toEqual([]);
    for (const event of [
      "chatInputCommandFinish",
      "contextMenuCommandFinish",
      "chatInputCommandError",
      "contextMenuCommandError",
      "interactionCreate",
      "guildCreate",
      "guildDelete",
    ]) {
      expect(client.listenerCount(event)).toBe(0);
    }
  });
});
