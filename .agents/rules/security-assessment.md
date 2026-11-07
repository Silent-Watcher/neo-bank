# Security Assessment Rule for AI Agents

**Status:** Permanent (applies to all future work)
**Date:** 2026-11-08
**Related:** ADR-017 (OTP verification attempt lockout)

## Mandatory Security Assessment

Whenever you implement, modify, or review a **security-sensitive feature**, you MUST perform a structured security assessment. This rule applies automatically — no user reminder needed.

### Security-Sensitive Features (non-exhaustive)

- Authentication and authorization
- Session management and token generation/validation
- Password reset and account recovery
- Email and phone verification (OTP flows)
- API rate limiting
- Invitation links
- Payment-related security
- Any workflow involving secrets, credentials, or identity

### Assessment Steps (in order)

1. **Identify attack scenarios.** Enumerate concrete ways an attacker could abuse the feature: brute force, enumeration, replay, bypass via regeneration, race conditions, distributed attacks from many IPs, etc.

2. **Identify security boundaries and enforcement mechanisms.** For each boundary (e.g., "max 5 wrong OTP attempts"), name the exact mechanism that enforces it (Redis key, Lua script, guard) and where it lives.

3. **Determine the attacker's practical opportunities.** Consider what the attacker can control (requests, timing, concurrency, IP rotation) and what limits them (rate limits, TTLs, lockouts).

4. **Estimate attack success probability when mathematically meaningful.** Use correct formulas, state all assumptions explicitly, and distinguish between:
   - Probability of guessing one specific secret
   - Probability of guessing any valid secret during its lifetime
   - Probability when counters reset vs. persist across regeneration

5. **Document assumptions and limitations.** State what is unknown (operational parameters, missing config) and provide bounded scenarios rather than inventing values.

6. **Compare risk against an explicit security target.** State the acceptable risk level (e.g., "< 1e-5 success probability per hour") and whether the implementation meets it.

7. **Identify weaknesses requiring additional protection.** List any bypass paths (e.g., attempt counter reset by regenerating the OTP, cooldown bypass via key deletion, success path not checking counters).

8. **Warn the user explicitly** whenever the current implementation has a meaningful security weakness. Do not stay silent — surface it in your report with severity, root cause, and practical impact.

### Design Requirements for Security Counters

When implementing attempt limits, lockouts, or similar security counters:

- **Atomicity:** All security-critical counter updates MUST be atomic (Lua scripts, INCR, etc.). Never use application-side check-then-act.
- **Independence from resource lifecycle:** A security counter MUST NOT reset when the resource it protects is regenerated, replaced, or deleted. Use a separate Redis key with its own TTL.
- **Concurrency safety:** Concurrent requests MUST NOT bypass the limit. Test with real Redis (Testcontainers) — mocks cannot prove atomicity.
- **Independent TTL semantics:** Expiration of the protected resource (e.g., OTP TTL) and expiration of the security restriction (e.g., lockout TTL) MUST have clearly defined, independent semantics. The security TTL should be >= the resource TTL.
- **Success-path safety:** Successful operations MUST NOT accidentally clear security restrictions that should remain active.
- **No reset on regeneration:** Generating a new secret/resource MUST NOT reset an active security lock.
- **No expiry bypass:** Redis key expiration MUST NOT create an opportunity to bypass the restriction.
- **Scope by identity, not just IP:** Restrictions SHOULD be scoped to the protected identity (phone, account, email), not only to IP addresses (which attackers can rotate).
- **Indistinguishable errors:** Security failures (locked, rate-limited, invalid) SHOULD return the same generic error to clients so attackers cannot distinguish states.

### Quantitative Assessment Format

When calculating attack success probability:

```
P(single guess) = 1 / |secret space|
P(n independent guesses) = 1 - (1 - P(single guess))^n
```

Adapt to the actual implementation: account for regeneration cycles, rate-limit windows, lockout windows, and whether counters persist. Always state assumptions (uniform randomness, no side-channel leakage, attacker capabilities).

### Documentation

- Security-sensitive design decisions require an ADR (see DECISIONS.md, ADR-first workflow).
- Quantitative assessments belong in the ADR or a dedicated security doc under `docs/`.
- This rule itself is permanent; update it when the methodology evolves.
