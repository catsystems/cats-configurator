---
name: cats-configurator-test
description: Test CATS Configurator on Windows, Linux, or macOS with no board, a Vega, or a Ground Station. Use for desktop smoke tests, bench acceptance, firmware update checks, and the CATS Flights log handoff.
---

# CATS Configurator testing

Work from the `cats-configurator` checkout. Read its `AGENTS.md` and use Node 24, the npm lockfile, and the existing Rust tests. Use the package or source revision the user wants to qualify. Record the OS, architecture, and build or commit.

Run the requested mode. Infer it from the bench and user request when possible. If the needed device is absent, do the applicable no-board or mocked checks and report the live checks as blocked.

| Mode           | First automated check                                                                                  | Desktop and bench procedure                                        |
| -------------- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------ |
| No board       | `node skills/cats-configurator-test/scripts/check.mjs baseline`                                        | [No-board smoke test](references/desktop.md)                       |
| Vega           | `node skills/cats-configurator-test/scripts/check.mjs vega --port PORT` with optional `--log PATH.cfl` | [Vega and CATS Flights](references/vega.md)                        |
| Ground Station | `node skills/cats-configurator-test/scripts/check.mjs gs` with one GS and its volume mounted           | [Ground Station firmware and radios](references/ground-station.md) |

For a full matrix, use one source revision on native hosts for all three operating systems. CI package builds and mocked tests help triage failures. Record native launch, live desktop interaction, physical hardware, and the browser handoff based on what was actually observed. Use a native desktop control tool or a configured WebDriver session when available. With shell access alone, automate the probes and ask for only the remaining physical or native UI step.

With a native display, build the [test-only WebdriverIO app](references/desktop.md#native-webdriverio-suite) once per host, then run `npm run test:desktop` for the no-board suite, `npm run test:desktop -- vega --port PORT --log FILE.cfl` for Vega, or `npm run test:desktop -- gs` for Ground Station. The bench references cover the live browser check and the explicit options for applying selected firmware on test devices. Run unplugged package checks separately when the requested evidence is for the shipped installer.

Use the supplied safe-mode test devices. Skip backups for these devices. Keep external loads disconnected as required by the app's update flow. Use Configurator's normal UI and built-in confirmations for device writes within the requested test. For an unexplained physical failure, inspect the device state before retrying and follow the app's recovery path. Use a synthetic or designated disposable log for the Flights handoff. Saving that log to a Flights account is a separate check when requested.

Report each check as passed, failed, skipped, or blocked with the OS and mode, observed result, and supporting command output, screenshot, or log excerpt. Distinguish test-generated data from device data. Omit handoff tokens, credentials, and unnecessary identifiers from evidence. Include the exact remaining step when a person or another OS is needed.
