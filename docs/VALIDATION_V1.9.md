# V1.9 validation record

## Verified locally

- 45 Django tests: 24 V1.9 tests plus 21 retained V1.5 tests.
- 8 React interaction tests: 4 V1.9 tests plus 4 retained V1.5 regression tests.
- 2 JavaScript data/Unicode regression tests.
- Production Vite build, Django system check and migrations.
- GitHub Actions: all tests and Linux Docker image build passed.
- Public Render V1.9 deployment: https://regexgenie.onrender.com.
- Four real Groq regex tasks (email, phone, order ID, digits), CSV/XLSX export and actual browser preview/apply/download passed.
- Real semantic and missing-marker suggestions passed schema/approval checks after JSON-mode fixes. A trailing blank XLSX row issue was detected and fixed with a regression test; the full public export rerun is recorded separately.
- Native browser: Landing, actual synthetic CSV upload, actual table preview and model-unconfigured error state.
- npm audit after updating the test runner: zero reported vulnerabilities.

Tests use mocked Groq transport/proposals where indicated. They verify deterministic processing and approval boundaries, not actual model quality. Safety coverage includes CSRF, cross-session access, stale Apply, idempotent Apply, literal replacement, explicit Remove, zero matches, regex timeout, native XLSX types, CSV formula escaping, invalid uploads, failed-upload preservation, consent refusal, invalid scope, complete suggestion schemas, selective mapping and true nulls.

## Not yet verified

- Broader model-quality evaluation beyond the synthetic live acceptance cases.
- Local Docker daemon execution: unavailable; the Docker build passed in GitHub Actions and the image runs on Render.
- A deliberate restart during a running job and long-idle wakeup timing have not been independently stress-tested. Actual deployments successfully restarted the managed worker and database migrations.
- Safari and independent screen-reader audit.

## Audit and compatibility

Baseline: cloned Silviaaq/RegexGenie main. Reused React/Vite/lucide, Django settings and error handling, immutable V1.5 endpoints, migrations, timeout-isolation helper and export safety logic. New functionality lives under cleaning; legacy APIs remain available to preserve existing consumers. The new workspace uses private immutable snapshots rather than storing cells in ORM JSON. Previous incomplete scratch files under work/RegexGenie are not the deliverable.
