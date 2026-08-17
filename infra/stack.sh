#!/usr/bin/env bash
# Day-to-day control for dashboard-eduai.
#
#   ./infra/stack.sh status     unit state, health, and whether the build is stale
#   ./infra/stack.sh restart    restart the running unit
#   ./infra/stack.sh redeploy   pnpm install, build, restart, verify health
#   ./infra/stack.sh logs       follow the journal
#
# `status` compares the build timestamp against the newest source file. That
# drift check is the whole reason this script exists: a service that has been
# up for three weeks serving code from before your last edit looks perfectly
# healthy in `systemctl status`.

set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT=4325

active_unit() {
	for unit in dashboard-eduai.service dashboard-eduai-dev.service; do
		if systemctl is-active --quiet "$unit" 2>/dev/null; then
			echo "$unit"
			return
		fi
	done
	echo ""
}

newest_source() {
	find "${PROJECT_DIR}/src" "${PROJECT_DIR}/astro.config.mjs" "${PROJECT_DIR}/package.json" \
		-type f -newermt '@0' -printf '%T@\n' 2>/dev/null | sort -rn | head -1
}

check_drift() {
	local built src
	[[ -f ${PROJECT_DIR}/dist/server/entry.mjs ]] || { echo "  build:  none"; return; }
	built="$(stat -c %Y "${PROJECT_DIR}/dist/server/entry.mjs")"
	src="$(newest_source)"
	src="${src%%.*}"
	if [[ -n $src && $src -gt $built ]]; then
		echo "  build:  STALE — source is newer than dist/. Run '$0 redeploy'."
	else
		echo "  build:  current ($(date -d "@${built}" '+%Y-%m-%d %H:%M'))"
	fi
}

cmd_status() {
	local unit; unit="$(active_unit)"
	echo "dashboard-eduai"
	echo "  unit:   ${unit:-none running}"
	[[ -n $unit ]] && echo "  since:  $(systemctl show -p ActiveEnterTimestamp --value "$unit")"
	local health
	health="$(curl -fsS --max-time 3 "http://127.0.0.1:${PORT}/health" 2>/dev/null || echo '')"
	echo "  health: ${health:-no response on ${PORT}}"
	check_drift
}

cmd_restart() {
	local unit; unit="$(active_unit)"
	[[ -n $unit ]] || { echo "nothing running"; exit 1; }
	systemctl restart "$unit"
	cmd_status
}

cmd_redeploy() {
	cd "$PROJECT_DIR"
	pnpm install --frozen-lockfile
	bun run build
	cmd_restart
}

cmd_logs() {
	local unit; unit="$(active_unit)"
	journalctl -u "${unit:-dashboard-eduai.service}" -f -n 100
}

case "${1:-status}" in
	status) cmd_status ;;
	restart) cmd_restart ;;
	redeploy) cmd_redeploy ;;
	logs) cmd_logs ;;
	*) echo "usage: $0 {status|restart|redeploy|logs}" >&2; exit 1 ;;
esac
