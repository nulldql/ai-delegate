import { readFile } from "fs/promises";
import { AnthropicProvider } from "./providers/anthropic.js";
import { OpenAiProvider } from "./providers/openai.js";
import type { Provider } from "./providers/types.js";

const PROVIDER_ALIASES: Record<string, "claude" | "openai"> = {
  claude: "claude",
  anthropic: "claude",
  openai: "openai",
  gpt: "openai",
};

export function resolveProvider(spec: string, maxTokens: number): Provider {
  const separatorIndex = spec.indexOf(":");
  const providerName = separatorIndex === -1 ? spec : spec.slice(0, separatorIndex);
  const model = separatorIndex === -1 ? "" : spec.slice(separatorIndex + 1);

  const resolved = PROVIDER_ALIASES[providerName];
  if (!resolved) {
    throw new Error(`unknown provider "${providerName}", use "claude" or "openai", optionally with :model-name`);
  }

  if (resolved === "claude") return new AnthropicProvider(model || "claude-opus-5", maxTokens);
  return new OpenAiProvider(model || "gpt-4o", maxTokens);
}

export type FileConfig = {
  planner?: string;
  worker?: string;
  maxDelegations?: number;
  maxTokens?: number;
  plannerSystem?: string;
  workerSystem?: string;
};

export async function loadConfigFile(path: string): Promise<FileConfig> {
  try {
    const raw = await readFile(path, "utf8");
    return JSON.parse(raw) as FileConfig;
  } catch (err) {
    if (err && typeof err === "object" && "code" in err && err.code === "ENOENT") return {};
    throw new Error(`couldn't read config file at ${path}: ${err instanceof Error ? err.message : String(err)}`);
  }
}
