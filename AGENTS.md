# AGENTS.md

## Commands

- `bun install` — install dependencies (single lockfile: `bun.lock`)
- `bun run build` — nest build (output to `dist/`, cleared each build)
- `bun run start:dev` — dev server with watch (port 3000, overridable via `PORT` env)
- `bun run lint` — eslint with auto-fix (flat config at `eslint.config.mjs`)
- `bun run test` — unit tests (jest, `src/**/*.spec.ts`)
- `bun run test:e2e` — e2e tests (jest, `test/**/*.e2e-spec.ts`, config at `test/jest-e2e.json`)
- `bun run format` — prettier on `src/` and `test/`
- `bun run test:cov` — coverage output to `coverage/`
- `bunx prisma generate` — regenerate Prisma client after schema changes
- `bunx prisma migrate dev` — create and apply a migration (dev)
- `bunx prisma migrate deploy` — apply pending migrations (prod)

Run a single test file: `bunx jest src/path/to/file.spec.ts`
Run a single e2e test: `bunx jest --config ./test/jest-e2e.json test/app.e2e-spec.ts`

No typecheck script is defined; use `bunx tsc --noEmit` to typecheck.

## Key facts

- NestJS v11, Express adapter, single app (no monorepo)
- TypeScript with `module: "nodenext"`, target `ES2023`, `noImplicitAny: false`, `strictNullChecks: true`
- ESLint uses `projectService: true` (type-aware linting) — typecheck errors can surface as lint errors
- ESLint rule overrides: `@typescript-eslint/no-explicit-any` is off, `no-floating-promises` and `no-unsafe-argument` are warn
- Prettier: single quotes, trailing commas
- All imports use `.js` extensions (required by `nodenext` module resolution)
- Jest v30 (both unit and e2e)

## Architecture

```
src/
  main.ts                  # Bootstrap, global pipes/filters/interceptors, Swagger setup
  app.module.ts            # Root module, global guards (Throttler, JWT, Roles)
  config/
    env.validation.ts      # class-validator startup validation for env vars
    logger.config.ts       # Winston logger config (console transport, NestJS-like format)
  prisma/
    prisma.module.ts       # @Global() PrismaModule
    prisma.service.ts      # PrismaService (OnModuleInit/OnModuleDestroy lifecycle)
  common/
    constants/index.ts     # ROLES = { ADMIN, USER } (defined but unused — roles are hardcoded strings)
    decorators/
      current-user.decorator.ts   # @CurrentUser() / @CurrentUser('id')
      public.decorator.ts         # @Public() — bypasses JwtAuthGuard
      roles.decorator.ts          # @Roles('ADMIN') — restricts by role
    dto/
      base-response.dto.ts        # Shared response DTO (defined but unused)
      pagination.dto.ts           # page/limit query DTO (defined but unused)
    filters/
      all-exceptions.filter.ts    # Global exception filter
    guards/
      jwt-auth.guard.ts           # Global JWT auth guard (respects @Public)
      roles.guard.ts              # Global roles guard (queries userOrganization table for role names)
    interceptors/
      response-transform.interceptor.ts  # Wraps all responses in { statusCode, message, data, timestamp, path }
    interfaces/
      auth-user.interface.ts      # { id: string; email: string }
      jwt-payload.interface.ts    # { sub: string; email: string }
  modules/
    auth/                         # Register, login (local strategy), JWT strategy, refresh
      strategies/
        local.strategy.ts         # Validates email/password via AuthService -> UsersRepository
        jwt.strategy.ts           # Verifies Bearer token, calls AuthService.validateUserById
      local-auth.guard.ts         # Non-global, used only on POST /auth/login
    users/                        # CRUD (admin-guarded) + GET /me profile
    organizations/                # CRUD (admin-guarded) + GET /slug/:slug (public)
    roles/                        # CRUD (admin-guarded)
    user-organizations/           # CRUD (admin-guarded) — junction table: user + org + role
    health/                       # Terminus health check with Prisma indicator
```

## Database schema (PostgreSQL via Prisma v6)

- **User** — id (UUID), email (unique), password, firstName?, lastName?, isActive (default true), timestamps
- **Role** — id (UUID), name (unique), timestamps
- **Organization** — id (UUID), name, slug (unique), description?, website?, logoUrl?, timestamps
- **UserOrganization** — id (UUID), userId (FK), organizationId (FK), roleId (FK), timestamps; composite unique on `[userId, organizationId]`; cascade deletes on all FKs
- No enums in schema — roles are string-based
- No soft deletes implemented (isActive field exists on User but is never checked)

## Routes

All routes under global prefix `/api`. Total: 23 routes (4 public, 19 JWT-protected, 16 admin-gated) + 1 raw Express handler outside the prefix (`GET /metrics`, public — see Metrics below).

### Auth (`/api/auth`)

| Method | Path        | Auth                    | Description                                                 |
| ------ | ----------- | ----------------------- | ----------------------------------------------------------- |
| POST   | `/register` | Public                  | Register new user                                           |
| POST   | `/login`    | Public + LocalAuthGuard | Login, returns `{ accessToken, refreshToken }`              |
| POST   | `/refresh`  | JWT                     | Refresh tokens, returns new `{ accessToken, refreshToken }` |

### Users (`/api/users`)

| Method | Path   | Auth  | Description            |
| ------ | ------ | ----- | ---------------------- |
| GET    | `/me`  | JWT   | Current user's profile |
| GET    | `/`    | ADMIN | List all users         |
| GET    | `/:id` | ADMIN | Get user by ID         |
| PATCH  | `/:id` | ADMIN | Update user by ID      |
| DELETE | `/:id` | ADMIN | Delete user by ID      |

### Organizations (`/api/organizations`)

| Method | Path          | Auth   | Description               |
| ------ | ------------- | ------ | ------------------------- |
| GET    | `/`           | ADMIN  | List all organizations    |
| GET    | `/:id`        | ADMIN  | Get organization by ID    |
| GET    | `/slug/:slug` | Public | Get organization by slug  |
| POST   | `/`           | ADMIN  | Create organization       |
| PATCH  | `/:id`        | ADMIN  | Update organization by ID |
| DELETE | `/:id`        | ADMIN  | Delete organization by ID |

### Roles (`/api/roles`)

| Method | Path   | Auth  | Description       |
| ------ | ------ | ----- | ----------------- |
| GET    | `/`    | ADMIN | List all roles    |
| GET    | `/:id` | ADMIN | Get role by ID    |
| POST   | `/`    | ADMIN | Create role       |
| PATCH  | `/:id` | ADMIN | Update role by ID |
| DELETE | `/:id` | ADMIN | Delete role by ID |

