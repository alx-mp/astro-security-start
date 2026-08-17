#!/usr/bin/env node
/*
 * Fails if a lockfile from another package manager shows up.
 *
 * The preinstall guard in enforce-pnpm.mjs catches the common case, but
 * `npm install --ignore-scripts` and `bun install --ignore-scripts` skip
 * lifecycle scripts entirely. What they cannot skip is writing their lockfile,
 * so that is what we look for. Wire this into CI and into the build script.
 */

import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const forbidden = [
	['package-lock.json', 'npm'],
	['npm-shrinkwrap.json', 'npm'],
	['yarn.lock', 'yarn'],
	['bun.lock', 'bun'],
	['bun.lockb', 'bun'],
];

const found = forbidden.filter(([file]) => existsSync(join(root, file)));

if (found.length > 0) {
	console.error('\nForeign lockfiles present:\n');
	for (const [file, manager] of found) {
		console.error(`  ${file}  (written by ${manager})`);
	}
	console.error('\nDelete them and run "pnpm install". pnpm-lock.yaml is the only');
	console.error('lockfile this project tracks.\n');
	process.exit(1);
}

if (!existsSync(join(root, 'pnpm-lock.yaml'))) {
	console.error('\npnpm-lock.yaml is missing. Run "pnpm install" to create it.\n');
	process.exit(1);
}

console.log('Lockfiles OK: pnpm-lock.yaml only.');
