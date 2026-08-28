import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { AnthropicProvider } from "../providers/anthropic.js";

function startFakeAnthropicServer(sseBody: string): Promise<{ server: Server; url: string; requests: unknown[] }> {
  const requests: unknown[] = [];
  return new Promise((resolvePromise) => {
    const server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (chunk: Buffer) => chunks.push(chunk));
      req.on("end", () => {
        requests.push(JSON.parse(Buffer.concat(chunks).toString("utf8")));
        res.writeHead(200, { "content-type": "text/event-stream" });
        res.end(sseBody);
      });
    });
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      resolvePromise({ server, url: `http://127.0.0.1:${port}`, requests });
    });
  });
}

function textOnlySse(text: string): string {
  return [
    `event: message_start`,
    `data: {"type":"message_start","message":{"id":"msg_1","type":"message","role":"assistant","content":[],"model":"claude-opus-5","stop_reason":null,"stop_sequence":null,"usage":{"input_tokens":12,"output_tokens":0}}}`,
    ``,
    `event: content_block_start`,
    `data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}`,
    ``,
    `event: content_block_delta`,
    `data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":${JSON.stringify(text)}}}`,
    ``,
    `event: content_block_stop`,
    `data: {"type":"content_block_stop","index":0}`,
    ``,
    `event: message_delta`,
    `data: {"type":"message_delta","delta":{"stop_reason":"end_turn","stop_sequence":null},"usage":{"output_tokens":7}}`,
    ``,
    `event: message_stop`,
    `data: {"type":"message_stop"}`,
    ``,
    ``,
  ].join("\n");
}

function toolUseSse(): string {
  return [
    `event: message_start`,
    `data: {"type":"message_start","message":{"id":"msg_2","type":"message","role":"assistant","content":[],"model":"claude-opus-5","stop_reason":null,"stop_sequence":null,"usage":{"input_tokens":20,"output_tokens":0}}}`,
    ``,
    `event: content_block_start`,
    `data: {"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"toolu_1","name":"delegate","input":{}}}`,
    ``,
    `event: content_block_delta`,
    `data: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{\\"subtask\\":\\"do it\\"}"}}`,
    ``,
    `event: content_block_stop`,
    `data: {"type":"content_block_stop","index":0}`,
    ``,
    `event: message_delta`,
    `data: {"type":"message_delta","delta":{"stop_reason":"tool_use","stop_sequence":null},"usage":{"output_tokens":9}}`,
    ``,
    `event: message_stop`,
    `data: {"type":"message_stop"}`,
    ``,
    ``,
  ].join("\n");
}

test("AnthropicProvider sends the right request shape and parses a text response", async () => {
  const { server, url, requests } = await startFakeAnthropicServer(textOnlySse("hello there"));
  try {
    const provider = new AnthropicProvider("claude-opus-5", 4096, { apiKey: "test-key", baseURL: url });
    const result = await provider.complete({
      system: "be helpful",
      messages: [
        { role: "user", content: "hi" },
        {
          role: "assistant",
          content: "checking",
          toolCalls: [{ id: "toolu_0", name: "delegate", input: { subtask: "x" } }],
        },
        { role: "tool_result", toolCallId: "toolu_0", content: "result of x", isError: false },
      ],
    });

    assert.equal(result.text, "hello there");
    assert.equal(result.done, true);
    assert.equal(result.usage.inputTokens, 12);
    assert.equal(result.usage.outputTokens, 7);

    const sent = requests[0] as {
      model: string;
      system: string;
      messages: { role: string; content: unknown }[];
    };
    assert.equal(sent.model, "claude-opus-5");
    assert.equal(sent.system, "be helpful");
    assert.equal(sent.messages.length, 3);
    assert.deepEqual(sent.messages[0], { role: "user", content: "hi" });
  } finally {
    server.close();
  }
});

test("AnthropicProvider sends tool definitions and parses a tool_use response", async () => {
  const { server, url, requests } = await startFakeAnthropicServer(toolUseSse());
  try {
    const provider = new AnthropicProvider("claude-opus-5", 4096, { apiKey: "test-key", baseURL: url });
    const result = await provider.complete({
      messages: [{ role: "user", content: "do something" }],
      tools: [
        {
          name: "delegate",
          description: "delegate a subtask",
          inputSchema: { type: "object", properties: { subtask: { type: "string" } }, required: ["subtask"] },
        },
      ],
    });

    assert.equal(result.done, false);
    assert.equal(result.toolCalls.length, 1);
    assert.equal(result.toolCalls[0].name, "delegate");
    assert.equal(result.toolCalls[0].id, "toolu_1");
    assert.deepEqual(result.toolCalls[0].input, { subtask: "do it" });

    const sent = requests[0] as { tools: { name: string; input_schema: unknown }[] };
    assert.equal(sent.tools.length, 1);
    assert.equal(sent.tools[0].name, "delegate");
    assert.deepEqual(sent.tools[0].input_schema, {
      type: "object",
      properties: { subtask: { type: "string" } },
      required: ["subtask"],
    });
  } finally {
    server.close();
  }
});
