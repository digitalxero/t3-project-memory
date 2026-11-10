# Verification

Minimum host: `djgilcrease/t3code` integration commit
`99c9ae3f3f844e6d6988809a985a44f68ab21543`, merged by Dj in
[PR #2](https://github.com/djgilcrease/t3code/pull/2). Its tree equals the tested
feature head `b71d60c41929055a4aeb8cc5f982726205b1c515`.

Host local proof: the new context assertion failed against the original MCP
handler, then passed with the fix; all 20 focused MCP/worker isolation tests and
all 45 tests selected by `check:changed` passed. Format, lint, knip, GraphQL and
affected typechecks passed. Hosted fork CI initially had an inherited budget
failure against main and queued Blacksmith jobs; the merge was performed by Dj,
not presented here as a fully green hosted CI result.

Plugin tests exercise opt-in and disabled access, hostile project input,
unscoped callers, environment isolation, new-thread provenance, correction
history, full-capacity rejection, lexical AND and punctuation queries, result
and character limits, export pagination, clear/forget, corrupt-state failure,
persistence, public SDK view validation, and the self-contained built entrypoint.
The initial repository CI passed Linux, macOS and Windows operation jobs. The
release PR reruns those jobs for the final source and committed bundle.

An isolated Linux development server and real Browser panel verified the
settings inspector, opt-in, remembering and correction with provenance. State
lived in this thread's worktree `.t3`; no server used the shared live database.
Before/after captures are attached to the delivery PR, not committed here.
Desktop and mobile use the host's existing data-driven plugin renderer; no native
Electron/iOS/Android runtime pass has been claimed. No live remote/tunnel session
or real paid provider was used. Agent identity and grants are tested through the
normal MCP registration and real worker IPC instead.

Repository-URL installation, lifecycle and packaged-host loading of the stable
tag are release gates. Their final results belong in the release notes; this
file does not claim those pending gates have passed.
