import { test } from "node:test";
import assert from "node:assert/strict";
import { toOpenAiMessages } from "../providers/openai.js";
import type { ChatMessage } from "../providers/types.js";

test("toOpenAiMessages puts the system prompt first when given one", () => {
  const result = toOpenAiMessages("be helpful", [{ role: "user", content: "hi" }]);
  assert.deepEqual(result[0], { role: "system", content: "be helpful" });
  assert.deepEqual(result[1], { role: "user", content: "hi" });
});

test("toOpenAiMessages skips the system message entirely when none is given", () => {
  const result = toOpenAiMessages(undefined, [{ role: "user", content: "hi" }]);
  assert.equal(result.length, 1);
  assert.equal(result[0].role, "user");
});

test("toOpenAiMessages converts an assistant tool call into OpenAI's tool_calls shape", () => {
  const messages: ChatMessage[] = [
    {
      role: "assistant",
      content: "checking",
      toolCalls: [{ id: "call_1", name: "delegate", input: { subtask: "x" } }],
    },
  ];
  const result = toOpenAiMessages(undefined, messages);
  assert.deepEqual(result[0], {
    role: "assistant",
    content: "checking",
    tool_calls: [{ id: "call_1", type: "function", function: { name: "delegate", arguments: '{"subtask":"x"}' } }],
  });
});

test("toOpenAiMessages sends null content instead of an empty string for a tool-only turn", () => {
  const messages: ChatMessage[] = [
    { role: "assistant", content: "", toolCalls: [{ id: "call_1", name: "delegate", input: {} }] },
  ];
  const result = toOpenAiMessages(undefined, messages);
  assert.equal(result[0].role, "assistant");
  if (result[0].role !== "assistant") throw new Error("expected assistant message");
  assert.equal(result[0].content, null);
});

test("toOpenAiMessages converts a tool_result into a tool role message", () => {
  const messages: ChatMessage[] = [{ role: "tool_result", toolCallId: "call_1", content: "paris" }];
  const result = toOpenAiMessages(undefined, messages);
  assert.deepEqual(result[0], { role: "tool", tool_call_id: "call_1", content: "paris" });
});
