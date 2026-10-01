# Build, install and test SMC on the owner's Fire TV (sessions on the owner's Mac)

Only a session running ON THE OWNER'S MAC can do this (the cloud sessions can't reach the
Fire TV or the Android SDK). The owner is not a coder: after every build, say in plain words
what you saw, show the version on screen, and push every change.

## SMC facts
- Package `app.lovable.f44324110df840aea0a1fb97cafa76e7`, launch activity `com.snowmedia.SplashActivity`.
- Fire TV: adb over Wi-Fi at `192.168.50.36:5555` (Fire OS 7 = Android 9).
- SDK `~/Library/Android/sdk`; JDK 21 `/usr/local/Cellar/openjdk@21/21.0.8/libexec/openjdk.jdk/Contents/Home`.
- Release signing comes from `android/keystore.properties` (never committed). No file = debug key = never ship.
  The SMC release key is itself named "Android Debug" (alias `androiddebugkey`, cert SHA-256 `7cdc1043…cc9b`)
  and every customer box has it, so never swap it; release.sh checks that exact certificate, not the name.
- Update channel: `https://snowmediaapps.com/smc/update.json` (FTP account rooted at `public_html`):
  `/smc/snow_media_center.<version>.apk`, `/smc/update.json`, and `/apps/snowmediacenter.apk`.
- MPV is for owner test builds only (`-PSMC_WITH_MPV=true`); customer releases never include it.

## The loop, after every finished change
1. Checks: `npx tsc --noEmit -p tsconfig.app.json`, eslint on changed files, `npx vitest run`, `npm run build`.
2. Raise `versionCode` (and `public/update.json` / `public/version.json` for a release).
3. `bash scripts/release.sh test` — clean build of main (no MPV), checks the APK (package, build number,
   not debuggable, release key, no MPV), installs it with `install -r` on the Fire TV and opens it.
   For owner MPV test builds: `bash scripts/firestick.sh 192.168.50.36`.
4. Test the change on the TV yourself with remote keys and screenshots (below), then the main paths around it.
5. Tell the owner what you saw. **Owner rule: publish (`bash scripts/release.sh publish`) ONLY after the
   owner says it passes.** Publish uploads the exact APK that was tested, update.json last.
6. If the update path itself changed, test the update end to end on the TV (section "Testing the update").

Run long builds in the background. `cap sync` can rewrite `android/capacitor.settings.gradle` with local
paths: `git checkout --` it, never commit it.

## Drive and see the TV (keep these in your scratchpad)
`k.sh` — remote keys (`k.sh down 3`, `k.sh ok`, `k.sh back`):
```bash
#!/bin/bash
ADB=~/Library/Android/sdk/platform-tools/adb; D=192.168.50.36:5555
case "$1" in up) c=19;; down) c=20;; left) c=21;; right) c=22;; ok) c=23;; back) c=4;; home) c=3;; *) c=$1;; esac
for i in $(seq 1 ${2:-1}); do $ADB -s $D shell input keyevent $c; sleep ${3:-0.35}; done
```
`shot.sh` — screenshot scaled for the Read tool (`shot.sh step1`):
```bash
#!/bin/bash
ADB=~/Library/Android/sdk/platform-tools/adb; D=192.168.50.36:5555; OUT=<your scratchpad>/ftv
mkdir -p "$OUT"; $ADB -s $D exec-out screencap -p > "$OUT/$1-full.png" && sips -Z 960 "$OUT/$1-full.png" --out "$OUT/$1.png" >/dev/null && echo "$OUT/$1.png"
```
- Not listed in `adb devices` → `adb connect 192.168.50.36:5555`. Asleep (`dumpsys power | grep mWakefulness`)
  → `input keyevent 224`: fine by day; at night ask the owner first.
- Look before you press: screenshot, a few keys, screenshot. If Back leaves the app, `am start` it again.
- Memory: `dumpsys meminfo <package>` (TOTAL and Java Heap before/after).
- Logs: `adb logcat -d -t 400 | grep …`, always piped through `sed -E 's#(https?://)[^ "]*#\1<redacted>#g'`.
  Never print passwords, tokens or stream URLs.
- System screens (installer, settings) may have nothing focused: `uiautomator dump /sdcard/ui.xml`, read
  `text=`/`focused=`, move until the right button is `focused="true"`, press OK, then delete the dump.
- adb key presses never open Amazon's on-screen keyboard; typing bugs need a WebView-debugging build that is
  never left on the TV or published. The remote's Back reaches SMC as Capacitor `backButton`; `keyevent 4` is the same.
- Confirm installs: `dumpsys package <package> | grep -E "versionCode|lastUpdateTime"` plus the version on screen
  (Settings → Updates).

## Testing the update (only when the update path changed)
1. Leave the TV on the current build; publish the new one (after the owner's OK); don't adb-install it.
2. Trigger SMC's own update (Settings → Updates, or its automatic check), with screenshots.
3. First time on a device Android asks to allow "Install unknown apps": **the owner switches it on, never you.**
4. Installer "Install an update to this application?": focus INSTALL (uiautomator), press OK.
5. Verify new versionCode, new lastUpdateTime, new version on screen, still signed in, data kept.
6. Android closes an app while replacing it; that is normal.

## Never
- Uninstall or wipe SMC on the owner's TV (always `install -r`).
- Flip security settings on the owner's devices.
- Type the owner's passwords anywhere, or print keys, tokens, the keystore, passwords or stream URLs.
- Leave a debug/diag build on the TV, or publish one. Publish without the owner's "it passes".
- Wake the TV at night without asking. Touch other apps on the TV.
