/// <reference types="vitest/config" />
import { getViteConfig } from 'astro/config';

/*
 * `getViteConfig()` loads astro.config.mjs and applies it to the test
 * environment, which is what makes `astro:env/server` resolve inside tests
 * instead of blowing up on an unknown module.
 * https://docs.astro.build/en/guides/testing/#vitest
 */
export default getViteConfig({
	test: {
		include: ['src/**/*.{test,spec}.{ts,tsx}'],
		environment: 'node',
		// Fail on an unhandled rejection instead of passing a green run that
		// swallowed the error.
		dangerouslyIgnoreUnhandledErrors: false,
	},
});
