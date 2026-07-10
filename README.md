<p align="center">
  <img src="assets/logo.png" alt="" width="96" height="96">
</p>

# Mochi JavaScript SDK

JavaScript and TypeScript SDK packages for [Mochi](https://github.com/mochi-analytics/mochi), self-hosted analytics for Discord bots.

## Packages

- `@mochi-analytics/core` - generic batching HTTP client for Mochi ingest and snapshot APIs
- `@mochi-analytics/discordjs` - discord.js v14 adapter for command, guild, and health instrumentation
- `@mochi-analytics/eris` - Eris adapter
- `@mochi-analytics/oceanic` - Oceanic.js adapter
- `@mochi-analytics/sapphire` - Sapphire framework adapter, with `success` and `duration` recorded for free

Every adapter exposes the same `attachMochi(client, mochi, options)` returning a
`detach` function. Future JavaScript Discord libraries should be added under
`packages/` and depend on `@mochi-analytics/core`.

## Install

```sh
npm install @mochi-analytics/core @mochi-analytics/discordjs
```

```ts
import { MochiClient } from "@mochi-analytics/core";
import { attachMochi } from "@mochi-analytics/discordjs";

const mochi = new MochiClient({
  url: "https://mochi.example.com",
  apiKey: process.env.MOCHI_API_KEY!,
});

attachMochi(client, mochi);
```

Full guides live at [docs.mochis.dev/sdks](https://docs.mochis.dev/sdks), one per
library — [discord.js](https://docs.mochis.dev/sdks/discordjs),
[Eris](https://docs.mochis.dev/sdks/eris),
[Oceanic.js](https://docs.mochis.dev/sdks/oceanic), and
[Sapphire](https://docs.mochis.dev/sdks/sapphire). They are maintained in the
[mochi-docs](https://github.com/mochi-analytics/mochi-docs) repo, which is the
single source of truth for documentation.

## Development

```sh
pnpm install
pnpm test
pnpm build
pnpm typecheck
```

## Releases

Release PRs are managed by Release Please. Publishing is handled by the `Publish` GitHub Actions workflow when a package release is published, or manually through workflow dispatch.

Publishing uses npm trusted publishing with GitHub Actions OIDC. Configure each npm package with this trusted publisher:

- Provider: GitHub Actions
- Repository: `mochi-analytics/mochi-js`
- Workflow filename: `publish.yml`
- Allowed action: `npm publish`

## License

Apache-2.0
