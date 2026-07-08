import { describe, expect, it } from "vitest";
import { extractJsonObject, findBalancedJsonObject, parseJsonArray, repairJsonText } from "@/lib/json";

describe("json helpers", () => {
  it("extracts fenced JSON from model responses", () => {
    expect(
      extractJsonObject(`Here is the result:\n\n\`\`\`json\n{"clear":true}\n\`\`\``),
    ).toEqual({ clear: true });
  });

  it("extracts a JSON object from surrounding text", () => {
    expect(extractJsonObject("Sure. {\"topics\":[\"interviews\"]} Thanks.")).toEqual({
      topics: ["interviews"],
    });
  });

  it("repairs trailing commas in arrays and objects", () => {
    expect(
      extractJsonObject(`{
  "interests": ["english",],
  "key_facts": ["level is A2",],
  "intent_summary": null,
  "name": null
}`),
    ).toEqual({
      interests: ["english"],
      key_facts: ["level is A2"],
      intent_summary: null,
      name: null,
    });
  });

  it("extracts the first balanced object when extra prose follows", () => {
    const noisy = `Here you go:
{
  "name": "Deibe",
  "name_provided": true,
  "interests": [],
  "key_facts": []
}
When no real name was given:
{
  "name": null
}`;

    expect(extractJsonObject(noisy)).toEqual({
      name: "Deibe",
      name_provided: true,
      interests: [],
      key_facts: [],
    });
  });

  it("finds the first balanced JSON object slice", () => {
    const slice = findBalancedJsonObject('prefix {"a":1,"b":{"c":2}} suffix');
    expect(slice).toBe('{"a":1,"b":{"c":2}}');
  });

  it("repairs common trailing comma mistakes", () => {
    expect(repairJsonText('["a", "b",]')).toBe('["a", "b"]');
  });

  it("returns an empty array for invalid stored arrays", () => {
    expect(parseJsonArray("not-json")).toEqual([]);
  });
});
