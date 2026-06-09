import { PACKAGE_NAME } from "../core/project-info";
import { resolveVaultDir } from "./plugin-config";

interface ParsedArgs {
  command: string | undefined;
  vault: string | undefined;
  note: string | undefined;
  help: boolean;
}

void main(process.argv.slice(2)).catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`${PACKAGE_NAME}: ${message}`);
  process.exitCode = 1;
});

async function main(argv: string[]): Promise<void> {
  const args = parseArgs(argv);
  if (args.help || args.command === undefined) {
    printHelp();
    return;
  }

  const vaultDir = resolveVaultDir(args.vault ?? process.env.VAULT);
  switch (args.command) {
    case "sync-note": {
      if (args.note === undefined) {
        throw new Error("Missing note path. Usage: wikipage-spine sync-note <note.md> --vault <vault>");
      }
      const { syncNote } = await import("./sync-note");
      const result = syncNote({ vaultDir, note: args.note });
      console.log(JSON.stringify(result, null, 2));
      return;
    }
    default:
      throw new Error(`Unknown command: ${args.command}`);
  }
}

function parseArgs(argv: string[]): ParsedArgs {
  const positional: string[] = [];
  let vault: string | undefined;
  let note: string | undefined;
  let help = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === undefined) {
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      help = true;
      continue;
    }
    if (arg === "--vault") {
      vault = readOptionValue(argv, (index += 1), "--vault");
      continue;
    }
    if (arg.startsWith("--vault=")) {
      vault = arg.slice("--vault=".length);
      continue;
    }
    if (arg === "--note") {
      note = readOptionValue(argv, (index += 1), "--note");
      continue;
    }
    if (arg.startsWith("--note=")) {
      note = arg.slice("--note=".length);
      continue;
    }
    if (arg.startsWith("-")) {
      throw new Error(`Unknown option: ${arg}`);
    }
    positional.push(arg);
  }

  return {
    command: positional[0],
    vault,
    note: note ?? positional[1],
    help,
  };
}

function readOptionValue(argv: string[], index: number, name: string): string {
  const value = argv[index];
  if (value === undefined || value.startsWith("-")) {
    throw new Error(`Missing value for ${name}`);
  }
  return value;
}

function printHelp(): void {
  console.log(`Usage:
  wikipage-spine sync-note <note.md> --vault <vault>
  VAULT=<vault> wikipage-spine sync-note <note.md>

Commands:
  sync-note   Synchronize one Markdown note through the installed Obsidian plugin settings.`);
}
