import { test } from "node:test";
import assert from "node:assert/strict";
import { toAnthropicMessages } from "../providers/anthropic.js";
import type { ChatMessage } from "../providers/types.js";

test("toAnthropicMessages converts a plain user message", () => {
  const messages: ChatMessage[] = [{ role: "user", content: "hi" }];
  const result = toAnthropicMessages(messages);
  assert.deepEqual(result, [{ role: "user", content: "hi" }]);
});

test("toAnthropicMessages converts an assistant message with tool calls into text + tool_use blocks", () => {
  const messages: ChatMessage[] = [
    {
      role: "assistant",
      content: "let me check that",
      toolCalls: [{ id: "call_1", name: "delegate", input: { subtask: "x" } }],
    },
  ];
  const result = toAnthropicMessages(messages);
  assert.equal(result.length, 1);
  assert.equal(result[0].role, "assistant");
  assert.deepEqual(result[0].content, [
    { type: "text", text: "let me check that" },
    { type: "tool_use", id: "call_1", name: "delegate", input: { subtask: "x" } },
  ]);
});

test("toAnthropicMessages omits the text block when an assistant turn has no text", () => {
  const messages: ChatMessage[] = [
    { role: "assistant", content: "", toolCalls: [{ id: "call_1", name: "delegate", input: {} }] },
  ];
  const result = toAnthropicMessages(messages);
  assert.deepEqual(result[0].content, [{ type: "tool_use", id: "call_1", name: "delegate", input: {} }]);
});

test("toAnthropicMessages converts a tool_result into a user message with a tool_result block", () => {
  const messages: ChatMessage[] = [{ role: "tool_result", toolCallId: "call_1", content: "paris" }];
  const result = toAnthropicMessages(messages);
  assert.deepEqual(result, [
    {
      role: "user",
      content: [{ type: "tool_result", tool_use_id: "call_1", content: "paris", is_error: undefined }],
    },
  ]);
});

test("toAnthropicMessages carries the isError flag onto is_error", () => {
  const messages: ChatMessage[] = [
    { role: "tool_result", toolCallId: "call_1", content: "boom", isError: true },
  ];
  const result = toAnthropicMessages(messages);
  const content = result[0].content;
  assert.ok(Array.isArray(content));
  assert.equal((content[0] as { is_error?: boolean }).is_error, true);
});
