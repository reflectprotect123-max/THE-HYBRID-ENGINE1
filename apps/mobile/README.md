# The Android app

Expo SDK 54 / React Native 0.81 / React 19. Android first.

This file exists because **`eas.json` cannot hold comments.** EAS validates it
against a strict schema and rejects any key it does not recognise — including
the `"//"` convention used everywhere else in this repo. The reasoning behind
those settings lives here instead.

## Signing — the expensive thing to get wrong

The app that is already installed on people's phones was signed with a specific
key. An update **must** be signed with that same key:

- Play rejects an upload signed with anything else as a different app.
- A sideload installs **beside** the existing app as a second icon, with none of
  the athlete's training history.

That key has been a repository secret since the WebView build:
`ANDROID_KEYSTORE_B64`, alias `hybrid`, with `ANDROID_KEYSTORE_PASSWORD` and
`ANDROID_KEY_PASSWORD`.

`.github/workflows/mobile-eas.yml` decodes it into `release.keystore`, writes a
`credentials.json` beside it, and `eas.json` sets `credentialsSource: "local"`
on the `preview` and `production` profiles so EAS uses it rather than generating
its own. That makes the signing correct by construction instead of depending on
someone uploading the right file to Expo. A missing keystore is a hard error,
not a fallback — an EAS-generated key produces an APK that cannot install over
`com.hybridengine.app` at all.

Both files are shredded in an `always()` step and are gitignored.

## Identity that must not drift

| Setting | Value | Why |
|---|---|---|
| `expo.android.package` | `com.hybridengine.app` | Change it and it is a different app |
| `expo.android.versionCode` | `> 27` (currently 30) | The shipped WebView build is 27 |
| `expo.runtimeVersion` | `"1"` — a hand-bumped string | See below. Not the `fingerprint` policy |
| `expo.owner` | `ths1s-team` | The EAS project belongs to an organisation, not a personal account. Without this, EAS resolves against whichever account the token belongs to and cannot find the project |
| `expo.extra.eas.projectId` | `7851ad90-…` | What `eas init --id` writes. Recorded rather than run, because CI builds are `--non-interactive` and cannot be prompted to link a project mid-build |

## runtimeVersion — the one rule that keeps OTA honest

`.github/workflows/mobile-ota.yml` publishes an EAS Update on every push that
touches this app. A phone only accepts an update whose `runtimeVersion` matches
the one compiled into the APK it is running.

**The rule: bump `expo.runtimeVersion` in the same commit as any NATIVE change**
— a new native module, a new permission, the icon, an Expo SDK bump — and ship
a fresh APK with it. Never bump it for a JS-only change; not bumping is
precisely what lets those ship over the air.

It is a hand-managed string rather than `{"policy": "fingerprint"}` because
fingerprint **silently broke delivery here**. Fingerprint hashes the autolinked
native module directories, and under pnpm those directory names embed the
peer-resolution hash. Adding `eas-cli` to the workspace injected
`graphql@16.8.1` into the path of every `expo-*` module, changing the runtime
version even though not one line of native code differed. Updates published
green; every phone ignored them; nothing logged an error on either side. A
fixed string cannot drift like that — but it does mean the rule above is now a
human responsibility rather than an automatic one.

## The native project is generated, not committed

`android/` is gitignored. `expo prebuild` regenerates it from `app.json` and the
config plugins on every build, including on EAS. Committing it would mean
hand-maintaining native code that is already described declaratively, and the
two drift silently.

Two things that only appear once prebuild runs, both fixed and both invisible to
`tsc`:

- The app referenced `./assets/icon.png` and had no `assets/` directory, so
  prebuild failed outright and no native project could be produced at all.
- `POST_NOTIFICATIONS` was not in the generated manifest. `targetSdk` is 35, so
  on Android 13+ the runtime request returns denied without prompting and no
  notification is ever shown — meaning the rest alarm, the one feature that
  needs a native app rather than the PWA, could not work.

The icon is generated from the **shipped** artwork
(`native/android-app/.../ic_raw.png`) placed 1:1 on an 800px canvas, which
reproduces the existing 18% inset with no resampling. An updating user should
not watch their icon change during what is meant to be a silent update.

## Checks

```
pnpm --filter @hybrid/mobile typecheck   # necessary, nowhere near sufficient
pnpm --filter @hybrid/mobile bundle      # Metro + Hermes, for real — this is the one that matters
```

`typecheck` is blind to whether this app can be built: TypeScript resolves
through pnpm's symlinks happily and Metro does not. This app spent the whole
migration unable to bundle while `tsc` stayed green. CI runs `bundle` on every
push for that reason.

Neither proves it **compiles** — that needs an EAS build — and nothing here
touches hardware. BLE, notifications and the share-sheet backup have never
executed on a device.
