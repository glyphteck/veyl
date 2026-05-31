# Packages

Use this guide for dependency installs, package upgrades, framework bumps, lockfile changes, and native-package rebuild decisions.

## Repo Package Model

The repo root is a Bun workspace. Workspace packages are:

- `apps/*`
- `apps/*`
- `shared`

Run root workspace installs from the repo root:

```bash
bun install
```

`functions/` is separate from the Bun workspace and uses npm:

```bash
cd functions && npm install
```

The repo uses Bun's isolated linker through `bunfig.toml`:

```toml
[install]
linker = "isolated"
```

Do not change the linker as a casual dependency fix. In the SDK 56 upgrade, a clean hoisted install made Doctor worse by surfacing older transitive SDK 55 peer copies under packages such as `react-native-passkeys` and `@expo/vector-icons`. Keep generated `node_modules/` out of source edits; delete and reinstall generated dependency folders only as a diagnostic or cleanup step.

The root `package.json` workspace catalog owns shared versions such as Firebase, Next, web React, and common shared libraries. Web packages should use `catalog:` for React and React DOM so Next peer compatibility is checked centrally. The root `overrides` keep Firebase and Next on the catalog versions.

## General Upgrade Rules

Before changing framework packages, inspect:

- the relevant package file
- the root catalog
- `bunfig.toml`
- current dirty files
- the upstream release notes for major framework bumps

Use the package manager to change package files and `bun.lock`. Do not hand edit `bun.lock`.

After framework package changes, run:

```bash
bun install
bun sync:frameworks
bun install
```

For a non-mutating compatibility check:

```bash
bun check:frameworks
```

`bun sync:frameworks` does two things:

- keeps web app React dependencies on the root Bun catalog and checks that catalog against the installed Next.js React peer range
- runs Expo install compatibility for the iOS app's React Native stack

Do not manually bump React, React DOM, React Native, Reanimated, Worklets, Screens, SVG, Keyboard Controller, or similar Expo-managed native packages unless the task is explicitly to override Expo's compatibility table. Native library major bumps, such as camera packages, must include the matching code migration instead of pinning back to an older API.

If a native package changes, expect a native rebuild before judging runtime behavior. Agents should not run a manual build by default unless the user asks for it, but the handoff must name the native packages changed and say that a rebuild is needed.

## Expo And iOS

Work from `apps/ios` for Expo commands:

```bash
cd apps/ios
bun x expo install --check
bun x expo install --fix
bun x expo-doctor
```

Use `bun x expo install <package>` for Expo SDK packages so the version follows the installed SDK. After changing `expo`, run the root framework sync sequence from the repo root.

This app uses dynamic config in `apps/ios/app.config.js`. Expo CLI cannot automatically write config plugin entries into dynamic config. When `expo install --fix` prints "Cannot automatically write to dynamic config", add only the plugin entries it requests by hand. In the SDK 56 upgrade, Expo requested these plugin entries:

- `expo-asset`
- `expo-audio`
- `expo-font`
- `expo-image`
- `expo-secure-store`
- `expo-video`

SDK 56 also required `expo-asset` as a direct peer for `expo-audio`.

For SDK 56, app-code imports from external React Navigation packages should use Expo Router's re-export:

```js
import { useIsFocused } from 'expo-router/react-navigation';
```

Do not keep direct app dependencies on `@react-navigation/*` unless app code truly imports those packages directly and the SDK release supports that surface.

`bun make ios` is the normal phone rebuild path for the dev client. It runs a clean prebuild, builds, installs `dev.veyl` on the configured phone, and does not start Metro. Use `bun dev ios` for the dev-client server. Use `bun make ios reset` after app identity, signing, associated-domain, or bundle-id changes when on-device state must be cleared.

Generated native directories such as `apps/ios/ios/` are build output. Do not hand edit them unless the task is explicitly about generated native output. A manual `pod install` inside that directory can refresh pods for an already-generated native project, but it is not a replacement for the repo's prebuild/build path after Expo config or package changes.

