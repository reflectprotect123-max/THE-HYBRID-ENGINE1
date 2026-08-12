/*
 * Build the Android app from the Expo-managed source.
 *
 * This deliberately builds a debug APK locally. A production APK/AAB must be
 * signed with the existing release key, so that path stays in EAS and the
 * checked-in GitHub workflow. Keeping the local path debug-signed makes it
 * useful for installing on a test phone without ever handling a private key.
 *
 * Run from the repository root:
 *   pnpm android:prebuild
 *   pnpm android:debug
 */
import { access, chmod } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { spawn } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const mobile = resolve(root, 'apps/mobile');
const android = resolve(mobile, 'android');
const isWindows = process.platform === 'win32';
const command = process.argv[2] || 'debug';

const pathExists = async (path) => {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
};

const fail = (message) => {
  console.error(`\nAndroid build cannot continue:\n${message}\n`);
  process.exit(1);
};

const run = (executable, args, cwd, extraEnv = {}) => new Promise((resolveRun, rejectRun) => {
  console.log(`\n> ${executable} ${args.join(' ')}`);
  const child = spawn(executable, args, {
    cwd,
    env: { ...process.env, ...extraEnv },
    stdio: 'inherit',
    // Windows exposes .cmd shims for Expo/Gradle; Unix does not need a shell.
    shell: isWindows,
  });
  child.once('error', rejectRun);
  child.once('exit', (code, signal) => {
    if (code === 0) resolveRun();
    else rejectRun(new Error(`command exited with ${signal || code}`));
  });
});

const expo = resolve(mobile, 'node_modules', '.bin', isWindows ? 'expo.cmd' : 'expo');
const gradle = resolve(android, isWindows ? 'gradlew.bat' : 'gradlew');

if (!(await pathExists(expo))) {
  fail('Expo is not installed. Run `pnpm install --frozen-lockfile` first.');
}

if (!['prebuild', 'debug'].includes(command)) {
  fail(
    `Unknown command "${command}". Use `
      + '`pnpm android:prebuild` or `pnpm android:debug`. '
      + 'Use the EAS workflow for a signed release APK or AAB.',
  );
}

const expoEnv = {
  CI: '1',
  EXPO_NO_TELEMETRY: '1',
  EXPO_HOME: process.env.EXPO_HOME || resolve(root, '.expo-home'),
};

try {
  await run(expo, ['prebuild', '--platform', 'android', '--no-install'], mobile, expoEnv);
} catch (error) {
  fail(`Expo prebuild failed: ${error.message}`);
}

if (command === 'prebuild') {
  console.log(`\nNative Android project ready at ${android}`);
  process.exit(0);
}

const sdk = process.env.ANDROID_SDK_ROOT || process.env.ANDROID_HOME;
if (!sdk) {
  fail(
    'ANDROID_SDK_ROOT (or ANDROID_HOME) is not set. Install Android SDK Platform 35 '
      + 'and Build-Tools 35.0.0, then set the SDK environment variable. See '
      + 'docs/ANDROID_BUILD.md.',
  );
}

const missing = [];
for (const path of [resolve(sdk, 'platforms', 'android-35'), resolve(sdk, 'build-tools', '35.0.0')]) {
  if (!(await pathExists(path))) missing.push(path);
}
if (missing.length) {
  fail(`The Android SDK is present but required components are missing:\n- ${missing.join('\n- ')}`);
}

if (!(await pathExists(gradle))) {
  fail('The generated Gradle wrapper is missing. Run `pnpm android:prebuild` again.');
}
if (!isWindows) await chmod(gradle, 0o755);

const gradleHome = process.env.GRADLE_USER_HOME || resolve(root, '.gradle-cache');
try {
  await run(gradle, [':app:assembleDebug'], android, { GRADLE_USER_HOME: gradleHome });
} catch (error) {
  fail(
    `Gradle failed: ${error.message}\n`
      + 'If this is the first build, make sure Gradle can reach services.gradle.org and '
      + 'Google Maven, or use the EAS workflow.',
  );
}

const apk = resolve(android, 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk');
if (!(await pathExists(apk))) fail('Gradle reported success but app-debug.apk was not produced.');
console.log(`\nAPK ready: ${apk}`);
