import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { AnthropicProvider } from "../providers/anthropic.js";
import { OpenAiProvider } from "../providers/openai.js";
import { runDelegation } from "../planner.js";

function startAnthropicPlannerServer(sseBodies: string[]): Promise<{ server: Server; url: string }> {
  let call = 0;
  return new Promise((resolvePromise) => {
    const server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (chunk: Buffer) => chunks.push(chunk));
      req.on("end", () => {
        const body = sseBodies[Math.min(call, sseBodies.length - 1)];
        call += 1;
        res.writeHead(200, { "content-type": "text/event-stream" });
        res.end(body);
      });
    });
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      resolvePromise({ server, url: `http://127.0.0.1:${port}` });
    });
  });
}

function startOpenAiWorkerServer(): Promise<{ server: Server; url: string; requests: unknown[] }> {
  const requests: unknown[] = [];
  return new Promise((resolvePromise) => {
    const server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (chunk: Buffer) => chunks.push(chunk));
      req.on("end", () => {
        requests.push(JSON.parse(Buffer.concat(chunks).toString("utf8")));
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            id: "chatcmpl_1",
            object: "chat.completion",
            created: 0,
            model: "gpt-4o",
            choices: [
              { index: 0, message: { role: "assistant", content: "paris is the capital of france" }, finish_reason: "stop" },
            ],
            usage: { prompt_tokens: 8, completion_tokens: 7, total_tokens: 15 },
          }),
        );
      });
    });
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      resolvePromise({ server, url: `http://127.0.0.1:${port}/v1`, requests });
    });
  });
}

const delegateToolUseSse = [
  `event: message_start`,
  `data: {"type":"message_start","message":{"id":"msg_1","type":"message","role":"assistant","content":[],"model":"claude-opus-5","stop_reason":null,"stop_sequence":null,"usage":{"input_tokens":30,"output_tokens":0}}}`,
  ``,
  `event: content_block_start`,
  `data: {"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"toolu_1","name":"delegate","input":{}}}`,
  ``,
  `event: content_block_delta`,
  `data: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{\\"subtask\\":\\"find the capital of france\\"}"}}`,
  ``,
  `event: content_block_stop`,
  `data: {"type":"content_block_stop","index":0}`,
  ``,
  `event: message_delta`,
  `data: {"type":"message_delta","delta":{"stop_reason":"tool_use","stop_sequence":null},"usage":{"output_tokens":12}}`,
  ``,
  `event: message_stop`,
  `data: {"type":"message_stop"}`,
  ``,
  ``,
].join("\n");

const finalAnswerSse = [
  `event: message_start`,
  `data: {"type":"message_start","message":{"id":"msg_2","type":"message","role":"assistant","content":[],"model":"claude-opus-5","stop_reason":null,"stop_sequence":null,"usage":{"input_tokens":40,"output_tokens":0}}}`,
  ``,
  `event: content_block_start`,
  `data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}`,
  ``,
  `event: content_block_delta`,
  `data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"the capital of france is paris"}}`,
  ``,
  `event: content_block_stop`,
  `data: {"type":"content_block_stop","index":0}`,
  ``,
  `event: message_delta`,
  `data: {"type":"message_delta","delta":{"stop_reason":"end_turn","stop_sequence":null},"usage":{"output_tokens":8}}`,
  ``,
  `event: message_stop`,
  `data: {"type":"message_stop"}`,
  ``,
  ``,
].join("\n");

test("runDelegation drives a real Anthropic planner and a real OpenAI worker end to end", async () => {
  const plannerServer = await startAnthropicPlannerServer([delegateToolUseSse, finalAnswerSse]);
  const workerServer = await startOpenAiWorkerServer();

  try {
    const planner = new AnthropicProvider("claude-opus-5", 4096, { apiKey: "test-key", baseURL: plannerServer.url });
    const worker = new OpenAiProvider("gpt-4o", 4096, { apiKey: "test-key", baseURL: workerServer.url });

    const result = await runDelegation({ task: "what's the capital of france", planner, worker });

    assert.equal(result.answer, "the capital of france is paris");
    assert.equal(result.delegations.length, 1);
    assert.equal(result.delegations[0].subtask, "find the capital of france");
    assert.equal(result.delegations[0].result, "paris is the capital of france");
    assert.equal(result.delegations[0].isError, false);

    assert.equal(result.usage.planner.inputTokens, 70);
    assert.equal(result.usage.planner.outputTokens, 20);
    assert.equal(result.usage.worker.inputTokens, 8);
    assert.equal(result.usage.worker.outputTokens, 7);

    const workerRequest = workerServer.requests[0] as { messages: { role: string; content: string }[] };
    assert.match(workerRequest.messages[0].content, /find the capital of france/);
  } finally {
    plannerServer.server.close();
    workerServer.server.close();
  }
});
