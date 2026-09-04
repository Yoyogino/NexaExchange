# Threat model

**Scope:** Nexa Exchange simulated BTC/USDT demo. This assessment does not authorize real assets, custody, deposits, or withdrawals.

## Assets to protect

- Password hashes, session tokens, CSRF tokens, authenticator secrets, recovery codes, and email reset codes
- Simulated wallet balances, locked funds, orders, trades, fees, and ledger invariants
- Administrator controls, audit events, encryption keys, backups, and monitoring credentials
- Service availability and the integrity of PostgreSQL and Redis

## Trust boundaries

1. Browser to HTTPS reverse proxy
2. Reverse proxy to the Node API
3. API to PostgreSQL and Redis on the private network
4. API to the transactional-email provider
5. Operator to admin panel and deployment host
6. Backup host to off-machine encrypted storage
7. Source repository to CI runner and container registry

## Addressed threats

| Threat | Current mitigation |
| --- | --- |
| Password and code brute force | Redis fail-safe throttles by both source IP and normalized account identity; passwords use scrypt; low-entropy verification, reset, and recovery codes use secret-keyed HMAC hashes; short-lived codes expire. |
| Session theft and CSRF | HttpOnly, Secure production, SameSite=Strict cookies; double-submit CSRF checks; revocable stored sessions; absolute and idle expiry; no user bearer-token fallback. |
| Admin privilege misuse | Server-side role checks, ledger-backed balance adjustments, market/trading controls, and audit events. |
| Ledger corruption or overspending | Fixed-precision arithmetic, database transactions, locked balances, double-entry postings, and invariant tests. |
| 2FA secret disclosure | AES-256-GCM encryption at rest with a separately supplied production key; one-time hashed recovery codes. |
| Email account enumeration | Generic production reset responses; local demo codes remain intentionally visible only in development. |
| Clickjacking and browser injection | Restrictive CSP, frame denial, MIME-sniffing protection, referrer and permissions policies, and production HSTS. |
| Dependency or container vulnerabilities | Locked installs, production dependency audit, automated updates, and high/critical container scanning in CI. |
| Backup theft or tampering | AES-256-GCM encrypted backups, separate key requirement, authenticated tamper rejection, retention, and off-machine-copy support. |
| Monitoring information disclosure | Dedicated constant-time token check; unauthorized metrics requests return 404; metrics contain no user identifiers. |
| Session-statistics disclosure | Public health endpoints expose only minimal status; detailed rotation statistics require an administrator session. |
| Secret or personal-data logging | Request bodies and headers are never logged; email failures use a truncated recipient hash and generic error type, and provider response bodies are discarded. |

## Remaining risks before any shared release

- Independent penetration testing and authorization review have not occurred.
- Session rotation is implemented with atomic replacement and a short concurrency grace window; independent review and staging validation remain required.
- Staging email, HTTPS, monitoring delivery, backup scheduling, and restore drills must be exercised on the actual host.
- Staging separates owner, migration, and runtime roles; validate the grants on the deployed database and keep migration credentials unavailable to the running API.
- CI actions should ultimately be pinned to reviewed commit hashes under the organization security policy.
- Denial-of-service protection still depends on the reverse proxy and hosting provider in addition to application throttles.
- Terms and privacy pages are templates and require qualified legal review.
- Real-asset operation would additionally require jurisdiction-specific licensing, KYC/AML and sanctions controls, custody/key management, banking arrangements, incident response, and an independent financial-controls audit.

## Review triggers

Repeat the threat model when adding an asset, market, external API, payment or wallet integration, staff role, deployment region, authentication method, or material infrastructure change.
