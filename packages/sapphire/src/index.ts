import type { MochiChannelType, MochiClient } from "@mochi-analytics/core";
import { attachMochi as attachDiscordJs } from "@mochi-analytics/discordjs";
import type {
  ChatInputCommandErrorPayload,
  ChatInputCommandFinishPayload,
  ContextMenuCommandErrorPayload,
  ContextMenuCommandFinishPayload,
  SapphireClient,
} from "@sapphire/framework";
import type {
  ChatInputCommandInteraction,
  CommandInteraction,
  ContextMenuCommandInteraction,
} from "discord.js";

export interface AttachOptions {
  /** Include guild names in join/leave event metadata. Default false. */
  includeGuildNames?: boolean;
  /** Command names to skip entirely. */
  ignoreCommands?: string[];
  /** How often to send guild-count snapshots. Default 1 hour. */
  snapshotIntervalMs?: number;
  /** When false, command events are NOT recorded. Default true. */
  autoTrackCommands?: boolean;
  /**
   * Also emit a Mochi `error` event carrying the thrown message whenever a
   * command rejects. This is in addition to the command event, which already
   * reports `success: false`. Default false.
   */
  trackErrors?: boolean;
}

/**
 * Hooks a MochiClient into a Sapphire client. Returns a detach function that
 * removes every listener and timer it installed.
 *
 * Unlike the bare discord.js adapter, Sapphire reports the outcome and wall
 * time of every command through its `*CommandFinish` events, so `success` and
 * `durationMs` are recorded automatically — there is no `wrapHandler` to apply.
 */
export function attachMochi(
  client: SapphireClient,
  mochi: MochiClient,
  options: AttachOptions = {},
): () => void {
  const {
    includeGuildNames = false,
    ignoreCommands = [],
    snapshotIntervalMs = 60 * 60 * 1000,
    autoTrackCommands = true,
    trackErrors = false,
  } = options;
  const ignored = new Set(ignoreCommands);

  // SapphireClient extends the discord.js Client, so guild events and health
  // snapshots are already handled. Command tracking is ours: Sapphire's
  // lifecycle events carry success and duration, which interactionCreate cannot.
  const detachDiscordJs = attachDiscordJs(client, mochi, {
    includeGuildNames,
    snapshotIntervalMs,
    autoTrackCommands: false,
  });

  const trackFinish = (
    interaction: CommandInteraction,
    commandName: string,
    payload: { success: boolean; duration: number },
    source: "slash" | "context_menu",
  ) => {
    if (!autoTrackCommands) return;
    if (ignored.has(commandName)) return;
    mochi.track({
      type: "command",
      name: fullCommandName(interaction),
      guildId: interaction.guildId ?? undefined,
      userId: interaction.user.id,
      channelType: channelTypeOf(interaction),
      success: payload.success,
      // Sapphire measures in fractional milliseconds.
      durationMs: Math.max(0, Math.round(payload.duration)),
      meta: { source },
    });
  };

  const trackError = (
    interaction: CommandInteraction,
    commandName: string,
    error: unknown,
  ) => {
    if (!trackErrors) return;
    if (ignored.has(commandName)) return;
    mochi.track({
      type: "error",
      name: commandName,
      guildId: interaction.guildId ?? undefined,
      userId: interaction.user.id,
      channelType: channelTypeOf(interaction),
      meta: { message: messageOf(error) },
    });
  };

  const onChatInputFinish = (
    interaction: ChatInputCommandInteraction,
    command: { name: string },
    payload: ChatInputCommandFinishPayload,
  ) => trackFinish(interaction, command.name, payload, "slash");

  const onContextMenuFinish = (
    interaction: ContextMenuCommandInteraction,
    command: { name: string },
    payload: ContextMenuCommandFinishPayload,
  ) => trackFinish(interaction, command.name, payload, "context_menu");

  const onChatInputError = (
    error: unknown,
    payload: ChatInputCommandErrorPayload,
  ) => trackError(payload.interaction, payload.command.name, error);

  const onContextMenuError = (
    error: unknown,
    payload: ContextMenuCommandErrorPayload,
  ) => trackError(payload.interaction, payload.command.name, error);

  // String literals rather than the `Events` enum so nothing is imported from
  // the peer at runtime. They match Events.ChatInputCommandFinish etc.
  client.on("chatInputCommandFinish", onChatInputFinish);
  client.on("contextMenuCommandFinish", onContextMenuFinish);
  client.on("chatInputCommandError", onChatInputError);
  client.on("contextMenuCommandError", onContextMenuError);

  return () => {
    client.off("chatInputCommandFinish", onChatInputFinish);
    client.off("contextMenuCommandFinish", onContextMenuFinish);
    client.off("chatInputCommandError", onChatInputError);
    client.off("contextMenuCommandError", onContextMenuError);
    detachDiscordJs();
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

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export type { MochiClient } from "@mochi-analytics/core";
