import { describe, expect, it } from "vitest";
import { PACKAGE_NAME, PLUGIN_ID, PLUGIN_NAME, REPOSITORY_NAME } from "./project-info";

describe("plugin names", () => {
  it("keeps the reserved names aligned", () => {
    expect(REPOSITORY_NAME).toBe("obsidian-wikipage-spine");
    expect(PLUGIN_ID).toBe("wikipage-spine");
    expect(PLUGIN_NAME).toBe("WikiPage Spine");
    expect(PACKAGE_NAME).toBe("wikipage-spine");
  });
});
