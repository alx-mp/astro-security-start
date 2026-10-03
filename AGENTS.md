# dashboard-eduai

Astro 7 BFF for the NestJS API. Hardened, meant to be copied as the starting
point for other projects. Keep it on current stable and keep these notes true.

## Stack

Checked 2026-10-03 against the registry and the installed binaries.

| Piece             | Pinned  | Latest  | Why not newer                                                   |
| ----------------- | ------- | ------- | --------------------------------------------------------------- |
| astro             | ^7.3.5  | 7.3.5   | current; 7.4.0-beta.1 is pre-release                            |
| @astrojs/node     | ^11.1.6 | 11.1.6  | current, peer `astro ^7.2.1`                                    |
| tailwindcss       | ^4.3.3  | 4.3.3   | current, as a Vite plugin                                       |
| @tailwindcss/vite | ^4.3.3  | 4.3.3   | peer `vite ^5.2 \|\| ^6 \|\| ^7 \|\| ^8`; Astro 7 ships Vite 8  |
| typescript        | ^6.0.3  | 7.0.2   | `@astrojs/check@0.9.10` peer is `^5.0.0 \|\| ^6.0.0`            |
| @biomejs/biome    | ^2.5.14 | 2.5.15  | 2.5.15 published 09-30 15:23 UTC, inside the 3-day gate         |
| vitest            | ^5.0.2  | 5.0.3   | 5.0.3 published 09-30 11:30 UTC, inside the 3-day gate          |
| @astrojs/check    | ^0.9.10 | 0.9.10  | current                                                         |
| @types/node       | ^26.6.3 | 26.6.4  | 26.6.4 published 10-01 22:39 UTC, inside the 3-day gate         |
| pnpm              | 12.8.1  | 12.8.1  | `latest` tag; pinned in `packageManager`, via corepack          |
| bun               | 1.3.13  | 1.4.2   | host binary at `/root/.bun/bin/bun`, shared with other services |
| node              | >=22.12 | 24.21.0 | floor comes from astro's own `engines`; host runs 24.15.0       |

The three gated rows clear by 2026-10-04 22:39 UTC. Rerun the update after that.

Port **4325**, not Astro's 4321: this host already runs Astro services on 4321,
4322, 4323 and 4331, each a systemd unit with `Restart=always`. Check
`ss -ltnp` before claiming a port for a copy of this template, and never
`fuser -k` one without checking the owner first.

## pnpm installs, bun runs

```sh
pnpm install            # dependencies
pnpm add <pkg>          # add one
pnpm update --latest    # move to current stable
pnpm audit              # advisories
pnpm audit signatures   # registry signatures of what is installed

bun run dev             # dev server on :4325
bun run build           # lockfiles -> astro check -> astro build
bun run preview         # serve the build
bun run lint            # biome check
bun run lint:fix        # biome check --write
bun run test            # vitest run
bun run ci              # lockfiles + lint + types + tests + build
```

`pnpm audit` has no `bun run` script; run it directly. Under pnpm 11 it could
not have one: `[run] bun = true` in `bunfig.toml` puts a `node` shim ahead of
the real binary, pnpm 11 needed `node:sqlite`, and Bun 1.3.13 does not
implement it. pnpm 12 is a native binary and does run under the shim (checked
2026-10-03).

`npm install` and `bun install` both fail, in three layers:

1. `engines.npm` / `engines.yarn` are the string `please-use-pnpm` and `.npmrc`
   sets `engine-strict=true`, so npm exits `EBADENGINE` before writing anything.
   pnpm only validates the `node` and `pnpm` keys and is unaffected.
2. `scripts/enforce-pnpm.mjs` runs as `preinstall`. This is what stops bun.
   `bunfig.toml` deliberately does not set `ignoreScripts`, which would skip it.
3. `scripts/check-lockfiles.mjs` catches the `--ignore-scripts` route by looking
   for a foreign lockfile. It runs first in `bun run build` and `bun run ci`.

## Rendering: on demand

`output: 'server'` with `@astrojs/node` in standalone mode. The build produces
`dist/server/entry.mjs`, a server that reads `HOST` and `PORT` and serves the
static assets itself. It speaks plain HTTP; Caddy terminates TLS in front.

Everything below is live because of that, and was inert while the output was
static: `security.checkOrigin`, `security.allowedDomains`, the body size limits,
and all of `src/middleware.ts`.

