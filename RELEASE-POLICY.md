# Release policy

Official CATS Configurator releases are built from the public source code and
build configuration in this repository under the
[GNU General Public License v3](LICENSE).

## Release packages

- Official packages are produced by the repository's GitHub Actions workflow
  from a version tag and published through
  [GitHub Releases](https://github.com/catsystems/cats-configurator/releases).
- Windows releases use an unsigned NSIS installer.
- macOS releases use ad-hoc application signing without notarization.
- Linux releases are provided as unsigned AppImage and Debian packages.
- Operating systems may display a security warning because the packages do not
  use commercial platform code-signing certificates.
- CATS Configurator does not check for or download application updates
  automatically. Users install new versions manually.
- Official release status and provenance do not apply to forks, local builds,
  or binaries redistributed by third parties.

## Team roles

- Authors and committers:
  [Nemanja Stojoski (@stojadin2701)](https://github.com/stojadin2701),
  [Luca Jost (@l-jost)](https://github.com/l-jost), and
  [Jonas Binz (@jbinz)](https://github.com/jbinz)
- Reviewers:
  [Nemanja Stojoski (@stojadin2701)](https://github.com/stojadin2701),
  [Luca Jost (@l-jost)](https://github.com/l-jost), and
  [Jonas Binz (@jbinz)](https://github.com/jbinz)
- Contributions from people who do not have commit access are reviewed before
  they are merged.
- Everyone with repository write or release access must enable multi-factor
  authentication for GitHub.

## Privacy policy

CATS Configurator does not include analytics, advertising, user tracking, or
crash-reporting services. Device configuration, application settings, and
flight-log processing are performed locally unless the user explicitly opens
an external service.

Serial diagnostics are written to a local `vega-communication.log` in the
operating system's per-user application log directory; the application does not
upload this transcript.

External documentation, release pages, and CATS Flights are opened only after
a user action. Choosing to analyze a flight log with CATS Flights opens
`https://catsystems.io/flights` in the user's browser and makes the selected log
available to that browser through a temporary loopback-only connection.

The application does not otherwise transfer user files, device configuration,
flight logs, or serial data to networked systems.

## Installation and system changes

The Windows NSIS installer installs CATS Configurator, registers it in the
Windows installed-apps list, and provides an uninstaller. It does not install
drivers or browser extensions and does not change security settings.
If WebView2 is missing, the installer downloads and installs Microsoft's
WebView2 runtime, which is required by the Windows application.

To uninstall:

- Windows: open **Settings > Apps > Installed apps**, select **CATS
  Configurator**, and choose **Uninstall**.
- macOS: quit CATS Configurator and move it from **Applications** to the Trash.
- Linux AppImage: quit CATS Configurator and delete the AppImage file and any
  launcher entry created by the user.
- Linux Debian package: remove `cats-configurator` using the system package
  manager.

Application data and logs are stored in the operating system's per-user
application-data and log directories. Users may remove those directories
separately if they also want to delete local data and serial diagnostics.
