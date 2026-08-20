import assert from "node:assert/strict";
import test from "node:test";
import { Command, Help } from "commander";
import { registerMcpCommand } from "../src/commands/mcp.js";
import { mcpExtendedHelp } from "../src/help/mcp-help.js";
import { formatSkilletHelp } from "../src/help-format.js";
import { registerAllCommands } from "../src/commands/register-all.js";

const helper = new Help();

function stripAnsi(text: string): string {
  return text.replace(/\u001b\[[0-9;]*m/g, "");
}

test("mcpExtendedHelp documents tools, sync prerequisite, and client examples", () => {
  const text = mcpExtendedHelp();
  assert.match(text, /list_skills/);
  assert.match(text, /get_skill/);
  assert.match(text, /search_skills/);
  assert.match(text, /skillet sync/);
  assert.match(text, /"command": "skillet"/);
  assert.match(text, /"args": \["mcp"\]/);
  assert.match(text, /mcp-loopback-token/);
  assert.match(text, /skillet:\/\//);
});

test("mcp command help includes extended body", () => {
  const program = new Command("skillet").version("test");
  program.configureHelp({ formatHelp: formatSkilletHelp, sortSubcommands: false });
  registerMcpCommand(program);
  const mcp = program.commands.find((c) => c.name() === "mcp");
  assert.ok(mcp);
  const help = stripAnsi(mcp!.helpInformation());
  assert.match(help, /Serve your kit to MCP agents/);
  assert.match(help, /Before you start/);
  assert.match(help, /--port <number>/);
});

test("root help lists mcp under Sync & share and omits Advanced mcp row", () => {
  const program = new Command("skillet").version("0.1.2");
  program.configureHelp({ formatHelp: formatSkilletHelp, sortSubcommands: false });
  registerAllCommands(program);

  const text = stripAnsi(formatSkilletHelp(program, helper));
  assert.match(text, /Sync & share/);
  assert.match(text, /Serve your kit to MCP agents/);
  assert.doesNotMatch(text, /^\s+route\s/m);
  assert.doesNotMatch(text, /Advanced/);
  assert.doesNotMatch(text, /Agent clients/);
});
