import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdtempSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PLUGIN_ID } from "../core/project-info";
import {
  loadVaultContext,
  resolveNotePath,
  resolveVaultDir,
} from "./plugin-config";

describe("CLI plugin config", () => {
  it("requires an explicit vault", () => {
    expect(() => resolveVaultDir(undefined)).toThrow("Missing vault");
  });

  it("loads settings from the installed plugin directory", () => {
    const vault = mkdtempSync(join(tmpdir(), "wikipage-spine-vault-"));
    const pluginDir = join(vault, ".obsidian", "plugins", PLUGIN_ID);
    mkdirSync(pluginDir, { recursive: true });
    writeFileSync(join(pluginDir, "manifest.json"), "{}", "utf8");
    writeFileSync(
      join(pluginDir, "data.json"),
      JSON.stringify({
        runtimeDir: "/tmp/runtime",
        databasePath: ".obsidian/plugins/wikipage-spine/test.sqlite",
        entityDir: "wiki",
        preferredLang: "en",
        noteGlobs: ["Notes/*.md"],
      }),
      "utf8",
    );

    expect(loadVaultContext(vault)).toMatchObject({
      vaultDir: vault,
      pluginDir,
      settings: {
        runtimeDir: "/tmp/runtime",
        preferredLang: "en",
        noteGlobs: ["Notes/*.md"],
      },
    });
  });

  it("keeps note targets inside the vault", () => {
    const vault = mkdtempSync(join(tmpdir(), "wikipage-spine-vault-"));
    expect(resolveNotePath(vault, "Notes/A.md")).toMatchObject({
      viewPath: "Notes/A.md",
    });
    expect(() => resolveNotePath(vault, "../A.md")).toThrow(
      "Note must be inside the vault",
    );
  });
});