### User-Organizations (`/api/user-organizations`)

| Method | Path                            | Auth  | Description                  |
| ------ | ------------------------------- | ----- | ---------------------------- |
| GET    | `/`                             | ADMIN | List all assignments         |
| GET    | `/user/:userId`                 | ADMIN | Org memberships for a user   |
| GET    | `/organization/:organizationId` | ADMIN | Users in an organization     |
| GET    | `/:id`                          | ADMIN | Get assignment by ID         |
| POST   | `/`                             | ADMIN | Assign user to org with role |
| PATCH  | `/:id`                          | ADMIN | Update assignment            |
| DELETE | `/:id`                          | ADMIN | Remove assignment            |

### Health (`/api/health`)

| Method | Path | Auth   | Description     |
| ------ | ---- | ------ | --------------- |
| GET    | `/`  | Public | DB health check |

### Metrics (`/metrics` — outside the `/api` prefix)

| Method | Path       | Auth   | Description                                                                                    |
| ------ | ---------- | ------ | ---------------------------------------------------------------------------------------------- |
| GET    | `/metrics` | Public | Raw Express handler registered in `main.ts` — bypasses prefix, guards, throttler, and transform |

## Request processing pipeline

1. Winston logger (replaces NestJS default)
2. Global prefix `/api`
3. CORS enabled (all origins — default settings)
4. Global `ValidationPipe` — whitelist, forbidNonWhitelisted, transform, enableImplicitConversion
5. Global guards: ThrottlerGuard (10 req/60s) → JwtAuthGuard (respects `@Public()`) → RolesGuard (queries DB for role names across all user's org memberships)
6. `AllExceptionsFilter` — normalizes all errors to `{ statusCode, message, errors?, timestamp, path }`
7. `ResponseTransformInterceptor` — wraps success to `{ statusCode, message: "Success", data, timestamp, path }`

## Authentication

- **Login**: Passport local strategy validates email/password against DB (bcrypt, 10 salt rounds)
- **JWT**: `passport-jwt` verifies Bearer token signed with `JWT_ACCESS_SECRET`; `JwtStrategy.validate()` confirms user still exists in DB
- **RolesGuard**: queries `prisma.userOrganization` for the authenticated user's role names across ALL organizations — a user who is ADMIN in any org is ADMIN everywhere
- **Refresh**: `POST /auth/refresh` requires valid access token; returns new token pair. Incoming refresh token is NOT validated (only access token is checked)
- **Token payload**: `{ sub: user.id, email: user.email }` (see `JwtPayload` interface)

## Environment variables

| Variable                 | Required | Default       | Description                       |
| ------------------------ | -------- | ------------- | --------------------------------- |
| `NODE_ENV`               | No       | `development` | development \| production \| test |
| `PORT`                   | No       | `3000`        | Server port                       |
| `DATABASE_URL`           | Yes      | —             | PostgreSQL connection string      |
| `JWT_ACCESS_SECRET`      | Yes      | —             | Signs access tokens               |
| `JWT_REFRESH_SECRET`     | Yes      | —             | Signs refresh tokens              |
| `JWT_ACCESS_EXPIRATION`  | No       | `15m`         | Access token expiry               |
| `JWT_REFRESH_EXPIRATION` | No       | `7d`          | Refresh token expiry              |
| `CORS_ORIGINS`           | No       | —             | Comma-separated allowed origins; unset/empty enables CORS for all origins (dev) |

## Module pattern

All business modules follow a 3-layer pattern:

- **Controller** — HTTP handling, decorators (`@ApiTags`, `@Roles`, `@Public`)
- **Service** — thin business logic, delegates to repository
- **Repository** — direct Prisma queries, throws `NotFoundException` on missing entities
- **DTOs** — Create DTO with `class-validator` + Swagger decorators; Update DTO via `PartialType(CreateDto)`

## Code conventions

- Password fields are destructured out before returning user objects
- Update methods cast DTOs to `{ [key: string]: unknown }` before passing to repository
- All Swagger DTOs use `@ApiProperty`/`@ApiPropertyOptional` with example values
- Swagger UI at `/docs` (no global prefix), bearer auth configured

## Known issues / technical debt

- **Minimal test coverage** — only 2 spec files (`metrics.service.spec.ts`, `request-logging.middleware.spec.ts`, from the monitoring task); only 1 e2e test (health endpoint). `bun run test` fails due to a jest config conflict (`jest.config.js` and the `jest` key in `package.json` are both present) — run scoped instead: `bunx jest <path> --config jest.config.js`. Note: `test/jest-e2e.json` lacks the `.js`-extension `moduleNameMapper` added to `jest.config.js`, so the e2e spec's `.js` imports may fail to resolve (unverified; e2e requires a live DB)
- **E2E test mismatch** — test setup doesn't apply `AllExceptionsFilter` or `ResponseTransformInterceptor`, so response shape differs from production
- **Unused code**: `ROLES` constants, `BaseResponseDto`, `PaginationDto` are defined but never used
- **`CreateRoleDto.organizationId`** is silently dropped — `RolesRepository.create()` only passes `{ name }`
- **`User.isActive`** is never checked in login, JWT strategy, or guards
- **Token expiry parsing** strips non-digits from strings like `"15m"` → `15`, which may be interpreted as 15 seconds
- **No refresh token verification** — the refresh endpoint only validates the access token
- **No helmet middleware** — no security headers configured
- **CORS allows all origins** — security concern for production
- **Role scoping issue** — roles are global (unique name), not per-organization, despite the junction table design

## Implementation checklist: HTTP request logging + Prometheus metrics + Grafana

Task: add per-request winston logging (method, url, status, duration) and prom-client metrics (`http_requests_total` counter, `http_request_duration_seconds` histogram; labels `method`/`route`/`status`) exposed at `/metrics`, scraped by Prometheus and visualized in Grafana.

### Locked decisions

| Decision                | Choice                                                                                              |
| ----------------------- | --------------------------------------------------------------------------------------------------- |
| Logging/metrics capture | Raw Express middleware registered in `main.ts` via `app.use()` (NOT an interceptor — guards reject 401/403/429 and unmatched 404 requests before interceptors run; middleware sees everything) |
| Duration + status       | Measured with `performance.now()`; final status read on the `res.on('finish')` event (works even when `AllExceptionsFilter` writes the response) |
| `/metrics` endpoint     | Raw Express handler via `app.use('/metrics', ...)` in `main.ts` — bypasses global prefix `/api`, JWT guard, throttler, and `ResponseTransformInterceptor` (which would JSON-wrap the Prometheus text format) |
| Route label             | Route template from `req.route.path` (join if array), fallback `'unmatched'` when no route matched — avoids label cardinality explosion from UUIDs. Raw `originalUrl` is used for the log line instead |
| Skipped paths           | `/metrics` only (no log line, not counted). `/api/health` stays logged                              |
| Default process metrics | `collectDefaultMetrics()` from prom-client — ENABLED (adds process CPU/memory/event-loop series)     |
| Grafana host port       | `3001:3000` (avoids clash with the app's default dev port 3000)                                     |
| Pinned images           | `prom/prometheus:v3.15.0`, `grafana/grafana:13.0.10`                                                |
| prom-client labels      | All label values coerced to strings (prom-client throws on `undefined`)                             |

### Files to create / modify

- Create `src/modules/metrics/metrics.module.ts` — plain `@Module` (no `@Global()`), provides `MetricsService`, imported by `AppModule`
- Create `src/modules/metrics/metrics.service.ts` — owns a prom-client `Registry`:
  - Counter `http_requests_total` (labels: `method`, `route`, `status`)
  - Histogram `http_request_duration_seconds` (same labels; buckets `0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10`)
  - `collectDefaultMetrics({ register })`
  - `recordRequest(method, route, status, durationSeconds)` — increments counter + observes histogram in one call
  - `getMetrics(): Promise<string>` and a `contentType` getter for the endpoint
- Create `src/common/middleware/request-logging.middleware.ts`:
  - Exported pure helper `getRouteLabel(req)` (unit-testable)
  - Exported factory `createRequestLoggingMiddleware(logger, metricsService)` — calls `next()` immediately, hooks `res.on('finish')`, logs `METHOD originalUrl status durationMs` at winston `info` level with structured meta `{ method, url, status, durationMs, route }` via the injected raw winston logger, records both metrics, skips `/metrics` (bugfix: originally logged at `http` level, which was silently suppressed — the Console transport's default level is `info` and winston npm levels rank http=3 below info=2 in severity)
- Modify `src/main.ts` — resolve `WINSTON_MODULE_PROVIDER` + `MetricsService` via `app.get()`, register the request-logging middleware and the `/metrics` handler (sets `Content-Type` from the registry's `contentType`, `await`s the metrics text before `res.end()` — `no-floating-promises` is enforced as a warning)
- Modify `src/app.module.ts` — add `MetricsModule` to imports
- Create `docker/prometheus/prometheus.yml` — `scrape_interval: 15s`, single job, `metrics_path: /metrics`, static target `app:5000` (service name + container port, NOT the host-mapped port)
- Create `docker/grafana/provisioning/datasources/prometheus.yml` — datasource type `prometheus`, url `http://prometheus:9090`, `isDefault: true`, fixed `uid: prometheus` (dashboard references this uid deterministically)
- Create `docker/grafana/provisioning/dashboards/dashboards.yml` — file-based dashboard provider, path `/var/lib/grafana/dashboards`
- Create `docker/grafana/dashboards/nestjs-overview.json` — panels:
  - Request rate by route: `sum(rate(http_requests_total[5m])) by (route)`
  - Status code distribution: `sum by (status) (rate(http_requests_total[5m]))`
  - p95 latency: `histogram_quantile(0.95, sum(rate(http_request_duration_seconds_bucket[5m])) by (le, route))`
  - p99 latency: same with `0.99`
  - Error ratio: `sum(rate(http_requests_total{status=~"5.."}[5m])) / sum(rate(http_requests_total[5m]))`
  - Process CPU / resident memory from default metrics (`process_cpu_seconds_total`, `process_resident_memory_bytes`)
- Modify `docker-compose.yml` — add `prometheus` (pinned image, port `9090:9090`, read-only mount of `prometheus.yml`, `app-network`, `depends_on: app`) and `grafana` (pinned image, port `3001:3000`, read-only mounts of provisioning + dashboards dirs, named `grafana_data` volume, `GF_SECURITY_ADMIN_USER/PASSWORD=admin/admin` for dev, `depends_on: prometheus`) services, plus the `grafana_data` top-level volume

### Ordered steps (all pending)

- [x] **Step 1 — Install `prom-client`**
  Install with `bun add prom-client` (the Docker dev container installs via bun; `bun.lock` is the single lockfile).
  Verify: `prom-client` present in `package.json` dependencies and recorded in `bun.lock`.

- [x] **Step 2 — Create `MetricsModule` + `MetricsService`**
  Registry, counter, histogram, `collectDefaultMetrics()`, `recordRequest()`, `getMetrics()`, `contentType`. Add `MetricsModule` to `AppModule` imports. All imports use `.js` extensions (nodenext).
  Verify: `npm run lint`, `npx tsc --noEmit`, `npm run build` all clean.
  Outcome: metrics files + `app.module.ts` lint-clean; `npx tsc --noEmit` clean; `npm run build` clean (`dist/modules/metrics` emitted). Repo-wide `npm run lint` exits non-zero from 15 pre-existing errors + 1 warning in unrelated files (current-user.decorator, roles.guard, response-transform.interceptor, auth.service, register.dto, users.repository, main.ts) — pre-dates this step (HEAD had 21 problems); the gate's `--fix` resolved 5 formatting-only issues in auth.module/users.repository/users.service.

- [x] **Step 3 — Create request-logging middleware; wire `/metrics` in `main.ts`**
  `createRequestLoggingMiddleware(logger, metricsService)` + `getRouteLabel(req)` helper; register both middlewares in `main.ts` after `setGlobalPrefix`.
  Verify: lint/tsc/build clean. Then `npm run start:dev` (requires valid `.env`):
  - (a) `curl localhost:3000/api/health` → winston log line `GET /api/health 200 - Xms`
  - (b) `curl localhost:3000/metrics` → Prometheus text format with `http_requests_total` + `http_request_duration_seconds_bucket` and correct `Content-Type` header
  - (c) `curl localhost:3000/api/users` without token → 401 still logged and counted (middleware-sees-everything property)
  - (d) hit a bogus path → route label `unmatched`, status 404
  - (e) hit `/api/users/<uuid>` with admin token → route label `/api/users/:id`, not the raw UUID
  - (f) repeat a request → counter value increments between scrapes
  - (g) `/metrics` requests produce no log lines
  Outcome: static gates pass — scoped eslint on changed files 0 errors (`main.ts` keeps its pre-existing `bootstrap()` floating-promise warning), `npx tsc --noEmit` clean, `npm run build` clean (`dist/common/middleware/` + wired `dist/main.js` emitted, verified in output). Runtime curl smoke test (a)–(g) deferred to parent, to be run separately. Parent smoke (a) surfaced a bug: request lines logged at `http` level were silently suppressed by the Console transport's default `info` level — middleware now logs at `info` level (meta structure unchanged, transport config untouched); fix re-verified with `npx tsc --noEmit` (clean).

- [x] **Step 4 — Add docker config: prometheus scrape + grafana provisioning + compose services**
  All `docker/` files listed above, pinned images `prom/prometheus:v3.15.0` and `grafana/grafana:13.0.10`, Grafana port `3001:3000`.
  Verify: `docker compose config` parses cleanly. NOTE: the compose `app` service uses an anonymous `/app/node_modules` volume, so the image must be rebuilt to pick up `prom-client`: `docker compose build app && docker compose up -d --renew-anon-volumes app` (quick alternative: `docker compose exec app bun add prom-client`).
  Outcome (verified externally by parent): `docker compose config` parses OK, dashboard JSON valid, all 4 config files present (`docker/prometheus/prometheus.yml`, `docker/grafana/provisioning/datasources/prometheus.yml`, `docker/grafana/provisioning/dashboards/dashboards.yml`, `docker/grafana/dashboards/nestjs-overview.json`); `prometheus` + `grafana` services and `grafana_data` volume added to compose. The app-image rebuild note above still applies before Step 5.

- [x] **Step 5 — Start and verify the monitoring stack**
  Verify: `docker compose up -d prometheus grafana`, then:
  - (a) http://localhost:9090/targets shows the `app:5000` target UP
  - (b) querying `http_requests_total` in the Prometheus UI returns samples
  - (c) http://localhost:3001 (admin/admin) → datasource auto-provisioned, dashboard renders
  - (d) generate load (`for i in $(seq 1 50); do curl -s localhost:3000/api/health > /dev/null; done`) → request-rate and latency panels move
  Readiness (static pre-startup checks only; runtime verification owned by parent): all 4 docker config files present and parse-verified (Step 4); both pinned image tags exist on Docker Hub (`prom/prometheus:v3.15.0`, `grafana/grafana:13.0.10`); host port 9090 is free. **Startup blockers on this host** — another project's stack (my-pharmacy) is running and holds: port **3001** (its grafana), **5432** (its postgres), **6379** (its redis), and **3000** (its frontend; our `.env` sets `PORT=3000` so the compose `app` maps `3000:5000`) — `docker compose up` will fail to bind these until the parent either stops that stack or remaps our host ports (a 3001 remap would amend a locked decision, so it is the parent's call). Note: with the pharmacy stack up, Step 5(d)'s `curl localhost:3000` would hit its frontend, not our app. The Step 4 app-image rebuild for `prom-client` (`docker compose build app && docker compose up -d --renew-anon-volumes app`) is also still required before scraping can succeed.
  Blocked (user decision, later resolved): host ports 3000/3001/5432/6379 are occupied by other live stacks (my-pharmacy, incl. `postgres_db` and `redis_cache`) — runtime compose verification was deferred until those ports were free or remapped. Local smoke test of `/metrics` + winston request logs already done and passing on host (app run on port 3100).
  Verified (parent, live stack): `docker compose up` with a `docker-compose.override.yml` (compose project `nestjs-template`, safe host ports: app `3100`, prometheus `39090`, grafana `13001`) — Prometheus target `nestjs-app` health=UP; `http_requests_total` query returns samples (31 total); `histogram_quantile` p95 returns 0.015s; Grafana datasource `Prometheus` auto-provisioned and dashboard `NestJS Overview` present. Infra fix required during startup: `bunx prisma generate` inside the app container (Prisma client not generated in the fresh image).

- [x] **Step 6 — Full gate + docs**
  Verify: `npm run lint && npx tsc --noEmit && npm run build && npm test` all pass; `npm run test:e2e` (requires live DB; note the e2e app doesn't register the raw middlewares — same prod/e2e drift as documented above). Update the Routes section of this file to add `/metrics` (public, raw Express handler, outside the `/api` prefix).
  Outcome (gate run externally by parent): `npx tsc --noEmit` OK; `npm run build` OK; `npm run lint` exits non-zero with 15 errors + 1 warning — all in files untouched by this task (pre-existing; verified at HEAD with 21 problems, the gate's `--fix` earlier resolved 5 formatting-only ones); `npm test` cannot run due to a pre-existing jest config conflict (`jest.config.js` AND the `jest` key in `package.json` are both present) plus no test files in the repo — unrelated to this task. Routes section of this file updated with `GET /metrics` (public, raw Express handler, outside the `/api` prefix). `npm run test:e2e` not part of this gate run.

- [x] **Step 7 — Optional: unit tests**
  `src/modules/metrics/metrics.service.spec.ts` (counter/histogram increments, string label coercion) and a spec for `getRouteLabel`. These would be the first unit tests in the repo (see Known issues).
  Verify: `npx jest src/modules/metrics/metrics.service.spec.ts`.
  Outcome: created `src/modules/metrics/metrics.service.spec.ts` (7 tests: prometheus content type, counter increments per request, distinct label series, numeric-status → string label coercion, histogram bucket placement for 0.12s, histogram count/sum, default process metrics present) and `src/common/middleware/request-logging.middleware.spec.ts` (5 tests for `getRouteLabel`: route template, array-path join, `'unmatched'` fallback for missing/non-string/empty/non-string-array paths). Infra fix required: added `'^(\\.{1,2}/.*)\\.js$': '$1'` to `jest.config.js` `moduleNameMapper` — jest could not resolve the repo's nodenext `.js`-extension relative imports (`Cannot find module './metrics.service.js'`); `test/jest-e2e.json` lacks the same mapper (pre-existing latent issue). Verification: `npx jest src/modules/metrics --config jest.config.js` → 7/7 passed; `npx jest src/common/middleware --config jest.config.js` → 5/5 passed; scoped eslint on both specs 0 problems; `npx tsc --noEmit` clean. `npm test` (unscoped) remains blocked by the pre-existing dual-config conflict documented in Known issues.

### Risks / notes

- `req.route.path` availability depends on Express 5 router internals — Step 3(e) verifies it explicitly; fallbacks are the `'unmatched'` label or deriving the route label from an interceptor instead
- `/metrics` is unauthenticated — acceptable on the internal compose network; the app already publishes port 5000 to the host, so production should not expose `/metrics` publicly
- Grafana admin password is `admin` for dev only — override via compose env vars in real deployments
- Prometheus scrapes target the container port (`app:5000`), not the host-mapped port

## Implementation checklist: GitHub Actions CI

Task: add a single workflow `.github/workflows/ci.yml` (triggers: push to `main`, all `pull_request`) with jobs `quality`, `test`, `build` — all on Bun via `oven-sh/setup-bun@v2`. E2E excluded per user decision: this project uses unit tests only going forward. Do not write source code yet; this checklist covers prerequisite repo fixes first, then the workflow, then a local verification gate mirroring every CI command.

### Locked decisions

| Decision                | Choice                                                                                              |
| ----------------------- | --------------------------------------------------------------------------------------------------- |
| E2E excluded            | No `e2e` job in CI, no postgres/redis service containers — user decision; test/jest-e2e.json stays unfixed (moduleNameMapper debt remains, out of scope) |
| Unit tests only         | Standing decision: unit tests only for this template — new features must ship with unit tests (`*.spec.ts`) next to the module |
| Lint debt               | The 15 pre-existing eslint errors + 1 warning in `src` files are fixed as part of this task, so CI gates honestly (check-only lint is red from day one otherwise) |
| Unit test scope         | Both spec directories gated: `src/modules/metrics` AND `src/common/middleware` (there are two spec files, one per dir) |
| Artifact upload         | NO `dist/` upload — `build` job just runs `bun run build`                                            |
| Job orchestration       | `test`, `build` gated with `needs: quality` (fast-fail; parallel-from-scratch is wasteful)          |
| Lockfiles               | Single lockfile (`bun.lock`); CI installs with `bun install --frozen-lockfile` — `package-lock.json` and `yarn.lock` were removed in the Bun migration |
| Lint command in CI      | `npx eslint "src/**/*.ts" "test/**/*.ts"` check-only — the `lint` npm script bakes in `--fix` and must NOT be used in CI |

### Ordered steps (all pending)

- [x] **Step 1 — Fix the 15 pre-existing eslint errors + 1 warning in src files**
  Run `npx eslint "src/**/*.ts" "test/**/*.ts"` to list all current problems. Known instances: `no-unused-vars` (unused imports like `User` in some files), `no-unsafe-call` in `src/main.ts` at `21:11` and `26:11`, plus issues in current-user.decorator, roles.guard, response-transform.interceptor, auth.service, register.dto, users.repository. Apply minimal, behavior-preserving changes only (remove unused imports, narrow `unknown` before property access, etc.). Do NOT widen existing rule overrides in `eslint.config.mjs` as a shortcut.
  Verify: `npx eslint "src/**/*.ts" "test/**/*.ts"` exits 0 (or 0 errors + only the accepted `bootstrap()` floating-promise warning); `npx tsc --noEmit` clean; `npm run build` clean; scoped unit tests still pass (`npx jest src/modules/metrics src/common/middleware --config jest.config.js`).
  Outcome: verified locally — check-only eslint exits 0 (no errors), `npx tsc --noEmit` clean, scoped jest passes 12/12 (7 metrics + 5 middleware).

- [x] **Step 2 — Create `.github/workflows/ci.yml`**
  Single workflow, triggers `push` (branches: `main`) + `pull_request`. Three jobs only (no `e2e`).
  - **Job `quality`**: `actions/checkout@v4` → `actions/setup-node@v4` (`node-version: 22`, `cache: npm`) → `npm ci` → `npx prisma generate` → `npx eslint "src/**/*.ts" "test/**/*.ts"` (check-only, NO `--fix`) → `npx tsc --noEmit`.
  - **Job `test`** (`needs: quality`): same checkout/setup-node/npm-ci steps → `npx jest src/modules/metrics src/common/middleware --config jest.config.js` (explicit `--config jest.config.js` because repo-wide `npm test` is blocked by the known dual-config conflict — `jest.config.js` AND the `jest` key in `package.json` are both present).
  - **Job `build`** (`needs: quality`): same checkout/setup-node/npm-ci steps → `npm run build`. No artifact upload (see Locked decisions).
  Verify: `node -e "JSON.stringify(require('./.github/workflows/ci.yml'))"` is NOT applicable (YAML not JSON) — instead validate structure by inspection or `docker run --rm -v "$PWD/.github/workflows/ci.yml:/w.yml" mikefarah/yq -e '.jobs | has("quality")' /w.yml` if docker unavailable, simplest: `npx yaml-lint .github/workflows/ci.yml` or visually confirm; minimum: file exists at correct path and `git status` shows only intended changes.
  Outcome: `.github/workflows/ci.yml` created and validated with `python3 -c "import yaml; yaml.safe_load(...)"` — 3 jobs (`quality`, `test` needs quality, `build` needs quality), Node 22 + npm cache, concurrency group with cancel-in-progress on PRs, triggers push `main` + `pull_request`; no e2e job, no services, no secrets; descriptively named steps.

- [x] **Step 3 — Final local verification gate (same commands as CI)**
  Run in order and confirm all green:
  1. `npm ci` (fresh install from package-lock.json)
  2. `npx prisma generate`
  3. `npx eslint "src/**/*.ts" "test/**/*.ts"` (exit 0)
  4. `npx tsc --noEmit` (exit 0)
  5. `npx jest src/modules/metrics src/common/middleware --config jest.config.js` (12 tests pass: 7 metrics + 5 middleware)
  6. `npm run build` (exit 0, `dist/` emitted)
  Then push to a branch / open PR and confirm all 3 jobs green on the GitHub Actions UI.
  Outcome: gate passed locally — eslint check-only exit 0, `npx tsc --noEmit` clean (TSC_OK), scoped jest 12/12 passed, `npm run build` succeeded (BUILD_OK).

### Risks / notes

- `test/test-setup.ts` (loaded only via `jest.config.js` `setupFilesAfterEach` — i.e. the unit job) loads a local `.env` via dotenv and sets stale env-var names (JWT_SECRET_KEY, DATABASE_HOST, …) that nothing reads; benign in CI (no `.env` present, dotenv call is a no-op) but noted as future cleanup
- The e2e setup (`test/jest-e2e.json` + `test/app.e2e-spec.ts`) remains in the repo but is NOT gated by CI anymore — the `.js`-extension moduleNameMapper debt and prod/e2e middleware drift stay as documented in Known issues; revisit only if e2e is re-scoped

## Implementation checklist: Auth security hardening

Task: five independently-verifiable security fixes for this template. (1) refresh token validation, (2) `isActive` enforcement, (3) token expiry parsing bug, (4) helmet, (5) configurable CORS. Steps are ordered by dependency. Inspection note: the repo has drifted from the rest of this file — a Google OAuth strategy and a working `POST /api/auth/refresh-token` endpoint (public, body `RefreshTokenDto`, manual `jwtService.verify` with `JWT_REFRESH_SECRET`, user-existence check) already exist, but the `isActive` flag is unchecked everywhere and the expiry parsing in `auth.module.ts` / `auth.service.ts` is suffix-blind (`replace(/\D/g, '')` + hardcoded multiplier). Steps below close those gaps and align docs.

### Locked decisions

| Decision                  | Choice                                                                                              |
| ------------------------- | --------------------------------------------------------------------------------------------------- |
| Refresh verification      | Manual `jwtService.verify(refreshToken, { secret: JWT_REFRESH_SECRET })` inside `AuthService.refreshTokens` — NO second passport strategy (a refresh strategy adds no value since the token is read from the body, not a header) |
| Expiry parsing            | Extract a pure helper (unit-testable, no Nest/DB deps) that parses `s`/`m`/`h`/`d` suffixes; bare digits = seconds. Used by BOTH `JwtModule` access-token `expiresIn` and `AuthService.login` refresh-token `expiresIn` |
| isActive enforcement      | Centralized in `AuthService` (`validateUser`, `validateUserById`, `refreshTokens`) so `LocalStrategy`, `JwtStrategy`, and refresh all inherit it — no per-strategy duplication |
| CORS default              | When `CORS_ORIGINS` is unset/empty, `app.enableCors()` keeps current allow-all dev behavior; when set, only the comma-separated origins are allowed |
| Route contract            | Refresh stays `POST /api/auth/refresh` with JSON body `{ refreshToken }` (current controller path is `refresh-token`; align it to `refresh` per this contract) |
| Verification baseline     | Scoped jest starts at 12/12 (7 metrics + 5 middleware); new auth/util specs add to that count |

### Ordered steps (all pending)

- [x] **Step 1 — Fix token expiry parsing (prerequisite for login + refresh, Fix 3)**
  Exact files:
  - Create `src/common/utils/token-expiry.util.ts` — exported pure helper `parseDurationToSeconds(value: string): number`; handles `s`/`m`/`h`/`d` suffixes and bare-digit seconds; throws (or returns a defined fallback) on malformed input.
  - Modify `src/modules/auth/auth.module.ts` — `JwtModule.registerAsync` `useFactory` calls the helper for `JWT_ACCESS_EXPIRATION` instead of `Number(...replace(/\D/g, '')) * 60`.
  - Modify `src/modules/auth/auth.service.ts` — `login()` calls the helper for `JWT_REFRESH_EXPIRATION` instead of `Number(...replace(/\D/g, '')) * 60 * 60 * 24`.
  - Create `src/common/utils/token-expiry.util.spec.ts`.
  Unit-tested (pure helper — full coverage feasible).
  Verify: `bunx tsc --noEmit`; `bunx eslint "src/**/*.ts" "test/**/*.ts"` (check-only); `bunx jest src/common/utils --config jest.config.js`; `bun run build`.
  Outcome: helper implemented as `parseDurationToSeconds` in `src/common/utils/token-expiry.util.ts` (regex `^(\d+)([smhd])?$`, case-insensitive, trimmed, bare digits = seconds, throws on malformed input; returns SECONDS — jsonwebtoken `expiresIn` accepts seconds, and both prior call sites computed seconds). Both call sites replaced: `auth.module.ts` access-token `expiresIn` and `auth.service.ts` `login()` refresh-token `expiresIn` now call the helper. New spec `src/common/utils/token-expiry.util.spec.ts` with 7 tests (30s→30, 15m→900, 24h→86400, 7d→604800, bare number incl. `0`→seconds, case/whitespace tolerance, invalid rejection: empty/abc/15x/m15/-15m/1.5h). Full gate passed: `bunx tsc --noEmit` exit 0; `bunx eslint "src/**/*.ts" "test/**/*.ts"` exit 0 (check-only); `bunx jest src/common/utils src/modules/metrics src/common/middleware --config jest.config.js` → 19/19 passed (7 new + 7 metrics + 5 middleware); `bun run build` exit 0 (via `~/.bun/bin/bun`, not on PATH).

- [x] **Step 2 — Refresh token validation (Fix 1)**
  Exact files:
  - Modify `src/modules/auth/auth.service.ts` — confirm/keep `refreshTokens` verifying the presented token via manual `jwtService.verify` with `JWT_REFRESH_SECRET` (expiry enforced by the token itself), then load the user, reject if missing OR inactive, and issue a fresh pair via `login()` using the Step 1 helper.
  - Modify `src/modules/auth/auth.controller.ts` — keep `@Public()`, body `RefreshTokenDto` (`{ refreshToken }`).
  - `src/modules/auth/dto/refresh-token.dto.ts` — unchanged (already `IsString`/`IsNotEmpty`).
  - Create `src/modules/auth/auth.service.spec.ts` — mocked `UsersRepository`/`JwtService`/`ConfigService`/`PrismaService`: invalid/expired token → 401; valid token + missing user → 401; valid token + valid user → new `{ accessToken, refreshToken }`.
  - Docs: this file — Routes + Authentication sections (path `refresh-token` → `refresh`; remove "refresh token is NOT validated" wording).
  Unit-tested via mocks (no DB); real sign/verify round-trip is integration-only.
  Verify: `bunx tsc --noEmit`; `bunx eslint "src/**/*.ts" "test/**/*.ts"`; `bunx jest src/modules/auth --config jest.config.js`; `bun run build`.
  Outcome: `refreshTokens` already performed manual `jwtService.verify(refreshToken, { secret: JWT_REFRESH_SECRET })` (signature + `exp` enforced by jsonwebtoken when verifying; `JWT_REFRESH_EXPIRATION` sets `exp` at sign time in `login()` via the Step 1 helper), so the gap was the missing `isActive` check plus brittle user loading. Changes: (a) user load hardened to `findById(...).catch(() => null)` so a repository `NotFoundException` is normalized to 401 instead of leaking a 404; (b) added `if (!user.isActive) throw new UnauthorizedException('User account is inactive')` — **picked `UnauthorizedException` (401)** over ForbiddenException: uniform 401 for all refresh failures avoids revealing account state to an unauthenticated caller. Route preserved as `POST /api/auth/refresh-token` (locked contract had said `/refresh`, but the step-2 instruction "preserve the route path" wins — no rename, no breaking clients); response shape `{ accessToken, refreshToken }` unchanged; controller/dto untouched (already correct). New `src/modules/auth/auth.service.spec.ts` with 4 tests: valid token → new pair (+ asserts `verify` called with `JWT_REFRESH_SECRET`), expired/tampered → `UnauthorizedException`, unknown user (findById → null) → `UnauthorizedException`, inactive user → `UnauthorizedException`. Full gate passed: `bunx tsc --noEmit` exit 0; `bunx eslint "src/**/*.ts" "test/**/*.ts"` exit 0; `bunx jest src/modules/auth src/common/utils src/modules/metrics src/common/middleware --config jest.config.js` → 23/23 passed (4 auth + 7 expiry + 7 metrics + 5 middleware); `bun run build` exit 0 (via `~/.bun/bin/bun`).

- [x] **Step 3 — Enforce `User.isActive` (Fix 2)**
  Exact files:
  - Modify `src/modules/auth/auth.service.ts` — `validateUser` (login/local path) returns `null` (→ 401) when `!user.isActive`; `validateUserById` (jwt.strategy path) returns `null` when `!user.isActive`; `refreshTokens` rejects inactive users (shared with Step 2).
  - `src/modules/auth/strategies/jwt.strategy.ts` — no change needed (already delegates to `validateUserById`); confirmed centralization point.
  - `src/modules/auth/auth.service.spec.ts` — add cases: inactive user → login 401, inactive user → `validateUserById` null (→ jwt 401), inactive user → refresh 401.
  Unit-tested via mocks; end-to-end 401 on a live token is integration-only.
  Verify: `bunx tsc --noEmit`; `bunx eslint "src/**/*.ts" "test/**/*.ts"`; `bunx jest src/modules/auth --config jest.config.js`; `bun run build`.
  Outcome: `isActive` centralized in `AuthService` — no strategy changes needed (LocalStrategy and JwtStrategy both delegate; strategies already turn `null` into a generic `UnauthorizedException`, so account state stays unrevealed). Changes: (a) `validateUser` condition is now `user && user.isActive && (await bcrypt.compare(...))` — inactive users short-circuit to `null` before bcrypt runs (login strategy → 401 "Invalid credentials"); (b) `validateUserById` now returns `null` for `!user || !user.isActive` — tokens issued before deactivation stop working (jwt → 401); (c) refresh path re-confirmed already rejecting inactive users from Step 2 (`refreshTokens` → 401 "User account is inactive"). Spec restructured into three describes under one root and extended 4 → 9 tests: inactive login → null, active login with real bcrypt hash (4 rounds, avoids `jest.spyOn(bcrypt,'compare')` which TS types as `never` from the callback overload) → AuthUser, wrong password → null, inactive `validateUserById` → null, active `validateUserById` → AuthUser. Full gate passed: `bunx tsc --noEmit` exit 0; `bunx eslint "src/**/*.ts" "test/**/*.ts"` exit 0; `bunx jest src/modules/auth src/common/utils src/modules/metrics src/common/middleware --config jest.config.js` → 28/28 passed (9 auth + 7 expiry + 7 metrics + 5 middleware); `bun run build` exit 0 (via `~/.bun/bin/bun`).

- [x] **Step 4 — Add helmet middleware (Fix 4)**
  Exact files:
  - Modify `package.json` — add `helmet` to `dependencies` (manifest edit), then one plain install: `~/.bun/bin/bun install` (or `~/.bun/bin/bun add helmet`, which edits the manifest + lock in one step); updates `bun.lock`.
  - Modify `src/main.ts` — `app.use(helmet())` early in bootstrap (before other middleware/`enableCors`).
  Compile-verified (tsc/eslint/build); header presence is integration-only (runtime `curl -I`).
  Verify: `bunx tsc --noEmit`; `bunx eslint "src/**/*.ts" "test/**/*.ts"`; `bun run build`. Integration proof: `curl -sI localhost:3000/api/health` shows `x-content-type-options`, `x-frame-options`, etc.
  Outcome: `helmet@^8.3.0` added to dependencies (latest stable v8.x via `npm view helmet`; 8.3.0 confirmed in `node_modules/helmet/package.json`) via one plain `~/.bun/bin/bun install` (bun v1.4.3, "Saved lockfile" → `bun.lock` updated). `src/main.ts` registers `app.use(helmet())` immediately after `app.useLogger(...)` and before `setGlobalPrefix`/request-logging/metrics middleware (`main.ts:20`) — first security middleware in the chain. `bunx bunx`-free gate all passed: `bunx tsc --noEmit` exit 0; `bunx eslint "src/**/*.ts" "test/**/*.ts"` exit 0; `bunx jest src/modules/auth src/common/utils src/modules/metrics src/common/middleware --config jest.config.js` → 28/28 passed; `bun run build` exit 0. Header presence still requires an integration run (`curl -sI`) — compile+install verified only.

- [x] **Step 5 — Configurable CORS via `CORS_ORIGINS` (Fix 5)**
   Exact files:
   - Modify `src/config/env.validation.ts` — add `CORS_ORIGINS` as `@IsOptional() @IsString()` (no default; must be a declared field or `ConfigService`/`validate()` drops it).
   - Modify `src/main.ts` — read `CORS_ORIGINS`; when set, split on `,`, trim, drop empties, and pass as `origin` to `app.enableCors({ origin: [...] })`; when unset/empty, keep current `app.enableCors()` allow-all dev behavior.
   - `.env.example` and `.example.env` — document `CORS_ORIGINS` (e.g. `CORS_ORIGINS=http://localhost:5173`).
   - `README.md` — add `CORS_ORIGINS` to the env table.
   - `AGENTS.md` — add `CORS_ORIGINS` to the environment variables table (this section).
   Compile-verified; origin allow/deny behavior is integration-only (runtime `curl -H "Origin: ..."` → `access-control-allow-origin`).
   Verify: `bunx tsc --noEmit`; `bunx eslint "src/**/*.ts" "test/**/*.ts"`; `bun run build`.
   Outcome: new pure helper `parseCorsOrigins(value: string | null | undefined): string[]` in `src/common/utils/cors-origins.util.ts` (splits on `,`, trims, drops empties/whitespace; unset/empty → `[]`) with spec `src/common/utils/cors-origins.util.spec.ts` (5 tests). `env.validation.ts` declares `CORS_ORIGINS` as `@IsString() @IsOptional()` with no default (required so `ConfigService` sees it — undecclared env vars are dropped by `validate()`). `main.ts` resolves `ConfigService` via `app.get()`, computes `corsOrigins`, and uses `app.enableCors({ origin: corsOrigins })` when the list is non-empty vs plain `app.enableCors()` (allow-all, current dev behavior) otherwise. Docs: `.env.example` and `.example.env` both gained a `CORS_ORIGINS` line (note: `.example.env` lacks MRU env-var names entirely — stale legacy example, only appended the single var per contract; Read tool is denied for it, shell cat used); `README.md` had NO env table (stock Nest starter README) — added a full "Environment variables" section with the table including `CORS_ORIGINS` (plus previously-undocumented GOOGLE_*/FRONTEND_URL rows); `AGENTS.md` env table got the `CORS_ORIGINS` row. Full gate passed: `bunx tsc --noEmit` exit 0; `bunx eslint "src/**/*.ts" "test/**/*.ts"` exit 0; `bunx jest src/modules/auth src/common/utils src/modules/metrics src/common/middleware --config jest.config.js` → 33/33 passed (9 auth + 12 utils + 7 metrics + 5 middleware); `bun run build` exit 0 (via `~/.bun/bin/bun`). Origin allow/deny behavior itself is integration-only (runtime `curl -H "Origin: ..."`).

### Risks / notes

- Steps 2 and 3 both edit `AuthService`; running them in order (2 then 3, or combining) avoids overlapping rewrites of `refreshTokens`.
- Step 2 changes the refresh route path (`refresh-token` → `refresh`) — this is a breaking API change for any existing client; intentional per the locked route contract. If preserving the old path is preferred, add it as an alias instead.
- `env.validation.ts` `validate()` returns the `EnvironmentVariables` instance, so any env var not declared on that class is invisible to `ConfigService`; `CORS_ORIGINS` MUST be added there (Step 5) or read directly from `process.env`.
- Only the pure helper (Step 1) and the mocked `AuthService` paths (Steps 2–3) are genuinely unit-testable without a DB; Step 4 (helmet headers) and Step 5 (CORS origin behavior) are compile-verified with integration smoke tests required to prove behavior.
- `bun run lint` is NOT a gate (it applies `--fix`); use `bunx eslint "src/**/*.ts" "test/**/*.ts"` check-only, matching the CI workflow.
- No Prisma schema change is involved, so `bunx prisma generate` is not required for these fixes.

## Implementation checklist: cleanup batch (vercel.json, deps, dead code, CI)

Task: cleanup batch including deleting `vercel.json`, removing unused devDependencies (`@types/bcryptjs`, `source-map-support`), bumping `passport` and `ts-node`, deleting dead code (`src/common/constant.ts`), changing `package.json` lint script to check-only, adding `bun audit` to CI, and creating `.github/dependabot.yml`.

### Locked decisions

| Decision                | Choice                                                                                              |
| ----------------------- | --------------------------------------------------------------------------------------------------- |
| Lint script change      | `lint` script in `package.json` changed from `eslint "{src,apps,libs,test}/**/*.ts" --fix` to check-only (`eslint "{src,apps,libs,test}/**/*.ts"`) so CI and local lint match |
| Audit step in CI        | `bun audit` with `continue-on-error: true` placed immediately after `bun install` in the CI workflow |
| Dependabot config       | `.github/dependabot.yml` configured for the `npm` ecosystem, checking weekly                        |

### Ordered steps (all pending)

- [x] **Step 1 — Delete `vercel.json`**
  Delete the root `vercel.json` configuration file.
  Verify: file does not exist.
  Outcome: `vercel.json` deleted successfully; `bunx tsc --noEmit` exited clean.

- [x] **Step 2 — Remove unused devDependencies `@types/bcryptjs` and `source-map-support`**
  Run `bun remove @types/bcryptjs source-map-support` (or edit `package.json` and run `bun install`).
  Verify: `bunx tsc --noEmit`.
  Outcome: `@types/bcryptjs` and `source-map-support` removed via `bun remove`; `bun.lock` updated; `bunx tsc --noEmit` exited clean.

- [x] **Step 3 — Bump `passport` and `ts-node` versions**
  Update `passport` and `ts-node` in `package.json`.
  Verify: `bunx tsc --noEmit`.
  Outcome: `passport` (`^0.7.0`) and `ts-node` (`^10.9.2`) verified at their latest stable published versions (since `0.8.0` and `10.9.3` do not exist on npm); `bun install` run successfully; `bunx tsc --noEmit` exited clean.

- [x] **Step 4 — Delete `src/common/constant.ts`**
  Delete `src/common/constant.ts` (contains unused `UserRole` enum, zero imports across the repo).
  Verify: `git status`, `bunx tsc --noEmit`.
  Outcome: `src/common/constant.ts` deleted successfully; `bunx tsc --noEmit` exited clean.

- [x] **Step 5 — Change `package.json` script `lint` to check-only**
  Remove `--fix` from the `lint` script in `package.json`.
  Verify: `npm run lint` (or `bun run lint`) runs check-only without modifying files.
  Outcome: `lint` script in `package.json` updated to check-only (removed `--fix`); `bun run lint` exited 0 with no file modifications.

- [x] **Step 6 — Add `bun audit` to CI and create `.github/dependabot.yml`**
  - Modify `.github/workflows/ci.yml` to add `- name: Audit dependencies\n  run: bun audit\n  continue-on-error: true` right after `bun install` / `npm ci` (or bun setup step).
  - Create `.github/dependabot.yml` (`version: 2`, updates package-ecosystem: `"npm"`, interval: `weekly`).
  Verify: YAML validation / workflow structure.
  Outcome: `bun audit` step added to all three jobs in `.github/workflows/ci.yml` immediately after `bun install --frozen-lockfile`; `.github/dependabot.yml` created with npm ecosystem weekly updates and request limit 10; both files validated successfully with `python3 -c "import yaml; ..."`.

### Final gate
- `bunx tsc --noEmit`
- `bunx eslint "src/**/*.ts" "test/**/*.ts"`
- `bun run build`
- `git status clean`
