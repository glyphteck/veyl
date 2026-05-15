# Security And Crypto Audit

- Hard review wallet export behavior across web, iOS, shared, and functions.
- Hard review account creation and the one-master-seed source of truth.
- Decide whether the current seed model can support future wallet imports, multi-wallets, and account evolution without breaking launched wallets.
- Verify no secret ever leaks to backend systems or anywhere outside the client except intentionally stored encrypted material.
- Treat the client as the only allowed secret-access attack surface. If another surface can access live secrets, fix the architecture.
- Audit lifetime of all seeds and dangerous secrets across app runtime states:
  - [ ] device plus vault unlocked
  - [ ] app open but vault locked
  - [ ] iOS device unlocked while app is backgrounded with the vault unlocked
  - [ ] browser shutdown while vault unlocked
  - [ ] app shutdown while vault unlocked
  - [ ] forced app kill or device shutdown while vault unlocked
- Determine where garbage collection is enough and where explicit zeroing or state teardown is needed.
