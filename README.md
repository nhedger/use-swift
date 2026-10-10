# use-swift

A cross-platform GitHub Action to setup the Swift toolchain.

Installs the **latest Swiftly** on macOS and Linux, then uses it to install your
selected Swift toolchain. Swiftly does not support Windows yet, so Windows runners
use the **official Swift installer** from Swift.org.

Swift is added to `PATH` for subsequent steps. On macOS, `TOOLCHAINS` is also set
so `xcrun` uses the selected toolchain.

## Usage

### Latest

By default, the action installs the latest Swift toolchain.

```yaml
- name: Setup Swift
  uses: nhedger/use-swift@v1
```

### Specific version

Set the `version` input to install a specific Swift toolchain version.

```yaml
- name: Setup Swift
  uses: nhedger/use-swift@v1
  with:
    version: "6.2"
```

### Snapshot

Set the `version` input to a snapshot identifier, such as `main-snapshot`.

```yaml
- name: Setup Swift
  uses: nhedger/use-swift@v1
  with:
    version: "main-snapshot"
```

Find available snapshots on [Swift.org](https://www.swift.org/install/macos/#development-snapshots).

You can also select a dated snapshot (`main-snapshot-2026-10-06`) or a release
branch snapshot (`6.4.x-snapshot`). Snapshot availability depends on the platform
and architecture.

### Cross-platform workflow

```yaml
jobs:
  build:
    strategy:
      matrix:
        os: [ubuntu-latest, macos-latest, windows-latest]
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v5
      - uses: nhedger/use-swift@v1
        with:
          version: "6.2"
      - run: swift build
      - run: swift test
```

## Inputs and outputs

| Input | Default | Description |
| --- | --- | --- |
| `version` | `latest` | Latest stable release, a minor release (`6.2`, selecting its latest patch), an exact release (`6.2.1`), or a Swiftly-style snapshot selector. |

| Output | Description |
| --- | --- |
| `version` | Installed compiler version, such as `6.2.1` or `6.5-dev`. |

The `version` input takes precedence over a repository's `.swift-version` file.
The action does not modify that file.

## Runners

- **macOS:** Intel and Apple Silicon. Requires Xcode or its Command Line Tools.
- **Linux:** x86_64 and ARM64, on distributions supported by Swiftly. Requires
  `tar`, GPG and CA certificates. Missing Swift system dependencies are installed
  using Swiftly's post-install script (root or passwordless `sudo` is required).
- **Windows:** x86_64 and ARM64, with Swift 5.10 or newer. Requires PowerShell 7,
  Visual Studio C++ build tools for the runner architecture, and a Windows SDK.
  The installer must be able to install its prerequisites without interactive
  elevation. Debugging older toolchains may additionally require Python 3.10.

GitHub-hosted runners provide the platform prerequisites. A selected Swift version
must have a download available for the runner's OS version and architecture.

## Development

Use Node.js 24 or newer and the pnpm version specified in `package.json`.

```sh
pnpm install
pnpm check
pnpm typecheck
pnpm test
pnpm build
```

Commit the generated `dist/index.mjs` when changing the action. GitHub Actions runs
this bundled entry point without installing npm dependencies. CI checks the bundle
and installs, compiles, and runs a Swift package on each supported platform.
