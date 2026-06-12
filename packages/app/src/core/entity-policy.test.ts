import { describe, expect, it } from "vitest";
import {
  ENTITY_FLAG_DISAMBIGUATION,
  shouldReportEntity,
} from "./entity-policy";

describe("entity policy", () => {
  it("suppresses disambiguation pages", () => {
    expect(
      shouldReportEntity({
        flags: ENTITY_FLAG_DISAMBIGUATION,
        colors: [{ anchorId: 15, distance: 1 }],
      }),
    ).toBe(false);
  });

  it("reports entities near positive anchors", () => {
    expect(
      shouldReportEntity({
        flags: 0,
        colors: [{ anchorId: 6, distance: 1 }],
      }),
    ).toBe(true);
  });

  it("does not auto-report entities that only hit broad religious-concept anchors", () => {
    expect(
      shouldReportEntity({
        flags: 0,
        colors: [{ anchorId: 4, distance: 1 }],
      }),
    ).toBe(false);
  });

  it("does not report entities that only hit broad positive anchors", () => {
    expect(
      shouldReportEntity({
        flags: 0,
        colors: [{ anchorId: 1, distance: 2 }],
      }),
    ).toBe(false);
  });

  it("does not report anchor entities themselves", () => {
    expect(
      shouldReportEntity({
        flags: 0,
        colors: [{ anchorId: 1, distance: 0 }],
      }),
    ).toBe(false);
  });

  it("suppresses entities near negative anchors", () => {
    expect(
      shouldReportEntity({
        flags: 0,
        colors: [
          { anchorId: 6, distance: 1 },
          { anchorId: 18, distance: 1 },
        ],
      }),
    ).toBe(false);
  });

  it("ignores distant negative anchors", () => {
    expect(
      shouldReportEntity({
        flags: 0,
        colors: [
          { anchorId: 6, distance: 1 },
          { anchorId: 18, distance: 5 },
        ],
      }),
    ).toBe(true);
  });

  it("does not auto-report entities without positive color evidence", () => {
    expect(
      shouldReportEntity({
        flags: 0,
        colors: [],
      }),
    ).toBe(false);
  });

  it("does not auto-report entities whose positive anchors are too distant", () => {
    expect(
      shouldReportEntity({
        flags: 0,
        colors: [{ anchorId: 1, distance: 5 }],
      }),
    ).toBe(false);
  });
});
