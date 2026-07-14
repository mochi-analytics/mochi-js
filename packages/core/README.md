# @mochi-analytics/core

Core JavaScript and TypeScript client for Mochi analytics.

## Install

```sh
npm install @mochi-analytics/core
```

## Usage

```ts
import { MochiClient } from "@mochi-analytics/core";

const mochi = new MochiClient({
  url: "https://mochi.example.com",
  apiKey: process.env.MOCHI_API_KEY!,
});

mochi.trackCommand("ping", {
  guildId: "123",
  userId: "456",
  success: true,
});

await mochi.shutdown();
```

## Community

Questions? Join the [Mochi Discord](https://discord.gg/59z89Ke4bt).

## License

Apache-2.0
