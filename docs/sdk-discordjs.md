# discord.js SDK

```sh
npm install @mochi-analytics/core @mochi-analytics/discordjs
```

## Quick start

```ts
import { Client, GatewayIntentBits } from "discord.js";
import { MochiClient } from "@mochi-analytics/core";
import { attachMochi } from "@mochi-analytics/discordjs";

const mochi = new MochiClient({
  url: "https://mochi.example.com",   // your Mochi instance
  apiKey: process.env.MOCHI_API_KEY!, // from the bot's settings page
});

const client = new Client({ intents: [GatewayIntentBits.Guilds] });
attachMochi(client, mochi);

client.login(process.env.DISCORD_TOKEN);

process.on("SIGTERM", async () => {
  await mochi.shutdown(); // flush remaining events
  client.destroy();
});
```

That's it. Mochi now records slash/context-menu command usage, guild joins
and leaves, and an hourly server-count snapshot.

## Options

```ts
attachMochi(client, mochi, {
  includeGuildNames: true,        // put guild names in join/leave metadata
  ignoreCommands: ["ping"],       // skip noisy commands
  snapshotIntervalMs: 30 * 60e3,  // default 1 hour
  autoTrackCommands: false,       // see "accurate timings" below
});
```

## Accurate duration & success

Auto-tracking records commands the moment the interaction arrives — it can't
see whether your handler succeeded or how long it took. For that, disable
auto-tracking and wrap your handlers:

```ts
import { wrapHandler } from "@mochi-analytics/discordjs";

attachMochi(client, mochi, { autoTrackCommands: false });

const play = wrapHandler(mochi, async (interaction) => {
  // your command logic — duration and thrown errors are recorded
});
```

## Custom events

```ts
mochi.track({
  type: "custom",
  name: "premium_purchased",
  userId: interaction.user.id,
  guildId: interaction.guildId ?? undefined,
  meta: { tier: "gold" },
});
```

## Design guarantees

- Events are batched (flushed every 5 s or 100 events) and sent in the
  background — `track()` never blocks or throws.
- Transient failures retry with backoff; the queue is bounded (oldest
  dropped first), so a dead Mochi instance can never leak memory or crash
  the bot.
- Raw user ids are hashed server-side with a per-bot salt and never stored.

## Other libraries / languages

Everything above is a thin wrapper over two HTTP endpoints — see
[ingest-api.md](./ingest-api.md) to integrate from discord.py, serenity, or
anything else.
