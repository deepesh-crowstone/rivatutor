import { describe, expect, it } from "vitest";
import { parseCefrLevel } from "@/lib/onboarding";

describe("parseCefrLevel", () => {
  it("parses exact level codes", () => {
    expect(parseCefrLevel("A2")).toBe("A2");
    expect(parseCefrLevel("b1")).toBe("B1");
  });

  it("extracts level from longer replies", () => {
    expect(parseCefrLevel("I think I am around A2")).toBe("A2");
    expect(parseCefrLevel("My level is C1.")).toBe("C1");
  });

  it("returns null for invalid levels", () => {
    expect(parseCefrLevel("beginner")).toBeNull();
    expect(parseCefrLevel("")).toBeNull();
  });
});
