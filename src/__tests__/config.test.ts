import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { loadConfigFile, resolveProvider } from "../config.js";
import { withTempDir } from "./test-utils.js";

test("resolveProvider defaults claude to claude-opus-5", () => {
  const provider = resolveProvider("claude", 4096);
  assert.equal(provider.name, "claude");
  assert.equal(provider.model, "claude-opus-5");
});

test("resolveProvider accepts an explicit model after a colon", () => {
  const provider = resolveProvider("claude:claude-haiku-4-5", 4096);
  assert.equal(provider.model, "claude-haiku-4-5");
});

test("resolveProvider treats anthropic and gpt as aliases", () => {
  process.env.OPENAI_API_KEY = "test-key";
  try {
    assert.equal(resolveProvider("anthropic", 4096).name, "claude");
    assert.equal(resolveProvider("gpt", 4096).name, "openai");
  } finally {
    delete process.env.OPENAI_API_KEY;
  }
});

test("resolveProvider defaults openai to gpt-4o", () => {
  process.env.OPENAI_API_KEY = "test-key";
  try {
    const provider = resolveProvider("openai", 4096);
    assert.equal(provider.name, "openai");
    assert.equal(provider.model, "gpt-4o");
  } finally {
    delete process.env.OPENAI_API_KEY;
  }
});

test("resolveProvider rejects an unknown provider", () => {
  assert.throws(() => resolveProvider("unknown-thing", 4096), /unknown provider/);
});

test("resolveProvider handles a model name that itself contains a colon", () => {
  process.env.OPENAI_API_KEY = "test-key";
  try {
    const provider = resolveProvider("openai:org:custom-model", 4096);
    assert.equal(provider.model, "org:custom-model");
  } finally {
    delete process.env.OPENAI_API_KEY;
  }
});

test("resolveProvider throws a clear error when no OpenAI credentials are configured", () => {
  const original = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  try {
    assert.throws(() => resolveProvider("openai", 4096));
  } finally {
    if (original !== undefined) process.env.OPENAI_API_KEY = original;
  }
});

test("loadConfigFile returns an empty object when the file doesn't exist", async () => {
  await withTempDir(async (dir) => {
    const config = await loadConfigFile(join(dir, "missing.json"));
    assert.deepEqual(config, {});
  });
});

test("loadConfigFile parses a real config file", async () => {
  await withTempDir(async (dir) => {
    const path = join(dir, "config.json");
    await writeFile(path, JSON.stringify({ planner: "claude:claude-opus-5", maxDelegations: 3 }));
    const config = await loadConfigFile(path);
    assert.deepEqual(config, { planner: "claude:claude-opus-5", maxDelegations: 3 });
  });
});

test("loadConfigFile throws a clear error on invalid JSON", async () => {
  await withTempDir(async (dir) => {
    const path = join(dir, "config.json");
    await writeFile(path, "{ not valid json");
    await assert.rejects(() => loadConfigFile(path), /couldn't read config file/);
  });
});
