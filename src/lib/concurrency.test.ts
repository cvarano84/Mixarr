import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mapWithConcurrency, resolveDbJobConcurrency } from "./concurrency";

describe("DB job concurrency", () => {
  it("uses a conservative default and clamps env overrides", () => {
    assert.equal(resolveDbJobConcurrency(undefined), 4);
    assert.equal(resolveDbJobConcurrency("5"), 5);
    assert.equal(resolveDbJobConcurrency("0"), 4);
    assert.equal(resolveDbJobConcurrency("99"), 10);
  });

  it("does not run more than the configured number of tasks at once", async () => {
    let active = 0;
    let maxActive = 0;

    const results = await mapWithConcurrency([1, 2, 3, 4, 5], 2, async (value) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      return value * 2;
    });

    assert.deepEqual(results, [2, 4, 6, 8, 10]);
    assert.equal(maxActive, 2);
  });
});
