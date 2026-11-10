import { PluginView, PluginCommandDescriptor } from "@t3tools/plugin-sdk";
import * as Schema from "effect/Schema";
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as Effect from "effect/Effect";
import plugin from "../src/plugin.mjs";
import { createStore } from "../src/store.mjs";
const fixture = (t) => {
  const dir = mkdtempSync(join(tmpdir(), "t3-memory-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return { dir, store: createStore(dir, "env-a") };
};
const agent = { actor: "agent", threadId: "thread-1", environmentId: "env-a" };
test("project opt-in, remember, bounded lexical recall, correction provenance, persistence, forget and isolation", (t) => {
  const { dir, store } = fixture(t);
  assert.throws(
    () => store.remember("a", { content: "task e2e", source: "docs" }, agent),
    /disabled/,
  );
  store.configure("a", true);
  store.configure("b", true);
  const first = store.remember(
    "a",
    { content: "Run task e2e against staging", source: "docs/testing" },
    agent,
  );
  store.remember("b", { content: "secret project b fact", source: "b" }, agent);
  assert.equal(store.recall("a", { query: "staging task" }).entries[0].id, first.id);
  assert.equal(store.recall("a", { query: "secret" }).entries.length, 0);
  assert.equal(store.recall("a", { query: "！！！" }).entries.length, 0);
  assert.deepEqual(store.recall("a", { budget: 1 }), { entries: [], truncated: true });
  const corrected = store.remember(
    "a",
    { id: first.id, content: "Run task e2e locally", source: "decision" },
    { ...agent, threadId: "new-provider-thread" },
  );
  assert.equal(corrected.history[0].provenance.threadId, "thread-1");
  assert.equal(
    createStore(dir, "env-a").recall("a", { query: "locally" }).entries[0].provenance.threadId,
    "new-provider-thread",
  );
  assert.throws(() => createStore(dir, "env-b").read("a"), /identity/);
  store.configure("a", false);
  assert.throws(() => store.recall("a", {}), /disabled/);
  assert.equal(store.export("a").entries.length, 1);
  assert.equal(store.forget("a", first.id).deleted, true);
  assert.equal(store.export("a").entries.length, 0);
});
test("limits, literal search, full capacity, clear while disabled and corrupt-state fail closed", (t) => {
  const { dir, store } = fixture(t);
  store.configure("a", true);
  for (let i = 0; i < 500; i++)
    store.remember("a", { content: `Fact ${i}: task e2e`, source: "test" }, agent);
  assert.throws(() => store.remember("a", { content: "overflow", source: "test" }, agent), /full/);
  assert.equal(store.recall("a", { query: "task", limit: 2 }).entries.length, 2);
  for (const input of [{ limit: 21 }, { budget: 20001 }, { limit: 0 }, { budget: 1.5 }])
    assert.throws(() => store.recall("a", input));
  assert.equal(store.recall("a", { query: "DROP TABLE" }).entries.length, 0);
  assert.equal(store.export("a", 1).entries.length, 3);
  assert.equal(store.export("a", 167).entries.length, 2);
  store.clear("a");
  assert.equal(store.read("a").enabled, false);
  assert.equal(store.read("a").entries.length, 0);
  writeFileSync(
    join(
      dir,
      readdirSync(dir).find((f) => f.endsWith(".json")),
    ),
    "{bad",
  );
  assert.throws(() => store.read("a"));
  assert.throws(() => store.configure("a", true));
});
test("real plugin commands bind agents to host context, deny unscoped peers, keep user control private and expose portable views", async (t) => {
  const { dir } = fixture(t);
  const contributions = await Effect.runPromise(
    plugin.activate({
      dataDirectory: dir,
      environmentId: Effect.succeed("env-a"),
      capabilities: ["command-invocation-context"],
      notifications: {
        targets: Effect.succeed({
          projects: [
            { id: "a", label: "Project A" },
            { id: "b", label: "Project B" },
          ],
          providers: [],
          truncated: false,
        }),
      },
    }),
  );
  for (const command of contributions.commands)
    Schema.decodeUnknownSync(PluginCommandDescriptor)(command);
  Schema.decodeUnknownSync(PluginView)(await Effect.runPromise(contributions.views[0].read()));
  const invoke = (id, input, ctx) =>
    Effect.runPromise(contributions.commands.find((c) => c.id === id).run(input, ctx));
  const user = { audience: "client" },
    caller = { audience: "agent", environmentId: "env-a", projectId: "a", threadId: "thread-1" };
  await invoke("configure", { projectId: "a", enabled: true }, user);
  const entry = await invoke(
    "remember",
    { projectId: "b", content: "NFKC café tests", source: "source" },
    caller,
  );
  assert.equal(typeof entry.id, "string");
  assert.equal((await invoke("recall", {}, caller)).entries.length, 1);
  assert.match((await invoke("recall", {}, { ...caller, projectId: "b" })).text, /disabled/);
  for (const ctx of [
    undefined,
    { audience: "agent" },
    { ...caller, environmentId: "env-b" },
    { audience: "agent", environmentId: "env-a" },
  ])
    assert.equal((await invoke("recall", { projectId: "a" }, ctx)).tone, "danger");
  assert.equal(
    (await invoke("configure", { projectId: "a", enabled: true }, caller)).tone,
    "danger",
  );
  assert.equal(contributions.commands.find((c) => c.id === "configure").agent, false);
  assert.equal(
    contributions.commands.find((c) => c.id === "remember").permission,
    "orchestration:operate",
  );
  await invoke("select", { projectId: "a" }, user);
  const view = await Effect.runPromise(contributions.views[0].read());
  Schema.decodeUnknownSync(PluginView)(view);
  assert.ok(view.blocks.some((b) => b.id === "edit-" + entry.id));
  assert.ok(Buffer.byteLength(JSON.stringify(view)) < 256 * 1024);
  await invoke("configure", { projectId: "a", enabled: false }, user);
  assert.equal((await invoke("recall", {}, caller)).tone, "danger");
  assert.equal((await invoke("export", { projectId: "a" }, user)).entries.length, 1);
  assert.equal((await invoke("clear", { projectId: "a", confirm: "no" }, user)).tone, "danger");
  await invoke("clear", { projectId: "a", confirm: "DELETE" }, user);
  assert.equal((await invoke("export", { projectId: "a" }, user)).entries.length, 0);
});

test("self-contained bundle, manifest agreement and worst-case correction/export/view bounds", async (t) => {
  const { dir } = fixture(t);
  const { default: built } = await import("../dist/plugin.mjs");
  const manifest = JSON.parse(
    (await import("node:fs")).readFileSync(new URL("../t3-plugin.json", import.meta.url), "utf8"),
  );
  assert.equal(built.id, manifest.id);
  assert.equal(built.version, manifest.version);
  const c = await Effect.runPromise(
    built.activate({
      dataDirectory: dir,
      environmentId: Effect.succeed("env-a"),
      capabilities: ["command-invocation-context"],
      notifications: {
        targets: Effect.succeed({
          projects: [{ id: "a", label: "Project A" }],
          providers: [],
          truncated: false,
        }),
      },
    }),
  );
  const invoke = (id, input) =>
    Effect.runPromise(c.commands.find((v) => v.id === id).run(input, { audience: "client" }));
  const content = '"'.repeat(2000),
    source = '"'.repeat(500);
  for (let i = 0; i < 3; i++) {
    const e = await invoke("remember", { projectId: "a", content, source });
    for (let revision = 0; revision < 7; revision++)
      await invoke("remember", { projectId: "a", id: e.id, content, source });
  }
  await invoke("select", { project: "a" });
  const view = await Effect.runPromise(c.views[0].read());
  Schema.decodeUnknownSync(PluginView)(view);
  assert.ok(Buffer.byteLength(JSON.stringify(view)) < 256 * 1024);
  const exported = await invoke("export", { projectId: "a" });
  const exportView = await Effect.runPromise(c.views[0].read());
  Schema.decodeUnknownSync(PluginView)(exportView);
  assert.ok(Buffer.byteLength(JSON.stringify(exportView)) < 256 * 1024);
  assert.equal(
    JSON.parse(
      exportView.blocks
        .filter((b) => b.id.startsWith("export-") && b.id !== "export-help")
        .map((b) => b.text)
        .join(""),
    ).entries.length,
    3,
  );
  assert.equal(exported.entries.length, 3);
  assert.equal(exported.entries[0].history.length, 5);
  assert.ok(Buffer.byteLength(JSON.stringify(exported)) < 256 * 1024);
  assert.equal(view.blocks.find((b) => b.id === "choose").fields[0].options[0].label, "Project A");
});
