# Security Policy

## Reporting Vulnerabilities

Please report security issues privately instead of opening a public issue.

Email: security@glyphteck.com

Include the affected surface, reproduction steps, expected impact, and any relevant logs or screenshots. Do not include live private keys, seed material, wallet secrets, passkeys, authentication tokens, or other user secrets in the report.

## Scope

In scope:

- Veyl web, iOS, and shared client code in this repo
- Firebase Functions, Firestore rules, Storage rules, and backend routing code in this repo
- Authentication, vault, encrypted chat, upload, reporting, moderation, push, wallet, and bot flows
- Abuse paths that could materially increase Glyphteck infrastructure cost

Out of scope:

- Social engineering, phishing, or physical attacks
- Denial-of-service reports without a specific, reproducible product weakness
- Issues in third-party services unless they create a concrete Veyl exploit path
- Automated scanner reports without a tested impact

## Public Firebase Config

`shared/firebaseconfig.js` contains Firebase client configuration used by the web and iOS clients. These values identify the Firebase project and are intentionally public client inputs, not server credentials.

Do not treat the Firebase client API key or web App Check site key as authorization. Backend access is controlled by Firebase Security Rules, App Check where enabled, callable authentication, upload reservations, quotas, and server-side validation.

Do not add server secrets, service account JSON, FCM server keys, APNS private keys, wallet seeds, bot seeds, or production credentials to this repo.
