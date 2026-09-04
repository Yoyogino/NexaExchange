# Nexa Crypto Exchange — Master Roadmap

**Last reviewed:** 2026-09-03  
**Current product:** Local simulated BTC/USDT exchange  
**Current validation:** 146 automated checks, TypeScript validation, and production web build passing  
**Safety boundary:** The application uses demo funds only. It must not accept deposits, process withdrawals, connect real wallets, custody keys, or move real assets.

## Status key

- ✅ Complete and validated locally
- 🟡 Built or documented, but still needs staging/external validation
- ⬜ Not started or requires an external decision/provider

## Executive status

The local simulated exchange is feature-complete for its present scope. Users can register, secure an account, trade simulated BTC/USDT, view balances and activity, and use real-time updates. Administrators can operate the simulated market and inspect activity. Financial mutations use a double-entry ledger and PostgreSQL transactions, and permanent financial/audit records are protected at both trigger and runtime-permission levels.

The next engineering milestone is not another local feature. It is a controlled **staging deployment**, followed by operational validation and independent review. A real-money launch is a separate program with substantial legal, compliance, custody, payments, security, and operational requirements.

## Roadmap from the beginning

### A. Product definition and safety boundary — ✅ Complete

- Defined the first release as a simulated BTC/USDT exchange.
- Separated demo balances from real assets.
- Documented product requirements, threat model, operations, staging, email, sessions, and backup procedures.
- Added a production decision gate prohibiting real wallets or customer assets before formal approval.

### B. Local development foundation — ✅ Complete

- Installed and configured Node.js, Docker Desktop, WSL 2, PostgreSQL, and Redis.
- Created a React, TypeScript, and Vite frontend.
- Created the Node/Express API.
- Added Docker Compose for local PostgreSQL and Redis.
- Added environment templates and one-command local startup.
- Added TypeScript checks and production builds.

### C. Accounts and simulated balances — ✅ Complete

- Account registration, sign-in, and sign-out.
- Secure asynchronous password hashing and verification.
- Simulated BTC and USDT funding with one-time claim protection.
- Available and locked wallet balances derived from ledger entries.
- No editable balance column is used as a source of truth.

### D. Double-entry ledger — ✅ Complete

- Balanced debit/credit posting groups using fixed-point, eight-decimal arithmetic.
- Atomic balance locking, unlocking, funding, settlement, fees, and administrator adjustments.
- PostgreSQL row locking prevents concurrent double spending.
- Ledger account creation is race-safe.
- Account/asset/type relationships are validated.
- User balance accounts cannot go negative.
- Ledger entries and account identities are append-only.
- Runtime staging credentials cannot update or delete ledger entries or accounts.

### E. Matching engine — ✅ Complete for the simulated market

- BTC/USDT limit and market orders.
- Price-time priority and partial fills.
- Maker-price execution and price-improvement refunds.
- Order cancellation and exact release of remaining locked funds.
- Self-trade prevention.
- Minimum size, maximum quantity/price/notional, and 100-open-order limits.
- Payload-bound idempotency keys prevent duplicated submissions.
- Cross-process locking prevents multiple API instances from consuming the same liquidity.
- Atomic order, trade, fee, and ledger settlement.
- Database constraints enforce valid order progress, price/type combinations, lock state, and trade values.
- Trade references must point to the correct buy/sell orders in the same market.
- Executed trades are append-only.

### F. Trading fees — ✅ Complete

- 0.10% maker fee and 0.20% taker fee.
- Fees are charged in the asset received.
- Fees post to dedicated fee ledger accounts in the trade transaction.
- Correct rounding for odd quantities and partial/multiple fills.
- Fee values are visible in user and administrator trade history.

### G. User trading interface — ✅ Complete for the demo

- Responsive BTC/USDT dashboard.
- Available and locked wallet balances.
- Buy/sell and limit/market order controls.
- Order book, open orders, cancellation, and trade history.
- Recent-market-activity chart and notifications.
- Server-sent live updates with polling fallback.
- Clear simulated-funds disclosure.
- Accessible table names, form errors, focus states, one-time-code hints, and responsive tables.
- Demo Terms and Privacy pages.

### H. Account and login security — ✅ Complete locally

- HttpOnly, SameSite session cookies and CSRF protection.
- Hashed, expiring, revocable database sessions.
- Thirty-minute idle timeout.
- Atomic session-token rotation every five minutes with a thirty-second grace period.
- Session listing and remote-session revocation.
- Email verification and password reset that revokes existing sessions.
- Authenticator two-factor authentication and single-use recovery codes.
- TOTP replay prevention and login history.
- Redis-backed IP/account rate limits with safe failure behavior.
- HMAC protection for low-entropy one-time codes.
- Encrypted authenticator secrets.
- Atomic one-time-code issuance and audit recording.
- SendGrid, AWS SES, and generic email-provider adapters.

### I. Administrator operations — ✅ Complete for the demo

- Role-protected administrator panel and command-line promotion tool.
- System/database/cache/request health view.
- Market pause and resume.
- Per-user trading disable and enable.
- Ledger-backed balance adjustments with insufficient-funds protection.
- Paginated users, orders, trades, and audit history.
- Order filters and accessible administrator controls.
- Permanent audit history protected from updates and deletion.

### J. Real-time data and multi-instance behavior — ✅ Complete locally

- Public market and targeted account server-sent events.
- Redis-backed event fan-out across API instances.
- Reconnect and slow-polling fallback behavior.
- Bounded, simulated-only load-test tool.
- Cross-instance matching/concurrency integration tests.

### K. Reliability and operational tooling — 🟡 Prepared; staging validation remains

