import { test } from "node:test";
import assert from "node:assert/strict";
import { runDelegation } from "../planner.js";
import { FakeProvider, textResult, toolCallResult } from "./fake-provider.js";

test("runDelegation returns the planner's answer directly when it never delegates", async () => {
  const planner = new FakeProvider("fake", "planner-model", [textResult("no delegation needed, the answer is 4")]);
  const worker = new FakeProvider("fake", "worker-model", [textResult("unused")]);

  const result = await runDelegation({ task: "what is 2 + 2", planner, worker });

  assert.equal(result.answer, "no delegation needed, the answer is 4");
  assert.equal(result.delegations.length, 0);
  assert.equal(worker.calls.length, 0);
});

test("runDelegation delegates a subtask to the worker and feeds the result back", async () => {
  const planner = new FakeProvider("fake", "planner-model", [
    toolCallResult([{ id: "call_1", subtask: "look up the capital of france" }]),
    textResult("the capital of france is paris"),
  ]);
  const worker = new FakeProvider("fake", "worker-model", [textResult("paris")]);

  const result = await runDelegation({ task: "what's the capital of france", planner, worker });

  assert.equal(result.answer, "the capital of france is paris");
  assert.equal(result.delegations.length, 1);
  assert.equal(result.delegations[0].subtask, "look up the capital of france");
  assert.equal(result.delegations[0].result, "paris");
  assert.equal(result.delegations[0].isError, false);

  const secondPlannerCall = planner.calls[1];
  const toolResultMessage = secondPlannerCall.messages.at(-1);
  assert.equal(toolResultMessage?.role, "tool_result");
});

test("runDelegation runs multiple delegate calls from one turn concurrently", async () => {
  const planner = new FakeProvider("fake", "planner-model", [
    toolCallResult([
      { id: "call_1", subtask: "subtask a" },
      { id: "call_2", subtask: "subtask b" },
    ]),
    textResult("done"),
  ]);
  const worker = new FakeProvider("fake", "worker-model", [textResult("result a"), textResult("result b")]);

  const result = await runDelegation({ task: "do two things", planner, worker });

  assert.equal(result.delegations.length, 2);
  assert.equal(worker.calls.length, 2);
});

test("runDelegation passes context through to the worker's message", async () => {
  const planner = new FakeProvider("fake", "planner-model", [
    toolCallResult([{ id: "call_1", subtask: "translate this", context: "the user speaks spanish" }]),
    textResult("done"),
  ]);
  const worker = new FakeProvider("fake", "worker-model", [textResult("hola")]);

  await runDelegation({ task: "translate hello", planner, worker });

  const workerMessage = worker.calls[0].messages[0];
  assert.equal(workerMessage.role, "user");
  if (workerMessage.role !== "user") throw new Error("expected a user message");
  assert.match(workerMessage.content, /translate this/);
  assert.match(workerMessage.content, /the user speaks spanish/);
});

test("runDelegation records a worker failure as an error event instead of throwing", async () => {
  const planner = new FakeProvider("fake", "planner-model", [
    toolCallResult([{ id: "call_1", subtask: "do the thing" }]),
    textResult("done despite the failure"),
  ]);
  const worker = new FakeProvider("fake", "worker-model", [
    () => {
      throw new Error("boom");
    },
  ]);

  const result = await runDelegation({ task: "task", planner, worker });

  assert.equal(result.delegations[0].isError, true);
  assert.match(result.delegations[0].result, /boom/);
  assert.equal(result.answer, "done despite the failure");
});

test("runDelegation stops delegating once it hits maxDelegations and tells the planner", async () => {
  const planner = new FakeProvider("fake", "planner-model", [
    toolCallResult([
      { id: "call_1", subtask: "one" },
      { id: "call_2", subtask: "two" },
    ]),
    textResult("done"),
  ]);
  const worker = new FakeProvider("fake", "worker-model", [textResult("result one")]);

  const result = await runDelegation({ task: "task", planner, worker, maxDelegations: 1 });

  assert.equal(result.delegations.length, 2);
  assert.equal(result.delegations[0].isError, false);
  assert.equal(result.delegations[1].isError, true);
  assert.match(result.delegations[1].result, /delegation limit/);
  assert.equal(worker.calls.length, 1);
});

test("runDelegation gives up after maxPlannerTurns if the planner never stops delegating", async () => {
  const infiniteDelegation = () => toolCallResult([{ id: `call_${Math.random()}`, subtask: "keep going" }]);
  const planner = new FakeProvider("fake", "planner-model", [infiniteDelegation]);
  const worker = new FakeProvider("fake", "worker-model", [textResult("ok")]);

  const result = await runDelegation({ task: "task", planner, worker, maxDelegations: 100, maxPlannerTurns: 3 });

  assert.match(result.answer, /turn budget/);
  assert.equal(result.plannerTurns, 4);
});

test("runDelegation aggregates token usage across planner and worker calls", async () => {
  const planner = new FakeProvider("fake", "planner-model", [
    toolCallResult([{ id: "call_1", subtask: "a" }]),
    textResult("done"),
  ]);
  const worker = new FakeProvider("fake", "worker-model", [textResult("a result")]);

  const result = await runDelegation({ task: "task", planner, worker });

  assert.equal(result.usage.planner.inputTokens, 30);
  assert.equal(result.usage.planner.outputTokens, 25);
  assert.equal(result.usage.worker.inputTokens, 10);
  assert.equal(result.usage.worker.outputTokens, 10);
});
