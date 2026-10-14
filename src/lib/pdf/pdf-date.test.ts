import { describe, expect, it } from "vitest";
import { parsePdfDate } from "./pdf-date";

describe("parsePdfDate", () => {
  it.each([
    ["D:20261013223944Z00'00'", "2026-10-13T22:39:44Z"],
    ["D:20261013223944Z00'00", "2026-10-13T22:39:44Z"],
    ["20261013223944Z", "2026-10-13T22:39:44Z"],
    ["D:20261014073944+09'00'", "2026-10-14T07:39:44+09:00"],
    ["20261014073944+09'00", "2026-10-14T07:39:44+09:00"],
    ["D:20261014073944+0900", "2026-10-14T07:39:44+09:00"],
  ])("parses %s", (value, expected) => {
    expect(parsePdfDate(value)).toBe(expected);
  });

  it.each([
    undefined,
    20261013223944,
    "20261013223944",
    "D:20261313223944Z",
    "D:20261032223944Z",
    "D:20261013243944Z",
    "D:20261013226044Z",
    "D:20261013223960Z",
    "D:20261013223944+2400",
    "D:20261013223944+0960",
  ])("rejects invalid PDF date %s", (value) => {
    expect(parsePdfDate(value)).toBeNull();
  });
});
