export type ToolCall = {
  id: string;
  name: string;
  input: Record<string, unknown>;
};

export type ChatMessage =
  | { role: "user"; content: string }
  | { role: "assistant"; content: string; toolCalls?: ToolCall[] }
  | { role: "tool_result"; toolCallId: string; content: string; isError?: boolean };

export type ToolDef = {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
};

export type Usage = {
  inputTokens: number;
  outputTokens: number;
};

export type CompleteResult = {
  text: string;
  toolCalls: ToolCall[];
  done: boolean;
  usage: Usage;
};

export type StreamHandlers = {
  onText?: (delta: string) => void;
};

export interface Provider {
  readonly name: string;
  readonly model: string;
  complete(params: {
    system?: string;
    messages: ChatMessage[];
    tools?: ToolDef[];
    stream?: StreamHandlers;
  }): Promise<CompleteResult>;
}
