# ClawMark Desktop

Flutter Desktop entrypoint for the ClawMark app on macOS and Windows.

## Local developer loop

- `pnpm desktop:pub:get`
- `pnpm desktop:analyze`
- `pnpm desktop:dev:macos`
- `pnpm desktop:run:macos`
- `pnpm desktop:build:macos`

For day-to-day UI iteration on macOS, use `pnpm desktop:dev:macos`. This is the
normal live developer loop. It runs `flutter run -d macos`, opens the app
directly, and supports the standard Flutter terminal controls:

- `r`: hot reload
- `R`: hot restart
- `q`: quit

You do not need to package or install the app for every UI change.

`pnpm desktop:build:macos` builds the Flutter desktop app without packaging it.
By default the resulting app is bootstrap-first: it starts the native host,
checks the local `ClawMarkCore` slot, and downloads/releases core payloads from
GitHub Releases when needed.

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

Use this only for distribution verification. It is not the recommended inner
loop for desktop UI development.

This packaging flow:

- builds the runtime payload unless `SKIP_JS_BUILD=1`
- builds the Flutter release app unless `SKIP_FLUTTER_BUILD=1`
- copies the release app into `dist/ClawMark.app`
- creates `dist/ClawMark-<version>-macos.zip`
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
`dist/ClawMark-win-x64`, and creates a zip archive. If
`WINDOWS_SIGNTOOL_CERT_PATH` is set, it will also try to sign
`ClawMark.exe` with `signtool.exe`. Like the macOS packager, it is
bootstrap-first unless `BUNDLE_DESKTOP_CORE=1` is set.

The script is staged in-repo, but Windows packaging still needs real
Windows-host verification.
