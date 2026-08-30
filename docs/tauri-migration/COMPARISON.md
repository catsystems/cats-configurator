# Configurator V1 and V2 comparison

This is the historical evaluation of the parallel Tauri V2 preview against
Electron V1 commit `2055da6`. Tauri was promoted to the repository root on
2026-08-30. The measurements, artifact hashes, and paths in the raw benchmark
files refer to the earlier side-by-side builds, not the renamed root package.

## Windows package benchmark

Both unsigned packages were built from commit `2055da6` plus the current V2
preview changes on the same Windows 11 machine. Five silent-install rounds used
fresh temporary directories and alternated which package ran first. Memory is
the complete application process tree three seconds after the window appeared;
both applications used their fake Vega so the sample did not depend on COM4.

| Metric                           | V1 1.4.2  | V2 2.0.0-alpha.1 | V2 result                                     |
| -------------------------------- | --------- | ---------------- | --------------------------------------------- |
| Installer                        | 103.0 MiB | 10.6 MiB         | 89.7% smaller                                 |
| Installed files                  | 383.0 MiB | 24.5 MiB         | 93.6% smaller                                 |
| Median installation              | 5,307 ms  | 1,250 ms         | 4.25x faster                                  |
| Median startup to window         | 280 ms    | 21 ms            | 13.33x faster                                 |
| Private working set at 15 s      | 117.7 MiB | 122.1 MiB        | 3.7% higher                                   |
| Private commit at 15 s           | 242.7 MiB | 239.5 MiB        | 1.3% lower                                    |
| Summed working set, 5-run median | 369.1 MiB | 443.3 MiB        | 20.1% higher; shared pages counted repeatedly |
| Process count                    | 4         | 7                | 3 more WebView2-related processes             |
| Median uninstall                 | 2,885 ms  | 892 ms           | 3.23x faster                                  |

The startup measurement stops when Windows exposes the main window handle; it
does not claim that all page content has rendered. V2 uses the operating
system's shared WebView2 runtime, so that runtime is excluded from installed
bytes but its child processes are included in memory. A follow-up per-process
sample after 15 seconds found 117.7 MiB of private resident memory for V1 and
122.1 MiB for V2, making actual idle RAM approximately equal. The much larger
summed-working-set difference is diagnostic only: shared Edge DLL and code pages
are counted once for every process mapping them. Raw five-run samples and
machine details are in `benchmarks/windows-2026-08-28.json`.

V1 installer SHA-256:
`6127899A78090331D7BA1120B0E8956471750EDC588A68317878A19C917166AD`.

V2 installer SHA-256:
`F7DF6702155F5D85FDF3652BB69B4AB58D545E452B29FD0016BC36B065C5562D`.

The final package-build samples were 53.7 seconds for V1 and 95.0 seconds for
V2. These are not decision-grade: V1 downloaded its Electron runtime, while V2
performed an incremental native compilation.

## Device and feature results

| Area                  | V1                                 | V2 preview                                       | Status                                     |
| --------------------- | ---------------------------------- | ------------------------------------------------ | ------------------------------------------ |
| Vega identity         | CATS Vega 3.1.0, telemetry 1.2.0   | Same connected device and versions               | Matched                                    |
| Profile snapshot      | 333.7 ms median                    | 217.8 ms median                                  | V2 34.7% faster across five read-only runs |
| Configuration/profile | 29 profile fields validated        | Profile round-trip passed                        | Matched on connected Vega                  |
| Preflight             | Existing production workflow       | READY, 6/6 checks                                | Matched on connected Vega                  |
| Flight log            | Existing production workflow       | Mounted `fl016.cfl` parsed and plotted           | Matched on connected Vega                  |
| Repeated connection   | Five profile reads before handover | 50/50 self-cycles; 5/5 V1-to-V2 handovers        | V2 passed after two port-release fixes     |
| Simulator             | Unsupported by connected firmware  | Immediate, explicit unsupported-firmware error   | Requires a CATS development firmware build |
| Browser handoff       | Production implementation          | Native local handoff implemented and unit tested | Live V2 transfer still open                |

The connected production Vega returned `UNKNOWN COMMAND, TRY 'HELP'` for
`sim`. The firmware source confirms that command is compiled only when
`CATS_DEV` is enabled. V2 previously hid this response behind its five-minute
simulation timeout; it now finishes immediately and explains that development
firmware is required. The packaged GUI behavior was verified on COM4. A
transient zero-byte Windows serial read also caused the first connection after
switching clients to appear disconnected; V2 now waits within the existing
command deadline, and five deliberate V1-to-V2 handovers passed. Raw device
samples are in
`benchmarks/vega-2026-08-28.json`.

## Measurements still required

- Steady-state total process-tree memory while disconnected and connected
- Real `.cfl` parse and first-plot latency
- One complete simulator run in each application using development firmware
- Live browser handoff, export, and configuration-write checks with designated
  non-production test data
- Equivalent macOS and Linux package and device checks

Record the environment, exact commit, artifact hashes, and raw samples when
these measurements are taken. The final decision should also consider UI
behavior, recovery from unplug/replug, and maintainability rather than package
size alone.
