# Tauri migration parity

The Tauri implementation was copied from Configurator 1.4.2 commit `2055da6`
and initially evaluated beside Electron as V2. On 2026-08-30 it was promoted
to the repository root and the Electron implementation was removed from this
branch. The updater remains excluded from the alpha; every other workflow
remains in the parity scope. The V1/V2 results below describe the parallel
evaluation before that promotion.

## Current status

- [x] Windows renderer and native shell
- [x] Serial discovery and connection
- [x] Board configuration, events, timers, logs, and CLI
- [x] Profiles and preflight
- [x] Local and onboard flight logs
- [x] CATS Flights handoff implementation
- [x] Unsigned Windows package
- [x] macOS and Linux package configuration and CI targets
- [x] Root Tauri application, canonical identity, and unified CI workflow
- [ ] Complete V1/V2 comparison report
- [ ] Successful native macOS and Linux CI packages and device checks

## Root promotion validation

Rechecked on Windows on 2026-08-30 after removing the parallel `v2` layout:

- 49 renderer and host-bridge tests pass from the repository root.
- 17 Rust tests pass; four opt-in read-only hardware checks also pass on COM4.
- The hardware checks include a configuration/profile/preflight snapshot,
  status, 50 connect/disconnect cycles, and the mounted `fl016.cfl` log.
- The log still contains 24,089 parsed records from 423,558 valid bytes,
  spanning -0.755 s to 47.29 s.
- Renderer lint/format checks, Rust formatting and Clippy, application/release
  contract checks, and the production frontend build pass.
- The renamed unsigned Windows NSIS installer builds successfully from the root.
- The canonical application name and identity replace the preview identity.
  Existing Electron installation upgrades and native macOS/Linux acceptance
  remain unvalidated.

## Windows validation

- Read-only hardware smoke, full configuration snapshot, profile round-trip,
  and preflight checks pass with a CATS Vega on COM4.
- The packaged application connects automatically, renders configuration,
  events, profiles, and preflight, and parses and plots a real onboard `.cfl`.
- Fifty consecutive connect/disconnect cycles pass. This check exposed and
  fixed a Windows port-handle release race before the successful run.
- Browser handoff is implemented and unit tested, but a live transfer was not
  performed during the read-only hardware session.
- Reset, save, configuration writes, exports, and onboard deletion were not
  exercised during the read-only hardware session.

## 1.4.2 regression audit

Audited against V1 commit `2055da6` on 2026-08-29. The renderer files are
byte-identical except for the intentional Tauri host integration, native file
selection/drop handling, preview footer, and excluded updater UI.

The audit found and fixed the following native-host parity gaps:

- delayed telemetry firmware-version refresh after Vega startup
- recovery when Vega emits `CATS is now ready` while the serial connection is idle
- bulk configuration reads with per-key fallback for firmware compatibility
- complete fake-Vega configuration, profile, and preflight behavior
- V1-compatible numeric profile comparisons and empty identity handling
- stable newest-first onboard flight-log ordering
- cancellation of a browser handoff with a partially connected client
- strict V1-equivalent external-link validation
- Vega communication transcript and connection/reset notifications

Validation after these fixes:

- all 113 V1 unit tests pass
- 22 V2 renderer tests pass, including the V1 profile and preflight suites
- 17 V2 native-host tests pass
- a connected Vega passes a profile/preflight snapshot, status smoke test, and
  50 consecutive connect/disconnect cycles
- the V1 and V2 parsers both read `fl016.cfl` as 24,089 records from 423,558
  valid bytes over the same -0.755 s to 47.29 s timeline
- the unsigned Windows NSIS preview package builds successfully

The updater remains intentionally excluded from the Tauri alpha. Destructive or
persistent device operations (reset/defaults, configuration writes, flash save,
and onboard-log deletion) were reviewed but were not run against the connected
production Vega during this read-only audit.
