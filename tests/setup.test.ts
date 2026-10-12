import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const home = await mkdtemp(join(tmpdir(), "omniroute-setup-"));
process.env.HOME = home;
const { default: extension } = await import("../src/index.ts");

test("setup discovers and syncs a combo-only catalog", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({
    data: [], combos: [{ id: "custom-route", name: "Custom route" }],
  }), { status: 200, headers: { "content-type": "application/json" } });
  let command: { handler: (args: string, ctx: unknown) => Promise<void> } | undefined;
  const registered: Record<string, unknown>[] = [];
  const pi = {
    registerCommand: (_name: string, value: typeof command) => { command = value; },
    registerProvider: (_name: string, value: { models: Record<string, unknown>[] }) => registered.push(...value.models),
  };
  let answers = ["http://localhost:20128", ""];
  const notices: string[] = [];
  const ctx = { ui: {
    input: async () => answers.shift(),
    notify: (message: string) => notices.push(message),
  } };
  try {
    await extension(pi as never);
    assert.ok(command);
    await command!.handler("setup", ctx);
    const file = JSON.parse(await readFile(join(home, ".prime/agent/models.json"), "utf8"));
    assert.deepEqual(file.providers.omniroute.models.map((model: { id: string }) => model.id), ["custom-route"]);
    assert.deepEqual(registered.map((model) => model.id), ["custom-route"]);
    assert.ok(notices.some((message) => message.includes("synced 1 models")));

    globalThis.fetch = async () => new Response(JSON.stringify({
      data: [
        { id: "openai/model" },
        { id: "google/model" },
        { id: "kg-medium", owned_by: "combo", context_length: 64000 },
        { id: "auto/fast", owned_by: "combo" },
        { id: "openai/shared", name: "In data", owned_by: "combo", max_tokens: 512 },
      ],
      combos: [
        { id: "combo-provider/route" },
        { id: "openai/shared", name: "Separate combo", max_tokens: 256 },
      ],
    }), { status: 200, headers: { "content-type": "application/json" } });
    answers = ["http://localhost:20128", "", "openai"];
    await command!.handler("setup", ctx);
    const providerNotice = notices.find((message) => message.startsWith("Available provider prefixes:"));
    assert.deepEqual(providerNotice?.split("\n"), ["Available provider prefixes:", "google, openai"]);
    const synced = registered.map((model) => model.id);
    assert.deepEqual(synced, ["custom-route", "openai/model", "kg-medium", "openai/shared", "combo-provider/route"]);
    assert.equal(registered.find((model) => model.id === "openai/shared")?.name, "Separate combo");
    assert.equal(registered.find((model) => model.id === "openai/shared")?.maxTokens, 256);
    assert.equal(synced.includes("auto/fast"), false);

    globalThis.fetch = async () => new Response(JSON.stringify({ data: [], combos: [] }), { status: 200 });
    answers = ["http://localhost:20128", ""];
    await command!.handler("setup", ctx);
    assert.ok(notices.some((message) => message.includes("No selectable models found")));
  } finally {
    globalThis.fetch = originalFetch;
    await rm(home, { recursive: true, force: true });
  }
});
