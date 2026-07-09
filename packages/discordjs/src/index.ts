import type { MochiChannelType, MochiClient } from "@mochi-analytics/core";
import type {
  Client,
  CommandInteraction,
  Guild,
  Interaction,
} from "discord.js";

export interface AttachOptions {
  /** Include guild names in join/leave event metadata. Default false. */
  includeGuildNames?: boolean;
  /** Command names to skip entirely. */
  ignoreCommands?: string[];
  /** How often to send guild-count snapshots. Default 1 hour. */
  snapshotIntervalMs?: number;
  /**
   * When false, command events are NOT recorded automatically on
   * interactionCreate — use wrapHandler/trackCommand for accurate
   * success/duration instead. Default true.
   */
  autoTrackCommands?: boolean;
}

/**
 * Hooks a MochiClient into a discord.js v14 client. Returns a detach
 * function that removes every listener and timer it installed.
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

  const onInteraction = (interaction: Interaction) => {
    if (!autoTrackCommands) return;
    if (!interaction.isChatInputCommand() && !interaction.isContextMenuCommand()) {
      return;
    }
    const name = fullCommandName(interaction);
    if (ignored.has(interaction.commandName)) return;
    mochi.track({
      type: "command",
      name,
      guildId: interaction.guildId ?? undefined,
      userId: interaction.user.id,
      channelType: channelTypeOf(interaction),
      shardId: shardIdOf(client),
      meta: {
        source: interaction.isChatInputCommand() ? "slash" : "context_menu",
      },
    });
  };

  const onGuildCreate = (guild: Guild) => {
    mochi.track({
      type: "guild_join",
      guildId: guild.id,
      shardId: shardIdOf(client),
      meta: includeGuildNames
        ? { name: guild.name, memberCount: guild.memberCount }
        : { memberCount: guild.memberCount },
    });
  };

  const onGuildDelete = (guild: Guild) => {
    mochi.track({
      type: "guild_leave",
      guildId: guild.id,
      shardId: shardIdOf(client),
      meta: includeGuildNames ? { name: guild.name } : undefined,
    });
  };

  const sendSnapshot = () => {
    void mochi.snapshot({
      guildCount: client.guilds.cache.size,
      shardId: shardIdOf(client),
      totalShards: totalShardsOf(client),
      approximateMemberSum: client.guilds.cache.reduce(
        (sum, guild) => sum + (guild.memberCount ?? 0),
        0,
      ),
      wsPingMs: Math.max(0, Math.round(client.ws.ping)),
    });
  };

  const onReady = () => {
    sendSnapshot();
    snapshotTimer = setInterval(sendSnapshot, snapshotIntervalMs);
    snapshotTimer.unref?.();
  };

  client.on("interactionCreate", onInteraction);
  client.on("guildCreate", onGuildCreate);
  client.on("guildDelete", onGuildDelete);
  if (client.isReady()) {
    onReady();
  } else {
    client.once("clientReady" as never, onReady);
  }

  return () => {
    client.off("interactionCreate", onInteraction);
    client.off("guildCreate", onGuildCreate);
    client.off("guildDelete", onGuildDelete);
    client.off("clientReady" as never, onReady);
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
        guildId: interaction.guildId ?? undefined,
        userId: interaction.user.id,
        channelType: channelTypeOf(interaction),
        success,
        durationMs: Date.now() - startedAt,
        meta: { source: "slash" },
      });
    }
  };
}

function fullCommandName(interaction: CommandInteraction): string {
  if (interaction.isChatInputCommand()) {
    const group = interaction.options.getSubcommandGroup(false);
    const sub = interaction.options.getSubcommand(false);
    return [interaction.commandName, group, sub].filter(Boolean).join(" ");
  }
  return interaction.commandName;
}

function channelTypeOf(interaction: CommandInteraction): MochiChannelType {
  const channel = interaction.channel;
  if (!channel) return interaction.guildId ? "guild_text" : "dm";
  if (channel.isDMBased()) return "dm";
  if (channel.isThread()) return "thread";
  if (channel.isVoiceBased()) return "guild_voice";
  return "guild_text";
}

function shardIdOf(client: Client): number {
  return client.shard?.ids[0] ?? 0;
}

function totalShardsOf(client: Client): number {
  const count = client.options.shardCount;
  return typeof count === "number" && count > 0 ? count : 1;
}

export type { MochiClient } from "@mochi-analytics/core";