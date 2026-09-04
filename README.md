# Crypto Exchange Demo

A centralized-exchange learning project built around **simulated balances only**. The first release will let authenticated users trade BTC/USDT in a realistic order book without connecting wallets, accepting deposits, or handling real money.

## Current scope

- Demo BTC and USDT wallets
- Secure user accounts
- BTC/USDT limit and market orders
- Order matching, partial fills, cancellations, and trade history
- Real-time order-book and market updates
- Administrative audit trail

## Not in the first release

- Real cryptocurrency custody or wallet connections
- Fiat deposits or withdrawals
- Real-money trading
- KYC/AML onboarding or payment processing

Those capabilities require jurisdiction-specific legal, compliance, custody, and security work before implementation.

## Project plan

The detailed first-release requirements and build roadmap live in [docs/PRODUCT_REQUIREMENTS.md](docs/PRODUCT_REQUIREMENTS.md).

## Current technology

- **Web app:** React, TypeScript, and Vite
- **Application services:** Node.js, Express, and JavaScript modules
- **Database:** PostgreSQL
- **Fast data / events:** Redis (available locally; not yet used by the API)
- **Testing:** Node's built-in test runner, PostgreSQL integration tests

## Current delivery status

The local demo supports registration and sign-in, simulated BTC/USDT balances, ledger-backed orders, price-time-priority matching, a trading dashboard, and protected administrator controls. See [the current game plan](docs/ROADMAP.md) for completed work, outstanding work, and the production decision gate.

## Local operations

Startup, health checks, backups, and a safe restore drill are documented in [docs/OPERATIONS.md](docs/OPERATIONS.md).
