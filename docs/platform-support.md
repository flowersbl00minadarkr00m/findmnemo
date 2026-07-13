# Source-run platform support

Support is evidence-based. A runnable Node binary alone is not a FindMnemo full-parity claim.

Automated CI and real-user acceptance are different evidence categories. The source matrix runs locked installs, contract tests, privacy scans, builds, and an isolated loopback smoke on GitHub-hosted Windows, macOS, and Ubuntu x64/arm64 runners. It uses fake credential-store contract tests; it does **not** prove that a real Keychain or Secret Service session is unlocked, nor that Gmail OAuth completed. GitHub's current standard runner labels are tracked in the [official hosted-runner reference](https://docs.github.com/en/actions/reference/runners/github-hosted-runners); the Windows and Ubuntu arm64 labels are public-preview infrastructure and a failed row blocks support promotion.

Fresh automated evidence: [Source run 29222169928](https://github.com/flowersbl00minadarkr00m/findmnemo/actions/runs/29222169928) passed Windows x64/arm64, macOS Intel/Apple silicon, Ubuntu 24.04 x64/arm64, the Windows desktop regression, and the required aggregate job on 2026-07-12. macOS and Ubuntu remain experimental for **full Gmail parity** until clean desktop hosts complete real Keychain/Secret Service and Gmail OAuth acceptance.

| Platform | Architecture | Current claim | Gmail requirement |
|---|---:|---|---|
| Windows 11 source run | x64 | Supported regression path | Existing DPAPI CurrentUser store |
| macOS 13.5+ | arm64/x64 | Experimental pending clean-host acceptance | Login Keychain and successful native probe |
| Ubuntu 24.04 LTS desktop | arm64/x64 | Experimental pending clean-host acceptance | Unlocked Secret Service provider and successful native probe |
| Other glibc desktop Linux | arm64/x64 | Experimental | Same preflight; no support claim without evidence |
| Alpine/musl | any | Unsupported for full parity | Native/package and session contract not accepted |
| WSL | any | Unsupported for full parity | No accepted desktop/keyring lifecycle |
| Headless Linux without Secret Service | any | Unsupported for full parity | Core may run; Gmail parity is unavailable |

macOS/Linux are source-run only. This feature does not provide `.dmg`, Homebrew, `.deb`, AppImage, systemd, launch-agent, or daemon installation.

Run `npm run setup:check` before building. Its `supportLevel`, Node, filesystem, listener, database, dependency-lock, and credential-store fields are local evidence. Missing/locked secure storage keeps Gmail unavailable and never triggers a plaintext fallback. See [source-run.md](source-run.md) for recovery.
