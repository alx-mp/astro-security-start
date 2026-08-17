import { API_TIMEOUT_MS, API_TOKEN, API_URL } from 'astro:env/server';

/*
 * Server-side client for the NestJS API.
 *
 * Import this from `.astro` frontmatter, endpoints and middleware only. It
 * reads from `astro:env/server`, so importing it into anything that runs in the
 * browser is a build error rather than a silent leak — which is the reason the
 * credentials live there instead of in `import.meta.env`.
 *
 * The shape is deliberate. The browser talks to Astro; Astro talks to NestJS.
 * Nothing about the API's address or its token reaches client code, there is no
 * CORS to configure, and `connect-src 'self'` in the CSP stays honest.
 */

export class ApiError extends Error {
	readonly status: number;
	readonly url: string;
	readonly body: string;

	constructor(status: number, url: string, body: string) {
		super(`${status} from ${url}`);
		this.name = 'ApiError';
		this.status = status;
		this.url = url;
		this.body = body;
	}
}

export interface ApiRequestOptions extends Omit<RequestInit, 'body'> {
	/** Serialised as JSON. Use `raw` for anything else. */
	json?: unknown;
	/** Passed through untouched, for form data or a stream. */
	raw?: BodyInit;
	/** Forwarded to NestJS, so the API sees the end user's session. */
	token?: string;
}

function buildHeaders(options: ApiRequestOptions): Headers {
	const headers = new Headers(options.headers);
	headers.set('accept', 'application/json');
	if (options.json !== undefined) {
		headers.set('content-type', 'application/json');
	}
	// A caller-supplied token wins: it represents the end user, while API_TOKEN
	// is this service's own identity.
	const bearer = options.token ?? API_TOKEN;
	if (bearer && !headers.has('authorization')) {
		headers.set('authorization', `Bearer ${bearer}`);
	}
	return headers;
}

function resolve(path: string): string {
	// A leading slash on `path` would otherwise discard any base path in
	// API_URL, so join them by hand instead of trusting URL semantics.
	return `${API_URL.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
}

/**
 * Calls the API and parses the JSON response.
 *
 * @throws {ApiError} when the response status is not ok.
 */
export async function apiFetch<T>(path: string, options: ApiRequestOptions = {}): Promise<T> {
	const { json, raw, token: _token, ...init } = options;
	const url = resolve(path);

	const response = await fetch(url, {
		...init,
		headers: buildHeaders(options),
		body: json !== undefined ? JSON.stringify(json) : raw,
		// Every upstream call is bounded. Without this a hung NestJS holds a
		// socket here until the process runs out of them.
		signal: init.signal ?? AbortSignal.timeout(API_TIMEOUT_MS),
	});

	if (!response.ok) {
		throw new ApiError(response.status, url, await response.text().catch(() => ''));
	}

	if (response.status === 204) {
		return undefined as T;
	}

	return (await response.json()) as T;
}

export const api = {
	get: <T>(path: string, options?: ApiRequestOptions): Promise<T> =>
		apiFetch<T>(path, { ...options, method: 'GET' }),
	post: <T>(path: string, json?: unknown, options?: ApiRequestOptions): Promise<T> =>
		apiFetch<T>(path, { ...options, method: 'POST', json }),
	patch: <T>(path: string, json?: unknown, options?: ApiRequestOptions): Promise<T> =>
		apiFetch<T>(path, { ...options, method: 'PATCH', json }),
	put: <T>(path: string, json?: unknown, options?: ApiRequestOptions): Promise<T> =>
		apiFetch<T>(path, { ...options, method: 'PUT', json }),
	delete: <T>(path: string, options?: ApiRequestOptions): Promise<T> =>
		apiFetch<T>(path, { ...options, method: 'DELETE' }),
} as const;
