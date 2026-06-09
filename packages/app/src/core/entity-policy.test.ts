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
        predicates: [{ pid: 31, valueQidNumber: 4167410 }],
      }),
    ).toBe(false);
  });

  it("reports entities with narrow professional predicates", () => {
    expect(
      shouldReportEntity({
        flags: 0,
        predicates: [{ pid: 356, valueQidNumber: 0 }],
      }),
    ).toBe(true);
  });

  it("reports entities with selected candidate predicates", () => {
    expect(
      shouldReportEntity({
        flags: 0,
        predicates: [{ pid: 106, valueQidNumber: 0 }],
      }),
    ).toBe(true);
  });

  it("suppresses broad authority identifiers", () => {
    expect(
      shouldReportEntity({
        flags: 0,
        predicates: [{ pid: 646, valueQidNumber: 0 }],
      }),
    ).toBe(false);
  });

  it("suppresses plain instance-of evidence", () => {
    expect(
      shouldReportEntity({
        flags: 0,
        predicates: [{ pid: 31, valueQidNumber: 5 }],
      }),
    ).toBe(false);
  });

  it("suppresses entities without positive predicate evidence", () => {
    expect(
      shouldReportEntity({
        flags: 0,
        predicates: [{ pid: 999999, valueQidNumber: 999998 }],
      }),
    ).toBe(false);
  });
});
