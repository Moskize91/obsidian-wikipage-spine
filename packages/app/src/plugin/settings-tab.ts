import { App, PluginSettingTab, Setting } from "obsidian";
import type WikiPageSpinePlugin from "./main";

export class WikiPageSpineSettingTab extends PluginSettingTab {
  constructor(
    app: App,
    private readonly plugin: WikiPageSpinePlugin,
  ) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl)
      .setName("Runtime dataset")
      .setDesc("Directory containing the compiled runtime manifest.json.")
      .addText((text) => {
        text
          .setPlaceholder("/path/to/runtime")
          .setValue(this.plugin.settings.runtimeDir)
          .onChange((value) => {
            void (async () => {
              this.plugin.settings.runtimeDir = value;
              await this.plugin.saveSettings();
            })();
          });
      });

    new Setting(containerEl)
      .setName("Database path")
      .setDesc("SQLite database path. Relative paths are resolved from the vault root.")
      .addText((text) => {
        text
          .setPlaceholder(".obsidian/plugins/wikipage-spine/wikipage-spine.sqlite")
          .setValue(this.plugin.settings.databasePath)
          .onChange((value) => {
            void (async () => {
              this.plugin.settings.databasePath = value;
              await this.plugin.saveSettings();
            })();
          });
      });

    new Setting(containerEl)
      .setName("Entity folder")
      .setDesc("Vault folder for generated entity views.")
      .addText((text) => {
        text
          .setPlaceholder("wiki")
          .setValue(this.plugin.settings.entityDir)
          .onChange((value) => {
            void (async () => {
              this.plugin.settings.entityDir = value;
              await this.plugin.saveSettings();
            })();
          });
      });

    new Setting(containerEl)
      .setName("Preferred language")
      .setDesc("Language used when new entities are created.")
      .addDropdown((dropdown) => {
        dropdown
          .addOption("zh", "Chinese")
          .addOption("en", "English")
          .setValue(this.plugin.settings.preferredLang)
          .onChange((value) => {
            void (async () => {
              this.plugin.settings.preferredLang = value === "en" ? "en" : "zh";
              await this.plugin.saveSettings();
            })();
          });
      });

    new Setting(containerEl)
      .setName("Note globs")
      .setDesc("Markdown note scan ranges, one glob per line.")
      .addTextArea((text) => {
        text
          .setPlaceholder("**/*.md")
          .setValue(this.plugin.settings.noteGlobs.join("\n"))
          .onChange((value) => {
            void (async () => {
              this.plugin.settings.noteGlobs = value
                .split(/\r?\n/)
                .map((line) => line.trim())
                .filter(Boolean);
              await this.plugin.saveSettings();
            })();
          });
      });
  }
}
