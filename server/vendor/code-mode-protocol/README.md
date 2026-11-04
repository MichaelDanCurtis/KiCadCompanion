# Pinned Code Mode protocol

Unmodified protocol from OpenAI Codex tag `rust-v0.153.4`, commit
`3d2ee51ca2d5db578f328aa75e20aa22c0197c9a`, file
`codex-rs/code-mode-protocol/src/grpc/codex.code_mode.v1.proto`.

Source: https://github.com/openai/codex/tree/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a

Protocol SHA-256:
`406d8f47d8d0b95a9d4ae104890e5e52764c9597e9271f75ff434a4ce24748d0`.
The runtime verifies this digest before loading the schema. Upstream Apache-2.0
LICENSE and NOTICE accompany this unmodified copy. Fixture compatibility copies
remain under tests/fixtures/code-mode-protocol for historical evidence links.

This is a private, version-pinned runtime candidate, not a stable upstream API
promise or permission to distribute provider binaries or access a service. The
matching source accepts HTTP(S) gRPC URLs; published app-server documentation
has described WebSockets. Pin the dispatcher, host and protocol together; never
silently adapt a different version. Production activation remains separately
gated by the provider boundary and its qualification.

The gateway handles local code-host RPC payloads containing model-generated
source and tool results. It never logs those payloads and does not forward
incoming authorization metadata. Its receipts contain bounded tool-name/type
metadata and schema digests only, never source, arguments, results or account
credentials. Closing the owned host closes the gateway and terminates that
owned process, with a SIGKILL fallback after two seconds.
