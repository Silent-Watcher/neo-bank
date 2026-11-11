# Code Review Report — template

Produced by `code-reviewer`. Structured Markdown. Findings must be evidence-
based; never invent findings, never report subjective preferences as
defects. Severity: `BLOCKER` (prevents approval), `WARNING` (requires
correction or explicit technical justification), `SUGGESTION` (optional,
never blocks).

```markdown
# Code Review Report

## Findings

### BLOCKER

<!-- none, or list -->

### WARNING

<!-- none, or list -->

### SUGGESTION

<!-- none, or list -->

<!--
Each finding, in the severity group, uses this shape:

#### CR-<n> — <short title>  (status: OPEN | FIXED | DISPUTED)
- **Location:** <file path>:<line or code location>
- **Evidence:** <what the code actually does>
- **Problem:** <what is wrong or potentially wrong>
- **Impact:** <concrete failure or degradation scenario>
- **Recommendation:** <specific, technically justified correction>
-->

## Verification Note

<!-- what was inspected beyond the supplied diff, with paths -->

## Final Status

<!-- exactly one of:
APPROVED
APPROVED_WITH_SUGGESTIONS
CHANGES_REQUIRED
-->
```
