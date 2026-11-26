# Ground Station bench testing

Read the current checkout's `FIRMWARE-UPDATES.md` for the eligible official assets and recovery steps. Use a single identified test Ground Station and keep its normal USB volume mounted. Run `node skills/cats-configurator-test/scripts/check.mjs gs` to exercise the native `version.json` discovery three times without a firmware write.

With the [desktop test build](desktop.md#native-webdriverio-suite), run `npm run test:desktop -- gs` for live discovery and release checks on Windows, Linux, or macOS. It opens the Ground Station application and radio confirmations and backs out before writing.

When the requested test includes a firmware write on the identified bench unit and the app's safety conditions are met, run `npm run test:desktop -- gs --install-version VERSION` to install and verify the matching offered GS version. Run `npm run test:desktop -- gs --prepare-radio-version VERSION` to stage the matching offered receiver image. Verify the device's post-install checks below, including the physical receiver installation after staging.

If the intended GS is already in TinyUF2 from its on-device recovery menu, append `--recovery` to the installation command and verify its recovery drive is mounted. The test checks the unique recovery target, the offered version, and fresh application and receiver metadata after restart.

In Configurator, go to **Firmware Updates → Check devices & releases**. Verify that the **Ground Station** card identifies the intended device and shows the installed GS version, and that **Ground Station radios** shows both receiver versions from the mounted device. Record the initial versions and any missing metadata. An unavailable or unknown version is a condition to report and investigate. Verify only the selected compatible official stable release is offered through the current updater. If the mode is discovery or dry run, inspect the confirmation and cancel.

## Ground Station application update

- Use the build for the target operating system. Check [OS-specific USB access and hardware validation](../../../FIRMWARE-UPDATES.md#linux-and-macos-integration) before testing.
- For end-to-end update acceptance, record the initial and selected component versions. Use the built-in **Update Ground Station** confirmation on the intended unit. Check the progression into recovery and the status during copying and restart. If runtime recovery is inaccessible, follow the GS screen's **Settings → Update Firmware → Ground Station** path, then recheck discovery. Use the documented recovery route for the installed firmware.
- Count success when the recovery drive has disappeared, the application has reconnected, and a fresh `version.json` reports the selected version. Rerun the `gs` probe with the normal volume mounted. Record completed stages and, if verification fails after the write, use **Retry connection check** where offered. A copy finishing or a drive disappearing is only intermediate evidence.
- After a requested physical update, check USB reconnect, the screen and buttons, and recording controls after restart and a power cycle. Check retention against the known test settings, calibration, and log presence without taking a backup. Ask for the physical observation if the device screen or controls are outside available tools.

## Ground Station radios

- Open the offline **Radio firmware installation guide**. Check compatibility for both reported receivers. Firmware 1.1.3 or earlier requires the one-time bootstrap described in the guide before the on-device receiver update can run. Record that as a blocker for installation when it is outside scope. For a requested preparation test, pick the normal GS USB volume on **Ground Station radios** and run **Prepare radio firmware**. Confirm the offered telemetry version and destination in the app. On success verify the staged image under `telemetry_firmware` and the **Show installation guide** action.
- A **Prepared** result establishes successful staging. To test installation, eject the drive cleanly and use **Settings → System → Update Firmware → Radio Receivers** on the physical GS, following the guide for the installed version. Verify **Both radios verified** and both receiver versions on its screen, then power-cycle and reconnect and verify both versions in the refreshed metadata. Keep a failed or blocked receiver result distinct from successful staging.
- The GS exposes its supported host workflows through **Firmware Updates** and the radio guide. Vega Configuration, Profiles, Preflight, and CLI are separate board workflows.
