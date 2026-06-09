import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SurfaceMatcher } from "./surface-matcher";

const runtimeDir = resolve(__dirname, "../../../../crates/data/runtime");

const articleNotes = [
  {
    title: "西格蒙德·弗洛伊德",
    text:
      "西格蒙德·弗洛伊德是奥地利心理学家，也是精神分析学的重要创始人物。他在维也纳大学学习医学，后来长期在维也纳行医和写作。弗洛伊德讨论过潜意识、梦、人格结构和心理治疗等主题，常被放在二十世纪思想史和心理学史中讨论。1938年纳粹德国吞并奥地利以后，弗洛伊德离开维也纳，迁居英国伦敦，并在1939年去世。",
    surfaces: ["西格蒙德·弗洛伊德", "维也纳大学", "精神分析学", "心理学", "伦敦"],
  },
  {
    title: "查尔斯·达尔文",
    text:
      "查尔斯·达尔文是英国博物学家、地质学家和生物学家。他曾参加小猎犬号航行，观察各地的生物、化石和地质现象。达尔文在《物种起源》中提出以自然选择解释生物演化，并把共同祖先和物种变化联系起来。达尔文的理论后来成为现代生物学的重要基础，也持续影响科学、哲学和社会思想。",
    surfaces: ["查尔斯·达尔文", "小猎犬号", "物种起源", "自然选择", "生物学"],
  },
  {
    title: "艾萨克·牛顿",
    text:
      "艾萨克·牛顿是英国数学家、物理学家和天文学家。他在《自然哲学的数学原理》中系统阐述了经典力学和万有引力，并给出了牛顿运动定律。牛顿还研究光学、微积分和天体运动，对科学革命和启蒙运动产生了深远影响。后来人们经常把牛顿、伽利略和莱布尼茨放在近代科学史中比较。",
    surfaces: ["艾萨克·牛顿", "自然哲学的数学原理", "万有引力", "牛顿运动定律", "莱布尼茨"],
  },
] as const;

describe("SurfaceMatcher", () => {
  const opened: SurfaceMatcher[] = [];

  afterEach(() => {
    while (opened.length > 0) {
      opened.pop()?.close();
    }
  });

  it.skipIf(!existsSync(runtimeDir))("scans article-style notes from runtime tables", () => {
    const matcher = SurfaceMatcher.open(runtimeDir, {
      stateCacheBlocks: 8,
      outputCacheBlocks: 4,
      qidCacheBlocks: 4,
      mapCacheBlocks: 1,
    });
    opened.push(matcher);

    for (const note of articleNotes) {
      const matches = [...matcher.scan([note.text])];
      for (const surface of note.surfaces) {
        expect(
          matches.some((match) => match.surface === surface && match.qids.length > 0),
          `${note.title} should match ${surface}`,
        ).toBe(true);
      }
      expect(matches.every((match) => note.text.slice(match.start, match.end) === match.surface))
        .toBe(true);
    }
  });

  it.skipIf(!existsSync(runtimeDir))("keeps state across chunked input", () => {
    const matcher = SurfaceMatcher.open(runtimeDir, {
      stateCacheBlocks: 1,
      outputCacheBlocks: 1,
      qidCacheBlocks: 1,
      mapCacheBlocks: 1,
    });
    opened.push(matcher);

    const chunks = ["我", "曾", "就", "读", "于", "北", "京", "大", "学", "。"];
    const matches = [...matcher.scan(chunks)];

    expect(matches.some((match) => match.surface === "北京大学" && match.qids.length > 0)).toBe(
      true,
    );
  });

  it.skipIf(!existsSync(runtimeDir))("uses constructor scan capture options", () => {
    const matcher = SurfaceMatcher.open(runtimeDir, {
      stateCacheBlocks: 8,
      outputCacheBlocks: 4,
      qidCacheBlocks: 4,
      mapCacheBlocks: 1,
      captureWindowUtf16: 2,
    });
    opened.push(matcher);

    const matches = [...matcher.scan(["我曾就读于北京大学。"])];
    const beijingUniversity = matches.find(
      (match) => match.end === 9 && match.utf16Length === 4 && match.qids.length > 0,
    );

    expect(beijingUniversity?.surface).toBeUndefined();
  });

  it.skipIf(!existsSync(runtimeDir))("scans English aliases from runtime tables", () => {
    const matcher = SurfaceMatcher.open(runtimeDir, {
      stateCacheBlocks: 8,
      outputCacheBlocks: 4,
      qidCacheBlocks: 4,
      mapCacheBlocks: 1,
    });
    opened.push(matcher);

    const text = "Alan Turing worked on Computer science and Artificial intelligence.";
    const matches = [...matcher.scan([text])];

    expect(matches.some((match) => match.surface === "Alan Turing" && match.qids.length > 0)).toBe(
      true,
    );
    expect(matches.some((match) => match.surface === "Computer science" && match.qids.length > 0))
      .toBe(true);
    expect(matches.every((match) => text.slice(match.start, match.end) === match.surface)).toBe(
      true,
    );
  });
});
