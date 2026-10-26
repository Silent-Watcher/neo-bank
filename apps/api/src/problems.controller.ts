import { Controller, Get, Header, VERSION_NEUTRAL } from '@nestjs/common';

import { APPLICATION_ERROR_PROBLEM_TYPE } from './shared/errors/error.code.js';

const APPLICATION_ERROR_DOCUMENTATION = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>${APPLICATION_ERROR_PROBLEM_TYPE}</title></head>
<body>
<h1>Problem Type: Application Error</h1>
<p>
  This Problem Type (<code>${APPLICATION_ERROR_PROBLEM_TYPE}</code>) is the family-level
  type for application-specific failures that do not map to an ordinary HTTP
  status. Errors of this type are returned with the
  <code>application/problem+json</code> media type per RFC 9457.
</p>
<p>
  In addition to the standard members (<code>type</code>, <code>title</code>,
  <code>status</code>, <code>detail</code>), responses carry these extension members:
</p>
<ul>
  <li><code>code</code> — a stable, machine-readable error code identifying the specific error.</li>
  <li><code>timestamp</code> — UTC ISO 8601 time of the failure.</li>
  <li><code>apiVersion</code> — the API version that served the request, or <code>neutral</code>.</li>
  <li><code>requestId</code> — the request correlation ID, also returned in the <code>x-request-id</code> header.</li>
</ul>
<p>
  <code>code</code> identifies the specific error; <code>type</code> identifies this
  broader family. Clients must rely on <code>code</code>, not on parsing
  <code>title</code> or <code>detail</code>.
</p>
</body>
</html>
`;

// Version-neutral so the `type` URI stays stable across API versions. The
// route is excluded from the global prefix in the bootstrap and serves HTML,
// so the response envelope interceptor does not wrap it.
@Controller({ path: 'problems/application-error', version: VERSION_NEUTRAL })
export class ProblemsController {
  @Get()
  @Header('Content-Type', 'text/html; charset=utf-8')
  applicationError(): string {
    return APPLICATION_ERROR_DOCUMENTATION;
  }
}
