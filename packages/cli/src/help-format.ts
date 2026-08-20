import type { Command, Help } from 'commander';
import { bold, cyan, dim, green, padEndVisible, yellow } from './cli-colors.js';
import { leafExtendedHelp } from './help/leaf-extended-help.js';
import {
  ROOT_FOOTER_POWER_COMMANDS,
  buildRootHelpGroups,
  resolveCommandDescription,
  type HelpGroup,
} from './help/root-surface.js';

function commandPath(cmd: Command): string {
  const names: string[] = [];
  let current: Command | null = cmd;
  while (current) {
    const name = current.name();
    if (name && name !== 'skillet') names.unshift(name);
    current = current.parent;
  }
  return names.join(' ');
}

function renderGroups(groups: HelpGroup[]): string[] {
  const lines: string[] = [];
  const usageWidth = Math.min(
    36,
    Math.max(20, ...groups.flatMap((g) => g.rows.map((r) => r.usage.length))),
  );

  for (const group of groups) {
    lines.push(yellow(group.title));
    for (const row of group.rows) {
      const usageCol = padEndVisible(cyan(row.usage), usageWidth);
      lines.push(`  ${usageCol}  ${dim(row.description)}`);
    }
    lines.push('');
  }
  return lines;
}

function renderRootHelp(cmd: Command): string {
  const lines: string[] = [];
  const version = cmd.version() ?? '';
  lines.push(bold(`Skillet ${version}`) + dim('   Your skills, everywhere.'));
  lines.push('');
  lines.push(bold('Usage'));
  lines.push(`  ${padEndVisible(cyan('skillet'), 20)}${dim('first run: connect, then sync')}`);
  lines.push(`  ${padEndVisible(cyan('skillet <command>'), 20)}${dim('run any command below')}`);
  lines.push('');
  lines.push(
    ...renderGroups(buildRootHelpGroups((id) => resolveCommandDescription(cmd, id))),
  );
  // Footer: two aligned lines, no backtick-`skillet` repetition, no em-dash.
  const footLabel = (s: string): string => dim(padEndVisible(s, 16));
  lines.push(`${footLabel('More commands')}${dim(ROOT_FOOTER_POWER_COMMANDS.join(' · '))}`);
  lines.push(`${footLabel('Details')}${dim('skillet <command> --help')}`);
  return lines.join('\n');
}

function renderGroupHelp(cmd: Command, helper: Help): string {
  const path = commandPath(cmd);
  const lines: string[] = [];
  lines.push(bold(path) + (cmd.description() ? dim(`   ${cmd.description()}`) : ''));
  lines.push('');
  lines.push(bold('Usage'));
  lines.push(`  ${cyan(`skillet ${path}`)} <command> [options]`);
  lines.push('');

  const subcommands = helper.visibleCommands(cmd);
  if (subcommands.length > 0) {
    lines.push(yellow('Commands'));
    const usageWidth = Math.min(
      32,
      Math.max(16, ...subcommands.map((c) => helper.subcommandTerm(c).length)),
    );
    for (const sub of subcommands) {
      const term = helper.subcommandTerm(sub);
      const usageCol = padEndVisible(cyan(term), usageWidth);
      const desc = sub.description() ?? '';
      lines.push(`  ${usageCol}  ${dim(desc)}`);
    }
    lines.push('');
  }

  const globalOpts = helper.visibleGlobalOptions(cmd);
  const opts = helper.visibleOptions(cmd);
  const allOpts = [...globalOpts, ...opts];
  if (allOpts.length > 0) {
    lines.push(yellow('Options'));
    for (const opt of allOpts) {
      lines.push(`  ${dim(helper.optionTerm(opt))}`);
      if (opt.description) lines.push(`    ${dim(opt.description)}`);
    }
    lines.push('');
  }

  lines.push(dim(`Run \`skillet ${path} <command> --help\` for command-specific options.`));
  return lines.join('\n');
}

function renderLeafHelp(cmd: Command, helper: Help): string {
  const path = commandPath(cmd);
  const lines: string[] = [];
  const title = path.length > 0 ? `skillet ${path}` : 'skillet';
  lines.push(bold(title) + (cmd.description() ? dim(`   ${cmd.description()}`) : ''));
  lines.push('');
  lines.push(bold('Usage'));
  lines.push(`  ${cyan(helper.commandUsage(cmd))}`);
  lines.push('');

  const opts = [...helper.visibleGlobalOptions(cmd), ...helper.visibleOptions(cmd)];
  if (opts.length > 0) {
    lines.push(yellow('Options'));
    const termWidth = Math.max(20, ...opts.map((o) => helper.optionTerm(o).length));
    for (const opt of opts) {
      const term = padEndVisible(green(helper.optionTerm(opt)), termWidth);
      lines.push(`  ${term}  ${dim(opt.description ?? '')}`);
    }
    lines.push('');
  }

  const args = cmd.registeredArguments;
  if (args.length > 0) {
    lines.push(yellow('Arguments'));
    for (const arg of args) {
      lines.push(`  ${cyan(arg.name())}  ${dim(arg.description ?? '')}`);
    }
    lines.push('');
  }

  const extra = leafExtendedHelp(path);
  if (extra) {
    lines.push('');
    lines.push(extra);
  }

  return lines.join('\n');
}

/** Colorful help for skillet and subcommands. */
export function formatSkilletHelp(cmd: Command, helper: Help): string {
  const isRoot = cmd.parent === null;
  if (isRoot) return renderRootHelp(cmd);
  if (cmd.commands.length > 0) return renderGroupHelp(cmd, helper);
  return renderLeafHelp(cmd, helper);
}
