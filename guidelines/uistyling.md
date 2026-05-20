# UI Styling Guidelines

This file is the single source for veyl web and iOS UI styling rules: component choices, visual recipes, interaction feel, layout conventions, typography, color, and motion. In this repo, "UI" and "styling" mostly refer to the same implementation surface, so keep those rules together here.

## ios

veyl iOS UI is built around native-feeling glass surfaces, heavy text, lucide icons, and small springy press feedback.

Use the existing glass primitives first:

- `GlassButton` for primary text actions.
- `GlassIcon` for route buttons, toolbar actions, and compact icon-only actions.
- `GlassField` for inputs.
- `GlassView` for glass panels, message bubbles, command chips, and other frosted surfaces.
- `GlassHeader` and `GlassFooter` for pinned top and bottom chrome.
- `Icon` for lucide icons so theme color and stroke width stay consistent.

Do not build new buttons from raw `Pressable` unless the shape is genuinely custom. If a raw press target is needed, use `useTap` or `tap` from `src/lib/tap.js`; default spring and haptics are preferred. For repeated press interactions, keep changes narrow: usually only `scale`, `hapticIn`, or `hapticOut`.

Tap feedback is scale-first. Press targets shrink on press down with the shared spring, then return on release. The default release haptic is soft and should stay on release for normal taps; use `hapticIn` only when immediate press-down confirmation is intentional, and use `hapticPress` for custom release cases such as menu rows that should not use the default. Prefer `tap` for reanimated values and `useTap` for React Native `Animated.Value` surfaces.

For controls that appear or disappear in place, use `usePop` from `src/lib/pop.js` so the item scales in and can animate width, height, or adjacent gaps. Keep normal press feedback on the child press target when a popped item is also tappable.

Do not set or animate `opacity` on `GlassView` or any component built on the `GlassView` primitive, including `GlassButton`, `GlassIcon`, `GlassField`, `GlassHeader`, and `GlassFooter`, or on wrappers whose opacity controls one of those components. Native glass has a known bug where setting opacity to `0` can leave the glass surface unable to render again. Hide glass controls with conditional mounting after their scale/size exit animation finishes, or use scale, width, height, gap, or route-state changes while keeping the glass layer itself fully opaque.

Use `160ms` as the default fixed animation time for responsive UI state changes, including button/toggle state changes, avatar selection borders, menu/dialog fades, search focus crossfades, and chat row layout transitions for height changes, inserts, and removals. Timings in the `100ms` to `200ms` range should usually normalize to `160ms`; keep deliberately different longer/shorter timings, springs, gesture physics, media viewer staging, and spinner behavior only when they are tuned for a specific feel.

Route and toolbar buttons usually use `GlassIcon`. The common size is `56`, icon size defaults to half that, and rounded square route buttons commonly use `rounded={16}`. Full circular buttons use the default `rounded="full"`. Accent actions set `accent`, which flips to foreground tint with background-colored content.

Text buttons usually use `GlassButton`. The default height is `54`, border radius is half the height, horizontal padding is `20`, label size is `18`, and label weight is `900`. Use `accent` for the main confirm/submit action. Use `pressableStyle={{ flex: 1 }}` when a button should fill a row.

Inputs usually look like:

- `GlassField` with `borderRadius: 24`.
- Horizontal padding around `14` to `16`.
- Row layout with optional leading icon/text.
- `TextInput` color `theme.foreground`, placeholder `theme.muted`.
- Standard input text size `20` for onboarding/password fields, `18` for search/chat/address fields, and `24`/`900` for money amount fields.

Typography is intentionally heavy:

- Large hero/app title: `fontWeight: '900'`.
- Screen titles: `24` to `36`, usually `800` or `900`.
- Header titles: around `20`, usually `800`.
- Row labels: `16`, usually `700` to `900`.
- Secondary row/meta text: `12` to `14`, usually `700`.
- Button labels: `18`, `900`.
- Empty-state titles: `24`, `900`; body copy: `16`, `700`, `theme.muted`.

Rounding is generous and consistent:

