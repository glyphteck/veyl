# Firebase base costs

Prices were checked against official Firebase/Google docs on 2026-06-10.

Sources:

- Firebase pricing: https://firebase.google.com/pricing
- Firestore pricing and billing behavior: https://firebase.google.com/docs/firestore/pricing
- Firestore location pricing: https://cloud.google.com/firestore/pricing
- Cloud Run pricing: https://cloud.google.com/run/pricing
- Cloud Storage pricing: https://cloud.google.com/storage/pricing

## Unit costs used

This model uses conservative Firestore multi-region-style rates. If Veyl's Firestore database is regional `us-central1`, Firestore reads/writes/deletes are about half these rates.

| Unit | Cost used in model |
| --- | ---: |
| Firestore document read | $0.06 / 100,000 = `$0.0000006` |
| Firestore document write | $0.18 / 100,000 = `$0.0000018` |
| Firestore document delete | $0.02 / 100,000 = `$0.0000002` |
| Firestore stored data | `nam5` example `$0.18 / GiB-month` |
| Cloud Functions invocation | $0.40 / 1,000,000 = `$0.0000004` after free tier |
| Cloud Storage stored data | current chat-media bucket is regional `US-CENTRAL1`; Standard storage is about `$0.020 / GiB-month` |
| Cloud Storage Class A op | Standard regional `$0.005 / 1,000` = `$0.000005` |
| Cloud Storage Class B op | Standard `$0.0004 / 1,000` = `$0.0000004` |
| Cloud Storage delete op | free |

Current project locations checked on 2026-05-29:

- Firestore database: `nam5`.
- Firebase Storage bucket: `glyphteck.firebasestorage.app`, regional `US-CENTRAL1`, storage class `REGIONAL`.

## Free quotas applied in README.md

| Product | Free quota applied |
| --- | ---: |
| Firestore reads | 50,000/day |
| Firestore writes | 20,000/day |
| Firestore deletes | 20,000/day |
| Cloud Functions invocations | 2,000,000/month |

Storage operation free quotas are not applied because Firebase Storage bucket billing depends on project/bucket setup and location. The model counts Storage operations at paid unit cost, includes stored bytes from the default avatar/media assumptions, and leaves downloaded bytes separate.

## Auth

Veyl uses Firebase Auth as the current Firestore/Storage auth adapter, but Firebase Auth is not a modeled cost in these totals.

## Important billing caveats

- Firestore queries have a minimum charge of one document read even when no documents match.
- Firestore Security Rules `get()`, `exists()`, and `getAfter()` calls from client SDK requests are billed as document reads.
- Function invocation cost is not the full function cost; Cloud Run CPU, memory, and outbound network require runtime metrics.
- Firestore index-entry reads are not included; use Query Explain for high-volume queries.
