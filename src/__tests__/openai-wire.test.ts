import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { OpenAiProvider } from "../providers/openai.js";

function startFakeOpenAiServer(responseBody: unknown): Promise<{ server: Server; url: string; requests: unknown[] }> {
  const requests: unknown[] = [];
  return new Promise((resolvePromise) => {
    const server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (chunk: Buffer) => chunks.push(chunk));
      req.on("end", () => {
        requests.push(JSON.parse(Buffer.concat(chunks).toString("utf8")));
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify(responseBody));
      });
    });
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      resolvePromise({ server, url: `http://127.0.0.1:${port}/v1`, requests });
    });
  });
}

test("OpenAiProvider sends the right request shape and parses a plain text response", async () => {
  const { server, url, requests } = await startFakeOpenAiServer({
    id: "chatcmpl_1",
    object: "chat.completion",
    created: 0,
    model: "gpt-4o",
    choices: [{ index: 0, message: { role: "assistant", content: "hello there" }, finish_reason: "stop" }],
    usage: { prompt_tokens: 15, completion_tokens: 6, total_tokens: 21 },
  });
  try {
    const provider = new OpenAiProvider("gpt-4o", 4096, { apiKey: "test-key", baseURL: url });
    const result = await provider.complete({
      system: "be helpful",
      messages: [{ role: "user", content: "hi" }],
      tools: [
        {
          name: "delegate",
          description: "delegate a subtask",
          inputSchema: { type: "object", properties: { subtask: { type: "string" } }, required: ["subtask"] },
        },
      ],
    });

    assert.equal(result.text, "hello there");
    assert.equal(result.done, true);
    assert.equal(result.usage.inputTokens, 15);
    assert.equal(result.usage.outputTokens, 6);

    const sent = requests[0] as {
      model: string;
      messages: { role: string; content: string }[];
      tools: { type: string; function: { name: string; parameters: unknown } }[];
    };
    assert.equal(sent.model, "gpt-4o");
    assert.deepEqual(sent.messages[0], { role: "system", content: "be helpful" });
    assert.deepEqual(sent.messages[1], { role: "user", content: "hi" });
    assert.equal(sent.tools[0].type, "function");
    assert.equal(sent.tools[0].function.name, "delegate");
    assert.deepEqual(sent.tools[0].function.parameters, {
      type: "object",
      properties: { subtask: { type: "string" } },
      required: ["subtask"],
    });
  } finally {
    server.close();
  }
});

test("OpenAiProvider parses a tool_calls response and round-trips the arguments as JSON", async () => {
  const { server, url } = await startFakeOpenAiServer({
    id: "chatcmpl_2",
    object: "chat.completion",
    created: 0,
    model: "gpt-4o",
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content: null,
          tool_calls: [
            { id: "call_1", type: "function", function: { name: "delegate", arguments: '{"subtask":"do it"}' } },
          ],
        },
        finish_reason: "tool_calls",
      },
    ],
    usage: { prompt_tokens: 20, completion_tokens: 9, total_tokens: 29 },
  });
  try {
    const provider = new OpenAiProvider("gpt-4o", 4096, { apiKey: "test-key", baseURL: url });
    const result = await provider.complete({
      messages: [{ role: "user", content: "do something" }],
      tools: [
        {
          name: "delegate",
          description: "delegate a subtask",
          inputSchema: { type: "object", properties: { subtask: { type: "string" } } },
        },
      ],
    });

    assert.equal(result.done, false);
    assert.equal(result.toolCalls.length, 1);
    assert.equal(result.toolCalls[0].id, "call_1");
    assert.equal(result.toolCalls[0].name, "delegate");
    assert.deepEqual(result.toolCalls[0].input, { subtask: "do it" });
  } finally {
    server.close();
  }
});
