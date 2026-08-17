import type { APIContext, MiddlewareHandler, MiddlewareNext } from 'astro';
// `astro/middleware` is a real subpath of the package, unlike the
// `astro:middleware` virtual module, so `sequence` arrives fully typed whether
// or not `astro sync` has run.
import { sequence } from 'astro/middleware';

/*
 * Types come from the `astro` package, not from the `astro:middleware` virtual
 * module, and every parameter is annotated rather than inferred.
 *
 * The reason is concrete. `defineMiddleware` only exists inside `astro:middleware`,
 * which is a virtual module resolved through the generated `.astro/types.d.ts`.
 * When that generation has not run, or an editor's TypeScript server is holding
 * a cache from before `node_modules` existed, the import resolves to `any`, and
 * every parameter it was supposed to type silently becomes an implicit `any`:
 *
 *   Parameter 'context' implicitly has an 'any' type. ts(7006)
 *
 * Annotating against `astro` — a real file on disk — means the signature holds
 * whatever the virtual module is doing. `defineMiddleware` was only ever an
 * identity function for inference; Astro looks for the `onRequest` export.
 */

/*
 * SECURITY_HEADERS covers the response headers that a CSP <meta> tag cannot.
 *
 * Content-Security-Policy is NOT one of them. Astro builds that itself from
 * security.csp in astro.config.mjs, and on an on-demand route it sends it as a
 * real response header. Calling headers.set('Content-Security-Policy', ...)
 * here would overwrite it, script and style hashes included, and the page would
 * stop rendering. Add directives to security.csp.directives instead.
 *
 * This runs per request now that output is 'server'. Routes that opt back into
 * prerendering with `export const prerender = true` are built ahead of time and
 * are served by the adapter without passing through here, so Caddy still needs
 * the same header list. infra/caddy/site.caddy carries it, and the two have to
 * be edited together.
 */

const SECURITY_HEADERS: Record<string, string> = {
	// Framing is covered by frame-ancestors in security.csp.directives. This is
	// the same rule for browsers old enough to need it spelled out.
	'X-Frame-Options': 'DENY',

	// Stop MIME sniffing. An uploaded .txt that looks like HTML stays a .txt.
	'X-Content-Type-Options': 'nosniff',

	// One year of HTTPS-only, matching the `secure_headers` snippet already
	// deployed in /etc/caddy/Caddyfile. Keep the two identical: a page served
	// with one max-age and a redirect served with another is the kind of
	// inconsistency that makes HSTS behave unpredictably. 31536000 is also the
	// floor hstspreload.org asks for, so the longer value buys nothing.
	'Strict-Transport-Security': 'max-age=31536000; includeSubDomains; preload',

	// Send the full URL to ourselves, only the origin to anyone else, nothing
	// when downgrading to http.
	'Referrer-Policy': 'strict-origin-when-cross-origin',

	// Hardware and ambient APIs are off until a feature asks for one.
	'Permissions-Policy':
		'accelerometer=(), autoplay=(), camera=(), display-capture=(), encrypted-media=(), fullscreen=(self), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), midi=(), payment=(), usb=(), xr-spatial-tracking=()',

	// Cut the window.opener link so a popup cannot reach back into this page.
	'Cross-Origin-Opener-Policy': 'same-origin',

	// Other origins cannot load our responses as a subresource.
	'Cross-Origin-Resource-Policy': 'same-origin',

	// Ask for our own agent cluster, which keeps this origin out of a shared
	// process with same-site siblings.
	'Origin-Agent-Cluster': '?1',

	// No speculative DNS lookups for links we happen to render.
	'X-DNS-Prefetch-Control': 'off',

	// Deliberately absent: Cross-Origin-Embedder-Policy. require-corp blocks every
	// cross-origin image, font and script that does not opt in with CORP headers,
	// which breaks most real projects on day one. Turn it on per project once you
	// know what you embed, and only if you need crossOriginIsolated.
};

export const securityHeaders: MiddlewareHandler = async (
	_context: APIContext,
	next: MiddlewareNext,
): Promise<Response> => {
	const response = await next();
	for (const [header, value] of Object.entries(SECURITY_HEADERS)) {
		response.headers.set(header, value);
	}
	return response;
};

/*
 * CSRF for JSON, which Astro's own check does not cover.
 *
 * `security.checkOrigin` compares Origin against the request URL, but only for
 * POST/PATCH/PUT/DELETE carrying application/x-www-form-urlencoded,
 * multipart/form-data or text/plain. Those three are the content types an HTML
 * form can produce without CORS, so that is the set Astro guards.
 *
 * application/json is outside it. A JSON body does trigger a CORS preflight, so
 * a browser will not deliver a cross-site JSON POST to us in the first place —
 * which is exactly why this is easy to forget, and why it stops being true the
 * moment someone relaxes CORS upstream or a client sends a content type that
 * sneaks past. Checking Origin ourselves costs one comparison.
 */

const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function isCrossOrigin(request: Request, siteOrigin: string): boolean {
	const origin = request.headers.get('origin');
	// No Origin header at all: not a browser-initiated cross-site request.
	// Server-to-server callers (including NestJS) land here.
	if (origin === null) return false;
	return origin !== siteOrigin;
}

export const jsonCsrf: MiddlewareHandler = async (
	context: APIContext,
	next: MiddlewareNext,
): Promise<Response> => {
	const { request, url } = context;
	const contentType = request.headers.get('content-type') ?? '';

	if (
		UNSAFE_METHODS.has(request.method) &&
		contentType.includes('application/json') &&
		isCrossOrigin(request, url.origin)
	) {
		return new Response('Cross-site request blocked', { status: 403 });
	}

	return next();
};

/*
 * Requests run left to right; responses unwind right to left. securityHeaders
 * is first so that it sees the final Response, including the 403 that jsonCsrf
 * may return without ever reaching a route.
 */
export const onRequest: MiddlewareHandler = sequence(securityHeaders, jsonCsrf);
