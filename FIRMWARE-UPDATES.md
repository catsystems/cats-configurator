# Device firmware updates

The Firmware Updates page uses Rust/Tauri commands and official stable GitHub
releases from `catsystems/cats-embedded`. It does not update Configurator itself.

## Release contract

Publish component assets as `flight_computer-<semver>.bin` and
`ground_station-<semver>.UF2`. The component version must match the code running
after installation. A release tag may identify an integration release instead;
it is not used as the component version. Drafts, prereleases, development asset
versions, legacy unversioned filenames, and custom/local files are not eligible.
`telemetry-<semver>.bin` is supported for preparing Ground Station radio updates.
Configurator validates and stages the image; both receivers are programmed by
the Ground Station after safe USB eject and confirmation on its screen.

Downloads use a bounded GitHub API scan, restricted HTTPS redirects, exact size,
available GitHub SHA-256 digest, and target-specific structural validation.
Without a GitHub digest, a locally recorded download hash protects retry within
the current app session; after restart such an asset is downloaded again.

## Device safety and recovery

Firmware downgrades are allowed through the normal update confirmation, including
installing the official stable release over a newer development version. The same
policy applies to Vega, Ground Station, and preparation of GS radio firmware.
Same-version reinstalls and unknown/unverified installed versions still require
their existing confirmations. Image validation and post-install verification
apply equally to upgrades and downgrades.

- Vega requires an accessible STM32 Bootloader WinUSB driver on Windows,
  an identified Vega reporting READY, no pending serial transaction, and
  user confirmation that deployment charges are disconnected. READY is not a
  guarantee of physical safety. STM32CubeProgrammer is not required or invoked.
  The existing ST WinUSB driver is compatible; a clean Windows installation may
  need a signed driver installed for `0483:DF11`. Do not replace the Vega serial
  or ST-LINK driver. The updater never silently installs or changes drivers.
- The native host owns the serial connection during an update. Ordinary commands,
  automatic connections, navigation, and normal application close/quit are blocked.
  Serial disconnects during a firmware operation update the connection state but
  do not also raise a generic serial-error notification. The firmware operation
  handles bootloader entry, reconnect deadlines, and failures through its own result;
  a disconnect alone never establishes update success. Normal serial operations
  still report unexpected connection errors.
  Cancellation ends at the bootloader-transition boundary. OS forced termination,
  power loss, or unplugging cannot be prevented by the app.
