# @mochi-analytics/sapphire

Sapphire framework adapter for Mochi analytics.

## Install

```sh
npm install @mochi-analytics/core @mochi-analytics/sapphire @sapphire/framework discord.js
```

## Usage

```ts
import { MochiClient } from "@mochi-analytics/core";
import { attachMochi } from "@mochi-analytics/sapphire";

const mochi = new MochiClient({
  url: "https://mochi.example.com",
  apiKey: process.env.MOCHI_API_KEY!,
});

const detachMochi = attachMochi(client, mochi);
```

Sapphire reports the outcome and wall time of every command through its
`chatInputCommandFinish` and `contextMenuCommandFinish` events, so `success` and
`durationMs` are recorded automatically — there is no handler to wrap.

Guild events and health snapshots come from `@mochi-analytics/discordjs`, which
`SapphireClient` extends.

See the [Sapphire guide](https://mochi.software/sdks/sapphire) for the full documentation.

## License

Apache-2.0
