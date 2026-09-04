# Session Token Rotation

**Status:** Phase G.2 - Security Baseline  
**Security Level:** High  
**Implementation Date:** 2026-09-02

---

## Overview

Session token rotation is a critical security practice that limits the window of exposure when a session token is compromised. Instead of using a single static token for the lifetime of a session, tokens are automatically rotated (replaced) at regular intervals.

### Security Benefits

1. **Limited Exposure Window** - If a token leaks, an attacker can only use it for ~5 minutes (default rotation interval)
2. **Replay Attack Mitigation** - Old tokens expire automatically, making replayed tokens useless
3. **Compliance** - Required by OWASP and security standards for production systems
4. **Reduced Theft Impact** - Stolen tokens from logs or caches have limited utility

---

## How It Works

### Token Lifecycle

```
1. User logs in
   └─> New token created (current_token)

2. User makes requests
   └─> Token validated every request
   └─> Every 5 minutes: token rotation triggered

3. Token Rotation Event
   ├─> New token generated (new_current)
   ├─> Old token marked as previous_token
   └─> Previous token remains valid for 30 seconds (grace period)

4. Grace Period (30 seconds)
   ├─> Both current and previous tokens accepted
   └─> Handles race conditions in concurrent requests

5. Grace Period Expires
   ├─> Previous token hash cleared from database
   └─> Only current token valid
```

### Rotation Trigger

Tokens rotate when BOTH conditions are met:
- User has been active (any request) in the last 30 minutes
- Last rotation was > 5 minutes ago (configurable)

### Grace Period

After rotation, the old token remains valid for 30 seconds to handle:
- Race conditions in rapid concurrent requests
- Browser tab updates with stale cookies
- Load balancer timing skew

After 30 seconds, only the new token is valid.

---

## Implementation Details

### Database Schema

Added to `sessions` table:

```sql
-- Current token (primary, always indexed)
token_hash TEXT UNIQUE NOT NULL

-- Previous token (during grace period only)
previous_token_hash TEXT
previous_token_expires_at TIMESTAMPTZ

-- Rotation tracking
rotated_at TIMESTAMPTZ
```

### API Changes

Session authentication middleware now:

1. **Check current token** - Primary authentication
2. **Check previous token** - Grace period fallback
3. **Update last_seen_at** - Track session activity
4. **Rotate token if due** - Issue new token in response

### Response Headers

New token issued in HTTP header on successful rotation:

```
X-Session-Token: <new-token-uuid>
```

Client should update the session cookie with the new token.

---

## Configuration

### Environment Variables

```bash
# Rotation interval (minutes between rotations)
SESSION_ROTATION_INTERVAL_MINUTES=5

# Grace period (seconds old token remains valid)
SESSION_GRACE_PERIOD_SECONDS=30

# Session idle timeout (minutes before session expires)
SESSION_IDLE_MINUTES=30
```

### Defaults

```javascript
const ROTATION_INTERVAL_MINUTES = 5;      // Rotate every 5 minutes
const TOKEN_GRACE_PERIOD_SECONDS = 30;    // 30-second grace period
const SESSION_IDLE_MINUTES = 30;          // Session expires after 30 minutes
```

---

## API Usage

### Server-Side Integration

```javascript
import { 
  touchSessionWithRotation,
  authenticateSessionToken,
  cleanupExpiredTokens
} from "./session-rotation.mjs";

// In session authentication middleware:
const auth = await authenticateSessionToken(pool, suppliedToken);
if (!auth) return res.status(401).json({ error: "Invalid session" });

// Touch session and check for rotation
const result = await touchSessionWithRotation(
  pool, 
  auth.sessionId,
  5,  // rotation interval minutes
  true // enable rotation
);

// If token was rotated, send new token to client
if (result.newToken) {
  res.set("X-Session-Token", result.newToken);
}

// Clean up expired tokens (run periodically, e.g., every minute)
await cleanupExpiredTokens(pool);
```

### Client-Side Integration

```javascript
// After successful request with X-Session-Token header:
const newToken = response.headers.get("X-Session-Token");
if (newToken) {
  // Update session cookie with new token
  document.cookie = `session=${newToken}; HttpOnly; SameSite=Strict; Secure`;
}
```

---

## Security Considerations

### Token Storage

- **Server:** Hash stored in database (SHA-256)
- **Client:** Plain token in HttpOnly cookie (never in localStorage)
- **Transport:** HTTPS only in production

