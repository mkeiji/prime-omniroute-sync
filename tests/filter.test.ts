import test from "node:test";
import assert from "node:assert/strict";
import { combineCatalogModels, filterModels, toPrimeModel } from "../src/index.ts";

const config = { providers: ["OpenAI", "anthropic"], includeModels: [], excludeModels: [], includeAutoModels: false };
const catalog = [
  { id: "openai/gpt-4.1", context_window: 100000, max_tokens: 4000 },
  { id: "anthropic/claude-sonnet" },
  { id: "google/gemini-pro" },
  { id: "auto" },
  { id: "auto/fast" },
];

test("provider allowlist is case-insensitive and excludes other providers and auto routes", () => {
  assert.deepEqual(filterModels(catalog, config).map((m) => m.id), ["openai/gpt-4.1", "anthropic/claude-sonnet"]);
});
test("include and exclude globs apply before output; excludes win", () => {
  assert.deepEqual(filterModels(catalog, { ...config, includeModels: ["*sonnet*", "openai/*"], excludeModels: ["*sonnet"] }).map((m) => m.id), ["openai/gpt-4.1"]);
});
test("models defined in combos are included alongside selected providers", () => {
  const combos = [{ id: "custom-route", name: "Custom route" }];
  const allModels = combineCatalogModels(catalog, combos);
  assert.deepEqual(filterModels(allModels, config).map((m) => m.id), [
    "openai/gpt-4.1", "anthropic/claude-sonnet", "custom-route",
  ]);
});
test("auto routes can be enabled separately", () => {
  assert.deepEqual(filterModels(catalog, { ...config, includeAutoModels: true }).map((m) => m.id), ["openai/gpt-4.1", "anthropic/claude-sonnet", "auto", "auto/fast"]);
});
test("model conversion preserves catalog limits and provides defaults", () => {
  assert.deepEqual(toPrimeModel(catalog[0]), { id: "openai/gpt-4.1", name: "openai/gpt-4.1", reasoning: false, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 100000, maxTokens: 4000 });
});
