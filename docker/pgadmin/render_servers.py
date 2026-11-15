"""Render the pgAdmin server-definition file from its template (ADR-028).

pgAdmin does not substitute environment variables in servers.json
(upstream gap pgadmin-org/pgadmin4#8663), so the container entrypoint runs
this script before the image's own entrypoint: every ${VAR} placeholder in
the mounted template is replaced by the identically named environment
variable, the result is validated as JSON, and it is written to the path
PGADMIN_SERVER_JSON_FILE points at (default /tmp/servers.json — the image
runs as uid 5050 and cannot write to /pgadmin4/, and per-container /tmp
scratch keeps the rendered file off the persistent /var/lib/pgadmin volume;
pgAdmin itself persists the imported password inside its configuration
database on that volume by design). Substituted values are JSON-escaped so
any credential value renders safely. A missing variable, invalid JSON, or an
unwritable output path aborts startup with an explicit error instead of
registering a broken definition.
"""

import json
import os
import pathlib
import re

TEMPLATE_PATH = pathlib.Path('/pgadmin4/servers.json.template')
DEFAULT_RENDERED_PATH = '/tmp/servers.json'
PLACEHOLDER_PATTERN = re.compile(r'\$\{(\w+)\}')


def render() -> None:
    template = TEMPLATE_PATH.read_text(encoding='utf-8')

    missing = sorted(set(PLACEHOLDER_PATTERN.findall(template)) - os.environ.keys())
    if missing:
        raise SystemExit(
            f'missing environment variables for servers.json template: {", ".join(missing)}'
        )

    # json.dumps escapes the value for JSON string context; the surrounding
    # quotes are stripped so the escaped body can be spliced into the
    # template's string literals.
    rendered = PLACEHOLDER_PATTERN.sub(
        lambda match: json.dumps(os.environ[match.group(1)])[1:-1],
        template,
    )
    try:
        json.loads(rendered)
    except json.JSONDecodeError as error:
        raise SystemExit(f'rendered servers.json is invalid JSON: {error}') from error

    rendered_path = pathlib.Path(os.environ.get('PGADMIN_SERVER_JSON_FILE', DEFAULT_RENDERED_PATH))
    try:
        rendered_path.write_text(rendered, encoding='utf-8')
    except OSError as error:
        raise SystemExit(f'cannot write rendered servers.json to {rendered_path}: {error}') from error


if __name__ == '__main__':
    render()
