import { Notice, Plugin } from "obsidian";
import { PLUGIN_NAME } from "../core/project-info";

export default class WikiPageSpinePlugin extends Plugin {
  async onload(): Promise<void> {
    this.addCommand({
      id: "open-wikipage-spine",
      name: "Open WikiPage Spine",
      callback: () => {
        new Notice(`${PLUGIN_NAME} is not implemented yet.`);
      },
    });
  }
}
