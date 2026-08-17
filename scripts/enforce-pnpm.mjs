#!/usr/bin/env node
/*
 * Blocks every package manager except pnpm.
 *
 * This runs as the `preinstall` lifecycle script. npm, pnpm, yarn and bun all
 * execute the root package's preinstall before they touch node_modules, and all
 * of them export npm_config_user_agent first, so one script covers all four.
 *
 * Measured on this host on 2026-08-14:
 *   npm  11.12.1 -> "npm/11.12.1 node/v24.15.0 linux x64 workspaces/false"
 *   pnpm 11.1.1  -> "pnpm/11.1.1 npm/? node/v24.15.0 linux x64"
 *   bun  1.3.13  -> "bun/1.3.13 npm/? node/v24.3.0 linux x64"
 *
 * The required version comes from package.json "packageManager" so there is
 * only one place to bump it.
 *
 * A lifecycle guard is not a security boundary. `--ignore-scripts` walks right
 * past it. The backstops for that are bunfig.toml (frozenLockfile with no
 * bun.lock present) and the lockfile check in scripts/check-lockfiles.mjs.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(readFileSync(join(here, '..', 'package.json'), 'utf8'));

const declared = manifest.packageManager ?? 'pnpm@11.1.1';
const [wantedName, wantedVersion = ''] = declared.split('@');
const wantedMajor = Number.parseInt(wantedVersion, 10) || 0;

const agent = process.env.npm_config_user_agent ?? '';
const execPath = process.env.npm_execpath ?? '';

// pnpm does not always export npm_config_user_agent (it skipped it under
// `pnpm install --frozen-lockfile` on 2026-08-14), so fall back to the path of
// the binary that spawned us before giving up. npm points at npm-cli.js, bun
// points at the bun binary itself.
function identify() {
	if (agent !== '') {
		const [name, version = ''] = agent.split(' ')[0].split('/');
		return { name, version, source: `npm_config_user_agent="${agent}"` };
	}
	const source = `npm_execpath="${execPath}"`;
	if (/[\\/]bun(\.exe)?$/.test(execPath)) return { name: 'bun', version: '', source };
	if (/npm-cli\.js$/.test(execPath)) return { name: 'npm', version: '', source };
	if (/yarn/.test(execPath)) return { name: 'yarn', version: '', source };
	if (/pnpm/.test(execPath)) return { name: 'pnpm', version: '', source };
	return null;
}

const detected = identify();

// No package manager left a trace. Someone ran `node scripts/...` by hand,
// which is fine, so say what we saw and get out of the way.
if (detected === null) {
	console.warn(
		'[enforce-pnpm] no package manager detected in the environment; skipping the check.',
	);
	process.exit(0);
}

const { name, version } = detected;
const major = Number.parseInt(version, 10) || 0;

function refuse(reason, hint) {
	const bar = '='.repeat(72);
	console.error(`\n${bar}`);
	console.error(`  Install refused: ${reason}`);
	console.error(bar);
	console.error(`  This project installs dependencies with ${wantedName} only.`);
	console.error(`  Detected: ${detected.source}`);
	console.error('');
	console.error(`  ${hint}`);
	console.error('');
	console.error('  Reminder on the split of duties here:');
	console.error(`    dependencies  ->  ${declared}   (pnpm install / pnpm add / pnpm remove)`);
	console.error('    scripts+build ->  bun          (bun run dev / bun run build)');
	console.error(`${bar}\n`);
	process.exit(1);
}

if (name !== wantedName) {
	refuse(
		`${name || 'unknown package manager'} is not allowed`,
		`Run "corepack pnpm install" or plain "pnpm install" instead.`,
	);
}

if (wantedMajor && major && major < wantedMajor) {
	refuse(
		`pnpm ${version} is older than the required major ${wantedMajor}`,
		`Run "corepack use ${declared}" to pick up the pinned version.`,
	);
}
