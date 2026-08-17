import type { APIContext, MiddlewareNext } from 'astro';
import { describe, expect, it } from 'vitest';
import { jsonCsrf, securityHeaders } from './middleware';

/*
 * These two handlers are the only security control in this project that is our
 * own code rather than a framework setting, so they are the ones worth pinning
 * down. Everything else (CSP hashes, checkOrigin, allowedDomains) is Astro's
 * and is verified against a running server instead.
 */

const SITE = 'https://dashboard.example';

function contextFor(url: string, request: Request): APIContext {
	// Only `request` and `url` are read by the handlers under test. Casting is
	// honest here: building a full APIContext would test Astro, not us.
	return { request, url: new URL(url) } as APIContext;
}

function jsonRequest(method: string, origin?: string): Request {
	const headers = new Headers({ 'content-type': 'application/json' });
	if (origin !== undefined) headers.set('origin', origin);
	return new Request(SITE, { method, headers, body: '{}' });
}

const passthrough: MiddlewareNext = async () => new Response('ok', { status: 200 });

describe('jsonCsrf', () => {
	it('blocks a cross-origin JSON POST', async () => {
		const request = jsonRequest('POST', 'https://evil.example');
		const response = await jsonCsrf(contextFor(SITE, request), passthrough);
		expect(response?.status).toBe(403);
	});

	it.each(['PUT', 'PATCH', 'DELETE'])('blocks a cross-origin JSON %s', async (method) => {
		const request = jsonRequest(method, 'https://evil.example');
		const response = await jsonCsrf(contextFor(SITE, request), passthrough);
		expect(response?.status).toBe(403);
	});

	it('allows a same-origin JSON POST', async () => {
		const request = jsonRequest('POST', SITE);
		const response = await jsonCsrf(contextFor(SITE, request), passthrough);
		expect(response?.status).toBe(200);
	});

	it('allows a request with no Origin header, which is how NestJS calls us', async () => {
		const request = jsonRequest('POST');
		const response = await jsonCsrf(contextFor(SITE, request), passthrough);
		expect(response?.status).toBe(200);
	});

	it('leaves GET alone even from another origin', async () => {
		const request = new Request(SITE, {
			method: 'GET',
			headers: { origin: 'https://evil.example' },
		});
		const response = await jsonCsrf(contextFor(SITE, request), passthrough);
		expect(response?.status).toBe(200);
	});

	it('does not touch form posts, which security.checkOrigin already covers', async () => {
		const request = new Request(SITE, {
			method: 'POST',
			headers: {
				'content-type': 'application/x-www-form-urlencoded',
				origin: 'https://evil.example',
			},
			body: 'a=1',
		});
		const response = await jsonCsrf(contextFor(SITE, request), passthrough);
		expect(response?.status).toBe(200);
	});
});

describe('securityHeaders', () => {
	it('stamps every header on the response', async () => {
		const request = new Request(SITE);
		const response = await securityHeaders(contextFor(SITE, request), passthrough);

		expect(response?.headers.get('x-frame-options')).toBe('DENY');
		expect(response?.headers.get('x-content-type-options')).toBe('nosniff');
		expect(response?.headers.get('referrer-policy')).toBe('strict-origin-when-cross-origin');
		expect(response?.headers.get('cross-origin-opener-policy')).toBe('same-origin');
		expect(response?.headers.get('origin-agent-cluster')).toBe('?1');
	});

	it('never sets Content-Security-Policy, which would clobber Astro hashes', async () => {
		const withCsp: MiddlewareNext = async () =>
			new Response('ok', {
				headers: { 'content-security-policy': "script-src 'self' 'sha512-abc'" },
			});

		const response = await securityHeaders(contextFor(SITE, new Request(SITE)), withCsp);
		expect(response?.headers.get('content-security-policy')).toBe("script-src 'self' 'sha512-abc'");
	});

	it('keeps the HSTS max-age in step with the Caddy secure_headers snippet', async () => {
		const response = await securityHeaders(contextFor(SITE, new Request(SITE)), passthrough);
		expect(response?.headers.get('strict-transport-security')).toBe(
			'max-age=31536000; includeSubDomains; preload',
		);
	});
});
