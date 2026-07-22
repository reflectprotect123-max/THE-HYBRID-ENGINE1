# THE Hybrid Engine — native app builds

Both apps are thin native wrappers around the live PWA
(https://thehybridengine1.netlify.app). All logic and data live in the web
app, so the native builds always track production — you never rebuild them to
ship a feature, only to change the wrapper itself.

Native binaries are built in **GitHub Actions**, not locally: the Windows
installer needs a Windows toolchain and the Android APK needs the Android SDK
(both provided by the CI runners). See `.github/workflows/`.

## Windows (.exe / .msi) — `native/windows`, Tauri v2
- CI: **Actions → "Build Windows .exe" → Run workflow**. Artifact
  `hybrid-engine-windows` contains the NSIS `.exe` installer and an `.msi`.
- The `.exe` is unsigned, so Windows SmartScreen shows a one-time
  "More info → Run anyway". A code-signing cert removes that (optional).
- Local (on a Windows machine): `cd native/windows && npm install &&
  npx tauri icon src-tauri/icons/icon-source.png && npm run build`.

## Android (.apk) — `native/android-app`, native WebView shell (v2, current)
- **Why v2:** the original Bubblewrap TWA (kept at `native/android`, dormant)
  could not expose Web Bluetooth, so live WHOOP heart rate was impossible
  inside the installed app. v2 is a small plain-Java WebView shell with a
  native BLE bridge (`window.AndroidHR`): the Conditioning screen scans,
  connects to WHOOP's HR Broadcast (BLE heart-rate service 0x180D), and
  streams second-by-second BPM into the page. Also bridged: screen
  keep-awake, backup export (system file saver), backup import (chooser).
- Same `applicationId` (`com.hybridengine.app`), same signing key, higher
  `versionCode` (2) — so it **installs over the old app as a normal
  update**, keeping data. All app logic still lives in the deployed PWA and
  updates over the air; rebuild the APK only to change the wrapper itself.
- CI: **Actions → "Build Android APK" → Run workflow** (auto-runs on changes
  under `native/android-app/`). Artifact `hybrid-engine-android`; also
  published to the `android-latest` release for a clean download link.
- Signing: the release keystore is **not** committed. To sign with the key
  whose fingerprint is in `assetlinks.json`, add these repo secrets
  (Settings → Secrets and variables → Actions):
  - `ANDROID_KEYSTORE_B64` — contents of `native/android/keystore.b64`
  - `ANDROID_KEYSTORE_PASSWORD` — `hybridengine`
  - `ANDROID_KEY_PASSWORD` — `hybridengine`
  Without the secrets the workflow builds with a throwaway key (installable,
  but the URL bar won't be hidden until assetlinks matches the real key).
- Play Store: $25 one-time Google dev account, upload the `.aab`. Sideloading
  the `.apk` needs no account and no review.

## Rotate/regenerate the signing key
`keytool -genkeypair -v -keystore hybrid-release.keystore -alias hybrid
-keyalg RSA -keysize 2048 -validity 10000` then update the SHA-256 in
`.well-known/assetlinks.json` and re-deploy.
