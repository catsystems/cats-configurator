<h1 align="center">CATS Configurator</h1>

<p align="center">
  <img src="https://github.com/catsystems/cats-docs/blob/main/logo/PNG/logo_with_smile.png" alt="CATS logo" width="200" height="200">
</p>

<p align="center">🐈 <em>Always land on your paws!</em> 🐈‍⬛</p>

CATS Configurator is the cross-platform desktop utility for configuring CATS
flight computers and inspecting `.cfl` flight logs. It uses a Vue/Vuetify
renderer and a Rust/Tauri host for serial communication, configuration,
profiles, preflight, local files, and CATS Flights handoff.

The Tauri implementation now lives at the repository root and replaces the
Electron implementation on this branch. The version remains
`2.0.0-alpha.1`; automatic updates are disabled. Windows alpha packages are
unsigned, and macOS alpha packages are ad-hoc signed but not notarized.
Upgrading an existing Electron installation has not yet been validated.

## Requirements

- Node.js 24.15 or newer (within Node.js 24 LTS) and npm 11 or newer
- Current stable Rust with Cargo
- Windows: the Microsoft C++ build tools and WebView2
- macOS: Xcode command-line tools (the app uses WKWebView)
- Linux: WebKitGTK 4.1 and the native build dependencies below
- A supported CATS device for hardware validation

On Debian or Ubuntu:

```sh
sudo apt-get install libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev libudev-dev patchelf xdg-utils
```

Linux users also need permission to access the Vega serial device. On Debian
and Ubuntu this normally means membership in the `dialout` group.

## Development

Run all commands from the repository root:

```sh
npm ci
npm start
```

npm installs the renderer dependencies and invokes the Tauri CLI. Cargo builds
the native backend and shell. `npm run dev` runs only the Vite server; use
`npm start` to launch the working desktop app with its native host.

## Verification

```sh
npm run lint
npm run format:check
npm test
npm run verify:release-contract
npm run build:frontend
npm run verify:production-target
cargo fmt --manifest-path src-tauri/Cargo.toml --all -- --check
cargo clippy --manifest-path src-tauri/Cargo.toml --locked --all-targets -- -D warnings
npm run test:rust
```

Renderer/component tests and native Rust tests are complementary: the renderer
suite tests the UI and Tauri bridge, while Rust tests exercise the serial,
profile, preflight, flight-log, and handoff code.

The ignored hardware checks are read-only. Close or disconnect other serial
clients first, then explicitly select the connected Vega and an existing log:

```powershell
$env:CATS_VEGA_PORT = "COM4"
$env:CATS_VEGA_LOG_PATH = "E:\fl016.cfl"
npm run test:hardware
```

These checks include 50 connect/disconnect cycles. They do not reset the board,
save configuration, delete onboard logs, or run a simulation. The separate
simulation check requires development firmware; production firmware may report
the command unavailable.

## Packaging and CI

```sh
npm run build
```

Packages are written under `src-tauri/target/**/release/bundle/`:

- Windows x64: NSIS installer
- macOS: Intel and Apple Silicon application bundles and DMGs
- Linux x64: AppImage and Debian package

CI installs from `package-lock.json`, checks both codebases, and builds all
four platform/architecture targets. Version tags publish the native artifacts;
tags containing a prerelease suffix create GitHub prereleases. Pushing a branch
does not publish a release. Native macOS/Linux device acceptance is still
required.

See the [migration parity record](docs/tauri-migration/PARITY.md), the
[historical comparison](docs/tauri-migration/COMPARISON.md), and the
[code signing policy](CODE_SIGNING_POLICY.md).

## Open source

CATS Configurator is licensed under the
[GNU General Public License v3](LICENSE) and can be used free of charge without
warranty.
