# @mochi-analytics/oceanic

Oceanic.js adapter for Mochi analytics.

## Install

```sh
npm install @mochi-analytics/core @mochi-analytics/oceanic oceanic.js
```

## Usage

```ts
import { MochiClient } from "@mochi-analytics/core";
import { attachMochi } from "@mochi-analytics/oceanic";

const mochi = new MochiClient({
  url: "https://mochi.example.com",
  apiKey: process.env.MOCHI_API_KEY!,
});

const detachMochi = attachMochi(client, mochi);
```

Oceanic runs every shard inside one process, so one snapshot is sent per shard,
each carrying that shard's own guild count.

See the [Oceanic.js guide](https://mochi.software/sdks/oceanic) for the full documentation.

## License

Apache-2.0
