# Launch

- Complete App Store Connect submission notes, reviewer access, support contact, and final review-bot readiness.
- Do a final release-readiness pass across safety, security, legal copy, Apple review support, wallet guardrails, account deletion, and export flows.
- Before public release, confirm old deterministic chat data and bot chat cursor state do not exist in the target backend, or wipe them only with explicit operator approval.
- Watch sealed inbox ping delivery after launch, since v1 routes opaque chat delivery through the `push` callable for block enforcement, push limits, and generic username notifications.
- Release veyl officially.