### Timing Attacks

Token hash comparison uses **constant-time comparison** to prevent timing attacks:

```javascript
// Secure (constant-time)
crypto.timingSafeEqual(hash1, hash2);

// Vulnerable (variable-time)
hash1 === hash2;
```

### Concurrency Handling

Grace period (30 seconds) handles:

```
Request 1 (Tab 1) ──────────────────┐
                                     ├─→ Rotation triggered
Request 2 (Tab 2) ──────────────────┘    Both tokens valid
                                         during grace period

Request 3 (Tab 1) ──────────────────┐    Uses new token
                                     ├─→ No additional rotation
Request 4 (Tab 2) ──────────────────┘    (just rotated)
```

---

## Testing

### Run Rotation Tests

```bash
npm test tests/session-rotation.test.mjs
```

### Test Coverage

- ✅ Token generation and hashing
- ✅ Current token authentication
- ✅ Previous token validation during grace period
- ✅ Previous token expiration after grace period
- ✅ Concurrent request handling
- ✅ Token rotation scheduling
- ✅ Session idle timeout
- ✅ Cleanup of expired tokens
- ✅ Rotation statistics

---

## Monitoring

### Health Checks

Monitor rotation effectiveness:

```javascript
const stats = await getRotationStats(pool);
// {
//   total_sessions: 42,
//   sessions_in_grace_period: 3,    // Should be small
//   rotated_last_hour: 156          // Steady over time
// }
```

### Alerts

Set up alerts for:

- Large number of sessions in grace period (> 10% of total)
- Failed rotation attempts (database errors)
- High rate of old token rejections (possible attack)

### Logging

All rotation events logged for audit:

```json
{
  "event": "session_token_rotated",
  "session_id": "uuid",
  "user_id": "uuid",
  "timestamp": "2026-09-02T21:40:00Z"
}
```

---

## Troubleshooting

### "Session token expired"

Possible causes:
- Token beyond 30-second grace period
- Session expired (idle > 30 minutes)
- Token revoked (logout or admin revocation)

**Solution:** Re-authenticate (log in again)

### Multiple failed auth attempts

Could indicate:
- Client not updating token on rotation
- Stale token cookie in browser
- Race condition in load-balanced setup

**Solution:**
1. Check X-Session-Token header handling
2. Verify cookie is being updated
3. Review network timing logs

### Grace period too short

If you see frequent "token expired" errors:

1. Increase `TOKEN_GRACE_PERIOD_SECONDS` (e.g., 60 seconds)
2. Review network latency
3. Check for synchronization issues in load balanced setup

### Grace period too long

If you want tighter security, decrease grace period:

1. Reduce `TOKEN_GRACE_PERIOD_SECONDS` (but not below 10)
2. Monitor error rates
3. Adjust based on network conditions

---

## Production Deployment Checklist

- [ ] All rotation columns added to sessions table
- [ ] Indexes created for performance
- [ ] Session auth middleware updated to support rotation
- [ ] Client code updated to handle X-Session-Token header
- [ ] Cleanup task scheduled (every minute)
- [ ] Monitoring and alerts configured
- [ ] Error logging set up
- [ ] Load testing completed
- [ ] Graceful fallback for old clients (no rotation support)
- [ ] Documentation updated for operations team

---

## Performance Impact

### Database

- **Index Added:** `sessions_grace_period_idx` - Minimal overhead
- **Cleanup Query:** Runs every minute, removes expired previous tokens
- **Queries:** Token lookup now checks 2 hashes instead of 1 (negligible)

### Network

- **New Header:** `X-Session-Token` added to responses (~36 bytes per rotation)
- **Frequency:** One new header per 5 minutes per session

### CPU

- **Hash Computation:** SHA-256 on every request (negligible, already happening)
- **Cleanup:** Background task with low priority

---

## Backward Compatibility

Old sessions without rotation columns work fine:

```javascript
// Graceful handling
if (!previous_token_hash) {
  // Token not rotated yet, just use current token
  return authenticateWithCurrentToken(pool, token);
}
```

---

## Related Security Features

Session token rotation complements:

- **Session Idle Timeout:** Expires old sessions automatically
- **CSRF Protection:** Prevents unauthorized actions
- **Rate Limiting:** Prevents brute force attacks
- **Secure Cookies:** HttpOnly, SameSite, Secure flags
- **HTTPS Enforcement:** Transport security

Together, these create a comprehensive session security model.
