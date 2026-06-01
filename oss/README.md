# veyl client

This is the public client source for veyl.

Veyl combines a self-custodial Spark Bitcoin wallet with end-to-end encrypted one-to-one messaging. The client derives wallet and chat keys from local vault material; Glyphteck's backend stores encrypted app data and public profile metadata, but should not receive the vault password, decrypted seed, wallet private keys, chat private keys, or plaintext private messages during normal operation.

This repository is intentionally client-first. It includes the web app, iOS app, and shared client logic needed to inspect, improve, and propose changes to the user-facing product and local cryptographic flows. The hosted service currently connects to Glyphteck-managed backend infrastructure with server-side guardrails and abuse controls.

The long-term goal is to make the whole system open source. Server code, rules, and deployment surfaces will be published when the abuse, operations, and contribution model are ready for public review.

Security issues should be reported through the project security policy instead of public issues when they could affect live users or service availability.
