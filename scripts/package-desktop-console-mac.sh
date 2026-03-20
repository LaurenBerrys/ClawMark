#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SOURCE_APP="$ROOT_DIR/apps/desktop_console/build/macos/Build/Products/Release/desktop_console.app"
DIST_ROOT="$ROOT_DIR/dist"
APP_LABEL="${APP_LABEL:-ClawMarkDesktopConsole}"
APP_BUNDLE="$DIST_ROOT/${APP_LABEL}.app"
SKIP_JS_BUILD="${SKIP_JS_BUILD:-0}"
SKIP_FLUTTER_BUILD="${SKIP_FLUTTER_BUILD:-0}"
SKIP_DMG="${SKIP_DMG:-0}"
SKIP_NOTARIZE="${SKIP_NOTARIZE:-1}"
BUNDLE_DESKTOP_CORE="${BUNDLE_DESKTOP_CORE:-0}"
SHOULD_SIGN=0

if [[ -n "${SIGN_IDENTITY:-}" || "${ALLOW_ADHOC_SIGNING:-0}" == "1" ]]; then
  SHOULD_SIGN=1
fi

echo "📦 Packaging Desktop Console for macOS"
mkdir -p "$DIST_ROOT"

if [[ "$SKIP_JS_BUILD" != "1" ]]; then
  echo "🧱 Building runtime TypeScript payload"
  (cd "$ROOT_DIR" && pnpm build)
else
  echo "🧱 Skipping runtime TypeScript build (SKIP_JS_BUILD=1)"
fi

if [[ "$SKIP_FLUTTER_BUILD" != "1" ]]; then
  echo "🖥  Building Flutter desktop release bundle"
  (cd "$ROOT_DIR" && node --import tsx scripts/run-desktop-console.ts build macos)
else
  echo "🖥  Skipping Flutter build (SKIP_FLUTTER_BUILD=1)"
fi

if [[ "$BUNDLE_DESKTOP_CORE" == "1" ]]; then
  echo "🧩 Staging bundled DesktopRuntime payload"
  (cd "$ROOT_DIR" && CLAWMARK_DESKTOP_BUNDLE_CORE=1 node --import tsx scripts/run-desktop-console.ts stage macos)
else
  echo "🧩 Packaging bootstrap-only desktop app (set BUNDLE_DESKTOP_CORE=1 to embed a fallback core payload)"
fi

if [[ ! -d "$SOURCE_APP" ]]; then
  echo "ERROR: Desktop Console app bundle not found at $SOURCE_APP" >&2
  exit 1
fi

echo "🚚 Copying app bundle to dist"
rm -rf "$APP_BUNDLE"
cp -R "$SOURCE_APP" "$APP_BUNDLE"
if [[ "$BUNDLE_DESKTOP_CORE" != "1" ]]; then
  rm -rf "$APP_BUNDLE/Contents/Resources/DesktopRuntime"
fi

if [[ "$SHOULD_SIGN" == "1" ]]; then
  echo "🔏 Signing Desktop Console bundle"
  "$ROOT_DIR/scripts/codesign-mac-app.sh" "$APP_BUNDLE"
else
  echo "🔏 Skipping codesign (set SIGN_IDENTITY or ALLOW_ADHOC_SIGNING=1 to enable)"
fi

VERSION=$(/usr/libexec/PlistBuddy -c "Print CFBundleShortVersionString" "$APP_BUNDLE/Contents/Info.plist" 2>/dev/null || echo "0.0.0")
ZIP_PATH="$DIST_ROOT/${APP_LABEL}-${VERSION}-macos.zip"
DMG_PATH="$DIST_ROOT/${APP_LABEL}-${VERSION}-macos.dmg"
NOTARY_ZIP="$DIST_ROOT/${APP_LABEL}-${VERSION}-macos.notary.zip"

echo "🗜  Creating zip archive: $ZIP_PATH"
rm -f "$ZIP_PATH"
ditto -c -k --sequesterRsrc --keepParent "$APP_BUNDLE" "$ZIP_PATH"

if [[ "$SKIP_DMG" != "1" ]]; then
  echo "💿 Creating DMG: $DMG_PATH"
  "$ROOT_DIR/scripts/create-dmg.sh" "$APP_BUNDLE" "$DMG_PATH"
else
  echo "💿 Skipping DMG (SKIP_DMG=1)"
fi

if [[ "$SKIP_NOTARIZE" != "1" && -n "${NOTARYTOOL_PROFILE:-}" ]]; then
  echo "🧾 Creating notarization zip: $NOTARY_ZIP"
  rm -f "$NOTARY_ZIP"
  ditto -c -k --sequesterRsrc --keepParent "$APP_BUNDLE" "$NOTARY_ZIP"
  STAPLE_APP_PATH="$APP_BUNDLE" "$ROOT_DIR/scripts/notarize-mac-artifact.sh" "$NOTARY_ZIP"
  rm -f "$NOTARY_ZIP"
  if [[ "$SKIP_DMG" != "1" ]]; then
    if [[ -n "${SIGN_IDENTITY:-}" ]]; then
      echo "🔏 Signing DMG"
      /usr/bin/codesign --force --sign "$SIGN_IDENTITY" --timestamp "$DMG_PATH"
    fi
    "$ROOT_DIR/scripts/notarize-mac-artifact.sh" "$DMG_PATH"
  fi
else
  echo "🧾 Skipping notarization (SKIP_NOTARIZE=1 or NOTARYTOOL_PROFILE missing)"
fi

echo
echo "Desktop Console packaging complete:"
echo "  App: $APP_BUNDLE"
echo "  Zip: $ZIP_PATH"
if [[ "$SKIP_DMG" != "1" ]]; then
  echo "  DMG: $DMG_PATH"
fi
