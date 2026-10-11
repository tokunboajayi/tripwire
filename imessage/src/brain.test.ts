import { expect, test } from "bun:test";
import { parse, saferProfile, alertText, bundle } from "./brain";
test("parse", () => {
  expect(parse("link 4821")).toEqual({ kind: "link", code: "4821" });
  expect(parse("Pause!").kind).toBe("pause");
  expect(parse("sell everything").kind).toBe("flatten");
  expect(parse("why did you sell SOL?")).toEqual({ kind: "ask", text: "why did you sell SOL?" });
});
test("texts only tighten", () => {
  expect(saferProfile("aggressive")).toBe("balanced");
  expect(saferProfile("conservative")).toBeNull();
});
test("alerts", () => {
  expect(alertText({ id: 1, ts: 0, kind: "reasoning", msg: "x" })).toBeNull();
  expect(alertText({ id: 1, ts: 0, kind: "order", msg: "Bought BTC" })).toBe("📈 Bought BTC");
  expect(bundle(["a", "b"])).toContain("(2)");
});
