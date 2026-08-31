# Device firmware updates

The Firmware Updates page uses Rust/Tauri commands and official stable GitHub
releases from `catsystems/cats-embedded`. It does not update Configurator itself.

## Release contract

Publish component assets as `flight_computer-<semver>.bin` and
`ground_station-<semver>.UF2`. The component version must match the code running
after installation. A release tag may identify an integration release instead;
it is not used as the component version. Drafts, prereleases, development asset
versions, legacy unversioned filenames, and custom/local files are not eligible.
`telemetry-<semver>.bin` is reserved but telemetry updating is disabled.

Downloads use a bounded GitHub API scan, restricted HTTPS redirects, exact size,
available GitHub SHA-256 digest, and target-specific structural validation.
Without a GitHub digest, a locally recorded download hash protects retry within
the current app session; after restart such an asset is downloaded again.

## Device safety and recovery

- Vega requires an accessible STM32 Bootloader WinUSB driver on Windows,
  an identified Vega reporting READY, no pending serial transaction, and
  user confirmation that deployment charges are disconnected. READY is not a
  guarantee of physical safety. STM32CubeProgrammer is not required or invoked.
  The existing ST WinUSB driver is compatible; a clean Windows installation may
  need a signed driver installed for `0483:DF11`. Do not replace the Vega serial
  or ST-LINK driver. The updater never silently installs or changes drivers.
- The native host owns the serial connection during an update. Ordinary commands,
  automatic connections, navigation, and normal application close/quit are blocked.
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
- Ground Station uses a dedicated 115200-baud console and the existing 1200-baud
  TinyUF2 transition. More than one ambiguous application/recovery device is
  rejected. Only validated ESP32-S2 application UF2 files are copied as `NEW.UF2`.
  The bootloader and partition table are never updated by this feature.
- Copy/flush completion or drive disappearance alone is not success: the running
  device must report the selected firmware version after reconnection. An I/O
  error during copy/flush remains a failure even if a drive disappeared.

Ground Station emits `CATS-FW target=ground-station version=<semver>` on console
activation and generates the same line in `/version.txt` before handing its FAT
volume to the PC. A file-derived version is unverified information. It cannot
authorize a downgrade or confirm an installation; live serial takes precedence.
Missing, malformed, or failed metadata does not disable the device or its drive.
Configuration, calibration, and logs remain untouched.

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
device identity, safety confirmation, image validation, downgrade protection,
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
final result. A successful test requires the selected version from fresh serial
reporting after writing, plus a power-cycle and settings check. Do not interrupt
an active write for an initial acceptance test.

### Retry and cancellation audit

Validated firmware is retained in memory through the USB operation, so changing
a cache file after validation cannot change the image written. Retrying a failed
write revalidates its cached bytes. A GS retry preserves the serial version and
confirmation from before entering recovery; file-derived metadata never grants
that approval.

After a successful write, a failed reconnection/version check offers **Retry
connection check**. It does not download, erase, or rewrite another image. Missing
or delayed startup reporting is retried within bounded deadlines; a reported
version mismatch remains a failure. Accepted cancellation cannot be lost before
the background worker starts, and cancellation is rejected after the transition
boundary. Failed writes, flushes, and final disk synchronization remain failures.
The serial request owns its pending-operation count until the request completes
or its worker stops. Cancelling the caller cannot leak the lock or permit a
firmware transition while that command is still running. SemVer build metadata
does not turn a same-version reinstall into a downgrade, and odd-length Vega
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
