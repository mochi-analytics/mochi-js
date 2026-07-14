# @mochi-analytics/eris

Eris adapter for Mochi analytics.

## Install

```sh
npm install @mochi-analytics/core @mochi-analytics/eris eris
```

## Usage

```ts
import { MochiClient } from "@mochi-analytics/core";
import { attachMochi } from "@mochi-analytics/eris";

const mochi = new MochiClient({
  url: "https://mochi.example.com",
  apiKey: process.env.MOCHI_API_KEY!,
});

const detachMochi = attachMochi(client, mochi);
```

Eris runs every shard inside one process, so one snapshot is sent per shard,
each carrying that shard's own guild count.

See the [Eris guide](https://mochi.software/sdks/eris) for the full documentation.

## Community

Questions? Join the [Mochi Discord](https://discord.gg/59z89Ke4bt).

## License

Apache-2.0