The Veyl iOS app's minimum supported iOS version is 26.5. Keep the `expo-build-properties` iOS deployment target at `26.5`. Some third-party podspecs can still declare a lower target even when the generated Podfile platform is correct; this repo uses `apps/ios/plugins/with-ios-pod-deployment-target.js` to raise generated Pod targets below 26.5 during prebuild. During the SDK 56 upgrade, `react-native-passkeys` compiled at iOS 15.1 and failed against `ExpoModulesCore` until the generated Pods project was normalized this way.

`@expo/ui` is intentionally excluded from iOS autolinking in `apps/ios/package.json`. Expo Router can bring it in transitively, but the Veyl app does not import the native `@expo/ui` package. During the SDK 56/Xcode 26.5 upgrade, its SwiftUI chart code failed to compile in `ChartView.swift`; excluding it from iOS autolinking removed the unused native pod from the generated project. After changing autolinking metadata, run a clean prebuild so stale pods are removed.

The iOS app target also carries linker unwind flags through `apps/ios/plugins/with-ios-linker-unwind-flags.js`. During the SDK 56/Xcode 26.5 rebuild, the final app link failed with compact-unwind personality limits while combining Swift, Rust, Objective-C, and C++ native code. Keep the plugin with SDK or native-linker upgrades unless the native dependency shape changes enough to prove it is no longer needed.

If an SDK or native-package upgrade fails because generated iOS files still point at old packages, regenerate the native project cleanly before retrying the phone build:

```bash
cd apps/ios
VEYL_IOS_VARIANT=dev VEYL_LOCAL_IOS_BUILD=1 VEYL_ASSOCIATED_DOMAINS_MODE=developer EXPO_PUBLIC_NETWORK=REGTEST bun x expo prebuild -p ios --clean
```

During the SDK 56 upgrade, the first `bun make ios -v` build reused stale generated Pod metadata that still referenced React Native 0.83.6, Expo SDK 55 package paths, and old Bun `.bun` hashes for `react-native-nitro-modules`. A clean prebuild removed those stale references and restored the Podfile lock to React Native 0.85.3/current package hashes. After the package, autolinking, deployment-target, and linker-flag fixes, `bun make ios -v` built, installed, and launched the dev app on an iOS 26.5 phone. Check the generated lockfile and project only as evidence; do not commit those generated files.

## Doctor Findings

Treat `bun x expo install --check` and `bun check:frameworks` as the first compatibility gate for the SDK package matrix.

`bun x expo-doctor` is still useful, but interpret it against the repo's Bun isolated install. During the SDK 56 upgrade, Doctor reported duplicate Expo native-module paths even after deleting generated `node_modules/` folders and reinstalling. The remaining duplicates were same-version Expo modules nested under Bun's `.bun` isolated store, often through `expo` or `expo-router`. A clean hoisted install was not a fix; it exposed older SDK 55 transitive peer copies.

When Doctor reports duplicates:

1. Run `bun install` from a clean generated dependency state if needed.
2. Run `bun x expo install --check`.
3. Run `bun check:frameworks`.
4. Inspect autolinking if native selection looks suspicious:

```bash
cd apps/ios
bun x expo-modules-autolinking search --platform ios --json
```

If the matrix checks are clean and autolinking chooses the expected current package, record the Doctor duplicate finding in the handoff instead of changing the linker or deleting the lockfile.

React Native Directory Doctor warnings may mention packages with missing metadata or untested New Architecture status. In the SDK 56 upgrade, the remaining metadata warnings were for existing packages: `react-native-nitro-image`, `@buildonspark/spark-sdk`, `react-native-argon2`, `react-native-passkeys`, and `expo-modules-jsi`. Do not pin back or replace packages solely because metadata is missing; use those warnings as review prompts when touching the package's feature area.

## Lockfile And Cleanup

Expected package-upgrade diffs usually include:

- the relevant `package.json`
- root `package.json` when the catalog changes
- `bun.lock`
- Expo config if config plugins or native app settings change

Do not leave temporary dependency experiments in place. If you test a different install strategy or delete generated dependency folders, restore the repo's configured install path before handoff.
