# Vega bench testing

Use one identified Vega and its USB volume. Use the Windows COM port, Linux serial device, or macOS `/dev/cu.*` path shown for the Vega. Close Configurator or disconnect it and close competing serial clients before running the serial harness. If the app reconnects automatically, close it for the harness and reopen it afterwards.

```text
node skills/cats-configurator-test/scripts/check.mjs vega --port PORT --log EXISTING_LOG.cfl
```

The harness checks status, 50 connect/disconnect cycles, and profile and preflight reads. With a log path it also parses that file. The profile and preflight probe uses a transient read of the test configuration. No profile export or backup is required. Simulation is separate and requires development firmware and a run that calls for simulation.

Use the [desktop test build](desktop.md#native-webdriverio-suite) with the identified port and log.

```sh
npm run test:desktop -- vega --port PORT --log EXISTING_LOG.cfl
```

This limits auto-connection to the selected serial path, opens configuration, events, profiles and preflight, and requests status in the CLI. It then tests the onboard log row and disconnects. It verifies the Flights handoff against the selected file's bytes over loopback. Append `--live-flights` to verify the published analyzer in an isolated Chrome session instead. Select a disposable log for the live check. The test grants CATS Flights loopback access in that disposable session. Use the manual browser path below to inspect a permission prompt or test the operating system's default browser. On Linux, resolve serial access through the device rule if the port is denied. [Linux device setup](../../../FIRMWARE-UPDATES.md#linux-and-macos-integration)

With one Vega and one Ground Station attached, append `--with-gs` to expose both devices to the picker test. Verify Vega is listed by default and the Ground Station stays out of the picker when **Show other serial ports** is enabled. Run `npm run test:desktop -- gs` with the same devices attached to verify discovery in Firmware Updates.

For a requested physical Vega update, confirm the app's bench safety conditions and append `--install-version VERSION` to install the matching official release. The test checks the selected serial device, uses the Firmware Updates confirmation, and verifies the running version over serial after Vega restarts. Without that option, the test backs out of the confirmation.

With Configurator running again, use the real UI to verify auto-detection or manual connection, board and firmware information, and a successful disconnect/reconnect. Check these surfaces against the values reported by the test board.

| Surface           | What to verify                                                                                                                                                                                                                                                                                |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Configuration     | Device status and the configuration fields populate. Unit changes render the corresponding values and edits enable Save. On a requested write test, use a reversible non-deployment field such as the recording speed if exposed, reread the saved value, and return it to its initial value. |
| Events & Timers   | Event names, recorded actions, and timer parameters populate. Use refresh or discard to verify recovery from an unsaved edit.                                                                                                                                                                 |
| Profiles          | Export a test fixture only when exercising profile export. Open and compare it, and check change and compatibility summaries. Apply a chosen test profile when profile writes are in scope.                                                                                                   |
| Preflight and CLI | Run preflight and verify the check details and timeline reflect the test board's settings. A warning may be correct. Check CLI output and history with a read-only command such as `status`.                                                                                                  |
| Flight Logs       | Verify onboard discovery and refresh with an existing disposable log. Select the intended CATS drive when asked. Open the onboard log, check graphs and exports, and test the direct handoff below. Use delete only when requested on a designated disposable log.                            |
| Firmware Updates  | Check that the target and installed/available versions appear and that the confirmation requires the safety checkbox. If physical Vega installation is in scope, use the official asset flow and `FIRMWARE-UPDATES.md` on the target operating system.                                        |

## Direct CATS Flights handoff

1. For the Vega direct path, click **Open in Flights** on the onboard row of a disposable log. To exercise the separate current-log action, open a log locally and click **Open in Flights** in the current log view. Use the generated synthetic log for the current-log path with no board. Record the source filename and which action started the handoff.
2. Use the browser opened by the operating system on the same host as Configurator. Verify it goes to `https://catsystems.io/flights/analyze`, receives the selected log without a manual file selection, renders its plots, and Configurator reports receipt or closes its waiting dialog. The browser retrieves the file through a temporary loopback connection. Treat a browser tab opening by itself as incomplete.
3. If testing persistence to a Flights account is requested, use a test account and a disposable log and verify the saved result in that account. The handoff acceptance ends when the browser renders the log. Keep account credentials and the handoff URL fragment out of reports and screenshots.
4. To test recovery, cancel an unconsumed handoff and start a fresh one, or use **Save and open manually** to verify the fallback. Label that fallback separately. Do not consume the live one-time token with a diagnostic request ahead of the browser. Check browser local-network permission, same-host routing, and app/browser logs when the dialog waits or expires.
