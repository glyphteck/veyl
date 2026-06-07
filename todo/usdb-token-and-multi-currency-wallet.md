# USDB Token And Multi-Currency Wallet

status: planned
branch: current
worktree: current
base: main@004b67abe2e1
repo version: 0.14.4

- Add first-class USDB token support alongside BTC.
- Treat USDB as just as central as Bitcoin in the balance model and wallet dashboard, not as a secondary add-on.
- Reassess wallet UX and dashboard layout for two primary currencies.
- Align the wallet UI with the logo direction: titanium wallet, two frosted-glass currency icons, active green for USDB and Bitcoin orange for BTC.
- Support mainnet USDB token `btkn1xgrvjwey5ngcagvap2dzzvsy4uk8ua9x69k82dwvt5e7ef9drm9qztux87`.
- Track the mainnet USDB token contract: https://sparkscan.io/token/3206c93b24a4d18ea19d0a9a213204af2c7e74a6d16c7535cc5d33eca4ad1eca?network=mainnet
- On regtest, issue a local test token named `veyl usdb` with ticker `$USDB` so USDB flows can be tested easily.
- Current wallet boot intentionally disables Spark token-output sync in `shared/vault.js` while the app remains BTC-only. Re-enable token sync deliberately as part of this task, with matching balance, dashboard, transfer, review, and cost docs.
