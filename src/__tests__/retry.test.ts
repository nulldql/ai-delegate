import { test } from "node:test";
import assert from "node:assert/strict";
import { withRetry } from "../retry.js";

test("withRetry returns the result immediately when the function succeeds", async () => {
  const result = await withRetry(async () => "ok", { isRetryable: () => true });
  assert.equal(result, "ok");
});

test("withRetry retries a retryable error up to the retry limit, then throws", async () => {
  let attempts = 0;
  await assert.rejects(
    () =>
      withRetry(
        async () => {
          attempts += 1;
          throw new Error("still failing");
        },
        { isRetryable: () => true, retries: 2 },
      ),
    /still failing/,
  );
  assert.equal(attempts, 3);
});

test("withRetry throws immediately on a non-retryable error", async () => {
  let attempts = 0;
  await assert.rejects(
    () =>
      withRetry(
        async () => {
          attempts += 1;
          throw new Error("not retryable");
        },
        { isRetryable: () => false, retries: 5 },
      ),
    /not retryable/,
  );
  assert.equal(attempts, 1);
});

test("withRetry succeeds after a transient failure", async () => {
  let attempts = 0;
  const result = await withRetry(
    async () => {
      attempts += 1;
      if (attempts < 2) throw new Error("transient");
      return "recovered";
    },
    { isRetryable: () => true, retries: 3 },
  );
  assert.equal(result, "recovered");
  assert.equal(attempts, 2);
});
