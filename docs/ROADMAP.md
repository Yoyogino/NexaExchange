# Nexa Crypto Exchange — Master Roadmap

**Last reviewed:** 2026-09-06

**Current product:** Simulated BTC/USDT exchange deployed to staging
**Current validation:** CI verification passes (146 active checks, TypeScript validation, production web build, dependency audit, and Compose validation). Public staging is currently unavailable while deployment recovery is in progress.
**Safety boundary:** The application uses demo funds only. It must not accept deposits, process withdrawals, connect real wallets, custody keys, or move real assets.

## Status key

- ✅ Complete and validated locally
- 🟡 Built or documented, but still needs staging/external validation
- ⬜ Not started or requires an external decision/provider

## Executive status

The local simulated exchange is feature-complete for its present scope. Users can register, secure an account, trade simulated BTC/USDT, view balances and activity, and use real-time updates. Administrators can operate the simulated market and inspect activity. Financial mutations use a double-entry ledger and PostgreSQL transactions, and permanent financial/audit records are protected at both trigger and runtime-permission levels.

The simulated exchange was deployed to a controlled HTTPS staging environment, where Phase 5 advanced orders and their single-app failure cases were verified end-to-end. Transactional email works through Amazon SES with DKIM, bounce/complaint suppression, and SNS alerts; production sending remains blocked pending reconsideration of SES case `178864133300316`.

The staging deployment is presently in recovery. GitHub pull requests #5 through #8 are merged and the verification job passes, but deployment run #6 failed during the database migration. The preserved PostgreSQL data volume was successfully adopted, then the application failed authentication because its protected environment passwords no longer matched the existing `nexa_app` and `nexa_migrator` database roles. The failed rollback also removed the Compose network. On 2026-09-06, the public HTTPS endpoint refused connections, and the local AWS session had expired, preventing a fresh EC2/container check. No real funds are involved.

## Immediate next actions

1. Reauthenticate the `shopboostlabs` AWS CLI session and verify EC2, the self-hosted runner, containers, networks, volumes, and temporary SSH rules.
2. Synchronize the existing `nexa_app` and `nexa_migrator` PostgreSQL role passwords with `/home/ubuntu/.env.staging` without printing secrets, then restore app/proxy readiness using the preserved volume.
3. Capture and correct the migration failure, then harden rollback so a failed deployment cannot remove the working network or strand services.
4. Run a fresh `main` deployment and require verification, migration, readiness, public HTTPS, and authenticated smoke tests to pass.
5. Continue monitoring SES case `178864133300316`; do not submit duplicate requests.

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

### M. Advanced orders — ✅ Complete for single-app staging

- Stop-loss, take-profit, trailing-stop, and linked order-chain/OCO APIs are implemented.
- Advanced-order database tables and indexes are deployed to staging.
- The background monitor evaluates active advanced orders against the latest market price.
- A stop-loss was created through the authenticated API and remained `ACTIVE` before its trigger.
- A simulated trade at 45,000 USDT triggered a 50,000 USDT stop-loss.
- The monitor executed the resulting market order through the existing ledger-safe matching engine.
- The advanced order changed from `ACTIVE` to `FILLED`, recorded its trigger time, fill price, and filled order ID, and emitted an `advanced_order_triggered` event.
- A take-profit was created at 55,000 USDT and changed from `ACTIVE` to `FILLED` within one monitor cycle when a simulated 55,000 USDT bid became available.
- The take-profit recorded a 55,000 USDT fill price and a filled order ID through the normal ledger-safe matching path.
- A 10% trailing stop initialized at a 55,000 USDT high-water mark with a 49,500 USDT trigger.
- A simulated rise to 60,000 USDT ratcheted the trigger upward to 54,000 USDT and preserved both updates in trailing-stop history.
- A simulated fall to 53,000 USDT triggered the trailing stop, which changed from `ACTIVE` to `FILLED` and recorded the correct fill and linked order IDs.
- An OCO chain containing a 50,000 USDT stop-loss and 55,000 USDT take-profit was created with both legs `ACTIVE`.
- A simulated 55,000 USDT bid filled the take-profit, changed the chain to `COMPLETED`, recorded the triggering leg, and automatically changed the stop-loss sibling to `CANCELED`.
- Staging testing found and fixed a zero-liquidity defect that had incorrectly labeled an unfilled advanced order as `FILLED` with a null fill price.
- A triggered market order with no bids now leaves its ordinary order unfilled, marks the advanced order `FAILED`, records a structured `NO_LIQUIDITY` event, and never reports a fill price.
- When the failed leg belongs to an OCO chain, the chain and its valid sibling remain `ACTIVE`; no sibling is canceled without a real execution.
- An `ACTIVE` take-profit and its authenticated session survived an app-container restart; readiness returned and the restarted monitor subsequently filled the order at 56,000 USDT.
- Three take-profit orders became eligible in the same monitor cycle, filled exactly once at 57,000 USDT with three unique resulting order IDs, and consumed the matching 0.06 BTC bid without leaving book residue.
- Phase 5 is complete for the current single-app staging topology. Multi-instance monitor/duplicate-trigger behavior and broader PostgreSQL, Redis, and full-host recovery remain part of the scale and failure-injection milestone.