- Glass fields and chat inputs: `24`.
- Message bubbles/cards/chips: `20` to `24`.
- Larger informational cards: `24` to `28`.
- Circular avatars/status dots/buttons: `99` or `999`.
- Route action icons: `16` when square, full radius when circular.

Color should come from `useTheme()` and `src/lib/colors.js`: `background`, `glassTint`, `foreground`, `muted`, `border`, `destructive`, `inflow`, `outflow`, `bitcoin`, and `active`. `background` is the real screen fill, while `glassTint` is the material tint used by `GlassView` so light-mode screens can stay full white without making native glass disappear. Use `alpha()` when a translucent variant is needed. Avoid hardcoded colors except for camera overlays or other isolated native surfaces.

Headers and footers are usually absolute glass overlays. Account for safe areas with `useSafeAreaInsets()`. Keep scroll content padded under overlays instead of placing content behind them.

On iOS, "bottom sheet" means an Expo Router native sheet route. Add a `Stack.Screen` with `presentation: 'formSheet'`, `sheetGrabberVisible: true`, an intentional `sheetAllowedDetents` value, and the right `contentStyle` for that sheet. Use existing route-backed sheets such as `scan`, `transfer`, and `peerselector` as the model. Do not build local `Modal` or absolute-position fake sheet implementations unless the task explicitly asks for a non-route overlay.

The iOS full-screen media viewer provider lives in `apps/veyl/ios/src/providers/mediaviewerprovider.js`, and its UI lives in `apps/veyl/ios/src/components/media/mediaviewer.js`. Providers should expose state/actions and mount the UI component, not own the full visual tree. Keep swipe navigation and vertical dismiss transforms separate: the rail owns horizontal translation, while exit scale, opacity, corner rounding, and save-action fade belong only to the active media slide. Neighboring slides should stay unscaled during dismiss previews.

For new iOS UI, implement in this order:

1. Choose the closest existing screen pattern: onboarding form, wallet/action header, chat composer, settings row, or modal-style veyl.
2. Use `GlassHeader`/`GlassFooter` for pinned chrome and `GlassView`/`GlassField`/`GlassButton`/`GlassIcon` for controls.
3. Import lucide icons from `lucide-react-native` and render them through `Icon` or `GlassIcon`.
4. Use `useTheme()` colors and the established font weights instead of local palettes.
5. Use `useTap`/`tap` for custom presses; do not invent a new animation or haptic pattern.
6. Never set or animate opacity on `GlassView`-based components or wrappers that control them; use scale, size, gap transitions, or delayed conditional mounting instead.
7. Prefer official Expo or React Native primitives for iOS-native UI. If a community package is needed, prefer one that is actively maintained and current with the app's Expo SDK and current iOS release.

## web

veyl web UI is Tailwind-first, rounded, shadowed, lightly blurred, and icon-driven. The base visual language lives in `apps/veyl/web/src/app/globals.css`.

Use the existing primitives first:

- `Button` for any button or link-like action.
- `Input` for inputs, including leading/trailing icons.
- `Field` for react-hook-form wiring and accessibility ids.
- `Card` for framed glass content areas.
- `Tabs`/`ToggleGroup` for segmented choices.
- `DropdownMenu`, `Command`, and dialogs for menus/search flows.
- Lucide icons from `lucide-react`.

Before making a new control, confirm whether an existing primitive or local component already covers it. Prefer reusing the repo component and its established class names over custom one-off sizing, borders, shadows, or layout wrappers.

Buttons are intentionally thin primitives. `Button` supplies layout, rounded full shape, disabled state, icon child handling, and focus reset. The visual style comes from class names:

- `button-outline`: `bg-background/70 px-3 py-2 shadow`.
- `button-fill`: `bg-foreground px-3 py-2 text-background shadow`.
- `button-destructive`: destructive foreground/background treatment.
- `grower`, `grower-sm`, `grower-lg`: icon/action hover growth.
- `shrinker`, `shrinker-fixed`, `shrinker-fixed-sm`: larger text/profile/menu controls that press inward.
- `mainmenu`: the center search route button in the navbar.

