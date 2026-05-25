# Repo Guideline Audit

status: review
branch: main
worktree: current
base: main@ab773d9

## Scope

Repo-wide scan for obvious architecture drift, weak naming, stale artifacts, and guideline mismatches. The direct cleanup pass has been applied in the current diff; this task file now only tracks unresolved follow-up prompts that should not be forced without product or focused security review.

## Write Boundary

- No generated/vendor directories.
- No tests, builds, typechecks, formatters, or `git diff --check` unless separately requested.
- Keep this file trimmed to unresolved review items; resolved cleanup belongs in durable docs, code, and final handoff notes.

## Handoff

- Repo docs, shared modules, web app, iOS app, backend/functions/rules, scripts, and active todo files were scanned.
- Error-only lint passed after the final cleanup pass.
- Backend deployable changes were deployed with Functions, rules, and Firestore index/config deploys.
- Local artifact scan did not find leftover `.DS_Store`, backup, temp, or `.vscode` files outside generated/vendor paths.

## Review Later

- iOS blocked-user list still uses native-style separators. I left it for visual review instead of forcing a styling change because list separators may be intentional on route-backed management screens.
- Account deletion still removes older wallet webhook collections if they exist. Current docs say wallet webhooks are inactive, but I left those deletes as privacy cleanup for stale pre-production records.
- Web dense list surfaces still use dividers and bottom borders. I left those for visual review because they are established scan-oriented layouts rather than isolated new card chrome.
- Remaining raw web buttons are confined to primitives, camera controls, and chat message/media controls. I left those as custom surfaces instead of forcing the shared `Button` shape onto specialized interactions.
- `setMediaSaved` still trusts the signed-in caller's opaque media path and encrypted stay id capability. That matches the current encrypted payload model, but it is worth a focused security review before launch.
- `formatUserDisplay()` can still fall back to truncated wallet/chat public keys when no username is known. I left it as a review item because it is shared across user UI, transaction fallback display, and admin/ops disambiguation.
- The mobile `/download` page still has no concrete App Store URL or install button because the repo does not define an App Store link yet. Add the real listing URL before public launch.
