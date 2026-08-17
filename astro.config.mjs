// @ts-check

import node from '@astrojs/node';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig, envField } from 'astro/config';

// Canonical origin. Astro uses it for sitemaps, canonical links and absolute
// URLs, so a wrong value here quietly poisons every generated link. Override it
// per deployment instead of editing this file.
const site = process.env.SITE_URL ?? 'http://localhost:4325';

// Hostnames this app answers to behind a reverse proxy, comma separated.
// Read at config load because security.allowedDomains cannot use astro:env.
const allowedHostnames = (process.env.ALLOWED_HOSTNAMES ?? '')
	.split(',')
	.map((value) => value.trim())
	.filter(Boolean);

// https://docs.astro.build/en/reference/configuration-reference/
export default defineConfig({
	site,

	// On-demand rendering. This is what wakes up checkOrigin, allowedDomains,
	// the body size limits and src/middleware.ts — all of which were declared but
	// dormant while the output was static.
	output: 'server',

	// Standalone builds dist/server/entry.mjs, a server that starts on its own
	// and also serves the static assets. HOST and PORT come from the environment
	// at runtime, which is how the systemd unit configures it. It speaks plain
	// HTTP on purpose: Caddy terminates TLS in front.
	// https://docs.astro.build/en/guides/integrations-guide/node/
	adapter: node({
		mode: 'standalone',

		// The adapter's own ceiling on any request body, default 1 GB. A dashboard
		// that talks to a NestJS API has no business accepting a gigabyte, and the
		// default is a free denial-of-service. Astro's actionBodySizeLimit below is
		// narrower: it only covers Actions, not every route.
		bodySizeLimit: 2 * 1024 * 1024,
	}),

	// One canonical URL per page. '/about/' and '/about' returning the same
	// document is how caches end up with two entries for one page. Has to agree
	// with the try_files line in infra/caddy/site.caddy.
	trailingSlash: 'never',

	// Two routes claiming the same path is a bug, not a warning. Astro's default
	// is 'warn', which lets one route silently shadow the other in a build log
	// nobody reads.
	prerenderConflictBehavior: 'error',

	// Astro 7 reserves src/fetch.ts as routing configuration and loads it by
	// default. `fetch` is a common enough filename that someone will eventually
	// create one as an ordinary helper and have it executed as config. Set this
	// back to 'fetch' in the project that actually wants the feature.
	fetchFile: null,

	security: {
		// Reject cross-site POST/PATCH/PUT/DELETE whose Origin header does not
		// match the request URL. This is Astro's CSRF defence. On by default; kept
		// explicit so nobody removes it thinking it was never considered.
		// On-demand rendering only.
		checkOrigin: true,

		// Which X-Forwarded-Host values to trust. Now that this runs on demand
		// behind Caddy, an empty list means Astro ignores the forwarded host and
		// builds Astro.url from the internal bind address — every absolute URL and
		// redirect would point at 127.0.0.1. Populate ALLOWED_HOSTNAMES per
		// deployment. Never use [{}]: that trusts any host header sent to you.
		allowedDomains: allowedHostnames.map((hostname) => ({
			hostname,
			protocol: 'https',
		})),

		// Request body ceilings, both 1 MB by default. Raise them per project only
		// when a real upload needs it.
		actionBodySizeLimit: 1048576,
		serverIslandBodySizeLimit: 1048576,

		// Content Security Policy. Astro hashes every script and style it bundles
		// and emits script-src and style-src for you, so do not declare those two
		// here or you will fight the generated hashes.
		//
		// How it is delivered depends on the route, not on the project: Astro
		// picks `meta` for prerendered routes and a real `content-security-policy`
		// response header for on-demand ones. The docs only describe the meta case.
		//
		// That matters for frame-ancestors below. In a meta tag browsers ignore it,
		// so for the static build it is inert and Caddy supplies the real one. On a
		// route rendered on demand it arrives as a header and is enforced. Listing
		// it here costs nothing in the static case and is correct in the other.
		//
		// Do not have middleware call headers.set('Content-Security-Policy', ...).
		// Under SSR that overwrites the header Astro just built, hashes and all.
		//
		// Not active under `astro dev` (Vite injects its own inline code). Test it
		// with `bun run build && bun run preview`.
		csp: {
			algorithm: 'SHA-512',
			directives: [
				"default-src 'self'",
				"base-uri 'self'",
				"object-src 'none'",
				"frame-src 'none'",
				"frame-ancestors 'none'",
				"form-action 'self'",
				"img-src 'self' data: blob:",
				"font-src 'self'",
				// 'self' only, because the browser never talks to NestJS directly:
				// Astro calls it server-side (src/lib/api.ts). That is the whole point
				// of the BFF shape — no CORS to configure, no API origin published in
				// the markup, and no token that has to survive in client code. If you
				// ever do need a direct browser call, add that exact origin here and
				// accept that you now own CORS and token exposure on the NestJS side.
				"connect-src 'self'",
				"media-src 'self'",
				"manifest-src 'self'",
				"worker-src 'self' blob:",
				'upgrade-insecure-requests',
			],
		},
	},

	vite: {
		// Tailwind 4 ships as a Vite plugin. The old @astrojs/tailwind integration
		// is the Tailwind 3 path and is not used here — installing both is the
		// usual way people end up with two conflicting builds.
		// https://docs.astro.build/en/guides/styling/#add-tailwind-4
		plugins: [tailwindcss()],
	},

	markdown: {
		// Astro's default highlighter is Shiki, which styles code with inline
		// style attributes. CSP cannot hash those, so the build warns and the
		// colours would be dropped by the policy. Prism uses classes and a
		// stylesheet you ship yourself, which the policy is fine with.
		// See https://docs.astro.build/en/guides/syntax-highlighting/
		syntaxHighlight: 'prism',
	},

	server: {
		// Bind to localhost. Setting host: true exposes the dev server to the LAN,
		// and this box sits behind firewalld with only 2608, 80 and 443 open.
		// '127.0.0.1' pins the dev bind to IPv4 loopback. The old `false` let Node
		// resolve 'localhost' to ::1, and every probe on this host (installer,
		// watchdog, stack.sh, Caddy) speaks to 127.0.0.1 — the server answered on
		// one loopback while everything asked the other. Never `true`: that
		// exposes the dev server to the LAN.
		host: '127.0.0.1',

		// Not Astro's default 4321. This host already runs other Astro projects on
		// 4321, 4322, 4323 and 4331, each one a systemd unit with Restart=always,
		// so anything that grabs 4321 here gets into a fight it cannot win. One
		// fixed port per project, checked with `ss -ltnp` before you claim it.
		port: 4325,

		// Which Host headers the dev server answers to. Empty means localhost only,
		// which is what stops a DNS-rebinding page from talking to your dev server.
		// Never set this to true.
		allowedHosts: [],
	},

	image: {
		// SVGs can be built to burn arbitrary CPU in the image pipeline. Off by
		// default in Astro; kept explicit because turning it on is a real decision.
		dangerouslyProcessSVG: false,

		// Remote images are not optimised unless their origin is listed. Both empty
		// means local images only.
		domains: [],
		remotePatterns: [],
	},

	env: {
		// Typed environment variables. Reading them through astro:env instead of
		// process.env is what keeps a secret from being inlined into client code:
		// access 'secret' is server-only and Astro refuses to bundle it.
		schema: {
			PUBLIC_SITE_NAME: envField.string({
				context: 'client',
				access: 'public',
				default: 'EduAI',
			}),

			// Base URL of the NestJS API. Server context on purpose: the browser
			// never calls NestJS directly in this design, so the address does not
			// belong in the client bundle. See src/lib/api.ts.
			API_URL: envField.string({
				context: 'server',
				access: 'public',
				default: 'http://127.0.0.1:3125',
			}),

			// Seconds before an upstream call to NestJS is abandoned. Without a
			// timeout a slow API turns into exhausted Node sockets on this side.
			API_TIMEOUT_MS: envField.number({
				context: 'server',
				access: 'public',
				default: 10000,
			}),

			// Service credential for NestJS, if the API expects one for
			// server-to-server calls. `access: 'secret'` is what stops Astro from
			// ever inlining it into something the browser downloads.
			API_TOKEN: envField.string({
				context: 'server',
				access: 'secret',
				optional: true,
			}),
		},

		// Check secrets at build time, not on the first request that needs them.
		// A deploy that is missing an env var should fail in CI, not at 2am.
		validateSecrets: true,
	},

	// Nothing experimental is on.
	//
	// Worth knowing before anyone enables one: chromeDevtoolsWorkspace grants
	// Chrome DevTools write access to your project directory. It is a genuinely
	// useful feature and it is also a browser tab that can edit your source.
	experimental: {},
});
