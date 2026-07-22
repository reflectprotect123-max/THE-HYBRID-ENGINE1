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

## Android (.apk) — `native/android`, Bubblewrap TWA
- Digital Asset Links are already deployed at
  `/.well-known/assetlinks.json` (matches the release keystore below), so the
  installed app runs full-screen with no browser chrome.
- CI: **Actions → "Build Android APK" → Run workflow**. Artifact
  `hybrid-engine-android` contains `app-release-signed.apk` (sideload it) and
  an `.aab` (for Play Store).
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
