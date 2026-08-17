import { API_TIMEOUT_MS, API_URL } from 'astro:env/server';
import type { APIRoute } from 'astro';

/*
 * Liveness and readiness for the systemd watchdog timer.
 *
 * `systemctl is-active` is not enough on its own: it reports "active" for a
 * process whose inner server has stopped answering, which is the exact failure
 * this endpoint exists to catch. infra/systemd/dashboard-eduai-health.timer
 * polls it and restarts only the unit that stopped responding.
 *
 * Deliberately terse. A health endpoint is unauthenticated by nature, so it
 * must not leak versions, paths, connection strings or upstream error bodies.
 */

export const prerender = false;

const BOOTED_AT = new Date().toISOString();

type UpstreamStatus = 'ok' | 'unreachable' | 'error';

async function checkApi(): Promise<UpstreamStatus> {
	try {
		const response = await fetch(`${API_URL.replace(/\/+$/, '')}/health`, {
			// Shorter than the app-wide timeout: a health probe that hangs is
			// itself a failure, and the watchdog is on a fixed interval.
			signal: AbortSignal.timeout(Math.min(API_TIMEOUT_MS, 3000)),
		});
		return response.ok ? 'ok' : 'error';
	} catch {
		return 'unreachable';
	}
}

export const GET: APIRoute = async () => {
	const api = await checkApi();

	return new Response(
		JSON.stringify({
			status: 'ok',
			bootedAt: BOOTED_AT,
			uptimeSeconds: Math.round(process.uptime()),
			api,
		}),
		{
			// 200 even when the API is unreachable. This reports whether *this*
			// process is alive; restarting Astro does not fix a downed NestJS, and
			// a watchdog that bounces us for an upstream failure just adds an
			// outage to an outage.
			status: 200,
			headers: {
				'content-type': 'application/json',
				'cache-control': 'no-store',
			},
		},
	);
};
