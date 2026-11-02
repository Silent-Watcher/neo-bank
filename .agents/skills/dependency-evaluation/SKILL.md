---
name: dependency-evaluation
description: Evaluate requirements for helpers, utilities, packages, and external tools before implementation or installation. Use whenever a task requires new supporting functionality or introduces a dependency.
---

# Dependency Evaluation

## Objective

Choose the simplest reliable, secure, and maintainable solution for every utility or supporting functionality requirement. Avoid unnecessary dependencies and premature abstractions.

This skill is mandatory whenever a task requires a new helper, utility, package, library, or external tool.

## 1. Understand the Requirement

Before writing code or installing anything:

1. Identify the exact problem and expected behavior.
2. Determine the inputs, outputs, constraints, and integration points.
3. Inspect the existing codebase, `package.json`, installed dependencies, and relevant project documentation.
4. Check whether the required functionality already exists in the project.
5. Identify relevant edge cases, failure modes, security concerns, and compatibility requirements.

Do not select a solution before understanding the actual requirement.

## 2. Evaluate an Internal Implementation

Determine whether the requirement can be implemented reliably with no more than **200-300 lines of production code**, excluding tests.

Consider:

- Implementation complexity and maintainability.
- Input validation and boundary conditions.
- Invalid inputs, missing values, and unexpected data.
- Error handling and failure scenarios.
- Asynchronous behavior, concurrency, and resource cleanup, where applicable.
- Security implications and potential misuse.
- Integration with the existing NestJS architecture and TypeScript configuration.

The list above is contextual, not a requirement to implement irrelevant checks.

### Decision rule

- If a reliable implementation fits within 200-300 lines, prefer implementing it internally.
- Keep the implementation focused. Do not introduce unnecessary abstractions, configuration options, or generic frameworks.
- Write tests covering normal behavior, relevant edge cases, invalid inputs, and expected failures.
- Run the tests and fix failures before integrating the implementation into the requested feature.
- Reuse existing project utilities and conventions where appropriate.
- If the implementation exceeds 200-300 lines, evaluate whether it can be simplified without compromising correctness, security, or maintainability.

The 200-line limit is a decision threshold, not permission to create an incomplete implementation. Do not omit essential validation, error handling, or tests merely to stay within the limit.

## 3. Evaluate Existing Dependencies and External Packages

If an internal implementation is unsuitable, first inspect existing dependencies and available project capabilities. Then evaluate external alternatives if necessary.

Before choosing a package:

1. Confirm that it directly satisfies the requirement.
2. Check whether the functionality is already available through an installed dependency or the framework.
3. Verify the package's official repository, package registry entry, and latest stable release.
4. Check maintenance activity, release history, open issues, and compatibility with the project's Node.js version, NestJS version, TypeScript configuration, and package manager.
5. Review the license and confirm that it is appropriate for the project.
6. Investigate known vulnerabilities using available authoritative security advisories and package auditing tools.
7. Assess dependency-tree size, transitive dependencies, installation scripts, native binaries, required permissions, and other relevant supply-chain risks.
8. Compare viable alternatives and explain meaningful trade-offs.
9. Select the latest stable release that satisfies compatibility and security requirements.

### Security requirements

- Do not treat popularity, download counts, or a recent release as proof of security.
- Do not install a package with a known, relevant, unresolved critical vulnerability.
- Investigate high-severity vulnerabilities and document the findings and mitigation before proceeding.
- Avoid unnecessary dependencies and packages with excessive permissions or unexplained installation behavior.
- Never execute untrusted installation scripts or package code merely to evaluate a package.
- Use the project's existing package manager and preserve lockfile consistency.
- Never claim that a package is vulnerability-free. Report the scope and limitations of the checks performed.

If reliable verification is unavailable, explicitly state what could not be verified. Do not fabricate security findings, compatibility checks, or repository activity.

## 4. Document Dependency Decisions

Whenever a new external package or tool is introduced, document the decision in the root `DECISIONS.md` before or as part of the implementation.

Use the project's existing ADR conventions if available. Otherwise, use this structure:

### ADR-NNN: Short Decision Title

- **Status:** Proposed, Accepted, Rejected, or Superseded
- **Date:** YYYY-MM-DD

#### Context

Describe the requirement, problem, and relevant constraints.

#### Options Considered

List the internal implementation, existing dependencies, and relevant external alternatives that were actually evaluated.

#### Decision

State the selected approach and the package name and version if applicable.

#### Rationale

Explain why the selected approach is preferable, including the reasons alternatives were rejected.

#### Security Assessment

Record the actual vulnerability checks, maintenance review, license review, compatibility checks, and relevant supply-chain considerations. Clearly identify anything that could not be verified.

#### Consequences

Describe relevant trade-offs, maintenance obligations, limitations, and future implications.

Keep records concise, factual, and specific to the decision. Do not create duplicate ADRs for an existing decision unless its scope or rationale materially changes.

Do not record an unimplemented proposal as an accepted decision.

## 5. Install and Integrate

If an external dependency or tool is justified, document the proposed decision in DECISIONS.md with the status Pending.

Stop and ask the user to approve or reject the decision before installing or introducing the dependency.

Do not install the dependency, modify project configuration to integrate it, or proceed with implementation steps that depend on it while approval is pending.

After explicit approval, update the decision status in DECISIONS.md to Accepted and continue the documented implementation process.

If rejected, update the decision status to Rejected and ask the user how to proceed if no suitable alternative exists.

After the evaluation supports using an external package:

1. Record the decision in `DECISIONS.md`.
2. Install the latest verified stable version compatible with the project.
3. Use the existing package manager and follow repository conventions.
4. Review the resulting dependency and lockfile changes.
5. Implement the integration with appropriate error handling and validation.
6. Add or update tests for the integration and relevant failure scenarios.
7. Run applicable tests, type checks, linting, formatting, and security audits when available.
8. Review the final changes for unnecessary dependencies, regressions, and security issues.

Do not install a package simply to experiment with it when the requirement can already be met reliably.

## 6. Stop and Ask the User

Stop before implementing the affected functionality if:

- No reliable internal implementation can be identified.
- No suitable external package or tool can be verified.
- Available alternatives introduce unacceptable security risks.
- A required license, compatibility, or security constraint cannot be resolved.
- The choice requires a significant architectural trade-off that cannot be determined from the project's existing decisions.

Present a concise summary containing:

1. The requirement.
2. The options evaluated.
3. Why each viable option is insufficient or unsuitable.
4. Any unresolved risks or uncertainties.
5. A clear question asking how the user wants to proceed.

Do not silently choose an unsafe workaround, install a speculative dependency, or implement a materially different solution without approval.

## 7. Final Reporting

When the task is complete, summarize:

- The chosen approach and why.
- Whether an internal implementation or external dependency was used.
- The relevant tests and checks executed, including their actual results.
- Any dependency decisions documented in `DECISIONS.md`.
- Any unresolved limitations or security concerns.

Never claim that a check passed unless it was actually executed.
