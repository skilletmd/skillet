# @skillet/adapters-opencode

Per-runtime materializer that writes Skillet skills into the layout opencode
expects. opencode reads Agent Skills from `.agents/skills` (the same location
Codex uses), so this adapter shares that write path with `@skillet/adapters-codex`
and differs only in how it detects an opencode install.

**Internal to [Skillet](https://skillet.md).** This package is part of the Skillet
monorepo and is not published as a standalone install — the public entry point is
the [`skilletmd`](../../cli/README.md) command-line client. For what Skillet is
and how the packages fit together, see the [monorepo README](../../../README.md).

## License

[Apache-2.0](../../../LICENSE)