## What is left to do

### 1. Recover and stabilize the staging environment — 🟡 Active incident

1. ✅ AWS EC2 staging host, Elastic IP, DNS, HTTPS, Docker, Caddy, PostgreSQL, Redis, and the application were originally deployed and validated.
2. 🔴 Public staging is currently unavailable: `https://exchange-staging.shopboostlabs.com/api/health` refused connections on 2026-09-06.
   - On September 5, 2026, the staging DNS record was corrected from the EC2 private address to Elastic IP `34.200.205.235`.
   - Caddy was corrected to serve `exchange-staging.shopboostlabs.com` and successfully obtained a publicly trusted certificate.
   - Public HTTP redirects to HTTPS; `GET /api/health` returns `200 {"status":"ok"}` over verified TLS with the expected baseline security headers.
3. ✅ Advanced-order migrations and services are deployed.
4. ✅ Registration, authentication, simulated funding, matching, and stop-loss execution have been exercised on the host.
5. ✅ Protected GitHub `staging` deployment and self-hosted runner were configured; PRs #5–#8 are merged, and the current verification job passes.
6. ✅ The original PostgreSQL data volume was identified and preserved during Compose adoption.
7. 🔴 Deployment run #6 failed at migration; the replacement application then reported PostgreSQL password authentication failure for `nexa_app`.
8. 🟡 Reauthenticate AWS CLI, inspect the live host, synchronize database role passwords, restore the application, and verify public readiness.
9. 🟡 Update the workflow to start dependencies first, synchronize roles safely, run migrations with captured logs, and perform a non-destructive rollback.
10. Run a fresh deployment from `main` and retain the exact successful run link as evidence.
11. ✅ Restricted runtime database permissions were previously revalidated in production mode: `nexa_app` cannot create schema objects, owns no tables, cannot delete ledger accounts, and cannot update or delete ledger entries, trades, or audit events. It retains the narrow `UPDATE` privilege required for row locking, whose immutable trigger still blocks actual changes.
12. ✅ A previous staging smoke test covered 2FA, cancellation, administrator controls, HTTPS authentication, email verification, password reset, CSRF, sign-out, and session revocation. Repeat the critical smoke test after recovery.

**Exit condition:** The existing simulated staging deployment is reproducible and passes the complete readiness, security, and smoke-test checklist.

### 2. Validate staging security and integrations — 🟡 In progress

1. ✅ Verify secure-cookie, CSRF, proxy, and session rotation behavior over real HTTPS. Public TLS, HTTP-to-HTTPS redirection, HSTS, baseline response headers, `Secure`/`HttpOnly`/`SameSite=Strict` cookie flags, missing-CSRF rejection, sign-out, and post-logout revocation are verified. A forced live exercise confirmed that rotation issues a new token, the previous token works only during its grace period, the expired previous token is rejected, the new token remains valid, and logout revokes it.
2. ✅ Send verification and password-reset messages through the selected email provider. Amazon SES domain verification/DKIM are healthy, the EC2 role has generated `ses:SendEmail` permission, and the application templates passed end-to-end inbox tests. The `nexa-transactional` configuration set now routes bounce and complaint events to the confirmed `nexa-staging-alerts` SNS subscription, with account suppression enabled for both event types. SES production access was denied under case `178864133300316`; request reconsideration with this completed evidence.
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

### 4. Connect monitoring, alerts, and backups — 🟡 In progress

1. Connect the protected metrics endpoint to a monitoring service.
2. Configure alerts for readiness, errors, latency, database, Redis, memory, disk, and backup failures.
3. Schedule encrypted off-machine backups.
4. Perform and document a staging restore drill.
5. Define recovery-time and recovery-point objectives.
6. Write incident-response and rollback runbooks.

Completed evidence:

- ✅ The `nexa-staging-alerts` SNS email subscription is confirmed.
- ✅ Amazon SES bounce and complaint events are routed through the `nexa-transactional` configuration set to that SNS topic.
- ✅ SES account-level suppression is enabled for both `BOUNCE` and `COMPLAINT`.

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

1. **Recover staging without replacing or deleting the preserved PostgreSQL data volume.**
2. **Make CI/CD deployment and rollback reproducible, then prove a clean deployment from `main`.**
3. **Revalidate HTTPS, email, sessions, runtime database permissions, and the complete smoke test.**
4. **Run multi-instance load, duplicate-trigger, concurrency, restart, and failure tests.**
5. **Collect monitoring evidence and complete an encrypted backup restore drill.**
6. **Complete independent security, accessibility, and Canadian legal reviews.**
7. **Select custody/key-management and regulatory operating partners before any real-money work.**

## Production decision gate

The application remains a simulator until every applicable legal, compliance, custody, payments, operational, and independent-security requirement has been completed and formally approved. Passing the local automated tests does not make it safe or lawful to operate with real customer assets.
