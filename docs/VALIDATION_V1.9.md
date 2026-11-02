# V1.9 validation record

## Verified locally

- 43 Django tests: 22 V1.9 tests plus 21 retained V1.5 tests.
- 8 React interaction tests: 4 V1.9 tests plus 4 retained V1.5 regression tests.
- 2 JavaScript data/Unicode regression tests.
- Production Vite build, Django system check and migrations.
- Native browser: Landing, actual synthetic CSV upload, actual table preview and model-unconfigured error state.
- npm audit after updating the test runner: zero reported vulnerabilities.

Tests use mocked Groq transport/proposals where indicated. They verify deterministic processing and approval boundaries, not actual model quality. Safety coverage includes CSRF, cross-session access, stale Apply, idempotent Apply, literal replacement, explicit Remove, zero matches, regex timeout, native XLSX types, CSV formula escaping, invalid uploads, failed-upload preservation, consent refusal, invalid scope, complete suggestion schemas, selective mapping and true nulls.

## Not yet verified

- Real Groq A01/A03/A07/A08 and model quality: no Groq key configured in this environment.
- Docker image execution: Docker CLI exists but no daemon is running.
- Render deployment/cold start/restart and public end-to-end A13: Render is not signed in; no deployment performed.
- Safari and independent screen-reader audit.

## Audit and compatibility

Baseline: cloned Silviaaq/RegexGenie main. Reused React/Vite/lucide, Django settings and error handling, immutable V1.5 endpoints, migrations, timeout-isolation helper and export safety logic. New functionality lives under cleaning; legacy APIs remain available to preserve existing consumers. The new workspace uses private immutable snapshots rather than storing cells in ORM JSON. Previous incomplete scratch files under work/RegexGenie are not the deliverable.
