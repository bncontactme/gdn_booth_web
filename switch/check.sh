#!/usr/bin/env bash
# ============================================================================
#  check.sh — Revisa que el Switch tenga todo para el photo booth
#  ---------------------------------------------------------------------
#  Solo mira, no cambia nada. Correlo con la camara y el boton conectados:
#      bash check.sh
# ============================================================================

set -u
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HERE/common.sh"

ok()   { printf '  [OK]    %s\n' "$*"; }
warn() { printf '  [OJO]   %s\n' "$*"; }
bad()  { printf '  [FALLA] %s\n' "$*"; }
section() { printf '\n== %s\n' "$*"; }

section "Sistema"
if [ -r /proc/device-tree/model ]; then
    ok "$(tr -d '\0' </proc/device-tree/model)"
fi
if [ -r /etc/os-release ]; then
    . /etc/os-release
    ok "${PRETTY_NAME:-Linux} (kernel $(uname -r))"
fi
if command -v free >/dev/null 2>&1; then
    free -h | awk '/^Mem:/ { print "  [OK]    Memoria: " $2 " en total, " $7 " libre" }'
fi

section "Navegador"
if BROWSER="$(find_browser)"; then
    version="$("$BROWSER" --version 2>/dev/null | head -n 1)"
    if is_snap "$BROWSER"; then
        warn "$BROWSER es el snap (${version:-?}): en el Switch no usa la grafica."
        warn "Instala el chromium-browser de Switchroot para que el video vaya fluido."
    else
        ok "$BROWSER (${version:-?})"
    fi
else
    bad "No hay Chromium. Instala el chromium-browser de Switchroot."
fi

section "Camara"
if lsmod 2>/dev/null | grep -q '^uvcvideo'; then
    ok "Driver de webcam (uvcvideo) cargado"
else
    warn "El driver uvcvideo no esta cargado (se carga solo al conectar la camara)"
fi
shopt -s nullglob
cams=(/dev/video*)
if [ ${#cams[@]} -eq 0 ]; then
    bad "No se ve ninguna camara. Conectala al dock y vuelve a correr esto."
else
    for dev in "${cams[@]}"; do
        name="$(cat "/sys/class/video4linux/$(basename "$dev")/name" 2>/dev/null)"
        ok "$dev ${name:+— $name}"
    done
    if command -v v4l2-ctl >/dev/null 2>&1; then
        echo "  Tamaños que da la camara (lo ideal: 1920x1080 en MJPG):"
        v4l2-ctl --device="${cams[0]}" --list-formats-ext 2>/dev/null \
            | grep -E "Pixel Format|Size:" | sed 's/^/      /' | head -n 30
    else
        warn "Para ver los tamaños de la camara: sudo apt install v4l-utils"
    fi
fi

section "USB (camara y boton)"
if command -v lsusb >/dev/null 2>&1; then
    devices="$(lsusb | grep -v -i "root hub")"
    if [ -n "$devices" ]; then
        printf '%s\n' "$devices" | sed 's/^/  /'
    else
        warn "No hay nada conectado por USB (¿esta en el dock?)"
    fi
else
    warn "lsusb no esta instalado (sudo apt install usbutils)"
fi

section "Internet"
if command -v wget >/dev/null 2>&1 && wget -q --spider --timeout=8 "$BOOTH_URL"; then
    ok "El booth abre: $BOOTH_URL"
elif command -v curl >/dev/null 2>&1 && curl -fsS -o /dev/null --max-time 8 "$BOOTH_URL"; then
    ok "El booth abre: $BOOTH_URL"
else
    bad "No se pudo abrir $BOOTH_URL — revisa el WiFi"
fi

section "Radio (AzuraCast)"
if command -v docker >/dev/null 2>&1; then
    running="$(docker ps --format '{{.Names}}' 2>/dev/null | grep -i -c azura)"
    if [ "${running:-0}" -gt 0 ]; then
        warn "AzuraCast esta corriendo: le quita memoria y procesador al booth."
    elif docker ps >/dev/null 2>&1; then
        ok "AzuraCast no esta corriendo"
    else
        warn "No se pudo preguntar a Docker (puede necesitar sudo)"
    fi
else
    ok "Docker no esta instalado"
fi

section "Modo ligero"
if [ -f "$STATE_DIR/lean-mode.state" ]; then
    ok "Activo: solo arranca lo que el booth necesita"
else
    warn "No activo. Para liberar memoria: bash $HERE/lean-mode.sh"
fi
heavy=""
for unit in docker.service cloudflared.service cups.service bluetooth.service unattended-upgrades.service; do
    [ "$(systemctl is-enabled "$unit" 2>/dev/null)" = "enabled" ] && heavy="$heavy ${unit%.service}"
done
[ -n "$heavy" ] && warn "Arrancan al prender:$heavy"

section "Booth"
if [ ! -e "$LOCK_FILE" ] || flock -n "$LOCK_FILE" true 2>/dev/null; then
    ok "Apagado (se prende con el icono Photo Booth)"
else
    ok "Prendido ahorita"
fi
[ -f "$LOG_FILE" ] && echo "  Log: $LOG_FILE"
echo
