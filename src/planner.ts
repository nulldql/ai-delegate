import type { ChatMessage, Provider, ToolDef, Usage } from "./providers/types.js";
import { ProviderError } from "./providers/errors.js";

export type DelegationEvent = {
  subtask: string;
  context?: string;
  result: string;
  isError: boolean;
};

export type DelegateResult = {
  answer: string;
  delegations: DelegationEvent[];
  plannerTurns: number;
  usage: { planner: Usage; worker: Usage };
};

const DELEGATE_TOOL: ToolDef = {
  name: "delegate",
  description:
    "Delegate one concrete, self-contained subtask to the worker AI and get its result back. You can call this multiple times, including several times in the same turn for independent subtasks. Once you have everything you need, answer as plain text with no further tool calls.",
  inputSchema: {
    type: "object",
    properties: {
      subtask: { type: "string", description: "A specific, self-contained task for the worker to carry out." },
      context: {
        type: "string",
        description: "Background the worker needs that isn't obvious from the subtask alone.",
      },
    },
    required: ["subtask"],
  },
};

const PLANNER_SYSTEM =
  "You are the planning AI in a two-AI system. Break the user's task into concrete subtasks and delegate each one to the worker AI using the delegate tool. The worker only sees what you put in the subtask and context fields, it has no memory of anything else and cannot see the original task. Delegate as many subtasks as you need, in parallel when they're independent of each other. Once you have everything you need, respond with the final answer as plain text and make no further tool calls.";

function addUsage(a: Usage, b: Usage): Usage {
  return { inputTokens: a.inputTokens + b.inputTokens, outputTokens: a.outputTokens + b.outputTokens };
}

export async function runDelegation(params: {
  task: string;
  planner: Provider;
  worker: Provider;
  plannerSystem?: string;
  workerSystem?: string;
  maxDelegations?: number;
  maxPlannerTurns?: number;
  onDelegationStart?: (subtask: string) => void;
  onDelegationEnd?: (event: DelegationEvent) => void;
  onPlannerText?: (delta: string) => void;
  onWorkerText?: (delta: string) => void;
}): Promise<DelegateResult> {
  const maxDelegations = params.maxDelegations ?? 8;
  const maxPlannerTurns = params.maxPlannerTurns ?? maxDelegations + 4;
  const messages: ChatMessage[] = [{ role: "user", content: params.task }];
  const delegations: DelegationEvent[] = [];
  let plannerUsage: Usage = { inputTokens: 0, outputTokens: 0 };
  let workerUsage: Usage = { inputTokens: 0, outputTokens: 0 };
  let plannerTurns = 0;

  while (true) {
    plannerTurns += 1;
    if (plannerTurns > maxPlannerTurns) {
      return {
        answer: "stopped: the planner used up its turn budget without producing a final answer.",
        delegations,
        plannerTurns,
        usage: { planner: plannerUsage, worker: workerUsage },
      };
    }

    const result = await params.planner.complete({
      system: params.plannerSystem ?? PLANNER_SYSTEM,
      messages,
      tools: [DELEGATE_TOOL],
      stream: params.onPlannerText ? { onText: params.onPlannerText } : undefined,
    });
    plannerUsage = addUsage(plannerUsage, result.usage);

    if (result.toolCalls.length === 0) {
      return {
        answer: result.text,
        delegations,
        plannerTurns,
        usage: { planner: plannerUsage, worker: workerUsage },
      };
    }

    messages.push({ role: "assistant", content: result.text, toolCalls: result.toolCalls });

    const remaining = Math.max(maxDelegations - delegations.length, 0);
    const callsToRun = result.toolCalls.slice(0, remaining);
    const overflowCalls = result.toolCalls.slice(remaining);

    const outcomes = await Promise.all(
      callsToRun.map(async (call) => {
        const subtask = typeof call.input.subtask === "string" ? call.input.subtask : JSON.stringify(call.input);
        const context = typeof call.input.context === "string" ? call.input.context : undefined;
        params.onDelegationStart?.(subtask);

        try {
          const workerResult = await params.worker.complete({
            system: params.workerSystem,
            messages: [{ role: "user", content: context ? `${subtask}\n\ncontext:\n${context}` : subtask }],
            stream: params.onWorkerText ? { onText: params.onWorkerText } : undefined,
          });
          const event: DelegationEvent = { subtask, context, result: workerResult.text, isError: false };
          return { call, event, usage: workerResult.usage };
        } catch (err) {
          const message =
            err instanceof ProviderError ? err.message : err instanceof Error ? err.message : String(err);
          const event: DelegationEvent = { subtask, context, result: `worker failed: ${message}`, isError: true };
          return { call, event, usage: { inputTokens: 0, outputTokens: 0 } };
        }
      }),
    );

    for (const outcome of outcomes) {
      delegations.push(outcome.event);
      workerUsage = addUsage(workerUsage, outcome.usage);
      params.onDelegationEnd?.(outcome.event);
      messages.push({
        role: "tool_result",
        toolCallId: outcome.call.id,
        content: outcome.event.result,
        isError: outcome.event.isError,
      });
    }

    for (const call of overflowCalls) {
      const subtask = typeof call.input.subtask === "string" ? call.input.subtask : "";
      const event: DelegationEvent = {
        subtask,
        result: "skipped: reached the delegation limit for this run",
        isError: true,
      };
      delegations.push(event);
      params.onDelegationEnd?.(event);
      messages.push({ role: "tool_result", toolCallId: call.id, content: event.result, isError: true });
    }
  }
}
