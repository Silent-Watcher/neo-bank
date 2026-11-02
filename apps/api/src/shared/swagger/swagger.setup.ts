import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

// Root-level path, deliberately outside the `api` prefix: the Swagger UI is a
// development aid for humans, not part of the versioned API surface, and the
// global prefix/versioning applies to Nest routes, not to this registration.
export const SWAGGER_DOCS_PATH = 'docs';

// The API version mirrors the URI-versioning defaultVersion in main.ts; both
// must change together when a new API version ships.
const OPENAPI_API_VERSION = '1';

/**
 * Registers the Swagger UI at `/{SWAGGER_DOCS_PATH}` and the OpenAPI JSON at
 * `/{SWAGGER_DOCS_PATH}/json`. Development-only: the environment gate lives
 * in the bootstrap function (main.ts), keeping one explicit decision point.
 *
 * The JSON/YAML URLs are set explicitly because @nestjs/swagger's defaults on
 * Fastify are `docs-json`/`docs-yaml`, which contradicts the UI path.
 */
export function setupSwagger(app: INestApplication): void {
  const config = new DocumentBuilder()
    .setTitle('Neo Bank API')
    .setDescription('REST API for Neo Bank. Versioned under /api/v1.')
    .setVersion(OPENAPI_API_VERSION)
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup(SWAGGER_DOCS_PATH, app, document, {
    jsonDocumentUrl: `${SWAGGER_DOCS_PATH}/json`,
    yamlDocumentUrl: `${SWAGGER_DOCS_PATH}/yaml`,
  });
}
