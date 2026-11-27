# No-board desktop smoke test

Run `node skills/cats-configurator-test/scripts/check.mjs baseline`. This runs the renderer suite, native Rust suite, release contract, and production frontend build. The Rust handoff tests bind loopback and verify the expected browser origin, token checks, and one successful transfer. If a sandbox denies loopback binds, rerun with access to loopback before treating that as an app failure. Use `npm ci` to provision a fresh checkout.

## Native WebdriverIO suite

Run these commands from the repository root with Node 24 and the native Tauri build dependencies.

```sh
npm run build:desktop-test
npm run test:desktop
```

The build embeds the normal renderer and native host in a standalone debug executable under `src-tauri/target/desktop-test`. It uses a separate application profile and disables the app updater. WebdriverIO starts the app and its localhost driver for the session. The desktop CI workflow runs the same spec on Windows, Linux, and macOS. On Linux, use a resizable desktop session or run it on a separate virtual X11 display if a tiling compositor ignores window resize requests.

```sh
GDK_BACKEND=x11 GDK_SCALE=1 xvfb-run -a -s '-screen 0 1600x1000x24' npm run test:desktop
```

The no-board test profile hides serial ports, so the smoke suite can run with bench devices still plugged in. It verifies disconnected launch, narrow and wide layout, the offline Ground Station radio guide, and native parsing, plotting, and recovery with a synthetic CFL. On Linux it opens the USB setup dialog and checks the Terminal command before any administrator action. It delivers the file-drop event to the real app and checks the real handoff's loopback response byte for byte. Run `npm run test:desktop -- no-board --live-flights` to have Chrome render the synthetic log in the published analyzer. Actual OS drag and drop, native file dialogs, package installation, and physical device acceptance are covered by the corresponding procedures. Failure screenshots are written to `test-results/desktop` when the WebView is reachable.

## Package and manual checks

Launch the requested package on its native host. For a source run with the native host use `npm start`.

| Platform    | Package and host checks                                                                                                                                                                                                                                                                           |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Windows x64 | Use the NSIS installer or an explicitly requested portable test binary. Launch under the normal user account and check the WebView2-rendered window. Check normal and 125–200% scaling when reproducing a display issue.                                                                          |
| Linux x64   | Test the AppImage or Debian package the user wants to qualify. Apply the repository's AppImage Wayland patch when building locally. Record Wayland or X11, compositor, and display scale. If mounting the AppImage fails, try `--appimage-extract-and-run` and identify which launch path passed. |
| macOS       | Use the matching Apple Silicon or Intel DMG/app. Test native WKWebView. If Gatekeeper blocks an expected ad-hoc signed build, use the macOS per-app override for the trusted package. Record the architecture actually exercised.                                                                 |

With USB devices disconnected, verify these checks in the real window where desktop access is available.

1. Launch, verify the displayed app version and **Disconnected** status, then verify that connection-dependent actions are unavailable. Refresh the port list. Open Flight Logs and Firmware Updates from navigation. Check that the bundled Ground Station radio installation guide opens offline.
2. Resize the window from wide to a narrow tile and back. Check controls, text proportions, navigation access, and the footer at the actual OS scale. On builds with the compact drawer, exercise its open and close behavior and selection of a route.
3. Run `node skills/cats-configurator-test/scripts/check.mjs fixture` to get disposable valid and invalid CFL paths. Use **Choose flight log** with the valid file, then repeat by drag and drop. Confirm its name, graph rendering, and metric/imperial change. The synthetic data has three flight-info samples spanning 0 to 1 second and a peak altitude of 12 m. Check that CSV and standalone HTML exports open and agree with the graph. Check that **Save a copy** is byte-identical to the input.
4. With a valid session displayed, try the empty fixture by both picker and drag and drop. Expect a readable error. Flag any stale plots or export actions after the host has cleared the earlier session. Reload the valid fixture between attempts and verify recovery. If asked to test the browser integration with no Vega, follow the [Flights handoff procedure](vega.md#direct-cats-flights-handoff) using the synthetic fixture.
5. Try **Check devices & releases** with no hardware. Verify there are no compatible detected devices and no write action is enabled. Record whether the public release query succeeded, or the actual error. The Configurator version button checks app updates separately from device firmware. Avoid installing an app update unless it is part of the test.
