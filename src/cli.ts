#!/usr/bin/env node
import { loadConfigFile, resolveProvider, type FileConfig } from "./config.js";
import { runDelegation, type DelegateResult } from "./planner.js";
import { estimateClaudeCost } from "./pricing.js";
import { ProviderError } from "./providers/errors.js";

function printHelp(): void {
  console.log(`ai-delegate <task>

a planner AI breaks your task into subtasks and delegates each one to a
worker AI, on any provider, then hands back a single answer.

  --planner <provider>[:<model>]   AI that plans and delegates (default: claude:claude-opus-5)
  --worker <provider>[:<model>]    AI that executes each subtask (default: claude:claude-opus-5)
  --max-delegations <n>            stop delegating after this many subtasks (default: 8)
  --max-tokens <n>                 max tokens per completion (default: 4096)
  --planner-system <text>          override the planner's system prompt
  --worker-system <text>           override the worker's system prompt
  --config <path>                  read defaults from a JSON config file (default: .aidelegaterc.json)
  --json                           print the full transcript as JSON instead of a live log
  --quiet                          only print the final answer
  --help                           show this message

providers: claude, openai. set ANTHROPIC_API_KEY and/or OPENAI_API_KEY.

examples:
  ai-delegate "plan a 3 day trip to tokyo" --planner claude --worker openai:gpt-4o
  ai-delegate "research and summarize the current state of fusion power" --worker claude:claude-haiku-4-5
`);
}

export type ParsedArgs = {
  task: string;
  plannerSpec?: string;
  workerSpec?: string;
  maxDelegations?: number;
  maxTokens?: number;
  plannerSystem?: string;
  workerSystem?: string;
  configPath: string;
  json: boolean;
  quiet: boolean;
};

export function parseArgs(argv: string[]): ParsedArgs | null {
  if (argv.length === 0 || argv.includes("--help")) {
    printHelp();
    return null;
  }

  const parsed: ParsedArgs = { task: "", configPath: ".aidelegaterc.json", json: false, quiet: false };
  const taskParts: string[] = [];

  function next(flag: string, i: number): string {
    const value = argv[i + 1];
    if (value === undefined) throw new Error(`${flag} needs a value`);
    return value;
  }

  function nextPositiveInt(flag: string, i: number): number {
    const raw = next(flag, i);
    const value = Number(raw);
    if (!Number.isFinite(value) || value <= 0) {
      throw new Error(`${flag} needs a positive number, got "${raw}"`);
    }
    return value;
  }

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--planner") {
      parsed.plannerSpec = next(arg, i);
      i += 1;
    } else if (arg === "--worker") {
      parsed.workerSpec = next(arg, i);
      i += 1;
    } else if (arg === "--max-delegations") {
      parsed.maxDelegations = nextPositiveInt(arg, i);
      i += 1;
    } else if (arg === "--max-tokens") {
      parsed.maxTokens = nextPositiveInt(arg, i);
      i += 1;
    } else if (arg === "--planner-system") {
      parsed.plannerSystem = next(arg, i);
      i += 1;
    } else if (arg === "--worker-system") {
      parsed.workerSystem = next(arg, i);
      i += 1;
    } else if (arg === "--config") {
      parsed.configPath = next(arg, i);
      i += 1;
    } else if (arg === "--json") {
      parsed.json = true;
    } else if (arg === "--quiet") {
      parsed.quiet = true;
    } else if (arg.startsWith("--")) {
      throw new Error(`unknown flag "${arg}"`);
    } else {
      taskParts.push(arg);
    }
  }

  parsed.task = taskParts.join(" ").trim();
  if (!parsed.task) throw new Error("no task given, pass one as the first argument");

  return parsed;
}

function mergeConfig(args: ParsedArgs, fileConfig: FileConfig) {
  return {
    plannerSpec: args.plannerSpec ?? fileConfig.planner ?? "claude:claude-opus-5",
    workerSpec: args.workerSpec ?? fileConfig.worker ?? "claude:claude-opus-5",
    maxDelegations: args.maxDelegations ?? fileConfig.maxDelegations ?? 8,
    maxTokens: args.maxTokens ?? fileConfig.maxTokens ?? 4096,
    plannerSystem: args.plannerSystem ?? fileConfig.plannerSystem,
    workerSystem: args.workerSystem ?? fileConfig.workerSystem,
  };
}

function printUsageSummary(result: DelegateResult, plannerModel: string, workerModel: string): void {
  const plannerCost = estimateClaudeCost(plannerModel, result.usage.planner.inputTokens, result.usage.planner.outputTokens);
  const workerCost = estimateClaudeCost(workerModel, result.usage.worker.inputTokens, result.usage.worker.outputTokens);

  console.log(
    `\nusage: planner ${result.usage.planner.inputTokens} in / ${result.usage.planner.outputTokens} out` +
      (plannerCost !== null ? ` (~$${plannerCost.toFixed(4)})` : ""),
  );
  console.log(
    `       worker  ${result.usage.worker.inputTokens} in / ${result.usage.worker.outputTokens} out` +
      (workerCost !== null ? ` (~$${workerCost.toFixed(4)})` : ""),
  );
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  let args: ParsedArgs | null;
  try {
    args = parseArgs(argv);
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
    return;
  }
  if (!args) return;

  const fileConfig = await loadConfigFile(args.configPath);
  const merged = mergeConfig(args, fileConfig);

  const planner = resolveProvider(merged.plannerSpec, merged.maxTokens);
  const worker = resolveProvider(merged.workerSpec, merged.maxTokens);

  if (!args.json && !args.quiet) {
    console.log(`planner: ${planner.name}:${planner.model}`);
    console.log(`worker:  ${worker.name}:${worker.model}\n`);
  }

  const result = await runDelegation({
    task: args.task,
    planner,
    worker,
    plannerSystem: merged.plannerSystem,
    workerSystem: merged.workerSystem,
    maxDelegations: merged.maxDelegations,
    onDelegationStart:
      !args.json && !args.quiet ? (subtask) => console.log(`-> delegating: ${subtask}`) : undefined,
    onDelegationEnd:
      !args.json && !args.quiet
        ? (event) => console.log(`${event.isError ? "!!" : "<-"} ${event.result}\n`)
        : undefined,
  });

  if (args.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (!args.quiet) {
    console.log(`--- done after ${result.delegations.length} delegation(s), ${result.plannerTurns} planner turn(s) ---\n`);
  }

  console.log(result.answer);

  if (!args.quiet) {
    printUsageSummary(result, planner.model, worker.model);
  }
}

main().catch((err) => {
  if (err instanceof ProviderError) {
    console.error(err.message);
  } else {
    console.error(err instanceof Error ? err.message : String(err));
  }
  process.exitCode = 1;
});