**The prerender trap.** A route with `export const prerender = true` is built
ahead of time and served by the adapter's static handler, which does **not** run
middleware. Measured on 2026-08-14: with `prerender = true` on `404.astro`, the
404 response carried 0 of 9 security headers. It is now on demand and every
route reports 9 of 9. If you do prerender a route, Caddy has to supply its
headers. Measured again on 2026-10-03 with Astro 7.3.5 and a throwaway
prerendered page: still 0 of 9, CSP only as a `<meta>` tag.

## Talking to NestJS

The browser talks to Astro; Astro talks to NestJS. `src/lib/api.ts` is the
server-side client, and it imports from `astro:env/server`, so importing it into
client code is a build error rather than a silent leak.

That shape is why `connect-src 'self'` in the CSP is honest, why there is no
CORS to configure, and why no API token has to survive in client code. If you
ever need a direct browser call, add that exact origin to `connect-src` and
accept that you now own CORS and token exposure on the NestJS side.

Every call is bounded by `API_TIMEOUT_MS`. A hung upstream without a timeout
exhausts sockets on this side.

## Security

- `security.csp` emits SHA-512 hashes for every bundled script and style. How it
  ships depends on the route, which the Astro docs do not mention: prerendered
  routes get a `<meta http-equiv>` tag, on-demand routes get a real
  `content-security-policy` response header
  (`astro/dist/core/fetch/fetch-state.js`). Not active under `astro dev`; test
  with `bun run build && bun run preview`.
- **Middleware must never call `headers.set('Content-Security-Policy', ...)`** —
  it would overwrite the policy Astro just built, hashes included, and the page
  would stop rendering. New directives go in `security.csp.directives`, an
  allow-list validated at config load. `src/middleware.test.ts` pins this.
- Caddy must not set a CSP either. Two policies intersect, and ours has no
  script-src hashes.
- **`checkOrigin` does not cover `application/json`.** It guards
  POST/PATCH/PUT/DELETE carrying `x-www-form-urlencoded`, `multipart/form-data`
  or `text/plain` — the three an HTML form can produce without CORS. The
  `jsonCsrf` handler in `src/middleware.ts` closes the JSON case. Verified live:
  cross-site 403, same-origin 200, no-Origin (server-to-server) 200.
- `security.allowedDomains` is fed by `ALLOWED_HOSTNAMES`. Behind Caddy it
  **must** be populated, or Astro ignores `X-Forwarded-Host` and builds every
  absolute URL from 127.0.0.1. Never `[{}]`; that trusts any host header.
- The adapter's `bodySizeLimit` defaults to 1 GB. Set to 2 MB here.
- Secrets go through `env.schema` with `access: 'secret'`, never `PUBLIC_`.
  `validateSecrets: true` fails the build instead of the first request.
- `@astrojs/node` enables sessions with filesystem storage automatically under
  SSR. Session data lands on disk unencrypted. NestJS owns auth here, so nothing
  writes to it — but if you start using `Astro.session`, know where it goes.
- `/health` is unauthenticated by nature. It returns status, boot time, uptime
  and one word about the API. No versions, no paths, no upstream error bodies.
  The Caddy template returns 404 for it from the internet.

Supply chain, all in `pnpm-workspace.yaml` (pnpm 11 and 12 ignore their own
settings in `.npmrc`, silently): `minimumReleaseAge: 4320` with
`minimumReleaseAgeStrict`, `trustPolicy: no-downgrade` scoped by
`trustPolicyIgnoreAfter: 43200` to the last 30 days, `blockExoticSubdeps`,
`allowBuilds` as an allow-list, `strictDepBuilds`, `strictPeerDependencies`,
`engineStrict`. pnpm 12 also checks the lockfile itself against the age and
trust rules before installing from it, frozen installs included
(`trustLockfile: false`), and stops on a key it does not recognise in that file.

