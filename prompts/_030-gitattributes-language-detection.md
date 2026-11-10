# 030 — GitAttributes: Omit HTML from GitHub Language Detection

## Original User Request

Add a `.gitattributes` file and make GitHub language detection omit the HTML content of the project.

## Implementation

- **`.gitattributes`** (repo root, new file): `*.html linguist-generated` — files marked `linguist-generated` are excluded from GitHub's Linguist language statistics. The pattern (no slash) matches at any repository depth, so it covers the current tracked HTML (`apps/admin/index.html`, the Vite entry boilerplate) and any future HTML (generated reports, email templates). In-repo comment documents the rationale.
- Only one HTML file is tracked in git (`apps/admin/index.html`); other HTML present locally (`.next/`, `dist/`) is build output excluded by `.gitignore`, so Linguist never saw it. Without the attribute the repository's language bar would display an "HTML" share caused by entry-file boilerplate.

## Decisions

- `linguist-generated` chosen over `linguist-vendored` / `linguist-detectable=false`: it is the conventional attribute for boilerplate entry files and reads clearest; all three produce the same statistics outcome. No ADR — trivial maintenance configuration, not an architectural decision.
- No documentation-update triggers matched (no env var, feature/endpoint, dependency, script, workspace, or convention change).

## Validation

- Config/documentation-only change (no source code touched): lint and tests not run per the repository rule for non-source changes.
- `git ls-files '*.html'` confirms the attribute target set is exactly the tracked HTML above.

## Notes

- No commit created (awaiting explicit user approval).
- GitHub recomputes language statistics on push; the repo page will refresh (sometimes with a short delay).
