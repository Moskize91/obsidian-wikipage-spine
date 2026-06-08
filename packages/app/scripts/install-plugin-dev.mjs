import fs from "node:fs/promises";
import path from "node:path";

async function loadEnvFile(filePath) {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) {
        continue;
      }
      const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
      if (!match) {
        continue;
      }
      const [, key, value] = match;
      if (process.env[key] === undefined) {
        process.env[key] = value.replace(/^"(.*)"$/, "$1").replace(/^'(.*)'$/, "$1");
      }
    }
  } catch (error) {
    if (error?.code !== "ENOENT") {
      throw error;
    }
  }
}

async function copyDir(source, target) {
  await fs.mkdir(target, { recursive: true });
  const entries = await fs.readdir(source, { withFileTypes: true });
  for (const entry of entries) {
    const sourcePath = path.join(source, entry.name);
    const targetPath = path.join(target, entry.name);
    if (entry.isDirectory()) {
      await fs.rm(targetPath, { recursive: true, force: true });
      await copyDir(sourcePath, targetPath);
    } else {
      await fs.copyFile(sourcePath, targetPath);
    }
  }
}

async function cleanTarget(target) {
  await fs.mkdir(target, { recursive: true });
  const entries = await fs.readdir(target, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === "data.json") {
      continue;
    }
    await fs.rm(path.join(target, entry.name), { recursive: true, force: true });
  }
}

await loadEnvFile(path.resolve(".env.local"));

const vault = process.env.OBSIDIAN_DEV_VAULT;
const pluginId = process.env.OBSIDIAN_PLUGIN_ID ?? "wikipage-spine";
if (!vault) {
  throw new Error("Missing OBSIDIAN_DEV_VAULT.");
}

const target = path.join(vault, ".obsidian", "plugins", pluginId);
await cleanTarget(target);
await copyDir(path.resolve("plugin-dist"), target);
console.log(`Installed plugin build to ${target}`);
