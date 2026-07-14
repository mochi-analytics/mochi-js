# @mochi-analytics/discordjs

discord.js v14 adapter for Mochi analytics.

## Install

```sh
npm install @mochi-analytics/core @mochi-analytics/discordjs discord.js
```

## Usage

```ts
import { MochiClient } from "@mochi-analytics/core";
import { attachMochi } from "@mochi-analytics/discordjs";

const mochi = new MochiClient({
  url: "https://mochi.example.com",
  apiKey: process.env.MOCHI_API_KEY!,
});

const detachMochi = attachMochi(client, mochi);
```

See the [discord.js guide](https://mochi.software/sdks/discordjs) for the full documentation.

## License

Apache-2.0
