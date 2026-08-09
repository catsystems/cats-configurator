# Changelog

All notable changes to this project will be documented in this file.

This project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.2.1] - 09-08-2026

- Detect a uniquely connected CATS Vega by its USB identity and connect to it
  automatically at startup or after hot-plugging.
- Keep multiple, unrecognized, and manually disconnected devices under explicit
  user control, with timeout and protocol validation for connection attempts.

## [1.2.0] - 09-08-2026

- Add an always-available Flight Logs workspace for local `.cfl` files while
  keeping Configuration as the default screen after connecting a board.
- Discover and browse flight logs on the Vega's read-only mounted CATS drive.
- Open local and onboard logs privately in CATS Flights through a single-use
  loopback handoff with a manual save fallback.
- Point every Configurator build and development session exclusively at the
  production CATS Flights website.

## [1.1.1] - 09-08-2026

- Align application typography and branding with the CATS websites using
  locally bundled Inter and Space Grotesk variable fonts.
- Add a direct Flights link to the navigation panel.
- Refine connected-screen spacing and enabled timer styling.

## [1.1.0] - 08-08-2026

- Move the desktop runtime to Node.js 24 and Electron 43.
- Replace Vue CLI and the legacy Electron builder plugin with electron-vite,
  Vite, and direct electron-builder packaging.
- Upgrade the renderer to Vue 3, Vue Router 5, Pinia 4, and Vuetify 4.
- Upgrade serialport and Plotly, make Plotly lazy-loaded, and make exported plot
  HTML fully offline.
- Replace generic renderer IPC access with a validated domain-specific bridge
  and strengthen Electron navigation, sandbox, and content security policies.
- Add non-mutating lint, unit/component tests, Electron smoke tests, security
  gates, reproducible CI, and automated dependency updates.

## [0.3.10] - 03-07-2025

- Add interactive flight-log plots and export-folder selection.
- Add metric/imperial display support across configuration and plots.
- Add application notifications and clearer export feedback.
- Display the application version and improve configuration safety checks.
- Update CI actions and add a pinned local Node version.

## [0.3.3] - 24-07-2023

- Save GNSS logs to CSV
- Reorder and add titles to plots
- Fix IMU acceleration scaling

## [0.3.2] - 10-06-2023

- Removed altitude liftoff detection from general settings
- Added new github action for automatic changelog
