---
name: nest-config
description: Implement and maintain the NestJS configuration system using ConfigModule, Node.js --env-file, Zod environment schemas, readable validation errors, and namespaced registerAs configuration factories. Use whenever adding, modifying, or reviewing environment variables, configuration schemas, or NestJS configuration namespaces.
---

# NestJS Configuration Architecture

## Purpose

Follow the project's established configuration architecture whenever implementing or modifying environment configuration in a NestJS application.

The configuration system must:
- Load environment variables through Node.js `--env-file`, not through NestJS ConfigModule.
- Validate environment variables with Zod before exposing them to application configuration.
- Organize environment schemas by responsibility.
- Produce readable validation errors through `fromZodError`.
- Use a shared custom error class for invalid environment configuration.
- Define configuration namespaces using `registerAs`.
- Use symbols as configuration namespace tokens.
- Keep the central ConfigModule setup in `src/shared/config/config.ts`.

Do not introduce an alternative configuration architecture unless explicitly requested.

## 1. Required Directory Structure

Use the following structure as the default:

```text
src/
├── shared/
│   └── errors/
│       └── env-validation.error.ts
└── config/
    ├── env/
    │   ├── env.config.ts
    │   └── schema/
    │       ├── db.env.ts
    │       └── server.env.ts
    ├── database.config.ts
    └── server.config.ts
    └── config.ts
```

Adapt filenames to the existing project when necessary. Do not create duplicate files or directories if equivalent project conventions already exist.

## 2. Central ConfigModule Setup

Define the primary NestJS configuration settings in:

`src/config/config.ts`

This file is the single source of truth for the application's ConfigModule setup.

Requirements:
- Use `ConfigModule.forRoot`.
- Set `ignoreEnvFile: true` so NestJS ConfigModule does not load `.env` files.
- Environment variables are supplied through Node.js `--env-file` and are already available in `process.env`.
- Configure the `load` array with the application's namespaced configuration factories.
- Preserve existing settings such as `isGlobal` when appropriate.
- Do not duplicate the setup in feature modules.

Example:

```typescript
// src/config/config.ts

import { ConfigModule } from '@nestjs/config';

import databaseConfig from './database.config.js';
import serverConfig from './server.config.js';

export const configModule = ConfigModule.forRoot({
  isGlobal: true,
  ignoreEnvFile: true,
  load: [databaseConfig, serverConfig],
});
```

Adapt import paths and module syntax to the project. Use `.js` import specifiers when required by its ESM and TypeScript configuration.

Do not add automatic `.env` loading, a second environment loader, or unnecessary configuration options.

## 3. Environment Schema Files

Create environment schema files inside:

`src/config/env/schema/`

Separate variables by responsibility rather than placing every environment variable in a single large schema.

Examples:
- `db.env.ts`: database connection settings.
- `server.env.ts`: HTTP server settings.
- Additional files only when another distinct configuration domain requires them.

Each schema file must:
1. Define a Zod object schema.
2. Validate the expected environment variable names and constraints.
3. Export the schema.
4. Export the corresponding TypeScript type inferred from the schema using `z.infer`.

Example:

```typescript
// src/config/env/schema/db.env.ts

import { z } from 'zod';

export const dbEnvSchema = z.object({
  DB_HOST: z.string().min(1),
  DB_PORT: z.coerce.number().int().min(1).max(65535),
  DB_NAME: z.string().min(1),
});

export type DbEnv = z.infer<typeof dbEnvSchema>;
```

Use appropriate Zod validators for the actual variable types. Account for the fact that values in `process.env` are strings or undefined, and apply coercion or transformations only when appropriate.

Do not invent environment variables or add unrelated validation rules.

## 4. Aggregate and Validate Environment Variables

Implement the aggregate schema and validation function in:

`src/config/env/env.config.ts`

### 4.1 Aggregate schemas

Import the individual schemas and merge their shapes into a single `envSchema`.

Example:

```typescript
import { z } from 'zod';
import { fromZodError } from 'zod-validation-error';

import { dbEnvSchema } from './schema/db.env.js';
import { serverEnvSchema } from './schema/server.env.js';

export const envSchema = z.object({
  ...dbEnvSchema.shape,
  ...serverEnvSchema.shape,
});

export type Env = z.infer<typeof envSchema>;
```

Add each relevant environment schema to this aggregate object. Avoid defining the same environment variable in multiple schemas.

### 4.2 Validate process.env

Pass `process.env` to `envSchema.safeParse()`.

If validation succeeds, use the parsed data from `result.data`. If validation fails, convert the Zod error into a readable message using `fromZodError` and throw the project's custom environment-validation error.

Example:

