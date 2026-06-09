import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, join, resolve, sep } from "node:path";
import { PLUGIN_ID } from "../core/project-info";
import {
  normalizePluginSettings,
  type PluginSettings,
} from "../plugin/settings";

export interface VaultContext {
  vaultDir: string;
  pluginDir: string;
  settings: PluginSettings;
}

export function resolveVaultDir(value: string | undefined): string {
  if (value === undefined || value.trim() === "") {
    throw new Error("Missing vault. Pass --vault <path> or set VAULT.");
  }
  return resolve(value);
}

export function loadVaultContext(vaultDir: string): VaultContext {
  const pluginDir = join(vaultDir, ".obsidian", "plugins", PLUGIN_ID);
  const manifestPath = join(pluginDir, "manifest.json");
  const dataPath = join(pluginDir, "data.json");
  if (!existsSync(manifestPath)) {
    throw new Error(
      `WikiPage Spine plugin is not installed in this vault: ${pluginDir}`,
    );
  }
  if (!existsSync(dataPath)) {
    throw new Error(
      `WikiPage Spine plugin settings are missing: ${dataPath}. Open Obsidian once after installing the plugin.`,
    );
  }

  return {
    vaultDir,
    pluginDir,
    settings: normalizePluginSettings(
      JSON.parse(readFileSync(dataPath, "utf8")) as Partial<PluginSettings>,
    ),
  };
}

export function resolveConfiguredPath(vaultDir: string, configured: string): string {
  return isAbsolute(configured) ? configured : join(vaultDir, configured);
}

export function resolveNotePath(vaultDir: string, note: string): {
  absolutePath: string;
  viewPath: string;
} {
  const absolutePath = isAbsolute(note) ? resolve(note) : resolve(vaultDir, note);
  const vaultPrefix = vaultDir.endsWith(sep) ? vaultDir : `${vaultDir}${sep}`;
  if (absolutePath !== vaultDir && !absolutePath.startsWith(vaultPrefix)) {
    throw new Error(`Note must be inside the vault: ${note}`);
  }
  const viewPath = absolutePath.slice(vaultPrefix.length).replace(/\\/g, "/");
  if (!viewPath.endsWith(".md")) {
    throw new Error(`Note must be a Markdown file: ${viewPath}`);
  }
  return { absolutePath, viewPath };
}
