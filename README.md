# ai-delegate

A planner AI breaks your task into subtasks and hands each one to a worker AI, then combines what comes back into one answer. Planner and worker can be different providers entirely, Claude planning and GPT executing, or the other way around, or the same model twice.

```bash
ai-delegate "plan a 3 day trip to tokyo" --planner claude --worker openai:gpt-4o
```

## Why this exists

A single model handling a big task does everything itself, one long chain of reasoning. Splitting planning from execution lets you use a stronger model to break the problem down and a cheaper or faster one to do the legwork, or just compare how two different providers handle the same subtasks. The planner never sees your API keys, and the worker never sees anything except the subtask it was given.

## Install

Not published to npm yet, so clone and run it directly:

```bash
git clone https://github.com/TheCEO3-rgb/ai-delegate.git
cd ai-delegate
npm install
npm run build
node dist/cli.js "<task>"
```

Set whichever provider keys you plan to use:

```bash
export ANTHROPIC_API_KEY=...
export OPENAI_API_KEY=...
```

You only need the key for the provider you're actually pointing at. If the planner is Claude and the worker is GPT, you need both.

## Usage

```bash
ai-delegate "research the current state of fusion power and summarize it"
ai-delegate "plan a 3 day trip to tokyo" --planner claude --worker openai:gpt-4o
ai-delegate "compare these two approaches" --planner openai --worker claude:claude-haiku-4-5
```

### Options

```
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
```

Providers right now are `claude` (alias `anthropic`) and `openai` (alias `gpt`). Model defaults to `claude-opus-5` and `gpt-4o` respectively if you don't name one.

### Config file

Drop a `.aidelegaterc.json` in your working directory to set defaults without typing flags every time:

```json
{
  "planner": "claude:claude-opus-5",
  "worker": "openai:gpt-4o",
  "maxDelegations": 5
}
```

Flags on the command line override whatever's in the file.

## How it works

The planner gets your task plus one tool, `delegate`, that takes a subtask and optional context. It calls that tool as many times as it needs, including several times in the same turn for subtasks that don't depend on each other, those run concurrently against the worker. Once it has what it needs it answers in plain text with no more tool calls, and that's what gets printed.

The worker never sees your original task or the planner's reasoning, only the exact subtask and context it was handed. If a worker call fails, that failure gets reported back to the planner as a normal tool result instead of crashing the whole run, so the planner can decide what to do about it. There's a hard cap on both the number of delegations and the number of planner turns, so a planner that won't stop delegating can't run forever.

Each request retries automatically on rate limits and server errors, with exponential backoff. Auth errors and bad requests fail immediately since retrying won't fix those.

At the end you get a token usage summary for both planner and worker, with a cost estimate when the model is a Claude one whose pricing is known.

## Known limitations

The worker calls don't have any tools of their own, they're a single completion against whatever the subtask asks for. That keeps the mental model simple, planner delegates work, worker reasons about it and answers, but it means a subtask that genuinely needs to browse the web or run code won't get that from the worker directly.

Only Claude and OpenAI are wired up right now, both through their own official SDKs. Adding another provider means writing a new adapter against `Provider` in `src/providers/types.ts`, translating that provider's message and tool-call format to and from the shared shape the planner already speaks.

## Development

```bash
git clone https://github.com/TheCEO3-rgb/ai-delegate.git
cd ai-delegate
npm install
npm test
```

`npm test` builds the project and runs the full suite with Node's built-in test runner. Most of the orchestration logic (parallel delegation, the delegation and turn limits, worker failure handling, usage aggregation) is tested against a fake provider so it never needs real API access. On top of that, both the Claude and OpenAI adapters are tested against a local HTTP server standing in for the real API, so the actual request bodies and the actual SDK response parsing get exercised for real, not just the logic wrapped around them. One test runs the full planner loop with a real Anthropic-shaped planner and a real OpenAI-shaped worker talking to each other through two local servers at once.

## License

MIT