- Vega enters DFU through `bl`. The native Rust backend uses `nusb` and ST's
  [AN3156 DfuSe protocol](https://www.st.com/resource/en/application_note/an3156-how-to-use-usb-dfu-protocol-in-bootloader-on-stm32-mcus-stmicroelectronics.pdf).
  It selects the uniquely new DFU serial number, validates the STM32F411 memory
  map and read access at the image boundaries, erases only sectors occupied by the image,
  and writes at `0x08000000`. Full byte-for-byte USB readback must match before
  the separate application-start request. No mass erase, option-byte writes,
  protection changes, or USB reset commands are exposed. Failure leaves the
  device in DFU; retry revalidates the cache and selects the same DFU identity.
- Ground Station reads component versions from its mounted `version.json` and uses a USB runtime
  `DFU_DETACH` request to invoke the `0x11F2` TinyUF2 reset hint. The 1200-baud
  transition enters ESP32 ROM download mode and must not be used for UF2 updates.
  If runtime DFU is inaccessible (for example, its Windows interface has no
  compatible driver), enter Settings → Update Firmware → Ground Station on the
  device, then check devices again. More than one ambiguous application/recovery device is
  rejected. Only validated ESP32-S2 application UF2 files are copied as `NEW.UF2`.
  The bootloader and partition table are never updated by this feature.
- Copy/flush completion or drive disappearance alone is not success: the
  restarted device must expose the selected firmware version in a freshly read
  `version.json` after recovery disconnects and its application reconnects. A
  Windows device-disappeared error (433 or 1167) at final flush/sync, after the
  entire image was accepted by `write_all`, proceeds to that verification: TinyUF2
  may restart before Windows finishes finalizing the file. Partial writes and
  all other I/O errors remain failures, even if the drive disappeared.

Current Ground Station firmware generates `/version.json` containing
`ground_station`, `telemetry_1`, and `telemetry_2` before handing its FAT volume to
the PC. Configurator uses that file for discovery, pre-update version policy,
and post-restart verification. It requires one unambiguous application device and
one metadata volume; missing/malformed metadata remains unknown. No GS serial
console is opened, and neither the console banner nor old `version.txt` is used.
File metadata is device-reported information, not cryptographic attestation.
Missing, malformed, or failed metadata does not disable the device or its drive.
Configuration, calibration, and logs remain untouched.

### Ground Station radio preparation (2.0.0 testing installer)

Matched against fetched `cats-embedded origin/main` at `d03fa477971158c6ca9c62c811af4dad428daa32`.
On Firmware Updates, select the normal GS USB drive in **Ground Station radios**.
Discovery requires a mounted FAT removable volume and the three component fields
in `version.json`; these identify a candidate, not cryptographic device identity.
The user confirms the intended destination. The two radio versions are displayed
as unverified file metadata. Both are checked for reported same-version reinstalls,
and explicit unknown/unverified-version confirmation is required.

The native host downloads the official stable telemetry asset and checks its
size, available SHA-256 digest, and STM32G071 vectors (256 bytes–128 KiB, 36 KiB
RAM, application at `0x08000000`). It creates `telemetry_firmware` if needed,
writes and syncs a unique `.part`, reads it back, then renames it to the official
`.bin` name. An identical existing image is accepted; conflicting files are never
overwritten. The selected volume identity and metadata are checked again.
An interrupted `.part` is not selectable by the GS updater.

**Prepared is not installed.** Safely eject the drive in Windows, then use
**Settings → Update Firmware → Radio Receivers** on the GS. Select the prepared
file and confirm updating both radios. The embedded updater owns UART handoff,
ROM erase/write/readback, receiver restart and result reporting. Check **Both
radios verified** and both versions on the device, then power-cycle and reconnect
to refresh `version.json`. Configurator cannot start or verify that operation
through the current GS console protocol. Vega telemetry updating remains disabled.
Keep the GS powered and do not run another Configurator firmware operation during
its on-device radio update. Physical acceptance of these GS paths remains pending.

**Radio firmware installation guide** opens an offline illustrated guide from the
Ground Station radios card, even without a detected device or release. After preparation,
**Show installation guide** also appears beside the result. It covers safe eject,
Settings → System → Update Firmware → Radio Receivers, file selection, installation,
both-receiver verification, and refreshing the reported versions. The six bundled
400×240 screenshots in `src/assets/radio-update` were captured from the compiled
Ground Station WebAssembly simulator using the `radio-update.json` scenario flow
and its production Window renderer. Filenames, versions, sizes and CRC values in
these screenshots are illustrative simulator values, not release metadata.

Initial 2.0.0 build validation on Windows, 2026-09-06: 59 frontend tests and 52 Rust tests passed
(10 opt-in tests excluded), along with ESLint, Prettier, Rust formatting, Clippy
with warnings denied, release-contract checks, production frontend and NSIS
builds. A separate read-only live test downloaded and validated the official
Vega 3.0.2, GS 1.3.0 and telemetry 1.2.0 assets against their release SHA-256
digests. No hardware was flashed. The unsigned installer is
`src-tauri/target/release/bundle/nsis/CATS Configurator_2.0.0_x64-setup.exe`
(11,718,400 bytes; SHA-256
`10ee5093bdb6fb90580842f436b5656c7f24cd458eac6e7dd4923cff31f471a1`).
Both executable and installer metadata report 2.0.0. Local packaging used the
existing Node 24 runtime and local Vite/Tauri executables because npm was absent;
no dependencies or package manager were changed.

### Markdown and version.json follow-up

Release notes render Markdown headings, tables, lists, code and links through
`markdown-it`. Raw HTML and embedded images are disabled; link clicks use the
existing native HTTPS allowlist and external browser.

The previous GS preparation failure, Windows error 995, was reproduced on COM3
before any write. The console input purge cancelled the outstanding asynchronous
read. Ground Station discovery, preparation and post-restart verification now
use `version.json` instead of opening the console, as requested. Three consecutive
read-only checks on the connected GS returned 1.3.0 in 0.02 seconds total.
Post-update verification still requires recovery-drive disappearance, application
reconnection, and a newly read matching version file. No physical firmware update
was performed during this follow-up.

Validation: 63 frontend tests and 50 Rust tests passed (11 opt-in tests excluded),
plus ESLint, Prettier, Clippy with warnings denied, and release-contract checks.
The lower Rust count reflects removal of the superseded console-parser tests.
The rebuilt 2.0.0 NSIS installer (2026-09-06 15:21 local) is 11,863,821 bytes,
SHA-256 `02e33c9bc24b863578c1f391a01280fb76d4ce6cca1af8aa38e0c04aca731f2f`.
It replaces the initial installer at the same path above.

### TinyUF2 automatic-disconnect follow-up

The testing report showed Windows error 433 after a successful UF2 copy and the
expected brief USB-drive disappearance. The pinned TinyUF2 implementation calls
`board_dfu_complete()` once all UF2 blocks arrive (`src/msc.c` at
`8542b474ffa19c0dd66a8ccc99b1d6b8caff8d12`), which can race the host's final flush.
Configurator now proceeds to restart/version.json verification for Windows
errors 433 and 1167 at final flush/sync, only after `write_all` accepted the entire
image. This is not reported as installation success on its own. Partial-write
errors, unrelated flush/sync failures, and missing or mismatched post-restart
versions still fail. A verification retry checks only the connection.

Validation: 63 frontend tests and 53 Rust tests passed (11 opt-in tests excluded),
including partial-write disconnects, final-flush disconnects, and strict sync-error
classification. ESLint, Prettier, Rust formatting, Clippy with warnings denied,
release-contract and production-target checks passed. Hardware re-testing of this
change is still required; no device was flashed while implementing it.
Three read-only checks of the attached Ground Station's `version.json` each
returned 1.3.0. The rebuilt unsigned 2.0.0 NSIS installer (2026-09-06 15:30 local)
is 11,873,317 bytes, SHA-256
`02ac9bf07d06a6259a5b9efbd7219916349c26a782e08a793aa62373a737126a`.
It replaces the previous installer at the same path above.

## Validation and release readiness

Run the normal frontend tests, Rust tests, lint, and builds. The ignored
`official_releases_live` test checks the actual GitHub API without writing to a
device. `built_ground_station_uf2_is_compatible` validates a local build pointed
to by `CATS_TEST_GS_UF2`; it does not enable local-file updates in the application.

Windows is the initial flashing target. macOS and Linux expose discovery/release
checks but reject flashing until their flows have separate hardware acceptance.
Automated tests and builds do not qualify any physical update path.

### Linux and macOS integration

The native DFU backend is shared across Windows, Linux, and macOS. Linux uses
USB device permissions; macOS uses its native USB API and sets the ROM's USB
configuration when needed. Neither platform invokes CubeProgrammer. macOS
serial discovery uses `/dev/cu.*` only, avoiding duplicate `/dev/tty.*` candidates.

Ground Station destinations must be real, writable FAT USB mounts. Linux resolves
`/proc/self/mountinfo` entries to USB devices in sysfs; macOS checks `/Volumes`
entries using the fixed, read-only `diskutil info -plist` query. Stale directories,
read-only/internal disks, and non-FAT filesystems are not update destinations.
Recovery identification accepts the pinned TinyUF2 Saola WROOM/WROVER Board-IDs
(`ESP32S2-Saola1M-v1.2` and `ESP32S2-Saola1R-v1.2`), not arbitrary ESP32-S2 boards.
See the pinned [WROOM definition](https://github.com/adafruit/tinyuf2/blob/8542b474ffa19c0dd66a8ccc99b1d6b8caff8d12/ports/espressif/boards/espressif_saola_1_wroom/board.h)
and [WROVER definition](https://github.com/adafruit/tinyuf2/blob/8542b474ffa19c0dd66a8ccc99b1d6b8caff8d12/ports/espressif/boards/espressif_saola_1_wrover/board.h).
These bootloader identities are not cryptographic proof that a board is a GS;
recovery updates still require selecting the intended, unambiguous device.

The Linux Debian package installs `70-cats-devices.rules` under
`/usr/lib/udev/rules.d`. The AppImage includes the same rules as a resource, but
cannot install system permissions itself. For an AppImage/source installation,
an administrator can install the provided rules once:

```sh
sudo install -m 0644 src-tauri/resources/70-cats-devices.rules /etc/udev/rules.d/70-cats-devices.rules
sudo udevadm control --reload-rules
```

Reconnect the device afterwards. The rules grant the active local session access
to Vega/GS serial and STM32 DFU interfaces, with `dialout`/`plugdev` group fallbacks,
and tell ModemManager not to probe CATS serial endpoints. Ground Station volumes
must also be mounted writable by the logged-in user. Never run Configurator as
root. On macOS, allow the USB accessory if prompted and close other serial/DFU
tools; no additional STM32 driver is needed.

CI builds Windows, Linux, and Apple Silicon/Intel macOS packages. Both Mac targets
also receive backend checks. This checkout has additionally passed native Linux
tests in Ubuntu WSL, which does not establish physical USB compatibility. macOS
builds and physical Linux/macOS updates still need to run on their native hosts.
Production flashing remains disabled there until that hardware acceptance is
recorded; the UI and native host both enforce this restriction.

For the requested Mac bench test, pull-request CI builds Apple Silicon and Intel
DMGs with the explicit `firmware-hardware-test` Cargo feature. These installers
show a hardware-test warning and enable the native Mac update path while keeping
device identity, safety confirmation, image validation, version confirmations,
and verification requirements intact. Tag/main builds do not enable this feature.
The feature does not permit custom firmware or change the official asset contract.
CI checks each DMG, ad-hoc app signature, and executable architecture, then copies
the app from the mounted DMG and checks that it stays running after launch. The packages
are not notarized: move the app to Applications and use **Open Anyway** under
macOS **Privacy & Security** for this trusted test build if Gatekeeper blocks it;
do not disable Gatekeeper globally. See [Apple's instructions](https://support.apple.com/en-us/102445).
Choose the arm64 artifact for Apple Silicon
or x64 for Intel.

Before testing, disconnect Vega deployment charges, close other serial/DFU tools,
and keep a known recovery route available. Record the Mac model, macOS version,
USB connection/cable, starting and selected firmware versions, and the updater's
final result. A successful test requires the selected version from fresh Vega
serial reporting or the restarted GS `version.json`, plus a power-cycle and settings check. Do not interrupt
an active write for an initial acceptance test.

### Retry and cancellation audit

Validated firmware is retained in memory through the USB operation, so changing
a cache file after validation cannot change the image written. Retrying a failed
write revalidates its cached bytes. A GS retry preserves the checked `version.json`
version and confirmation from before entering recovery. It does not replace that
approval with metadata from an unrelated or ambiguous volume.

After a successful write, a failed reconnection/version check offers **Retry
connection check**. It does not download, erase, or rewrite another image. Missing
or delayed startup reporting is retried within bounded deadlines; a reported
version mismatch remains a failure. Accepted cancellation cannot be lost before
the background worker starts, and cancellation is rejected after the transition
boundary. Failed writes remain failures. Only Windows device-disappeared errors
at final flush/sync after the full UF2 write proceed to reconnect verification;
a failed verification offers a connection-only retry, never an automatic rewrite.
The serial request owns its pending-operation count until the request completes
or its worker stops. Cancelling the caller cannot leak the lock or permit a
firmware transition while that command is still running. SemVer build metadata
does not bypass same-version reinstall confirmation, and odd-length Vega
images are rejected before entering DFU.

The portability audit passed 57 frontend tests and 46 Rust tests on both Windows
and Ubuntu WSL (9 opt-in tests excluded on each), frontend lint/format checks,
Rust Clippy with warnings denied, and the frontend production build. No hardware
was flashed during this audit. The optimized Windows executable and the Linux
debug executable with the embedded frontend also built successfully (no installer
packaging was run locally). macOS-only USB and disk-discovery code still
requires native Mac build and hardware validation; parser tests on another OS
are not a substitute.

Before shipping, record hardware acceptance for Vega normal update, failed
programming/verification recovery, and Ground Station application/recovery starts.
Verify GS behavior immediately after installation and after a power cycle,
including USB eject/reconnect, display/buttons, recording ownership, and retained
settings/calibration/logs. The metadata-bearing GS firmware must be published as
an official versioned release asset before the normal end-to-end updater can
install it. No release publication is part of this implementation.

### Initial Windows Vega acceptance using CubeProgrammer, 2026-08-31

With explicit approval for the legacy filename and confirmation that deployment
charges were disconnected, the native updater installed the official v3.0.2
`flight_computer.bin` (234,776 bytes, SHA-256
`9edbaf02d7bc24ca85a0047e8ae0888b4b177693cbc05dcc0686d1b86cf5329a`).
The connected Vega changed from `3.0.2-trace` to `3.0.2`. Programming and
verification completed before starting the image, and fresh serial reporting
confirmed `3.0.2` and READY. The configuration snapshot was unchanged. A further
serial check after startup confirmed telemetry remained `1.1.3-trace`.

The first attempt stopped before writing because CubeProgrammer 2.23.0 labeled
its DFU selector `Device Index`, rather than `USB Port`. Correcting that parser
allowed a successful retry through the full preparation, download, validation,
DFU transition, program/verify, and reconnection path. This is historical evidence
for the initial implementation; the CLI backend and its parser have since been
replaced by native USB DFU.

The explicitly opted-in `acceptance_vega_official_legacy_302` test is ignored by
default and excluded from the ordinary read-only hardware test command. Its
filename exception is confined to test code; production release selection is
unchanged. Configuration snapshots, serial logs, and the result were saved under
`tmp/vega-firmware-acceptance-b17d0cb5-2e4d-49e2-b029-418a938f75d7` locally.
This confirms the normal Vega programming path; destructive failure injection,
native-window close/quit testing during a physical write, and Ground Station
hardware acceptance are still outstanding.

### Native USB DFU validation, 2026-08-31

The native backend opened Vega `306135573132` through the existing ST WinUSB
driver, accepted its 512 KiB flash map and 2048-byte transfer size, and read all
234,776 bytes of the installed official 3.0.2 image. Every byte matched the pinned
SHA-256-validated release asset above. It then issued the separate application
start request. Fresh serial reporting on COM4 confirmed firmware `3.0.2`, READY,
and unchanged telemetry `1.1.3-trace`. CubeProgrammer was not invoked and no flash
erase or write was performed in this test.

The initial read-only probe tried the factory flash-size register, which the ROM
rejected with `errTARGET`. The backend now uses the bootloader's validated flash
map and checks upload access at both image boundaries before erasing. The probe
then passed, including recovery from that DFU error state.

After explicit same-version reinstallation approval, the full native acceptance
test confirmed Vega `3.0.2`, telemetry `1.1.3-trace`, and a fresh READY status,
downloaded the pinned official asset, and sent `bl`. The serial connection closed,
but Windows could not enumerate the bootloader: it reported Code 43, "Device
Descriptor Request Failed," on the same physical USB port. The update timed out
before selecting a DFU target, so no erase or firmware write occurred. Evidence
is in `tmp/vega-firmware-acceptance-2fd29063-22d2-497e-b5bd-afefabab47e3`.
A restart of only that USB device was attempted after matching its location path
to Vega's application and DFU records; Windows denied it. A physical USB reconnect
restored the normal Vega application on COM4.

The approved retry then passed the complete native update path in 54.58 seconds:
official download and validation, fresh READY check, uniquely new DFU identity,
application-sector erase, programming, full byte-for-byte readback, verified-image
start, and fresh application-version confirmation. It reinstalled `3.0.2` without
invoking CubeProgrammer. Before/after configuration values matched exactly.
A separate serial check after startup confirmed `3.0.2`, READY, and unchanged
telemetry `1.1.3-trace`; telemetry reporting was initially unavailable immediately
after reconnection. Successful evidence, including that final check, is in
`tmp/vega-firmware-acceptance-892dfab1-acc4-48f4-85c8-686d6d3cc39c`.

The ignored `acceptance_vega_official_legacy_302` test requires explicit
legacy-asset, physical-safety, and same-version approval; the latter is represented
by `CATS_VEGA_REINSTALL_APPROVAL=1` after approval is actually given.
The readback-only probe is `acceptance_native_dfu_readback_only` and requires the
identified Vega already in DFU, its expected serial, and the pinned 3.0.2 asset.

The native-backend revision passed 56 frontend tests, 38 Rust tests (9 opt-in
tests excluded from the normal run), ESLint, Clippy with warnings denied, format
checks, the frontend production build, and the Windows Tauri release build.
Protocol tests cover occupied-sector erase, short final blocks, erase/write
errors, disconnection, read protection, incomplete status/readback, mismatches,
and retry from the DFU error state. The normal native Windows erase/write flow
has now passed hardware acceptance. Repeated update-cycle testing for the
observed USB enumeration failure, destructive failure injection, native-window
close/quit testing during a physical write, and Ground Station hardware acceptance
remain outstanding.
