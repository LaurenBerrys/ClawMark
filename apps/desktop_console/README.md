# desktop_console

Flutter Desktop entrypoint for the ClawMark Desktop Console on macOS and Windows.

## Local developer loop

- `pnpm desktop:pub:get`
- `pnpm desktop:analyze`
- `pnpm desktop:run:macos`
- `pnpm desktop:build:macos`

`pnpm desktop:build:macos` builds the Flutter desktop app. By default the
resulting app is now bootstrap-first: it starts the
native host, checks the local `ClawMarkCore` slot, and downloads/releases core
payloads from GitHub Releases when needed.

If you want a development build with an embedded fallback runtime payload, use:

```bash
CLAWMARK_DESKTOP_BUNDLE_CORE=1 pnpm desktop:build:macos
```

## ClawMarkCore packaging

- `pnpm desktop:core:package:macos`
- `pnpm desktop:core:package:windows`

These scripts package the runtime payload for GitHub Releases as:

- `ClawMarkCore-macos-<arch>-<version>.tar.gz`
- `ClawMarkCore-windows-<arch>-<version>.zip`

Each run also emits a per-asset manifest file in `dist/` that can be merged
into the final `clawmark-core-manifest.json` release asset.

## macOS packaging

- `pnpm desktop:package:macos`

This packaging flow:

- builds the runtime payload unless `SKIP_JS_BUILD=1`
- builds the Flutter release app unless `SKIP_FLUTTER_BUILD=1`
- copies the release app into `dist/ClawMarkDesktopConsole.app`
- creates `dist/ClawMarkDesktopConsole-<version>-macos.zip`
- optionally creates a DMG unless `SKIP_DMG=1`
- optionally signs the app if `SIGN_IDENTITY` is set or `ALLOW_ADHOC_SIGNING=1`
- optionally notarizes when `NOTARYTOOL_PROFILE` is available and `SKIP_NOTARIZE=0`
- keeps the package bootstrap-first by default; set `BUNDLE_DESKTOP_CORE=1` only when
  you explicitly want a fallback runtime payload embedded in the app bundle

Common local fast path:

```bash
SKIP_JS_BUILD=1 SKIP_FLUTTER_BUILD=1 SKIP_DMG=1 pnpm desktop:package:macos
```

## Windows packaging

- `pnpm desktop:build:windows`
- `pnpm desktop:package:windows`

The Windows packaging flow is implemented in
`scripts/package-desktop-console-windows.ps1`. It builds the runtime payload,
builds the Flutter Windows release bundle, copies the release directory into
`dist/ClawMarkDesktopConsole-win-x64`, and creates a zip archive. If
`WINDOWS_SIGNTOOL_CERT_PATH` is set, it will also try to sign
`desktop_console.exe` with `signtool.exe`. Like the macOS packager, it is
bootstrap-first unless `BUNDLE_DESKTOP_CORE=1` is set.

The script is staged in-repo, but Windows packaging still needs real
Windows-host verification.
