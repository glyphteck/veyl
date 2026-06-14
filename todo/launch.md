# Launch

status: active
branch: current
worktree: current
base: main@efd8e766fdf6
repo version: 0.16.2

- Complete App Store Connect submission notes, reviewer access, support contact, and final review-bot readiness.
- Do a final release-readiness pass across safety, security, legal copy, Apple review support, wallet guardrails, account deletion, and export flows.
- Submit and present veyl under the company Apple Developer organization, with seller, support, privacy, review, and legal identity aligned.
- Confirm company control of launch-critical assets and services: app assets, domains, Apple Developer, App Store Connect, Firebase/Google Cloud, GitHub, support email, and production infrastructure.
- Complete the launch legal review for liability, risk language, usage rules, wallet responsibility, taxes, sanctions, legal compliance, and communications safety.
- Rotate launch API keys and confirm production repositories/infrastructure are owned by the company organization before public release.
- Before public release, confirm old deterministic chat data and bot chat cursor state do not exist in the target backend, or wipe them only with explicit operator approval.
- Watch sealed inbox ping delivery after launch, since v1 routes opaque chat delivery through the `push` callable for block enforcement, push limits, and generic username notifications.
- Release veyl officially.