- Health and readiness endpoints.
- Request, error, latency, dependency, process, and session metrics.
- Protected metrics export and administrator health display.
- Structured request and exception logs.
- Graceful shutdown and retention cleanup.
- Authentication-query indexes and expired-code cleanup.
- PostgreSQL backup, encrypted backup, restore, and tamper tests.
- Production container and HTTPS reverse-proxy configuration.
- Separate database owner, migration, and restricted runtime roles.
- Runtime write restrictions for permanent financial and audit tables.
- CI checks for tests, build, dependency audit, container validation, and staging configuration.
- Manual, protected, serialized staging deployment workflow.

### L. Automated quality and security checks — ✅ Complete locally

- 146 automated checks.
- Isolated PostgreSQL test schema with safeguards against touching the development database.
- Financial invariants, concurrency, matching, fees, authentication, sessions, administration, accessibility, backups, monitoring, email providers, and deployment configuration are covered.
- TypeScript validation and production web builds pass.
- Internal threat model and automated dependency/container security gates are present.

## What is left to do

### 1. Create and deploy the staging environment — ⬜ Next milestone

1. Choose a staging host and domain that will never handle real funds.
2. Configure DNS and HTTPS.
3. Create the protected GitHub `staging` environment.
4. Add staging host, SSH, database, encryption, email, and monitoring secrets.
5. Run the prepared staging deployment workflow.
6. Confirm database migrations and restricted runtime permissions.
7. Run a smoke test covering registration, verification, 2FA, funding, orders, fills, cancellation, admin controls, and sign-out.

**Exit condition:** A reproducible simulated staging deployment is reachable over HTTPS and passes its readiness and smoke checks.

### 2. Validate staging security and integrations — ⬜

1. Verify secure-cookie, CSRF, proxy, and session rotation behavior over real HTTPS.
2. Send verification and password-reset messages through the selected email provider.
3. Confirm secrets never appear in logs, images, artifacts, or client responses.
4. Run dependency and container scans on the deployed release.
5. Verify the API runtime role cannot change permanent financial/audit records.
6. Exercise account and IP rate limits from multiple clients.

**Exit condition:** All staging security checks pass with saved evidence and no unresolved high-severity findings.

### 3. Validate scale and failure behavior — ⬜

1. Run the prepared load/reconnect test against multiple API instances.
2. Record accepted latency, reconnect, and error-rate thresholds.
3. Restart API, Redis, and PostgreSQL components separately and record recovery behavior.
4. Test concurrent ordering, cancellation, session rotation, and administrator actions in staging.
5. Confirm the ledger invariant after every failure test.

**Exit condition:** Agreed performance thresholds are met and injected failures do not corrupt orders, trades, or balances.

### 4. Connect monitoring, alerts, and backups — ⬜

1. Connect the protected metrics endpoint to a monitoring service.
2. Configure alerts for readiness, errors, latency, database, Redis, memory, disk, and backup failures.
3. Schedule encrypted off-machine backups.
4. Perform and document a staging restore drill.
5. Define recovery-time and recovery-point objectives.
6. Write incident-response and rollback runbooks.

**Exit condition:** Alerts are proven to arrive, backups restore successfully, and recovery ownership is documented.

### 5. Independent reviews and product polish — ⬜

1. Commission an independent security architecture review and penetration test.
2. Remediate findings and obtain a remediation review.
3. Perform formal keyboard, screen-reader, zoom, contrast, and mobile accessibility testing.
4. Have qualified counsel replace/review the demo Terms and Privacy templates.
5. Complete a multi-user acceptance test and administrator-operations walkthrough.

**Exit condition:** No unresolved critical/high security findings; accessibility and legal sign-offs are recorded for the intended demo release.

### 6. Decide the product direction — ⬜ Owner decision

Before expanding the demo, decide:

- Intended countries/jurisdictions and excluded locations.
- Whether the product remains a simulator or pursues real-money operation.
- Custodial versus non-custodial model.
- Crypto-only versus crypto/fiat scope.
- Supported assets and markets.
- Fee and revenue model.
- Customer type, support model, and expected volume.
- Build-versus-buy choices for identity, custody, blockchain, surveillance, and payments.

These choices materially change the legal obligations and system architecture. Do not build real deposit/withdrawal features until they are resolved.

### 7. Real-money production program — ⬜ Not authorized or started

If a real exchange is pursued, this becomes a separate production program requiring at minimum:

1. Qualified legal and regulatory analysis for every intended jurisdiction.
2. Required registrations, licences, policies, disclosures, and regulatory reporting.
3. KYC/KYB, AML, sanctions, fraud, transaction monitoring, case management, and market surveillance.
4. Institution-grade custody/key management, wallet architecture, address screening, confirmations, reconciliation, hot/cold controls, and withdrawal approvals.
5. Fiat banking/payment partners and reconciliation if fiat is supported.
6. Production-grade ledger governance, segregation, daily reconciliation, approvals, and financial reporting.
7. High availability, disaster recovery, incident response, security operations, vulnerability management, and change control.
8. Customer support, disputes, complaints, account recovery, privacy requests, and retention processes.
9. Independent security, financial-control, compliance, and penetration audits.
10. Formal launch approval by legal, compliance, security, operations, finance, and executive owners.

## Recommended execution order

1. **Deploy simulated staging.**
2. **Validate HTTPS, email, sessions, and runtime database permissions.**
3. **Run multi-instance load and failure tests.**
4. **Connect monitoring and prove encrypted backup restoration.**
5. **Complete independent security, accessibility, and legal reviews.**
6. **Decide whether to stop at a polished simulator or fund a separate regulated production program.**

## Production decision gate

The application remains a simulator until every applicable legal, compliance, custody, payments, operational, and independent-security requirement has been completed and formally approved. Passing the local automated tests does not make it safe or lawful to operate with real customer assets.
