# Code signing policy

Official CATS Configurator releases are built from the public source code and
build configuration in this repository under the
[GNU General Public License v3](LICENSE). Free code signing provided by
[SignPath.io](https://signpath.io/), certificate by
[SignPath Foundation](https://signpath.org/).

## Signed releases

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

Packaged versions automatically query the GitHub Releases API shortly after
startup and every six hours to check for updates. When a newer stable release
is available, the application downloads the matching release artifact from
GitHub into its local update cache, verifies its size and GitHub-provided
SHA-256 digest, and asks the user before installation. The application never
executes a downloaded installer automatically. These requests are governed by
the [GitHub General Privacy Statement](https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement).

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

To uninstall:

- Windows: open **Settings > Apps > Installed apps**, select **CATS
  Configurator**, and choose **Uninstall**.
- macOS: quit CATS Configurator and move it from **Applications** to the Trash.
- Linux AppImage: quit CATS Configurator and delete the AppImage file and any
  launcher entry created by the user.

Application settings and downloaded-update files are stored in the operating
system's per-user application-data directory. Users may remove that directory
separately if they also want to delete their local settings and update cache.
