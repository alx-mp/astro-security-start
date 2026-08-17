#!/usr/bin/env bash
# Installs the systemd units for dashboard-eduai. Idempotent: safe to re-run.
#
# Nothing here has been run yet. Read it, then:
#   sudo ./infra/install.sh          # production SSR server + health watchdog
#   sudo ./infra/install.sh --dev    # dev server with HMR instead
#
# It refuses to steal a port from a unit that is not ours, because that mistake
# has already been made once on this host: a blind `fuser -k 4325/tcp` killed
# gymlord-front-dev, which happened to be listening there.

set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
UNIT_DIR=/etc/systemd/system
ENV_FILE=/etc/dashboard-eduai.env
PORT=4325
MODE=production

[[ ${1:-} == "--dev" ]] && MODE=dev

die() { echo "error: $*" >&2; exit 1; }
note() { echo "  $*"; }

require_root() {
	[[ $EUID -eq 0 ]] || die "run as root"
}

# Refuse to continue if something we do not own holds the port.
check_port() {
	local holder
	holder="$(ss -ltnp "sport = :${PORT}" 2>/dev/null | awk 'NR>1' || true)"
	[[ -z $holder ]] && { note "port ${PORT} is free"; return; }

	local unit
	unit="$(systemctl list-units --type=service --state=running --no-legend 2>/dev/null \
		| awk '{print $1}' \
		| xargs -r -I{} sh -c 'systemctl show -p Environment {} 2>/dev/null | grep -q "PORT='"${PORT}"'" && echo {}' \
		| head -1 || true)"

	case "$unit" in
		dashboard-eduai*.service|"") note "port ${PORT} held by us or unattributed, continuing" ;;
		*) die "port ${PORT} belongs to ${unit}. Pick another port in astro.config.mjs and the units." ;;
	esac
}

# The node path is baked into the unit; verify it before writing a unit that
# would fail with a 203/EXEC that tells you nothing.
resolve_node() {
	local node_bin
	node_bin="$(command -v node || true)"
	[[ -x $node_bin ]] || die "node not found on PATH"
	echo "$node_bin"
}

seed_env_file() {
	if [[ -f $ENV_FILE ]]; then
		note "${ENV_FILE} exists, leaving it alone"
		return
	fi
	install -m 600 -o root -g root /dev/null "$ENV_FILE"
	cat >"$ENV_FILE" <<-EOF
		# Runtime environment for dashboard-eduai. Mode 600: this holds secrets.
		# Unit files are world readable, which is why none of this lives in them.
		SITE_URL=https://CHANGE-ME.example
		ALLOWED_HOSTNAMES=CHANGE-ME.example
		API_URL=http://127.0.0.1:3125
		API_TIMEOUT_MS=10000
		# API_TOKEN=
	EOF
	note "wrote ${ENV_FILE} — fill in SITE_URL, ALLOWED_HOSTNAMES and API_URL"
}

install_unit() {
	local src="$1" dst="${UNIT_DIR}/$(basename "$1")"
	sed -e "s#/home/apps/edu-master-ai/dashboard-eduai#${PROJECT_DIR}#g" \
		-e "s#/root/.nvm/versions/node/v24.15.0/bin/node#${NODE_BIN}#g" \
		"$src" >"$dst"
	chmod 644 "$dst"
	note "installed $(basename "$dst")"
}

main() {
	require_root
	NODE_BIN="$(resolve_node)"
	note "project: ${PROJECT_DIR}"
	note "node:    ${NODE_BIN}"
	note "mode:    ${MODE}"

	check_port
	seed_env_file

	# Only one of the two servers may own the port. Stop the other first.
	if [[ $MODE == dev ]]; then
		systemctl disable --now dashboard-eduai.service 2>/dev/null || true
		systemctl disable --now dashboard-eduai-health.timer 2>/dev/null || true
		install_unit "${PROJECT_DIR}/infra/systemd/dashboard-eduai-dev.service"
		systemctl daemon-reload
		systemctl enable --now dashboard-eduai-dev.service
	else
		systemctl disable --now dashboard-eduai-dev.service 2>/dev/null || true
		[[ -d ${PROJECT_DIR}/dist/server ]] || die "no build found. Run 'bun run build' first."
		install_unit "${PROJECT_DIR}/infra/systemd/dashboard-eduai.service"
		install_unit "${PROJECT_DIR}/infra/systemd/dashboard-eduai-health.service"
		install_unit "${PROJECT_DIR}/infra/systemd/dashboard-eduai-health.timer"
		systemctl daemon-reload
		systemctl enable --now dashboard-eduai.service
		systemctl enable --now dashboard-eduai-health.timer
	fi

	note "waiting for /health ..."
	for _ in $(seq 1 30); do
		if curl -fsS --max-time 2 "http://127.0.0.1:${PORT}/health" >/dev/null 2>&1; then
			note "healthy: $(curl -fsS "http://127.0.0.1:${PORT}/health")"
			return 0
		fi
		sleep 1
	done
	die "never became healthy. Check: journalctl -u dashboard-eduai -n 50"
}

main "$@"
