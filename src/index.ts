import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const HOME = join(homedir(), ".prime", "agent");
const STATE_PATH = join(HOME, "extensions", "omniroute-model-sync", "config.json");
const MODELS_PATH = join(HOME, "models.json");
const PROVIDER_ID = "omniroute";
const API = "openai-completions";

type Config = {
  serverUrl: string;
  apiKey: string;
  providers: string[];
  includeModels: string[];
  excludeModels: string[];
  includeAutoModels: boolean;
};
type Model = {
  id: string;
  name?: string;
  context_length?: number;
  context_window?: number;
  contextWindow?: number;
  max_tokens?: number;
  max_output_tokens?: number;
  max_completion_tokens?: number;
  input_modalities?: string[];
  modalities?: string[];
  supports_reasoning?: boolean;
  reasoning?: boolean;
  [key: string]: unknown;
};
type ModelsFile = { providers?: Record<string, Record<string, unknown>>; [key: string]: unknown };

const defaultConfig = (): Config => ({
  serverUrl: "http://localhost:20128",
  apiKey: "",
  providers: [],
  includeModels: [],
  excludeModels: [],
  includeAutoModels: false,
});

function normalizeUrl(input: string): string {
  const url = new URL(input.trim());
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("Server URL must use http or https.");
  return url.toString().replace(/\/+$/, "").replace(/\/v1$/i, "");
}
function readConfig(): Config {
  try {
    const saved = JSON.parse(readFileSync(STATE_PATH, "utf8")) as Partial<Config>;
    return {
      ...defaultConfig(), ...saved,
      serverUrl: normalizeUrl(saved.serverUrl || defaultConfig().serverUrl),
      providers: Array.isArray(saved.providers) ? saved.providers.map(String) : [],
      includeModels: Array.isArray(saved.includeModels) ? saved.includeModels.map(String) : [],
      excludeModels: Array.isArray(saved.excludeModels) ? saved.excludeModels.map(String) : [],
    };
  } catch { return defaultConfig(); }
}
function saveConfig(config: Config): void {
  mkdirSync(dirname(STATE_PATH), { recursive: true });
  writeFileSync(STATE_PATH, JSON.stringify(config, null, 2), { mode: 0o600 });
  chmodSync(STATE_PATH, 0o600);
}
function readModelsFile(): ModelsFile {
  if (!existsSync(MODELS_PATH)) return {};
  try {
    const data = JSON.parse(readFileSync(MODELS_PATH, "utf8")) as ModelsFile;
    if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("models.json must contain a JSON object.");
    if (data.providers !== undefined && (!data.providers || typeof data.providers !== "object" || Array.isArray(data.providers))) {
      throw new Error("models.json providers must be a JSON object.");
    }
    return data;
  } catch (error) {
    throw new Error(`Cannot safely update ${MODELS_PATH}: ${error instanceof Error ? error.message : String(error)}`);
  }
}
function writeModelsFile(config: Config, models: Record<string, unknown>[]): void {
  const data = readModelsFile();
  data.providers ??= {};
  data.providers[PROVIDER_ID] = {
    baseUrl: `${config.serverUrl}/v1`,
    api: API,
    apiKey: "OMNIROUTE_API_KEY",
    auth: "none",
    authHeader: true,
    models,
  };
  mkdirSync(dirname(MODELS_PATH), { recursive: true });
  const temp = `${MODELS_PATH}.tmp`;
  writeFileSync(temp, JSON.stringify(data, null, 2), { mode: 0o600 });
  chmodSync(temp, 0o600);
  renameSync(temp, MODELS_PATH);
}
function globRegex(glob: string): RegExp {
  let pattern = "^";
  for (const char of glob) {
    if (char === "*") pattern += ".*";
    else if (char === "?") pattern += ".";
    else pattern += /[|\\{}()[\]^$+]/.test(char) ? `\\${char}` : char;
  }
  return new RegExp(pattern + "$", "i");
}
function matchesAny(value: string, patterns: string[]): boolean {
  return patterns.some((pattern) => globRegex(pattern).test(value));
}
function modelProvider(model: Model): string {
  if (typeof model.id !== "string") return "";
  return model.id.includes("/") ? model.id.slice(0, model.id.indexOf("/")) : "";
}
export function filterModels(models: Model[], config: Config): Model[] {
  const providers = new Set(config.providers.map((name) => name.toLowerCase()));
  return models.filter((model) => {
    if (!model.id || typeof model.id !== "string") return false;
    const id = model.id;
    const isAuto = id === "auto" || id.startsWith("auto/");
    if (isAuto ? !config.includeAutoModels : !providers.has(modelProvider(model).toLowerCase())) return false;
    if (config.includeModels.length && !matchesAny(id, config.includeModels)) return false;
    return !matchesAny(id, config.excludeModels);
  });
}
export function toPrimeModel(model: Model): Record<string, unknown> {
  const contextWindow = numberOr(model.context_length, model.context_window, model.contextWindow, 128_000);
  const maxTokens = numberOr(model.max_output_tokens, model.max_completion_tokens, model.max_tokens, contextWindow);
  const modalities = model.input_modalities ?? model.modalities ?? [];
  const input = ["text", ...(modalities.some((m) => /image|vision/i.test(m)) ? ["image"] : [])];
  return {
    id: model.id,
    name: model.name || model.id,
    reasoning: model.supports_reasoning === true || model.reasoning === true,
    input,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow,
    maxTokens,
  };
}
function numberOr(...values: unknown[]): number {
  for (const value of values) if (typeof value === "number" && Number.isFinite(value) && value > 0) return value;
  return 128_000;
}
async function fetchCatalog(config: Config): Promise<Model[]> {
  const response = await fetch(`${config.serverUrl}/v1/models`, {
    headers: config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {},
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`OmniRoute returned HTTP ${response.status} from /v1/models.`);
  const payload = await response.json() as { data?: Model[] };
  if (!Array.isArray(payload.data)) throw new Error("OmniRoute response did not contain a data[] model list.");
  return payload.data;
}
function register(pi: ExtensionAPI, config: Config, models: Record<string, unknown>[]): void {
  if (!models.length) return;
  pi.registerProvider(PROVIDER_ID, {
    name: "OmniRoute",
    baseUrl: `${config.serverUrl}/v1`,
    apiKey: config.apiKey || "omniroute-public",
    api: API,
    models,
  });
}
async function sync(pi: ExtensionAPI, config: Config): Promise<number> {
  if (!config.providers.length) throw new Error("No providers selected. Run /omniroute setup and enter provider prefixes.");
  const catalog = await fetchCatalog(config);
  const selected = filterModels(catalog, config);
  if (!selected.length) throw new Error("No models matched the selected providers and filters; models.json was not changed.");
  const models = selected.map(toPrimeModel);
  writeModelsFile(config, models);
  register(pi, config, models);
  return models.length;
}
function providerNames(models: Model[]): string[] {
  return [...new Set(models.map(modelProvider).filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

export default async function (pi: ExtensionAPI): Promise<void> {
  let config = readConfig();
  // Restore the last selected catalog with the secure key from the extension config.
  const existing = readModelsFile().providers?.[PROVIDER_ID];
  if (existing && Array.isArray(existing.models)) register(pi, config, existing.models as Record<string, unknown>[]);

  pi.registerCommand("omniroute", {
    description: "Configure and sync filtered models from OmniRoute",
    handler: async (args, ctx) => {
      const action = (args || "help").trim().split(/\s+/)[0].toLowerCase();
      try {
        if (action === "setup") {
          const url = await ctx.ui.input("OmniRoute base URL", config.serverUrl);
          if (!url) return;
          const apiKey = await ctx.ui.input("OmniRoute API key (leave blank if not needed)", "");
          if (apiKey === undefined) return;
          const draft = { ...config, serverUrl: normalizeUrl(url), apiKey };
          ctx.ui.notify("Connecting to OmniRoute and discovering provider prefixes…", "info");
          const catalog = await fetchCatalog(draft);
          const available = providerNames(catalog);
          if (!available.length) throw new Error("No provider-prefixed model IDs found in the OmniRoute catalog.");
          ctx.ui.notify(`Available provider prefixes:\n${available.join(", ")}`, "info");
          const providersText = await ctx.ui.input("Provider prefixes to include (comma-separated)", config.providers.join(", "));
          if (providersText === undefined || !providersText.trim()) return;
          draft.providers = [...new Set(providersText.split(",").map((p) => p.trim()).filter(Boolean))];
          config = draft;
          saveConfig(config);
          const count = await sync(pi, config);
          ctx.ui.notify(`Saved config and synced ${count} models from: ${config.providers.join(", ")}`, "info");
          return;
        }
        if (action === "filters") {
          if (!config.apiKey) throw new Error("Run /omniroute setup first.");
          const includeText = await ctx.ui.input("Include model ID globs (comma-separated; blank = all selected-provider models)", config.includeModels.join(", "));
          if (includeText === undefined) return;
          const excludeText = await ctx.ui.input("Exclude model ID globs (comma-separated)", config.excludeModels.join(", "));
          if (excludeText === undefined) return;
          const autoText = await ctx.ui.input("Include auto and auto/* routing models? (yes/no)", config.includeAutoModels ? "yes" : "no");
          if (autoText === undefined) return;
          config.includeModels = includeText.split(",").map((p) => p.trim()).filter(Boolean);
          config.excludeModels = excludeText.split(",").map((p) => p.trim()).filter(Boolean);
          config.includeAutoModels = /^y(es)?$/i.test(autoText.trim());
          saveConfig(config);
          const count = await sync(pi, config);
          ctx.ui.notify(`Filters saved; synced ${count} models.`, "info");
          return;
        }
        if (action === "sync") {
          const count = await sync(pi, config);
          ctx.ui.notify(`Synced ${count} filtered models from OmniRoute.`, "info");
          return;
        }
        if (action === "status") {
          ctx.ui.notify(`URL: ${config.serverUrl}\nProviders: ${config.providers.join(", ") || "not set"}\nInclude: ${config.includeModels.join(", ") || "(all)"}\nExclude: ${config.excludeModels.join(", ") || "(none)"}\nAuto models: ${config.includeAutoModels ? "yes" : "no"}\nConfig: ${STATE_PATH}`, "info");
          return;
        }
        ctx.ui.notify("Commands: /omniroute setup | filters | sync | status", "info");
      } catch (error) {
        ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
      }
    },
  });
}
