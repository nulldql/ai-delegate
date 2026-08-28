import type { ChatMessage, CompleteResult, Provider, ToolDef, ToolCall } from "../providers/types.js";

export type FakeTurn =
  | CompleteResult
  | ((messages: ChatMessage[], tools: ToolDef[] | undefined) => CompleteResult | Promise<CompleteResult>);

export class FakeProvider implements Provider {
  readonly name: string;
  readonly model: string;
  readonly calls: { messages: ChatMessage[]; tools: ToolDef[] | undefined }[] = [];
  private turns: FakeTurn[];
  private turnIndex = 0;

  constructor(name: string, model: string, turns: FakeTurn[]) {
    this.name = name;
    this.model = model;
    this.turns = turns;
  }

  async complete(params: { system?: string; messages: ChatMessage[]; tools?: ToolDef[] }): Promise<CompleteResult> {
    this.calls.push({ messages: params.messages, tools: params.tools });
    const turn = this.turns[Math.min(this.turnIndex, this.turns.length - 1)];
    this.turnIndex += 1;
    return typeof turn === "function" ? turn(params.messages, params.tools) : turn;
  }
}

export function textResult(text: string): CompleteResult {
  return { text, toolCalls: [], done: true, usage: { inputTokens: 10, outputTokens: 10 } };
}

export function toolCallResult(calls: { id: string; subtask: string; context?: string }[]): CompleteResult {
  const toolCalls: ToolCall[] = calls.map((c) => ({
    id: c.id,
    name: "delegate",
    input: c.context ? { subtask: c.subtask, context: c.context } : { subtask: c.subtask },
  }));
  return { text: "", toolCalls, done: false, usage: { inputTokens: 20, outputTokens: 15 } };
}