```typescript
// src/config/env/env.config.ts

import { z } from 'zod';
import { fromZodError } from 'zod-validation-error';

import { EnvValidationError } from '../../shared/errors/env-validation.error.js';
import { dbEnvSchema } from './schema/db.env.js';
import { serverEnvSchema } from './schema/server.env.js';

export const envSchema = z.object({
  ...dbEnvSchema.shape,
  ...serverEnvSchema.shape,
});

export type Env = z.infer<typeof envSchema>;

function validateEnv(): Env {
  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    const validationError = fromZodError(result.error);

    throw new EnvValidationError(validationError.message);
  }

  return result.data;
}

export const _env = validateEnv();
```

Treat this as a structural example. Adapt the error class name, constructor arguments, imports, and error-handling conventions to the existing codebase.

Requirements:
- Reuse the existing custom error class if one already exists.
- If none exists, create a focused error class under `src/shared/errors/`.
- Do not introduce another validation library.
- Do not silently ignore invalid values.
- Do not log environment variable values or secrets in validation errors.
- Do not return the raw `safeParse` result.
- Export the validated, parsed environment data as `_env`.
- Ensure validation runs before configuration factories consume `_env`.

The validated object must be the source of truth for all application configuration factories.

## 5. Custom Environment Validation Error

Use a dedicated error class for invalid environment configuration.

Its responsibility is to distinguish environment validation failures from unrelated application errors while preserving a readable message.

Before creating a new class:
1. Inspect `src/shared/errors/`.
2. Reuse an existing suitable error class if available.
3. Otherwise, create a minimal class following existing project conventions.

Do not add a general-purpose error framework or unnecessary abstractions for this task.

## 6. Namespaced Configuration Factories

Create configuration factory files directly under `src/config/`, outside the `env/` directory.

Examples:
- `database.config.ts`
- `server.config.ts`

Each factory must:
1. Import the validated `_env` object.
2. Define a namespace token using a symbol.
3. Use `registerAs` to create the configuration factory.
4. Return an object whose values are derived from `_env`.
5. Export the factory as the default export for registration in the central ConfigModule setup.

Example:

```typescript
// src/config/database.config.ts

import { registerAs } from '@nestjs/config';

import { _env } from './env/env.config.js';

export const DATABASE_CONFIG = Symbol('DATABASE_CONFIG');

export default registerAs(DATABASE_CONFIG, () => ({
  host: _env.DB_HOST,
  port: _env.DB_PORT,
  name: _env.DB_NAME,
}));
```

Use descriptive, domain-specific symbol names. Avoid string namespace tokens when the project's convention requires symbols.

Keep the configuration factory focused on mapping validated environment values into a namespaced configuration object. Do not perform environment validation inside individual factories.

Use the corresponding namespace symbol when injecting configuration through `ConfigType`, `ConfigService`, or the relevant NestJS configuration APIs. Follow the project's existing injection conventions.

## 7. Application Startup

The runtime must load environment variables before NestJS application code evaluates configuration modules.

Use Node.js `--env-file` when starting the application, for example:

```bash
node --env-file=./env/.env.development dist/main.js
```

Adapt the path and entry point to the project's runtime setup. For development, production, and test environments, use the appropriate existing startup commands and environment files.

Do not add a second `.env` loader or make ConfigModule responsible for loading environment files.

## 8. Adding a New Environment Variable

Whenever a new environment variable is introduced:

1. Identify its responsibility.
2. Add it to the appropriate `*.env.ts` schema.
3. Add the schema to `envSchema` in `env.config.ts` if it is not already included.
4. Confirm that its validation and inferred type are correct.
5. Map the validated value into the appropriate `registerAs` factory.
6. Add the factory to `load` in `src/shared/config.ts` only if a new configuration namespace was created.
7. Update the relevant environment example files and documentation if the project maintains them.
8. Run the relevant existing validation, type-checking, tests, and build commands.

If the variable belongs to an existing namespace, do not create another namespace unnecessarily.

## 9. Constraints and Non-Goals

- Do not access `process.env` directly from configuration consumers or feature modules. Centralize environment access in the validation layer.
- Do not bypass `_env` by reading raw environment variables in configuration factories.
- Do not duplicate schemas or validation logic.
- Do not create unnecessary abstractions, generic configuration frameworks, or wrapper services.
- Do not modify unrelated application architecture.
- Do not change existing environment variable names unless explicitly required.
- Do not add dependencies without checking whether they are already installed and compatible with the project.
- Do not modify startup scripts unless required to ensure Node.js `--env-file` is used correctly.
- Preserve the project's existing ESM, TypeScript, linting, formatting, and testing conventions.

## 10. Verification

After implementing configuration changes:

- Verify that invalid environment values cause a readable startup error.
- Verify that valid values are parsed and exposed through `_env`.
- Verify that Zod defaults and transformations are reflected in the validated output.
- Verify that each namespace is registered in the central ConfigModule setup.
- Verify that configuration consumers use the appropriate namespace and token.
- Run relevant existing type-checking, linting, tests, and build commands.
- Report any checks that could not be completed.

Do not claim successful verification unless the relevant commands actually completed successfully.
