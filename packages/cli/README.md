# skilletmd

Your skills, everywhere. `skillet` is the command-line client for
[Skillet](https://skillet.md) — a package manager for agent skills. Author your
skills once as `SKILL.md` folders (the open [agentskills.io](https://agentskills.io)
format) and sync them to every computer, agent, and surface you use, then share
them with people you trust.

## Install

No install step — run it with `npx`:

```bash
npx skilletmd
```

Requires **Node.js 22+**.

## Getting started

Sign in once (passwordless), link the machine with a pair code, and sync:

```bash
npx skilletmd login        # passwordless sign-in to skillet.md
npx skilletmd connect      # link this machine with a pair code
                                # (skillet.md → Settings → Devices)
npx skilletmd sync         # pull your kit down / push local changes
```

After the first `connect`, every machine you pair stays in sync.

## Common commands

| Command | What it does |
|---|---|
| `login` / `auth` | Passwordless sign-in and registry session management. |
| `connect` | Link this machine with a pair code from skillet.md → Settings → Devices. |
| `sync` | Reconcile this machine with your kit — pull new versions, push local edits. |
| `status` | Show the harm-scan safety state for your kit's skills (alias: `scan`). |
| `list` | List the skills in your kit. |
| `add` | Add a skill from the registry to your kit. |
| `import` | Import skills from a local folder or a linked GitHub repo. |
| `export` | Export skills to a portable bundle. |
| `publish` | Publish a skill version to the registry. |
| `mcp` | Serve your kit to MCP agents (Claude Desktop, Cursor, Claude Code). |
| `web` | Open skillet.md in your browser. |

Run `npx skilletmd --help` for the full command list, and
`npx skilletmd <command> --help` for a specific command.

## Learn more

- [Skillet on the web](https://skillet.md)
- [What Skillet is and how it fits together](https://github.com/skilletmd/skillet#readme) (monorepo README)

## License

[Apache-2.0](https://github.com/skilletmd/skillet/blob/main/LICENSE)
