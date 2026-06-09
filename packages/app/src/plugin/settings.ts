import { PLUGIN_ID } from "../core/project-info";

export type PreferredLanguage = "zh" | "en";

export interface PluginSettings {
  runtimeDir: string;
  databasePath: string;
  entityDir: string;
  preferredLang: PreferredLanguage;
  noteGlobs: string[];
}

export const DEFAULT_DATABASE_PATH = `.obsidian/plugins/${PLUGIN_ID}/wikipage-spine.sqlite`;
export const DEFAULT_ENTITY_DIR = "wiki";
export const DEFAULT_NOTE_GLOBS = ["**/*.md"] as const;

type RawPluginSettings = Partial<
  Omit<PluginSettings, "noteGlobs"> & {
    noteGlobs: unknown;
  }
>;

export function getDefaultPluginSettings(): PluginSettings {
  return {
    runtimeDir: "",
    databasePath: DEFAULT_DATABASE_PATH,
    entityDir: DEFAULT_ENTITY_DIR,
    preferredLang: "zh",
    noteGlobs: [...DEFAULT_NOTE_GLOBS],
  };
}

export function normalizePluginSettings(
  raw: RawPluginSettings | null | undefined,
): PluginSettings {
  const defaults = getDefaultPluginSettings();
  return {
    runtimeDir:
      typeof raw?.runtimeDir === "string"
        ? normalizePathSetting(raw.runtimeDir)
        : defaults.runtimeDir,
    databasePath:
      typeof raw?.databasePath === "string" && raw.databasePath.trim()
        ? normalizePathSetting(raw.databasePath)
        : defaults.databasePath,
    entityDir:
      typeof raw?.entityDir === "string" && raw.entityDir.trim()
        ? normalizeVaultFolderPath(raw.entityDir)
        : defaults.entityDir,
    preferredLang:
      raw?.preferredLang === "en" || raw?.preferredLang === "zh"
        ? raw.preferredLang
        : defaults.preferredLang,
    noteGlobs: normalizeNoteGlobs(raw?.noteGlobs, defaults.noteGlobs),
  };
}

export function normalizePathSetting(value: string): string {
  return value.trim().replace(/\\/g, "/").replace(/\/+$/g, "");
}

export function normalizeVaultFolderPath(value: string): string {
  return normalizePathSetting(value).replace(/^\/+/g, "");
}

function normalizeNoteGlobs(
  raw: unknown,
  fallback: readonly string[],
): string[] {
  const values =
    typeof raw === "string"
      ? raw.split(/\r?\n|,/)
      : Array.isArray(raw)
        ? raw
        : fallback;
  const normalized = values
    .filter((value): value is string => typeof value === "string")
    .map((value) => value.trim())
    .filter(Boolean);
  return normalized.length > 0 ? normalized : [...fallback];
}
