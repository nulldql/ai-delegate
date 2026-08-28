import { test } from "node:test";
import assert from "node:assert/strict";
import { parseArgs } from "../cli.js";

test("parseArgs joins non-flag words into the task", () => {
  const args = parseArgs(["plan", "a", "trip", "to", "tokyo"]);
  assert.equal(args?.task, "plan a trip to tokyo");
});

test("parseArgs reads planner and worker specs", () => {
  const args = parseArgs(["do", "the", "thing", "--planner", "claude:claude-opus-5", "--worker", "openai:gpt-4o"]);
  assert.equal(args?.plannerSpec, "claude:claude-opus-5");
  assert.equal(args?.workerSpec, "openai:gpt-4o");
});

test("parseArgs reads numeric flags", () => {
  const args = parseArgs(["task", "--max-delegations", "3", "--max-tokens", "2048"]);
  assert.equal(args?.maxDelegations, 3);
  assert.equal(args?.maxTokens, 2048);
});

test("parseArgs reads system prompt overrides", () => {
  const args = parseArgs(["task", "--planner-system", "be terse", "--worker-system", "be thorough"]);
  assert.equal(args?.plannerSystem, "be terse");
  assert.equal(args?.workerSystem, "be thorough");
});

test("parseArgs sets json and quiet flags", () => {
  const args = parseArgs(["task", "--json", "--quiet"]);
  assert.equal(args?.json, true);
  assert.equal(args?.quiet, true);
});

test("parseArgs defaults json, quiet, and config path", () => {
  const args = parseArgs(["task"]);
  assert.equal(args?.json, false);
  assert.equal(args?.quiet, false);
  assert.equal(args?.configPath, ".aidelegaterc.json");
});

test("parseArgs returns null with no arguments", () => {
  assert.equal(parseArgs([]), null);
});

test("parseArgs returns null on --help", () => {
  assert.equal(parseArgs(["--help"]), null);
});

test("parseArgs throws on an unknown flag", () => {
  assert.throws(() => parseArgs(["task", "--bogus"]), /unknown flag/);
});

test("parseArgs throws when a value-taking flag has nothing after it", () => {
  assert.throws(() => parseArgs(["task", "--planner"]), /needs a value/);
});

test("parseArgs throws when there's no task at all", () => {
  assert.throws(() => parseArgs(["--json"]), /no task given/);
});
