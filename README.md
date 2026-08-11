# CATS Configurator

<img src="https://github.com/catsystems/cats-docs/blob/main/logo/PNG/logo_with_smile.png" alt="CATS Logo" width="300" height="300">

_Always land on your paws._

CATS Configurator is the cross-platform desktop utility for configuring CATS
flight computers and inspecting `.cfl` flight logs.

## Requirements

- Node.js 24.15 or newer (within Node.js 24 LTS)
- npm 11 or newer
- A supported CATS device for hardware validation

## Development

```bash
# Reproduce the locked dependency graph
npm ci

# Start Electron with the Vite development server
npm start

# Run non-mutating quality checks
npm run lint
npm run format:check
npm test

# Run the Electron bridge and navigation smoke test
npm run test:e2e

# Create the platform package(s)
npm run build
```

`npm run lint` never rewrites source files. Use `npm run lint:fix` or
`npm run format` only when an explicit rewrite is intended.

Electron DevTools open automatically in development. Renderer source maps are
enabled, so breakpoints can be placed directly in the Vue source from the
DevTools **Sources** panel.

## Release formats

- Windows x64: NSIS installer
- macOS: Intel and Apple Silicon DMGs
- Linux x64: AppImage

CI installs exclusively from `package-lock.json`, runs lint, formatting, tests,
and security gates, then packages each platform. Tags publish the four native
artifacts as one GitHub release.

## Open source

All CATS code is open source and can be used free of charge without warranty.
