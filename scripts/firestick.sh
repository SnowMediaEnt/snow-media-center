#!/usr/bin/env bash
# Build SMC and install it on a Fire TV / Android TV box in one go (run on the Mac).
#
#   scripts/firestick.sh 192.168.1.50          # MPV test build (owner)
#   scripts/firestick.sh 192.168.1.50 --no-mpv # customer build, no MPV
#
# The box needs ADB debugging on: Settings → My Fire TV → Developer options →
# ADB debugging. Its IP is under Settings → My Fire TV → About → Network.
# The first time, the TV asks "Allow USB debugging?" — choose Always allow.
set -euo pipefail

IP="${1:-${FIRESTICK_IP:-}}"
MPV="-PSMC_WITH_MPV=true"
[ "${2:-}" = "--no-mpv" ] && MPV=""
if [ -z "$IP" ]; then
  echo "Usage: scripts/firestick.sh <box IP> [--no-mpv]"; exit 1
fi

SDK="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
ADB="$SDK/platform-tools/adb"
[ -x "$ADB" ] || ADB="$(command -v adb || true)"
[ -n "$ADB" ] || { echo "adb not found (install Android SDK platform-tools)"; exit 1; }

cd "$(dirname "$0")/.."
git checkout main
git pull origin main
rm -rf dist node_modules android/app/build android/app/src/main/assets/public
npm install
npm run build
npx cap sync android
(cd android && ./gradlew clean assembleRelease $MPV)

APK=android/app/build/outputs/apk/release/app-release.apk
AAPT="$(ls -d "$SDK"/build-tools/*/aapt | tail -1)"
VER="$("$AAPT" dump badging "$APK" | grep -o "versionCode='[0-9]*' versionName='[^']*'")"
echo "Built: $VER"
CODE="$(echo "$VER" | grep -o "versionCode='[0-9]*'" | grep -o "[0-9]*")"
SUFFIX=""; [ -n "$MPV" ] && SUFFIX="_mpv"
NAME="$(echo "$VER" | grep -o "versionName='[^']*'" | cut -d"'" -f2)"
cp "$APK" "$HOME/Downloads/snow_media_center_${NAME}_build${CODE}${SUFFIX}.apk"

echo "Connecting to $IP…"
"$ADB" connect "$IP:5555"
"$ADB" -s "$IP:5555" wait-for-device
"$ADB" -s "$IP:5555" install -r "$APK"
"$ADB" -s "$IP:5555" shell monkey -p app.lovable.f44324110df840aea0a1fb97cafa76e7 -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1 || true
echo "Installed build $CODE on $IP."
