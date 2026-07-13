# Native keyring dependency qualification

> Qualified: 2026-07-12
> Package: `@napi-rs/keyring@1.3.0` (exact pin)
> Decision: Approved for the Spec 007 macOS/Linux credential-store seam; Windows continues to use the existing DPAPI store.

## Provenance and license

- npm package: `@napi-rs/keyring@1.3.0`
- Upstream repository: <https://github.com/Brooooooklyn/keyring-node>
- Release: <https://github.com/Brooooooklyn/keyring-node/releases/tag/v1.3.0>
- License: MIT, confirmed by the package metadata and upstream `LICENSE`: <https://github.com/Brooooooklyn/keyring-node/blob/main/LICENSE>
- Binding: N-API Rust binding over `keyring-rs`; no command-line secret transport is used.

## Runtime and binary matrix

- Package engine declaration: Node `>=10`.
- The 1.3.0 upstream development baseline uses `@types/node` 24 and N-API.
- Local qualification loaded the published Windows x64 native package under Node `v24.17.0`.
- Published 1.3.0 optional packages cover the approved targets:
  - macOS: `darwin-arm64`, `darwin-x64`
  - Linux glibc/musl: `linux-arm64-gnu`, `linux-arm64-musl`, `linux-x64-gnu`, `linux-x64-musl`
  - Windows regression package: `win32-x64-msvc` (plus arm64/ia32, not claimed by this MVP)

Clean-host loading and real Keychain/Secret Service set/get/delete evidence remain T8 acceptance work. Package publication metadata is not treated as proof that a host keyring is configured or unlocked.

## Security boundary

- FindMnemo uses only the asynchronous entry API.
- A random, isolated probe is set, read, and deleted before a macOS/Linux store is returned.
- Load, permission, locked-store, mismatch, or cleanup failure returns a safe unavailable capability and no store.
- There is no plaintext file, browser storage, command-line secret, or colocated-key fallback.
- Probe values, account identifiers, raw native errors, credentials, and keyring handles are excluded from browser DTOs and diagnostic guidance.

## Lock and refresh policy

- Root dependency is pinned exactly to `1.3.0`; the lockfile retains platform-specific optional packages.
- Dependency refresh requires repeating license/provenance, Node 24, published-target, fake-adapter, local native-load, privacy, and clean-host keyring checks.
