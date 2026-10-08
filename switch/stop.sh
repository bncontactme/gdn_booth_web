#!/usr/bin/env bash
# ============================================================================
#  stop.sh — Apaga el Photo Booth (icono "Detener Photo Booth")
#  ---------------------------------------------------------------------
#  Le avisa a start.sh que ya no lo vuelva a abrir, cierra el navegador del
#  booth (solo ese; otro Chromium que este abierto no se toca) y deja la
#  pantalla como estaba.
# ============================================================================

set -u
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HERE/common.sh"

mkdir -p "$STATE_DIR"
touch "$STOP_FLAG"
log "Pidieron detener el booth."

# El navegador del booth es el unico que usa el perfil gdn-photobooth.
pkill -TERM -f -- "--user-data-dir=[^ ]*gdn-photobooth" 2>/dev/null

# Se espera a que start.sh termine y suelte el candado (hasta 10 s). Si no
# lo suelta, al navegador se le cierra a la fuerza.
for _ in $(seq 1 20); do
    if flock -n "$LOCK_FILE" true 2>/dev/null; then
        exit 0
    fi
    sleep 0.5
done
pkill -KILL -f -- "--user-data-dir=[^ ]*gdn-photobooth" 2>/dev/null
allow_sleep
log "El navegador no cerro solo; se cerro a la fuerza."
