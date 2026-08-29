import Anthropic from "@anthropic-ai/sdk";
import type { ChatMessage, CompleteResult, Provider, StreamHandlers, ToolCall, ToolDef } from "./types.js";
import { ProviderError } from "./errors.js";
import { withRetry } from "../retry.js";

export function toAnthropicMessages(messages: ChatMessage[]): Anthropic.MessageParam[] {
  const result: { role: "user" | "assistant"; content: Anthropic.ContentBlockParam[] }[] = [];

  function pushOrMerge(role: "user" | "assistant", content: Anthropic.ContentBlockParam[]): void {
    const last = result[result.length - 1];
    if (last && last.role === role) {
      last.content.push(...content);
    } else {
      result.push({ role, content });
    }
  }

  for (const msg of messages) {
    if (msg.role === "user") {
      pushOrMerge("user", [{ type: "text", text: msg.content }]);
      continue;
    }
    if (msg.role === "assistant") {
      const content: Anthropic.ContentBlockParam[] = [];
      if (msg.content) content.push({ type: "text", text: msg.content });
      for (const call of msg.toolCalls ?? []) {
        content.push({ type: "tool_use", id: call.id, name: call.name, input: call.input });
      }
      if (content.length === 0) content.push({ type: "text", text: "" });
      pushOrMerge("assistant", content);
      continue;
    }
    pushOrMerge("user", [
      {
        type: "tool_result",
        tool_use_id: msg.toolCallId,
        content: msg.content,
        is_error: msg.isError,
      },
    ]);
  }

  return result;
}

function isRetryableAnthropicError(err: unknown): boolean {
  if (err instanceof Anthropic.RateLimitError) return true;
  if (err instanceof Anthropic.APIConnectionError) return true;
  if (err instanceof Anthropic.APIError && typeof err.status === "number") return err.status >= 500;
  return false;
}

export class AnthropicProvider implements Provider {
  readonly name = "claude";
  readonly model: string;
  private client: Anthropic;
  private maxTokens: number;

  constructor(model = "claude-opus-5", maxTokens = 4096, clientOptions?: ConstructorParameters<typeof Anthropic>[0]) {
    this.model = model;
    this.maxTokens = maxTokens;
    this.client = new Anthropic(clientOptions);
  }

  async complete(params: {
    system?: string;
    messages: ChatMessage[];
    tools?: ToolDef[];
    stream?: StreamHandlers;
  }): Promise<CompleteResult> {
    const tools = params.tools?.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.inputSchema,
    }));

    try {
      return await withRetry(
        async () => {
          const messageStream = this.client.messages.stream({
            model: this.model,
            max_tokens: this.maxTokens,
            system: params.system,
            messages: toAnthropicMessages(params.messages),
            tools,
          });

          if (params.stream?.onText) {
            const onText = params.stream.onText;
            messageStream.on("text", (delta) => onText(delta));
          }

          const response = await messageStream.finalMessage();

          let text = "";
          const toolCalls: ToolCall[] = [];
          for (const block of response.content) {
            if (block.type === "text") {
              text += block.text;
            } else if (block.type === "tool_use") {
              toolCalls.push({ id: block.id, name: block.name, input: block.input as Record<string, unknown> });
            }
          }

          return {
            text,
            toolCalls,
            done: toolCalls.length === 0,
            usage: {
              inputTokens: response.usage.input_tokens,
              outputTokens: response.usage.output_tokens,
            },
          };
        },
        { isRetryable: isRetryableAnthropicError },
      );
    } catch (err) {
      if (err instanceof Anthropic.AuthenticationError) {
        throw new ProviderError(`claude authentication failed, check ANTHROPIC_API_KEY (${err.message})`, "claude", false);
      }
      if (err instanceof Anthropic.APIError) {
        throw new ProviderError(`claude api error (${err.status}): ${err.message}`, "claude", false);
      }
      if (err instanceof Error && err.message.includes("Could not resolve authentication method")) {
        throw new ProviderError("claude has no credentials configured, set ANTHROPIC_API_KEY", "claude", false);
      }
      throw err;
    }
  }
}
