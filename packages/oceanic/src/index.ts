import type { MochiChannelType, MochiClient } from "@mochi-analytics/core";
import type {
  AnyInteractionGateway,
  Client,
  CommandInteraction,
  Guild,
  Shard,
  Uncached,
} from "oceanic.js";

/**
 * Mirrors `InteractionTypes.APPLICATION_COMMAND` and
 * `ApplicationCommandTypes.CHAT_INPUT`. Declared as `number` so the comparison
 * against Oceanic's numeric enums typechecks without importing them at runtime.
 */
const APPLICATION_COMMAND: number = 2;
const CHAT_INPUT: number = 1;

const CHANNEL_TYPES: Record<number, MochiChannelType> = {
  0: "guild_text", // GUILD_TEXT
  1: "dm", // DM
  2: "guild_voice", // GUILD_VOICE
  3: "group_dm", // GROUP_DM
  5: "guild_text", // GUILD_ANNOUNCEMENT
  10: "thread", // ANNOUNCEMENT_THREAD
  11: "thread", // PUBLIC_THREAD
  12: "thread", // PRIVATE_THREAD
  13: "guild_voice", // GUILD_STAGE_VOICE
};

export interface AttachOptions {
  /** Include guild names in join/leave event metadata. Default false. */
  includeGuildNames?: boolean;
  /** Command names to skip entirely. */
  ignoreCommands?: string[];
  /** How often to send guild-count snapshots. Default 1 hour. */
  snapshotIntervalMs?: number;
  /**
   * When false, command events are NOT recorded automatically on
   * interactionCreate — use wrapHandler for accurate success/duration
   * instead. Default true.
   */
  autoTrackCommands?: boolean;
}

/**
 * Hooks a MochiClient into an Oceanic.js client. Returns a detach function
 * that removes every listener and timer it installed.
 *
 * Oceanic runs every shard inside one process, so one snapshot is sent per
 * shard carrying that shard's own guild count — the per-shard reading the
 * ingest API expects.
 */
export function attachMochi(
  client: Client,
  mochi: MochiClient,
  options: AttachOptions = {},
): () => void {
  const {
    includeGuildNames = false,
    ignoreCommands = [],
    snapshotIntervalMs = 60 * 60 * 1000,
    autoTrackCommands = true,
  } = options;
  const ignored = new Set(ignoreCommands);
  let snapshotTimer: ReturnType<typeof setInterval> | null = null;

  const onInteraction = (interaction: AnyInteractionGateway) => {
    if (!autoTrackCommands) return;
    if (interaction.type !== APPLICATION_COMMAND) return;
    const command = interaction as CommandInteraction;
    if (ignored.has(command.data.name)) return;
    mochi.track({
      type: "command",
      name: fullCommandName(command),
      guildId: command.guildID ?? undefined,
      userId: command.user.id,
      channelType: channelTypeOf(command),
      shardId: shardIdOf(client, command.guildID),
      meta: { source: sourceOf(command) },
    });
  };

  const onGuildCreate = (guild: Guild) => {
    mochi.track({
      type: "guild_join",
      guildId: guild.id,
      shardId: guild.shard?.id ?? 0,
      meta: includeGuildNames
        ? { name: guild.name, memberCount: guild.memberCount }
        : { memberCount: guild.memberCount },
    });
  };

  // Oceanic hands back an uncached `{ id }` when the guild was never cached.
  const onGuildDelete = (guild: Guild | Uncached) => {
    const cached = "name" in guild ? guild : null;
    mochi.track({
      type: "guild_leave",
      guildId: guild.id,
      shardId: cached?.shard?.id ?? 0,
      meta: includeGuildNames && cached ? { name: cached.name } : undefined,
    });
  };

  const sendSnapshots = () => {
    const totalShards = Math.max(client.shards.size, 1);
    for (const shard of client.shards.values()) {
      let guildCount = 0;
      let approximateMemberSum = 0;
      for (const guild of client.guilds.values()) {
        if (guild.shard?.id !== shard.id) continue;
        guildCount += 1;
        approximateMemberSum += guild.memberCount ?? 0;
      }
      void mochi.snapshot({
        guildCount,
        shardId: shard.id,
        totalShards,
        approximateMemberSum,
        wsPingMs: pingOf(shard),
      });
    }
  };

  const onReady = () => {
    sendSnapshots();
    snapshotTimer = setInterval(sendSnapshots, snapshotIntervalMs);
    snapshotTimer.unref?.();
  };

  client.on("interactionCreate", onInteraction);
  client.on("guildCreate", onGuildCreate);
  client.on("guildDelete", onGuildDelete);
  if (client.ready) {
    onReady();
  } else {
    client.once("ready", onReady);
  }

  return () => {
    client.off("interactionCreate", onInteraction);
    client.off("guildCreate", onGuildCreate);
    client.off("guildDelete", onGuildDelete);
    client.off("ready", onReady);
    if (snapshotTimer) clearInterval(snapshotTimer);
  };
}

/**
 * Wraps a command handler so Mochi records accurate duration and success.
 * Use together with `autoTrackCommands: false`.
 *
 *   const handler = wrapHandler(mochi, async (interaction) => { ... });
 */
export function wrapHandler<I extends CommandInteraction>(
  mochi: MochiClient,
  handler: (interaction: I) => Promise<unknown> | unknown,
): (interaction: I) => Promise<void> {
  return async (interaction: I) => {
    const startedAt = Date.now();
    let success = true;
    try {
      await handler(interaction);
    } catch (error) {
      success = false;
      throw error;
    } finally {
      mochi.track({
        type: "command",
        name: fullCommandName(interaction),
        guildId: interaction.guildID ?? undefined,
        userId: interaction.user.id,
        channelType: channelTypeOf(interaction),
        success,
        durationMs: Date.now() - startedAt,
        meta: { source: sourceOf(interaction) },
      });
    }
  };
}

/** Builds e.g. "config set" — getSubCommand returns the group/sub path. */
function fullCommandName(interaction: CommandInteraction): string {
  const path = interaction.data.options?.getSubCommand(false) ?? [];
  return [interaction.data.name, ...path].join(" ");
}

function sourceOf(interaction: CommandInteraction): string {
  return interaction.data.type === CHAT_INPUT ? "slash" : "context_menu";
}

function channelTypeOf(interaction: CommandInteraction): MochiChannelType {
  const channel = interaction.channel;
  if (!channel) return interaction.guildID ? "guild_text" : "dm";
  return CHANNEL_TYPES[channel.type] ?? "other";
}

function shardIdOf(client: Client, guildId: string | null): number {
  if (!guildId) return 0;
  return client.guilds.get(guildId)?.shard?.id ?? 0;
}

/** A shard's latency is `Infinity` until its first heartbeat lands. */
function pingOf(shard: Shard): number {
  return Number.isFinite(shard.latency) ? Math.max(0, Math.round(shard.latency)) : 0;
}

export type { MochiClient } from "@mochi-analytics/core";
