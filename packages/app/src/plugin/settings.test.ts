import { describe, expect, it } from "vitest";
import {
  DEFAULT_DATABASE_PATH,
  normalizePluginSettings,
} from "./settings";

describe("plugin settings", () => {
  it("normalizes missing settings to plugin-owned defaults", () => {
    expect(normalizePluginSettings(null)).toEqual({
      runtimeDir: "",
      databasePath: DEFAULT_DATABASE_PATH,
      entityDir: "wiki",
      preferredLang: "zh",
      noteGlobs: ["**/*.md"],
    });
  });

  it("keeps absolute runtime paths and normalizes vault paths", () => {
    expect(
      normalizePluginSettings({
        runtimeDir: " /tmp/runtime/ ",
        databasePath: " .obsidian\\plugins\\wikipage-spine\\db.sqlite ",
        entityDir: "/wiki/entities/",
        preferredLang: "en",
        noteGlobs: "Daily/*.md\nProjects/*.md",
      }),
    ).toEqual({
      runtimeDir: "/tmp/runtime",
      databasePath: ".obsidian/plugins/wikipage-spine/db.sqlite",
      entityDir: "wiki/entities",
      preferredLang: "en",
      noteGlobs: ["Daily/*.md", "Projects/*.md"],
    });
  });
});
