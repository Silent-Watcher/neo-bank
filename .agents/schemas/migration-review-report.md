# Migration Review Report — template

Produced by `migration-reviewer`. Structured Markdown. Findings must be
evidence-based; never invent findings, never approve because the CLI
generated the file successfully. Severity: `BLOCKER` (prevents approval),
`WARNING` (requires correction or explicit technical justification),
`SUGGESTION` (optional, never blocks). Corrections are always phrased as new
forward migrations — never as edits to an existing migration.

```markdown
# Migration Review Report

## Migration Files Reviewed

<!-- list of migration paths (+ snapshot when supplied) -->

## Schema Changes Identified

<!-- per table: operation, columns, types, constraints -->

## Findings

### BLOCKER

<!-- none, or list -->

### WARNING

<!-- none, or list -->

### SUGGESTION

<!-- none, or list -->

<!--
Each finding, in the severity group, uses this shape:

#### MR-<n> — <short title>  (status: OPEN | FIXED | DISPUTED)
- **Location:** <file path>:<line or code location>
- **Schema operation:** <the exact CREATE/ALTER/DROP involved>
- **Evidence:** <what the migration SQL actually does>
- **Problem:** <what is wrong or potentially wrong>
- **Impact:** <concrete failure, drift, or data-loss scenario>
- **Recommendation:** <new forward migration or regeneration; never an edit
  to an existing migration>
-->

## Potential Data-Loss Risks

<!-- explicitly "none", or the concrete risks -->

## Naming and Type-Mapping Verification

<!-- snake_case identifiers, column types/nullability vs entity metadata,
     primary key BIGINT/string mapping, BaseEntity column propagation -->

## Required Corrections

<!-- none, or the ordered list of required new forward migrations -->

## Verification Note

<!-- what was inspected beyond the supplied diff, with paths -->

## Final Verdict

<!-- exactly one of:
APPROVED
APPROVED_WITH_SUGGESTIONS
CHANGES_REQUIRED
-->
```
