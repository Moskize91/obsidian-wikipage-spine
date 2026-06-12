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

  it("reports entities with positive color evidence", () => {
    expect(
      shouldReportEntity({
        flags: 0,
        colors: [{ anchorId: 6, distance: 1 }],
      }),
    ).toBe(true);
  });

  it("does not report isolated entities without scored color evidence", () => {
    expect(
      shouldReportEntity({
        flags: 0,
        colors: [],
      }),
    ).toBe(false);
  });

  it("uses broad positive anchors as survival evidence", () => {
    expect(
      shouldReportEntity({
        flags: 0,
        colors: [{ anchorId: 1, distance: 2 }],
      }),
    ).toBe(true);
  });

  it("reports positive anchor entities themselves", () => {
    expect(
      shouldReportEntity({
        flags: 0,
        colors: [{ anchorId: 1, distance: 0 }],
      }),
    ).toBe(true);
  });

  it("vetoes entities near selected negative anchors", () => {
    expect(
      shouldReportEntity({
        flags: 0,
        colors: [
          { anchorId: 6, distance: 1 },
          { anchorId: 16, distance: 1 },
        ],
      }),
    ).toBe(false);
  });

  it("lets positive evidence offset non-veto negative evidence", () => {
    expect(
      shouldReportEntity({
        flags: 0,
        colors: [
          { anchorId: 6, distance: 1 },
          { anchorId: 18, distance: 1 },
        ],
      }),
    ).toBe(true);
  });

  it("rejects entities whose non-veto negative evidence wins survival scoring", () => {
    expect(
      shouldReportEntity({
        flags: 0,
        colors: [
          { anchorId: 1, distance: 5 },
          { anchorId: 18, distance: 1 },
          { anchorId: 19, distance: 2 },
        ],
      }),
    ).toBe(false);
  });

  it("rejects entities whose positive and negative evidence exactly offset each other", () => {
    expect(
      shouldReportEntity({
        flags: 0,
        colors: [
          { anchorId: 1, distance: 2 },
          { anchorId: 18, distance: 2 },
        ],
      }),
    ).toBe(false);
  });

  it("accepts entities with a weak positive survival advantage", () => {
    expect(
      shouldReportEntity({
        flags: 0,
        colors: [
          { anchorId: 1, distance: 2 },
          { anchorId: 18, distance: 3 },
        ],
      }),
    ).toBe(true);
  });
});
