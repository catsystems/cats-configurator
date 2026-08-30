# Code signing policy

Official CATS Configurator releases are built from the public source code and
build configuration in this repository under the
[GNU General Public License v3](LICENSE). Free code signing provided by
[SignPath.io](https://signpath.io/), certificate by
[SignPath Foundation](https://signpath.org/).

## Signed releases

The current Tauri 2.0 alpha builds are not production-signed. Windows packages
are unsigned, macOS CI packages use ad-hoc signing without notarization, and
automatic updates are disabled. The official signing process below must be
validated for the new packages before a production release.

- Signing is limited to official CATS Configurator release artifacts produced
  by the repository's GitHub Actions workflow from a version tag.
- SignPath signing under this policy applies to the official Windows NSIS
  installer. The macOS and Linux packages use their platform-specific release
  processes and are not signed by the SignPath Foundation certificate.
- Every signing request requires manual approval by a designated approver.
- The signed Windows installer is published through the repository's
  [GitHub Releases](https://github.com/catsystems/cats-configurator/releases).
- Signatures do not apply to forks, local builds, or binaries redistributed by
  third parties.

## Team roles

- Authors and committers:
  [Nemanja Stojoski (@stojadin2701)](https://github.com/stojadin2701),
  [Luca Jost (@l-jost)](https://github.com/l-jost), and
  [Jonas Binz (@jbinz)](https://github.com/jbinz)
- Reviewers:
  [Nemanja Stojoski (@stojadin2701)](https://github.com/stojadin2701),
  [Luca Jost (@l-jost)](https://github.com/l-jost), and
  [Jonas Binz (@jbinz)](https://github.com/jbinz)
- Signing approvers:
  [Nemanja Stojoski (@stojadin2701)](https://github.com/stojadin2701),
  [Luca Jost (@l-jost)](https://github.com/l-jost), and
  [Jonas Binz (@jbinz)](https://github.com/jbinz)
- Contributions from people who do not have commit access are reviewed before
  they are merged.
- Additional people will be listed here before they receive a signing role.
- Everyone with repository write access or a SignPath signing role must enable
  multi-factor authentication for both GitHub and SignPath.

## Privacy policy

CATS Configurator does not include analytics, advertising, user tracking, or
crash-reporting services. Device configuration, application settings, and
flight-log processing are performed locally unless the user explicitly opens
an external service.

The Tauri alpha does not check for or download updates automatically. Users
install new versions manually. Serial diagnostics are written to a local
`vega-communication.log` in the operating system's per-user application log
directory; the application does not upload this transcript.

External documentation, release pages, and CATS Flights are opened only after
a user action. Choosing to analyze a flight log with CATS Flights opens
`https://flights.catsystems.io` in the user's browser and makes the selected
log available to that browser through a temporary loopback-only connection.

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
