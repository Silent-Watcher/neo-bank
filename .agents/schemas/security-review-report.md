# Security Review Report — template

Produced by `code-security-analyzer`. Structured Markdown. Think from an
attacker's perspective; distinguish confirmed vulnerabilities from
theoretical risks (`INFORMATIONAL` = hardening observation with no realistic
exploit path). Never expose raw secrets, tokens, OTP values, or credentials
in the report. Never invent findings.

```markdown
# Security Review Report

## Findings

<!--
Each finding uses this shape:

#### SEC-<n> — <short title>  (status: OPEN | FIXED | DISPUTED)
- **Severity:** CRITICAL | HIGH | MEDIUM | LOW | INFORMATIONAL
- **Classification:** CWE-<id> (<name>) or other applicable classification
- **Location:** <file path>:<line>
- **Evidence:** <exact code or configuration observed, redacted as needed>
- **Vulnerability:** <description>
- **Attack scenario:** <concrete, step-by-step exploitation path>
- **Exploitability & prerequisites:** <authentication, network position,
  timing, configuration>
- **Potential impact:**
- **Recommended remediation:**
-->

## Confirmed vs. Theoretical

<!-- one short paragraph separating the two, when both exist -->

## Verification Note

<!-- what was inspected beyond the supplied diff (call chains, trust
     boundaries, configuration), with paths -->

## Final Status

<!-- exactly one of:
SECURITY_APPROVED
SECURITY_APPROVED_WITH_INFORMATIONAL_FINDINGS
SECURITY_CHANGES_REQUIRED
-->
```
