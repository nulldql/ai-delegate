import OpenAI from "openai";
import type { ChatMessage, CompleteResult, Provider, StreamHandlers, ToolCall, ToolDef } from "./types.js";
import { ProviderError } from "./errors.js";
import { withRetry } from "../retry.js";

export function toOpenAiMessages(
  system: string | undefined,
  messages: ChatMessage[],
): OpenAI.Chat.ChatCompletionMessageParam[] {
  const result: OpenAI.Chat.ChatCompletionMessageParam[] = [];
  if (system) result.push({ role: "system", content: system });

  for (const msg of messages) {
    if (msg.role === "user") {
      result.push({ role: "user", content: msg.content });
      continue;
    }
    if (msg.role === "assistant") {
      const toolCalls = msg.toolCalls?.map((call) => ({
        id: call.id,
        type: "function" as const,
        function: { name: call.name, arguments: JSON.stringify(call.input) },
      }));
      result.push({
        role: "assistant",
        content: msg.content || null,
        tool_calls: toolCalls && toolCalls.length > 0 ? toolCalls : undefined,
      });
      continue;
    }
    result.push({ role: "tool", tool_call_id: msg.toolCallId, content: msg.content });
  }

  return result;
}

function isRetryableOpenAiError(err: unknown): boolean {
  if (err instanceof OpenAI.RateLimitError) return true;
  if (err instanceof OpenAI.APIConnectionError) return true;
  if (err instanceof OpenAI.APIError && typeof err.status === "number") return err.status >= 500;
  return false;
}

export class OpenAiProvider implements Provider {
  readonly name = "openai";
  readonly model: string;
  private client: OpenAI;
  private maxTokens: number;

  constructor(model = "gpt-4o", maxTokens = 4096, clientOptions?: ConstructorParameters<typeof OpenAI>[0]) {
    this.model = model;
    this.maxTokens = maxTokens;
    this.client = new OpenAI(clientOptions);
  }

  async complete(params: {
    system?: string;
    messages: ChatMessage[];
    tools?: ToolDef[];
    stream?: StreamHandlers;
  }): Promise<CompleteResult> {
    const tools: OpenAI.Chat.ChatCompletionTool[] | undefined = params.tools?.map((t) => ({
      type: "function",
      function: { name: t.name, description: t.description, parameters: t.inputSchema },
    }));

    try {
      return await withRetry(
        async () => {
          if (!tools && params.stream?.onText) {
            return this.streamPlainCompletion(params.system, params.messages, params.stream.onText);
          }
          return this.createCompletion(params.system, params.messages, tools);
        },
        { isRetryable: isRetryableOpenAiError },
      );
    } catch (err) {
      if (err instanceof OpenAI.AuthenticationError) {
        throw new ProviderError(`openai authentication failed, check OPENAI_API_KEY (${err.message})`, "openai", false);
      }
      if (err instanceof OpenAI.APIError) {
        throw new ProviderError(`openai api error (${err.status}): ${err.message}`, "openai", false);
      }
      throw err;
    }
  }

  private async createCompletion(
    system: string | undefined,
    messages: ChatMessage[],
    tools: OpenAI.Chat.ChatCompletionTool[] | undefined,
  ): Promise<CompleteResult> {
    const response = await this.client.chat.completions.create({
      model: this.model,
      max_tokens: this.maxTokens,
      messages: toOpenAiMessages(system, messages),
      tools,
    });

    const choice = response.choices[0];
    const text = choice.message.content ?? "";
    const toolCalls: ToolCall[] = (choice.message.tool_calls ?? [])
      .filter((call): call is OpenAI.Chat.ChatCompletionMessageFunctionToolCall => call.type === "function")
      .map((call) => ({
        id: call.id,
        name: call.function.name,
        input: JSON.parse(call.function.arguments) as Record<string, unknown>,
      }));

    return {
      text,
      toolCalls,
      done: toolCalls.length === 0,
      usage: {
        inputTokens: response.usage?.prompt_tokens ?? 0,
        outputTokens: response.usage?.completion_tokens ?? 0,
      },
    };
  }

  private async streamPlainCompletion(
    system: string | undefined,
    messages: ChatMessage[],
    onText: (delta: string) => void,
  ): Promise<CompleteResult> {
    const stream = await this.client.chat.completions.create({
      model: this.model,
      max_tokens: this.maxTokens,
      messages: toOpenAiMessages(system, messages),
      stream: true,
      stream_options: { include_usage: true },
    });

    let text = "";
    let inputTokens = 0;
    let outputTokens = 0;

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta?.content;
      if (delta) {
        text += delta;
        onText(delta);
      }
      if (chunk.usage) {
        inputTokens = chunk.usage.prompt_tokens;
        outputTokens = chunk.usage.completion_tokens;
      }
    }

    return { text, toolCalls: [], done: true, usage: { inputTokens, outputTokens } };
  }
}
