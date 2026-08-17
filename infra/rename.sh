#!/usr/bin/env bash
# Rebrands a clone of this template.
#
#   ./infra/rename.sh <new-name> <new-port>
#   ./infra/rename.sh panel-clinica 4326
#
# The project name and port are spread across ten files: package.json, the
# Astro config, four systemd units, two shell scripts, the Caddy vhost and the
# docs. Renaming by hand means missing one, and the one you miss is usually a
# systemd unit that then fights the original for its port. This does all of them
# and renames the unit files themselves.
#
# It refuses a port that another unit on this host already owns.

set -euo pipefail

OLD_NAME=dashboard-eduai
OLD_PORT=4325

NEW_NAME="${1:-}"
NEW_PORT="${2:-}"

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

die() { echo "error: $*" >&2; exit 1; }
note() { echo "  $*"; }

usage() {
	echo "usage: $0 <new-name> <new-port>" >&2
	echo "  new-name: lowercase, digits and dashes; becomes the package and unit name" >&2
	echo "  new-port: 1024-65535, must not be taken on this host" >&2
	exit 1
}

[[ -n $NEW_NAME && -n $NEW_PORT ]] || usage
[[ $NEW_NAME =~ ^[a-z][a-z0-9-]*$ ]] || die "name must be lowercase letters, digits and dashes"
[[ $NEW_PORT =~ ^[0-9]+$ && $NEW_PORT -ge 1024 && $NEW_PORT -le 65535 ]] || die "port out of range"

check_port_free() {
	if ss -ltn "sport = :${NEW_PORT}" 2>/dev/null | grep -q LISTEN; then
		die "port ${NEW_PORT} is in use. Run 'ss -ltnp' and pick another."
	fi
	if ls /etc/systemd/system/*.service >/dev/null 2>&1 &&
		grep -rqs "PORT=${NEW_PORT}\b" /etc/systemd/system/*.service; then
		die "port ${NEW_PORT} is already claimed by an installed systemd unit."
	fi
	note "port ${NEW_PORT} is free"
}

rewrite_contents() {
	local files
	# -l so we only rewrite files that actually contain something to change.
	mapfile -t files < <(
		grep -rl -e "$OLD_NAME" -e "$OLD_PORT" "$PROJECT_DIR" \
			--exclude-dir=node_modules --exclude-dir=dist --exclude-dir=.astro \
			--exclude-dir=.git --exclude=pnpm-lock.yaml 2>/dev/null || true
	)
	[[ ${#files[@]} -gt 0 ]] || { note "nothing to rewrite"; return; }
	for file in "${files[@]}"; do
		sed -i -e "s/${OLD_NAME}/${NEW_NAME}/g" -e "s/\b${OLD_PORT}\b/${NEW_PORT}/g" "$file"
		note "rewrote ${file#"$PROJECT_DIR"/}"
	done
}

rename_units() {
	local dir="${PROJECT_DIR}/infra/systemd"
	[[ -d $dir ]] || return
	for file in "$dir"/${OLD_NAME}*; do
		[[ -e $file ]] || continue
		local target="${dir}/$(basename "$file" | sed "s/${OLD_NAME}/${NEW_NAME}/")"
		mv "$file" "$target"
		note "renamed $(basename "$file") -> $(basename "$target")"
	done
}

main() {
	note "project: ${PROJECT_DIR}"
	note "${OLD_NAME}:${OLD_PORT} -> ${NEW_NAME}:${NEW_PORT}"
	check_port_free
	rewrite_contents
	rename_units

	echo
	echo "Done. Now, in order:"
	echo "  1. rm -rf node_modules dist .astro && pnpm install"
	echo "  2. bun run ci"
	echo "  3. edit the Stack table in AGENTS.md, it still describes the template"
	echo "  4. replace the copy in src/pages and src/components"
	echo "  5. set SITE_URL, ALLOWED_HOSTNAMES and API_URL in .env"
	echo
	echo "This script has now rewritten itself too, so it cannot be run twice."
}

main "$@"
