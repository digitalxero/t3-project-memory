import {
  mkdirSync,
  readFileSync,
  openSync,
  writeFileSync,
  fsyncSync,
  closeSync,
  renameSync,
  unlinkSync,
  readdirSync,
  statSync,
} from "node:fs";
import { join } from "node:path";
import { createHash, randomUUID } from "node:crypto";

const text = (value, max, name) => {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.length > max ||
    Buffer.byteLength(value) > max * 2 ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)
  )
    throw new Error(`Invalid ${name} (1–${max} characters required).`);
  return value.trim();
};
const integer = (value, fallback, max) => {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || value < 1 || value > max)
    throw new Error(`Expected an integer from 1 to ${max}.`);
  return value;
};
const tokens = (value) => [
  ...new Set(
    value
      .normalize("NFKC")
      .toLocaleLowerCase("en-US")
      .match(/[\p{L}\p{N}_]+/gu) ?? [],
  ),
];
export function createStore(directory, environmentId) {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const path = (project) =>
    join(
      directory,
      createHash("sha256")
        .update(text(project, 200, "project"))
        .digest("hex") + ".json",
    );
  const read = (project) => {
    let raw;
    try {
      if (statSync(path(project)).size > 32_000_000)
        throw new Error("Memory file exceeds recovery limit.");
      raw = readFileSync(path(project), "utf8");
    } catch (e) {
      if (e.code === "ENOENT")
        return { version: 1, environmentId, projectId: project, enabled: false, entries: [] };
      throw e;
    }
    if (Buffer.byteLength(raw) > 32_000_000)
      throw new Error("Memory file exceeds recovery limit. Restore an export offline.");
    const data = JSON.parse(raw);
    if (
      data.version !== 1 ||
      data.environmentId !== environmentId ||
      data.projectId !== project ||
      typeof data.enabled !== "boolean" ||
      !Array.isArray(data.entries) ||
      data.entries.length > 500
    )
      throw new Error("Invalid memory file or environment identity. Restore an export offline.");
    for (const entry of data.entries) {
      text(entry.id, 200, "id");
      text(entry.content, 2000, "content");
      text(entry.source, 500, "source");
      if (!Array.isArray(entry.history) || entry.history.length > 5)
        throw new Error("Invalid correction history.");
    }
    return data;
  };
  const write = (data) => {
    const dest = path(data.projectId),
      temp = dest + ".tmp";
    const fd = openSync(temp, "w", 0o600);
    try {
      writeFileSync(fd, JSON.stringify(data));
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(temp, dest);
    // Directory fsync is supported on Unix; Windows cannot open directories this way.
    if (process.platform !== "win32") {
      const dir = openSync(directory, "r");
      try {
        fsyncSync(dir);
      } finally {
        closeSync(dir);
      }
    }
  };
  const enabled = (project) => {
    const data = read(project);
    if (!data.enabled)
      throw new Error(
        "Agent memory is disabled for this project. Ask the user to enable it in Shared Project Memory.",
      );
    return data;
  };
  return {
    read,
    projects: () =>
      readdirSync(directory)
        .filter((name) => /^[a-f0-9]{64}\.json$/.test(name))
        .map((name) => {
          const data = JSON.parse(readFileSync(join(directory, name), "utf8"));
          return text(data.projectId, 200, "project");
        }),
    configure(project, on) {
      if (typeof on !== "boolean") throw new Error("enabled must be boolean");
      const data = read(project);
      data.enabled = on;
      write(data);
      return { enabled: on };
    },
    remember(project, input, provenance) {
      const data = provenance.actor === "agent" ? enabled(project) : read(project);
      const content = text(input.content, 2000, "content"),
        source = text(input.source, 500, "source");
      const now = new Date().toISOString();
      if (input.id !== undefined) {
        const entry = data.entries.find((e) => e.id === input.id);
        if (!entry) throw new Error("Memory entry not found in this project.");
        entry.history = [
          ...entry.history,
          {
            content: entry.content,
            source: entry.source,
            provenance: entry.provenance,
            at: entry.updatedAt,
          },
        ].slice(-5);
        Object.assign(entry, { content, source, provenance, updatedAt: now });
        write(data);
        return entry;
      }
      if (data.entries.length >= 500)
        throw new Error(
          "Project memory is full (500 entries). Correct or forget an existing entry first.",
        );
      const entry = {
        id: randomUUID(),
        content,
        source,
        provenance,
        createdAt: now,
        updatedAt: now,
        history: [],
      };
      data.entries.push(entry);
      write(data);
      return entry;
    },
    recall(project, input) {
      const data = enabled(project),
        query = input.query === undefined ? "" : text(input.query, 500, "query");
      const terms = tokens(query),
        limit = integer(input.limit, 5, 20),
        budget = integer(input.budget, 8000, 20000);
      if (query && terms.length === 0) return { entries: [], truncated: false };
      const ranked = data.entries
        .map((e) => ({
          entry: e,
          score: terms.reduce(
            (n, t) => n + (tokens(e.content + " " + e.source).includes(t) ? 1 : 0),
            0,
          ),
        }))
        .filter((r) => !terms.length || r.score === terms.length)
        .sort(
          (a, b) =>
            b.score - a.score ||
            b.entry.updatedAt.localeCompare(a.entry.updatedAt) ||
            a.entry.id.localeCompare(b.entry.id),
        );
      const entries = [];
      let used = 0;
      for (const { entry } of ranked) {
        const result = {
          id: entry.id,
          content: entry.content,
          source: entry.source,
          provenance: entry.provenance,
          updatedAt: entry.updatedAt,
        };
        const size = JSON.stringify(result).length;
        if (entries.length >= limit || used + size > budget) break;
        entries.push(result);
        used += size;
      }
      return { entries, truncated: entries.length < ranked.length };
    },
    forget(project, id, agent = false) {
      const data = agent ? enabled(project) : read(project);
      text(id, 200, "id");
      const before = data.entries.length;
      data.entries = data.entries.filter((e) => e.id !== id);
      write(data);
      return { deleted: before !== data.entries.length };
    },
    clear(project) {
      const data = read(project);
      data.enabled = false;
      data.entries = [];
      write(data);
      return { deleted: true, enabled: false };
    },
    export(project, page = 1) {
      const data = read(project);
      const index = integer(page, 1, 1000);
      return {
        version: 1,
        environmentId,
        projectId: project,
        enabled: data.enabled,
        page: index,
        hasMore: index * 3 < data.entries.length,
        entries: data.entries.slice((index - 1) * 3, index * 3),
      };
    },
  };
}