`pnpm-lock.yaml` holds two YAML documents since pnpm 12: the pinned pnpm and its
platform binaries, with integrity hashes, then the dependency graph. A scanner
or SBOM tool that reads only the first document reports zero dependencies and
no error (https://pnpm.io/supply-chain-security).

`minimumReleaseAgeExclude` holds first-party Astro packages only. A caret range
cannot resolve on release day without it. Third-party entries are debt.

## Styling: Tailwind first

Tailwind 4 as the `@tailwindcss/vite` plugin, the way Astro documents it. Not
`@astrojs/tailwind`; that is the Tailwind 3 integration, and having both is how
a project ends up with two conflicting CSS builds.

No `tailwind.config.js` in v4 — configuration is CSS. Project tokens go in the
`@theme` block of `src/styles/global.css` and become utilities automatically:
`--color-brand-600` gives `bg-brand-600`. Use those instead of arbitrary values
like `bg-[#4f46e5]`, which a later redesign cannot find.

Plain CSS is for what utilities cannot express, in `global.css` under
`@layer base`: element defaults, `prefers-reduced-motion`, `:focus-visible`.
The `!important` in the reduced-motion block is the one correct use in the
codebase and carries a `biome-ignore` explaining why.

`src/components/Welcome.astro` is the conventions reference.

## Types

Everything is annotated. Nothing important is left to inference.

`src/middleware.ts` takes its types from `astro` and `sequence` from
`astro/middleware`, both real files, rather than the `astro:middleware` virtual
module. Virtual modules resolve through generated types, so when generation has
not run — or an editor caches a state from before `node_modules` existed —
`defineMiddleware` degrades to `any` and every parameter it was meant to type
follows, surfacing as `Parameter 'context' implicitly has an 'any' type ts(7006)`.

The test that proves it: delete `.astro/`, run `tsc --noEmit`, count implicit-any
hits. Zero.

`.astro` components declare an `interface Props`. `Layout.astro` requires
`title` — a page without one is a bug, and the type system should say so.

## Lint, format, test

Biome does lint and format for everything. One tool instead of ESLint + plugins
+ Prettier + a plugin matrix to keep in sync across many cloned projects.
`useSortedClasses` sorts Tailwind classes, the same algorithm as
`prettier-plugin-tailwindcss`.

In `.astro` files Biome checks the frontmatter only. It can read the markup
since 2.3, but behind `html.experimentalFullSupportEnabled`, which Biome 2.5
still calls experimental and which is off here. Until it is on, no rule sees
the template half, `useSortedClasses` included (measured 2026-10-03 with 2.5.14).

Vitest via `getViteConfig()`, which loads `astro.config.mjs` so `astro:env/server`
resolves inside tests. `src/middleware.test.ts` covers the two handlers that are
our own code rather than a framework setting. Vitest 5 keeps reporter output and
attachments under `.vitest/`; git and Biome both ignore it.

## TypeScript and the editor

`tsconfig.json` is one line: `extends: "astro/tsconfigs/strict"`. Astro 7's base
preset declares `include` and `exclude` with `${configDir}` (TypeScript 5.5+),
so restating them is duplication waiting to drift.

`postinstall` runs `astro sync`, so a fresh clone has `.astro/types.d.ts` right
after `pnpm install`. `.vscode/settings.json` points the editor at
`node_modules/typescript/lib` so it uses the same compiler as `bun run check`.

If the editor says **"File 'astro/tsconfigs/strict' not found"**, the config is
fine and the TS server is stale — that path resolves through astro's exports
map, so it only exists once `node_modules` does. Restart the TS server. Verify
from a shell rather than trusting the editor:

```sh
node_modules/.bin/tsc --showConfig   # prints the inherited options
node_modules/.bin/tsc --noEmit       # exits 0
bun run check                        # 0 errors
```

## Infra: dev unit installed, prod prepared

`dashboard-eduai-dev.service` was installed and enabled on 2026-08-17 (`install.sh --dev`); env values live in `/etc/dashboard-eduai.env`. The production unit, health timer and Caddy vhost stay prepared, not deployed. Read before running.

```
infra/systemd/dashboard-eduai.service          production SSR + hardening
infra/systemd/dashboard-eduai-dev.service      dev server with HMR
infra/systemd/dashboard-eduai-health.{service,timer}   /health watchdog, 45s
infra/install.sh                               idempotent installer
infra/stack.sh                                 status | restart | redeploy | logs
infra/rename.sh                                rebrand a clone: name + port
infra/caddy/site.caddy                         vhost template, reverse_proxy
```

Two details specific to this host, both already burnt in:

- `ExecStart` goes through `/bin/bash`. Node lives under `/root/.nvm`, SELinux
  labels it `cache_home_t`, and `init_t` may not `execve` that (203/EXEC).
  systemd can exec `/bin/bash`, and bash then execs node. `SELinuxContext` alone
  does not fix it.
- `install.sh` refuses to take a port held by a unit that is not ours. A blind
  `fuser -k 4325/tcp` has already killed a sibling service once.

`stack.sh status` compares the build timestamp against the newest source file.
A service up for three weeks serving pre-edit code looks perfectly healthy in
`systemctl status`; that drift check is why the script exists.

Secrets go in `/etc/dashboard-eduai.env`, mode 600. Unit files are world
readable.

`SITE_URL` and `ALLOWED_HOSTNAMES` are build inputs: `astro.config.mjs` reads
them when the build starts and the result is fixed inside `dist/`.
`stack.sh redeploy` takes both from that env file. A bare `bun run build` takes
them from the project `.env`, and a build made with localhost values answers
403 to its own forms once it is behind Caddy.

Three things about `infra/caddy/site.caddy`, measured on a first real deploy
(2026-10-03):

- All response headers live in one `header` block that Caddy defers, because
  it removes `Server`. A block that is not deferred sets its values before the
  proxy runs and the proxy appends the app's copies: five headers went out
  twice.
- No shared header snippet is imported next to it. A deferred snippet runs
  after a block written below it, and its `X-Frame-Options: SAMEORIGIN`
  replaced the `DENY` the app sends.
- `X-Forwarded-For` is overwritten with `{client_ip}`. Astro takes the first
  entry as `clientAddress`, and a CDN appends to whatever list the browser
  sent, so without the overwrite a visitor picks their own address.

Dev bind is pinned to `127.0.0.1` in `astro.config.mjs` (`server.host`): `false` let Node pick ::1 while every probe on this host asks 127.0.0.1.

Still open: the repository has no CI workflow, so nothing runs `bun run ci` on
push. Firewalld has no port for this app and no vhost is deployed.

## Reusing this as a template

The project name and the port appear in ten files: `package.json`,
`astro.config.mjs`, four systemd units, two shell scripts, the Caddy vhost and
the docs. Renaming by hand means missing one, and the one you miss is usually a
unit that then fights the original for its port.

```sh
./infra/rename.sh panel-clinica 4326
rm -rf node_modules dist .astro && pnpm install
bun run ci
```

`rename.sh` refuses a port that is listening or that an installed unit already
claims, rewrites every occurrence, and renames the unit files themselves.
Verified on 2026-08-14 against a throwaway copy: zero leftovers, clean install,
CI green, and the clone answered `/health` with 9 of 9 headers on its new port.

After renaming, four things are still yours to write: the Stack table in this
file, the copy in `src/pages` and `src/components`, the values in `.env`, and
the domain in `infra/caddy/site.caddy`.

## Updating

```sh
pnpm update --latest
bun run ci
```

Then update the version table. Two things to expect:

- A **peer dependency** blocking a major — that is why typescript sits on 6
  while 7 is out. Check with `pnpm view <pkg> peerDependencies`. pnpm 12 stops
  the whole update with `ERR_PNPM_PEER_DEP_ISSUES` and leaves `package.json`
  alone (pnpm 11 warned and wrote the bad range), so hold the blocked package
  back: `pnpm update --latest '!typescript'`.
- `ERR_PNPM_NO_MATURE_MATCHING_VERSION` means the release-age policy is working.
  Wait three days rather than adding an exclude entry.

After a **bun** upgrade, re-check `bunfig.toml`. bun.com documents the current
release (1.4.2 on 2026-10-03) while this host runs 1.3.13, and three keys
differ: `[install] dryRun` is ignored, `[install] frozenLockfile` blocks the
lockfile write but not the install, and `[run] noOrphans` does not exist. Two
are waiting there to be enabled.

Before a new Astro major, read the upgrade guide
(`https://docs.astro.build/en/guides/upgrade-to/v<N>/`) and re-check the config
reference: `security.csp` arrived in 6.0, `allowedDomains` in 5.14.2,
`serverIslandBodySizeLimit` in 6.0.

## Docs

- Astro config: https://docs.astro.build/en/reference/configuration-reference/
- Node adapter: https://docs.astro.build/en/guides/integrations-guide/node/
- Astro + Tailwind: https://docs.astro.build/en/guides/styling/#add-tailwind-4
- Astro testing: https://docs.astro.build/en/guides/testing/
- bunfig.toml: https://bun.com/docs/runtime/bunfig
- pnpm settings: https://pnpm.io/settings
- Biome: https://biomejs.dev/
