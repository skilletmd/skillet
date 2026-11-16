# @skillet/adapters-cursor

Detects a Cursor install. Cursor reads the universal `.agents/skills` folders the
Codex baseline already writes, so this adapter labels Cursor as a runtime and adds
no second copy; sync sweeps the `.cursor/rules/*.mdc` rules the old writer left.

**Internal to [Skillet](https://skillet.md).** This package is part of the Skillet
monorepo and is not published as a standalone install — the public entry point is
the [`skilletmd`](../../cli/README.md) command-line client. For what Skillet is
and how the packages fit together, see the [monorepo README](../../../README.md).

## License

[Apache-2.0](../../../LICENSE)
