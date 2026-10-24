# NestJS Configuration Convention

When working on NestJS environment variables, configuration modules, environment validation, or configuration namespaces, you MUST follow the `nest-config` skill.

## Mandatory Rules

- Read and follow `agents/skills/nest-config/SKILL.md` before implementing configuration-related changes.
- Keep the central `ConfigModule.forRoot()` setup in `src/shared/config/config.ts`.
- Set `ignoreEnvFile: true`; environment files are loaded through Node.js `--env-file`, not through NestJS ConfigModule.
- Define environment schemas under `src/shared/config/env/schema/`, organized by responsibility.
- Aggregate the schemas in `src/shared/config/env/env.config.ts` using `z.object()` and schema shapes.
- Validate `process.env` using Zod `safeParse()`.
- On validation failure, use `fromZodError` and the project's shared custom environment-validation error.
- Export the validated and parsed environment object as `_env`; use `result.data`, not the entire `safeParse` result.
- Define domain-specific configuration factories under `src/config/` using `registerAs()` and symbol namespace tokens.
- Read environment values from `_env` inside configuration factories, never directly from `process.env`.
- Register the configuration factories in the `load` array of the central ConfigModule setup.
- Reuse existing schemas, errors, configuration factories, and project conventions whenever possible.

## Scope Control

Apply this convention only when the task involves configuration setup or changes. Do not refactor unrelated code, add unnecessary abstractions, introduce alternative environment-loading mechanisms, or modify unrelated startup settings.

If the existing project structure differs, inspect it first and adapt the convention without creating duplicate files or conflicting configuration systems.

If the user explicitly requests a different approach, follow the explicit request rather than silently imposing this convention.
