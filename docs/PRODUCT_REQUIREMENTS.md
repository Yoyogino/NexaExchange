# Product requirements: Crypto Exchange Demo (v0.2)

## 1. Purpose

Build a safe, educational prototype of a centralized crypto exchange. It should model the mechanics of exchange trading while using only fictional balances. No customer assets, private keys, or payment details will be collected or stored.

**Implementation note (2026-09-02):** the prototype now includes accounts, a double-entry ledger, matching, a trading dashboard, and administrator controls. The live status and remaining build plan are in [ROADMAP.md](ROADMAP.md).

## 2. Product boundaries

### In scope

- Individual user accounts
- Email/password login; two-factor authentication remains future work
- Demo balances for BTC and USDT
- One market: BTC/USDT
- Limit and market orders
- Price-time-priority order matching
- Partial fills, order cancellation, zero-fee trades, and trade history
- Polled ticker, trades, and order-book updates
- Admin audit views

### Explicitly out of scope

- Real deposits, withdrawals, blockchain interaction, or private-key custody
- Fiat payments, card processing, or banking connections
- KYC/AML collection and identity verification
- Margin, lending, staking, derivatives, or copy trading
- Mobile native apps

## 3. Users and permissions

| Role | Capabilities |
| --- | --- |
| Visitor | View public market data and create an account. |
| Trader | Receive demo funds; place, cancel, and review orders; view balances and history. |
| Administrator | View user, market, system, and audit data. No silent balance edits. |

## 4. Functional requirements

### Authentication

- A user can register, sign in, and sign out.
- Passwords are stored only as strong hashes.
- Sessions are demo-only in-memory bearer tokens; expiry/revocation remains future work.
- Email verification, password reset, two-factor authentication, and login rate limits remain future work.

### Demo wallets and ledger

- New users receive a clearly labelled configurable demo balance.
- Each movement is posted as balanced accounting entries; balances are derived from the ledger.
- Funds committed to open sell orders or buy orders are locked separately from available funds.
- Every entry records the reason, actor, time, and related entity (such as order or trade).
- Balance adjustments require an explicit administrative action and permanent audit record.

### Trading

- The BTC/USDT market publishes price and quantity. Minimum trade size and non-zero fee settings remain future work.
- Users can submit market or limit buy/sell orders.
- The matching engine applies price-time priority.
- Orders may fill partially and remain open for their unfilled quantity.
- Users can cancel open orders; only remaining funds are released.
- A completed match creates a trade record and associated ledger postings atomically.

### Market data

- Display best bid, best ask, last price, 24-hour volume, recent trades, and order-book depth.
- Refresh market data through short-interval polling. Push updates and charts remain future work.

### Administration and audit

- Administrators can inspect accounts, orders, trades, and audit events. System health monitoring remains future work.
- All admin actions are attributed to a user and cannot be edited or deleted from the interface.
- The system supports pausing a market or disabling trading for a user.

## 5. Key rules

1. No order may spend more than its available balance.
2. Each trade must debit and credit equal value in the ledger.
3. A trade, its order updates, and its ledger postings must succeed or fail together.
4. Matching results must be deterministic from the order sequence.
5. Decimal monetary quantities must never use JavaScript floating-point arithmetic.
6. Demo balances and every screen that shows them must be visibly marked as simulated.

## 6. Quality and security requirements

- Use TypeScript for the web app; server modules currently use JavaScript.
- Validate every request at the server boundary.
- Enforce authorization server-side, not only in the user interface.
- Apply rate limiting to login, order placement, and password-reset flows before any shared or public deployment.
- Keep secrets outside source control and provide an `.env.example` file.
- Maintain unit tests for ledger and matching-engine invariants.
- Add end-to-end tests for registration, funding, placing an order, matching, and cancellation.
- Provide structured logs, health checks, error reporting, backups, and restore verification before deployment.

## 7. Data model (initial)

| Entity | Purpose |
| --- | --- |
| User | Account identity and role. |
| Session | Authenticated access and revocation. |
| Market | BTC/USDT trading configuration. |
| Order | Submitted trade request and current execution status. |
| Trade | A matched buyer/seller execution. |
| LedgerAccount | Available, locked, fee, and system accounting accounts. |
| LedgerEntry | Immutable debit/credit record. |
| AuditEvent | Security- and admin-relevant event record. |

## 8. Delivery milestones

### Milestone A — foundation

- Create the Next.js/TypeScript workspace.
- Configure formatting, linting, test runner, environment handling, and CI.
- Bring up PostgreSQL and Redis locally.

### Milestone B — accounts and ledger

- Implement registration, sessions, roles, and demo funding.
- Implement ledger accounts, postings, available/locked balances, and audit events.
- Test balance and accounting invariants.

### Milestone C — matching engine

- Implement market configuration, order validation, matching, partial fills, and cancellation.
- Commit trade, order, and ledger changes transactionally.
- Thoroughly test price-time priority and insufficient-funds cases.

### Milestone D — exchange interface

- Build wallet, market, trading, history, and settings pages.
- Add live updates and a clear demo-mode indicator.

### Milestone E — operations and release

- Build protected admin pages, logs, monitoring, backups, and a staging deployment.
- Complete security review and usability testing.

## 9. Production decision gate

Do not add real-wallet or real-money features until legal/compliance counsel, custody architecture, key-management controls, financial controls, incident response, and an independent security audit are in place.
