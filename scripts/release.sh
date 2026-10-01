#!/usr/bin/env bash
# SMC customer release, in two steps (run on the Mac). Nothing reaches the
# server until the owner has tried the exact same APK on the Firestick.
#
#   scripts/release.sh test      # build the customer APK (no MPV), install it on the Firestick
#   scripts/release.sh publish   # owner said it passes: upload THAT tested APK over FTP
#
# The Firestick is 192.168.50.36 unless FIRESTICK_IP says otherwise.
#
# publish makes two copies of the same APK:
#   snowmediacenter.apk              -> /apps on the server
#   snow_media_center.<version>.apk  -> /smc on the server
# then uploads /smc/update.json LAST, so a box is never told about a file
# that isn't there yet.
#
# FTP: the account's directory must be public_html (the web root, which
# holds both /apps and /smc). The password is asked for each
# time and never saved. Override the defaults with FTP_HOST / FTP_USER.
set -euo pipefail

STEP="${1:-}"
IP="${FIRESTICK_IP:-192.168.50.36}"
FTP_HOST="${FTP_HOST:-ftp.snowmediaapps.com}"
FTP_USER="${FTP_USER:-smc@snowmediaapps.com}"
SDK="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
JDK21=/usr/local/Cellar/openjdk@21/21.0.8/libexec/openjdk.jdk/Contents/Home
[ -n "${JAVA_HOME:-}" ] || { [ -d "$JDK21" ] && export JAVA_HOME="$JDK21"; }
ADB="$SDK/platform-tools/adb"
[ -x "$ADB" ] || ADB="$(command -v adb || true)"
cd "$(dirname "$0")/.."
NAME="$(node -p "require('./public/update.json').version")"
CODE="$(node -p "require('./public/update.json').versionCode")"
OUT="$HOME/Downloads/smc-release-$NAME"

case "$STEP" in
test)
  git checkout main
  git pull origin main
  NAME="$(node -p "require('./public/update.json').version")"
  CODE="$(node -p "require('./public/update.json').versionCode")"
  OUT="$HOME/Downloads/smc-release-$NAME"
  rm -rf dist node_modules android/app/build android/app/src/main/assets/public
  npm install
  npm run build
  npx cap sync android
  # cap sync can write local paths into this file; never commit them.
  git checkout -- android/capacitor.settings.gradle 2>/dev/null || true
  [ -f android/keystore.properties ] || { echo "STOP: no android/keystore.properties, so this would be signed with a debug key."; exit 1; }
  # Customer build: never with MPV (it logs stream addresses with line logins).
  (cd android && ./gradlew clean assembleRelease)

  APK=android/app/build/outputs/apk/release/app-release.apk
  AAPT="$(ls -d "$SDK"/build-tools/*/aapt | tail -1)"
  BADGING="$("$AAPT" dump badging "$APK")"
  APK_NAME="$(echo "$BADGING" | grep -o "versionName='[^']*'" | cut -d"'" -f2)"
  APK_CODE="$(echo "$BADGING" | grep -o "versionCode='[0-9]*'" | cut -d"'" -f2)"
  if unzip -l "$APK" | grep -q "libmpv"; then
    echo "STOP: this APK contains MPV. Customer builds must not."; exit 1
  fi
  if [ "$(echo "$BADGING" | grep -c application-debuggable)" != "0" ]; then
    echo "STOP: this APK is debuggable."; exit 1
  fi
  APKSIGNER="$(ls -d "$SDK"/build-tools/*/apksigner | tail -1)"
  CERT="$("$APKSIGNER" verify --print-certs "$APK")"
  # SMC's release key is named "Android Debug" (alias androiddebugkey) and every box in the
  # field has SMC signed with it, so check the exact certificate, not the name: any other
  # key (e.g. this Mac's own debug key) means customers can't update.
  FIELD_CERT=7cdc1043c5022e4e070836f1791960bf16e6555d9c6e03569796992759ffcc9b
  if ! echo "$CERT" | grep -i "SHA-256 digest" | grep -q "$FIELD_CERT"; then
    echo "STOP: not signed with the SMC release key that customers' boxes have."; exit 1
  fi
  echo "$CERT" | grep -i "SHA-256 digest" | head -1
  if [ "$APK_NAME" != "$NAME" ] || [ "$APK_CODE" != "$CODE" ]; then
    echo "STOP: APK is $APK_NAME ($APK_CODE) but public/update.json says $NAME ($CODE)."; exit 1
  fi

  rm -rf "$OUT"; mkdir -p "$OUT"
  cp "$APK" "$OUT/snowmediacenter.apk"
  cp "$APK" "$OUT/snow_media_center.$NAME.apk"
  BYTES="$(wc -c < "$APK" | tr -d ' ')"
  node -e "
