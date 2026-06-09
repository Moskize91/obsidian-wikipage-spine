import { Notice, Plugin } from "obsidian";
import { PLUGIN_NAME } from "../core/project-info";
import { WikiPageSpineSettingTab } from "./settings-tab";
import {
  getDefaultPluginSettings,
  normalizePluginSettings,
  type PluginSettings,
} from "./settings";

export default class WikiPageSpinePlugin extends Plugin {
  settings: PluginSettings = getDefaultPluginSettings();

  async onload(): Promise<void> {
    await this.loadSettings();
    await this.saveSettings();

    this.addSettingTab(new WikiPageSpineSettingTab(this.app, this));

    this.addCommand({
      id: "open-wikipage-spine",
      name: "Open WikiPage Spine",
      callback: () => {
        new Notice(`${PLUGIN_NAME} settings are available in Community plugins.`);
      },
    });
  }

  async loadSettings(): Promise<void> {
    this.settings = normalizePluginSettings(
      (await this.loadData()) as Partial<PluginSettings> | null,
    );
  }

  async saveSettings(): Promise<void> {
    this.settings = normalizePluginSettings(this.settings);
    await this.saveData(this.settings);
  }
}
