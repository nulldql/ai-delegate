import { test } from "node:test";
import assert from "node:assert/strict";
import { estimateClaudeCost } from "../pricing.js";

test("estimateClaudeCost computes cost from known per-million rates", () => {
  const cost = estimateClaudeCost("claude-opus-5", 1_000_000, 1_000_000);
  assert.equal(cost, 5.0 + 25.0);
});

test("estimateClaudeCost handles partial-million token counts", () => {
  const cost = estimateClaudeCost("claude-sonnet-5", 500_000, 100_000);
  assert.equal(cost, 500_000 / 1_000_000 * 2.0 + 100_000 / 1_000_000 * 10.0);
});

test("estimateClaudeCost returns null for a model it doesn't recognize", () => {
  assert.equal(estimateClaudeCost("gpt-4o", 1000, 1000), null);
  assert.equal(estimateClaudeCost("some-future-model", 1000, 1000), null);
});