For web controls that appear or disappear in place, wrap the control in `.pop` and toggle `data-open="true"`. Put `grower*` or `shrinker*` on the inner `Button` when the popped item also needs press feedback, so the pop transform and press transform do not fight on the same element.

Route buttons and compact toolbar actions are usually icon-only `Button`s with lucide icons and `grower-lg`. Navbar route icons are commonly `size-6`; default lucide styling sets icons to `size-5` and `stroke-[2.5]`. Chat composer/action icons often use `size-5`; standalone utility actions often use `size-6`.

Text submit actions usually use `button-outline shrinker` or `button-fill shrinker`. Confirmation actions should default to pill buttons, usually `button-fill shrinker` for the primary confirmation and `button-outline shrinker` for secondary confirmation choices. Use icon-only `grower-lg` actions for secondary adjacent actions such as scan, camera, wallet, history, cloak, QR, or new chat.

Inputs use `Input`:

- `rounded-full`.
- `bg-background/70`.
- `px-2.75 py-1.5`.
- `shadow backdrop-blur-sm`.
- `placeholder:text-muted`.
- Disabled state: `disabled:cursor-not-allowed disabled:opacity-50`.
- Leading/trailing slots use default pads `pl-9.5` and `pr-10.5`, with icons positioned around `left-3`/`right-3`.

Cards, dialogs, dropdowns, toasts, chat bubbles, and floating composer bars generally use the same glass recipe: `rounded-round bg-background/70 shadow backdrop-blur-sm`. The theme radius `rounded-round` is `1.375rem`. Use `rounded-full` for controls that are true pills/circles.

Use shadows instead of visible borders for separation. Avoid `border`, `border-*`, and divider-line styling in new UI unless a native browser control or third-party component leaves no practical alternative.

Typography is direct and heavy:

- Do not set branded, downloaded, or named commercial text fonts. Web base text uses `system-ui, sans-serif`; command/code/seed surfaces may use Tailwind `font-mono`, which resolves to a local system monospace stack and does not bundle font files. Do not add loaded fonts or custom `font-family` stacks. iOS uses React Native's default text family with only size, weight, and variant overrides.
- Main labels and command/menu labels often use `font-black`.
- Toggle items use `font-black`.
- Keyboard shortcuts use `text-sm font-black tracking-widest text-muted`.
- Secondary UI copy uses `text-muted`.
- Keep text lowercase where the surrounding UI does.

Important explanatory, safety, and legal text should use `text-foreground`, not muted color. Reserve `text-muted` for metadata or details that do not need to be read carefully, such as version labels. Legal and rules copy should allow text selection with `select-text`.

Segmented controls use `ToggleGroup`: root is `shadow flex w-fit items-center rounded-full`; items are `h-9 min-w-9`, `font-black`, separated with left borders, and active state is `bg-foreground text-background`. Tabs follow the same full-pill segmented pattern.

Menus and command surfaces should use the existing components. Dropdown items slide their first children on hover/focus. Command/main menu search is the app-wide navigation surface; do not replace it with ad hoc search UI.

Web uses `160ms` as the Tailwind default transition duration in `apps/veyl/web/src/app/globals.css`. Do not add explicit `duration-[160ms]`, `duration-160`, `duration-150`, or `duration-200` classes for normal transitions; rely on `transition-*` alone. Use explicit durations only when the animation is intentionally outside the default, such as longer chart/camera transitions, toast lifetimes, custom JavaScript row animation constants, media playback, or loading spinners.

For new web UI, implement in this order:

1. Check whether the needed component or pattern already exists, then pick the closest existing component: `Button`, `Input`, `Card`, `ToggleGroup`, `Tabs`, `DropdownMenu`, or `Command`.
2. Compose Tailwind classes with `cn()` when conditional classes are needed.
3. Use lucide icons and size them with Tailwind `size-*` only when deviating from the default.
4. Apply `grower*` to icon route/actions and `shrinker*` to larger pill/text controls.
5. Use `rounded-round bg-background/70 shadow backdrop-blur-sm` for glass panels and floating surfaces.
6. Use `Field` for forms so labels, hints, and invalid state remain wired.
7. Never use `window.confirm`, `window.alert`, or `window.prompt`; make a small dialog instead.
