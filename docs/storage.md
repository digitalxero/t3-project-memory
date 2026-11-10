# Storage decision (2026-11-10)

For 500 short facts per project, bounded lexical recall needs no model or vector
index. Choose one atomic JSON snapshot per project in T3's plugin data directory.
The index is an in-process scan of at most 500 entries. Each entry is capped at
2,000 characters/4,000 UTF-8 bytes, source at 500 characters/1,000 bytes, with
five prior corrections. Writes are serialized synchronous operations in one
worker event loop, fsync the temporary file, then rename over the old snapshot.
Unix also fsyncs the directory; Windows lacks that extra durability guarantee.
A crash before rename preserves the prior snapshot; leftover temporary files are
ignored. Invalid state fails closed and is never silently reset. Restore an
export offline under its original identity after stopping the plugin. This is
crash-resistant persistence, not a backup or a concurrent multi-writer store.

## Candidates investigated

Actual current source snapshots:

- [veqlite](https://github.com/sirasagi62/veqlite/tree/2de9b0c91ac28d1c97bc66205d8e89205b493b0d), version 0.2.1, last commit 2026-08-16.
- [rag-lite-ts](https://github.com/raglite/rag-lite-ts/tree/5e14810e9c1c7ec79b65a8ab2d99873fc7fad7ae), version 2.3.1, last commit 2026-01-25.

Both package manifests declare MIT. RAG-lite has a LICENSE; veqlite's checked
source has no standalone license file, so redistribution would require checking
its npm contents/notices. No source from either was copied into this plugin.
Both have modest histories (32 and 30 commits at inspection); dates alone do not
establish future maintenance or support guarantees.

Veqlite offers SQLite/sqlite-vec and PGlite/pgvector drivers, injected embedding
models, vector nearest-neighbor retrieval, metadata and bulk ingestion. Its
public DB facade has no lexical recall or forget/correction API. SQLite triggers
maintain vectors when SQL rows change, but the provided transaction helper has
no rollback on callback failure. The Node adapter always loads sqlite-vec's
native extension. Declared dependencies also include better-sqlite3, PGlite,
Transformers and ts-node. An injected model can avoid model calls but does not
remove installed dependencies. Default embeddings require local model downloads
and ONNX execution; local inference costs CPU/RAM and disk, even without API fees.

Practical experiment: installed veqlite@0.2.1 on Node 24.22 Linux and tried schema,
insert and search with a deterministic three-dimensional test embedder. The
unmodified Node adapter failed insert with `column index out of range` (numbered
SQL parameters `$1` etc passed positionally to node:sqlite). This is a candidate
integration failure, not a claim that every driver fails. No real embedding model
was downloaded and no semantic-relevance benchmark is claimed.

RAG-lite provides text/multimodal ingestion, chunking, transformer embeddings,
optional reranking/generation, SQLite metadata and an HNSW WASM vector index in a
separate worker. Source `src/core/vector-index.ts` resolves a compiled worker by
filesystem location; it cannot simply disappear inside one bundled plugin entry.
The SQLite document store and binary index are separate durable artifacts, with
rebuild/recovery machinery rather than a single transactional fact store. Its
core DB and vector layers can be used without a model, but that bypasses much of
the advertised retrieval engine. No built-in project permission boundary is a
substitute for host authentication and plugin scoping.

Practical experiment: installed rag-lite-ts@2.3.1, opened and initialized its real
SQLite schema, initialized its actual WASM worker, inserted vector 1, searched it
and saved the binary index. Search returned neighbor 1 at distance 0. Reopened that saved index and repeated
the search successfully. Real SQLite document/chunk insertion, correction,
connection reopen and cascading deletion also passed. Native
sqlite3, hnswlib-wasm, Transformers/ONNX, parsers and optional sharp expand the
packaging surface. The combined candidate install occupied approximately 949 MiB
on this Linux host, excluding model downloads. That is not an individual package
size measurement. Native/WASM compatibility on Windows/macOS or T3 SEA was not
proven by this experiment.

Neither candidate provides the permission, project identity, provenance, user
controls or disable semantics this plugin needs. Neither is adopted. Adding
semantic retrieval later should require evidence that lexical misses materially
hurt this bounded use case, plus real embedding/recovery and packaged-worker
experiments on each supported host OS. The chosen backend uses only Node fs,
path and crypto built-ins and needs no network, API key, model, native extension,
or WASM asset. Its own operations, lifecycle and packaged loading are verified
separately; do not infer host-platform coverage from candidate experiments.
