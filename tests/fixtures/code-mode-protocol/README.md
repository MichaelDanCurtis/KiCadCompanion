# Pinned test protocol

Historical compatibility copy. Runtime code now loads the identical pinned
protocol and notices from `server/vendor/code-mode-protocol/`; fixture gateway
imports reexport that runtime implementation. The copies are byte-compared by
the focused host test. Original provenance follows.

Unmodified protocol from OpenAI Codex tag `rust-v0.153.4`, commit
`3d2ee51ca2d5db578f328aa75e20aa22c0197c9a`, file
`codex-rs/code-mode-protocol/src/grpc/codex.code_mode.v1.proto`.

Source: https://github.com/openai/codex/tree/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a

Upstream Apache-2.0 LICENSE and NOTICE accompany this copy. This is a private
test dependency, not a promise of a stable supported provider interface. The
matching source accepts HTTP(S) gRPC URLs for `--code-mode-host`; the currently
published app-server documentation instead describes WebSockets. Pin the
binary, host and protocol together. Do not silently adapt another version.

No credentials, model requests, account traffic or raw response events traverse
this test gateway. It sees local code-host RPC requests, which can contain
model-generated source and tool results; never log those payloads.