const fs=require('fs');const u=JSON.parse(fs.readFileSync('public/update.json','utf8'));
u.size=(${BYTES}/1048576).toFixed(1)+' MB';u.bytes=${BYTES};u.sha256='$(shasum -a 256 "$APK" | cut -d' ' -f1)';u.downloadUrl='https://snowmediaapps.com/smc/snow_media_center.${NAME}.apk';
fs.writeFileSync('${OUT}/update.json',JSON.stringify(u,null,2)+'\n');"
  shasum -a 256 "$OUT/snow_media_center.$NAME.apk" | cut -d' ' -f1 > "$OUT/tested.sha256"

  [ -n "$ADB" ] || { echo "adb not found (install Android SDK platform-tools)"; exit 1; }
  echo "Installing $NAME (build $CODE) on the Firestick at $IP…"
  PKG=app.lovable.f44324110df840aea0a1fb97cafa76e7
  "$ADB" devices | grep -q "^$IP:5555[[:space:]]*device" || "$ADB" connect "$IP:5555"
  "$ADB" -s "$IP:5555" wait-for-device
  # Always an in-place update (-r). Never uninstall: that wipes sign-ins and data.
  "$ADB" -s "$IP:5555" install -r "$OUT/snow_media_center.$NAME.apk"
  "$ADB" -s "$IP:5555" shell am start -n "$PKG/com.snowmedia.SplashActivity" >/dev/null
  "$ADB" -s "$IP:5555" shell dumpsys package "$PKG" | grep -E "versionCode|lastUpdateTime" | head -2
  echo "Installed on the Firestick. Nothing was uploaded."
  echo "When it passes, run: scripts/release.sh publish"
  ;;

publish)
  for f in snowmediacenter.apk "snow_media_center.$NAME.apk" update.json tested.sha256; do
    [ -f "$OUT/$f" ] || { echo "STOP: $OUT/$f is missing. Run scripts/release.sh test first."; exit 1; }
  done
  # Only the exact APK that was installed on the Firestick goes up.
  NOW="$(shasum -a 256 "$OUT/snow_media_center.$NAME.apk" | cut -d' ' -f1)"
  [ "$NOW" = "$(cat "$OUT/tested.sha256")" ] || { echo "STOP: the APK changed since it was tested."; exit 1; }
  cmp -s "$OUT/snowmediacenter.apk" "$OUT/snow_media_center.$NAME.apk" || { echo "STOP: the two copies differ."; exit 1; }

  read -r -s -p "FTP password for $FTP_USER: " FTP_PASS; echo
  NETRC="$(mktemp)"; chmod 600 "$NETRC"
  trap 'rm -f "$NETRC"' EXIT
  printf 'machine %s login %s password %s\n' "$FTP_HOST" "$FTP_USER" "$FTP_PASS" > "$NETRC"
  unset FTP_PASS
  put() { curl --fail --ssl-reqd --netrc-file "$NETRC" --ftp-create-dirs -T "$1" "ftp://$FTP_HOST/$2"; }
  put "$OUT/snowmediacenter.apk"            "apps/snowmediacenter.apk"
  put "$OUT/snow_media_center.$NAME.apk"    "smc/snow_media_center.$NAME.apk"
  put "$OUT/update.json"                    "smc/update.json"

  echo "Checking the live files…"
  curl -sI "https://snowmediaapps.com/smc/snow_media_center.$NAME.apk" | head -1
  curl -sI "https://snowmediaapps.com/apps/snowmediacenter.apk" | head -1
  curl -s "https://snowmediaapps.com/smc/update.json?ts=$(date +%s)" | grep -E '"version"|"versionCode"'
  echo "Done: SMC $NAME is live."
  ;;

*)
  echo "Usage: scripts/release.sh test | publish"; exit 1 ;;
esac
