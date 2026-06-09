# Bugs

Current open bugs that need fixes.

## iOS Full-Screen Swipe To Leave Routes Degrades After Root Tab Swiping

Status: open, accepted for now

The iOS stacks previously enabled native gestures globally with `gestureEnabled: true` and `fullScreenGestureEnabled: true`, but on iOS 26.5 the whole-screen back gesture can degrade during normal app routing until only the edge/corner back swipe works.

Current hypothesis: React Native Screens uses iOS 26's native `interactiveContentPopGestureRecognizer` for whole-screen pop gestures by default. That recognizer can defer to horizontal `UIScrollView` pans when a horizontal pager reports content wider than its frame. Root tab swiping is implemented with an app-owned Expo Router `TabRouter` wrapper around `react-native-pager-view`, so root tab swipes can still be the trigger that poisons full-screen stack back recognition behind pushed routes.

Current implementation decision: keep root route swiping app-owned and narrow. `apps/ios/src/lib/navigation/homepager.js` uses Expo Router's `TabRouter` as the selected-tab source of truth, renders the four home routes in `react-native-pager-view`, disables tab-level back history, and ignores stale native page-selection events unless they match the live scroll position while the pager is actively dragging or settling. Home tab order, root-path gating, last-route mapping, and warming live in `apps/ios/src/lib/navigation/hometabs.js`. `MainMenu` derives its icon animation from the pager's live `position`.

Rejected mitigations: forcing `animation: 'simple_push'`/`animationMatchesGesture: true` and patching `react-native-screens` made back swipes feel too heavy and required a native rebuild. Those changes were removed.

Evidence:

- `apps/ios/app/_layout.js`
- `apps/ios/app/(vault)/_layout.js`
- `apps/ios/app/(vault)/(app)/_layout.js`
- `apps/ios/app/(onboarding)/_layout.js`
- `apps/ios/src/lib/navigation/stackoptions.js`
- `apps/ios/app/(vault)/(app)/(home)/_layout.js`
- `apps/ios/src/lib/navigation/homepager.js`
- `apps/ios/src/lib/navigation/hometabs.js`
- `apps/ios/app/(vault)/(app)/(home)/camera.js`
- `apps/ios/package.json`

The available update includes `expo-router@56.2.7` to `~56.2.8`, but `56.2.8` is documented as having no user-facing changes. `react-native-screens` is already `4.25.2`, and `react-native-gesture-handler` is already `~2.31.1`; neither is part of the current Expo install warning.

Fix direction:

- Verify root page swiping across chat, camera, wallet, and settings still feels native on the focused root surface.
- Verify native-feeling full-screen back after opening chat, routing through sheets/pages, root-swiping quickly, and returning to pushed routes.
- If the root pager continues poisoning native stack back, the next clean option is an upstreamable React Native Screens or `react-native-pager-view` fix. Do not patch React Native Screens or force the custom full-screen pan path unless the native package fix can be upstreamed cleanly.
- Keep pager swipes, chat row swipes, media-viewer swipes, camera recording-lock swipes, and stack leave gestures separate so one gesture surface does not accidentally block another.
- Prefer React Native Screens' public native-stack options and supported navigator patterns before carrying a local package patch.
- Verify on device across current chat, chat settings, wallet sheets, QR routes, and auth/vault routes.
