#!/usr/bin/env bash
# ============================================================================
#  lean-mode.sh — Deja el Switch solo para el photo booth
#  ---------------------------------------------------------------------
#  Apaga (y quita del arranque) todo lo que el booth no usa, para que la
#  camara tenga toda la memoria y el procesador:
#
#      bash lean-mode.sh          apagar
#      bash lean-mode.sh --undo   dejar todo exactamente como estaba
#
#  Se anota que estaba prendido antes, asi --undo solo regresa eso.
#  No toca lo que el booth necesita: WiFi, SSH, la pantalla, el escritorio,
#  ni los servicios propios del Switch (nv*, screen-toggle, nvpmodel).
# ============================================================================

set -u
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HERE/common.sh"

LEAN_STATE="$STATE_DIR/lean-mode.state"
AUTOSTART_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/autostart"
MARK="X-GDN-Photobooth=lean-mode"

UNITS=(
    # Radio (AzuraCast + tunel de Cloudflare). El icono RADIO START la
    # sigue prendiendo a mano cuando se necesite.
    docker.service docker.socket containerd.service
    cloudflared.service tunnel-watchdog.service radio-boot.service
    # Impresoras, modem, Bluetooth y Joy-Con, reportes de fallas.
    # (avahi se queda: con el se encuentra el Switch como xxsw1tchxx.local
    # cuando cambia de red.)
    cups.service cups.socket cups.path cups-browsed.service
    ModemManager.service bluetooth.service joycond.service
    apport.service kerneloops.service
    # Actualizaciones y tareas en segundo plano. OJO: esto incluye las
    # actualizaciones automaticas de seguridad; despues del evento corre
    # --undo (o actualiza a mano de vez en cuando).
    unattended-upgrades.service
    apt-daily.timer apt-daily-upgrade.timer fwupd-refresh.timer
    update-notifier-download.timer update-notifier-motd.timer motd-news.timer
    man-db.timer plocate-updatedb.timer
    sysstat.service sysstat-collect.timer sysstat-summary.timer
)

# Programas del escritorio que arrancan solos y el booth no usa.
DESKTOP_APPS=(
    org.kde.discover.notifier    # avisos de actualizaciones
    org.kde.kdeconnect.daemon    # KDE Connect
    geoclue-demo-agent           # ubicacion
    kup-daemon                   # respaldos
    spice-vdagent                # solo sirve en maquinas virtuales
    org.kde.plasma-welcome       # bienvenida de KDE
)

# Como encontrar el proceso de cada programa (para cerrarlo ya, no solo al
# reiniciar). Rutas completas: un nombre corto como "agent" podria cerrar
# otra cosa.
desktop_process() {
    case "$1" in
        org.kde.discover.notifier) echo "/DiscoverNotifier" ;;
        org.kde.kdeconnect.daemon) echo "/kdeconnectd" ;;
        geoclue-demo-agent)        echo "/geoclue-2.0/demos/agent" ;;
        kup-daemon)                echo "/kup-daemon" ;;
        spice-vdagent)             echo "/spice-vdagent" ;;
        *)                         echo "" ;;
    esac
}

unit_exists() { systemctl cat "$1" >/dev/null 2>&1; }

lean_on() {
    mkdir -p "$STATE_DIR" "$AUTOSTART_DIR"
    if [ -f "$LEAN_STATE" ]; then
        echo "Ya estaba en modo ligero (para regresar: --undo). Se vuelve a aplicar."
    else
        : >"$LEAN_STATE"
    fi

    echo "== Servicios"
    local unit state
    for unit in "${UNITS[@]}"; do
        unit_exists "$unit" || continue
        state="$(systemctl is-enabled "$unit" 2>/dev/null)"
        grep -q "^unit $unit " "$LEAN_STATE" || printf 'unit %s %s\n' "$unit" "$state" >>"$LEAN_STATE"
        sudo -n systemctl disable --now "$unit" >/dev/null 2>&1
        printf '  apagado  %-32s (antes: %s)\n' "$unit" "${state:-?}"
    done

    echo "== Programas del escritorio"
    local app proc file
    for app in "${DESKTOP_APPS[@]}"; do
        [ -f "/etc/xdg/autostart/$app.desktop" ] || continue
        file="$AUTOSTART_DIR/$app.desktop"
        if [ -f "$file" ] && ! grep -q "$MARK" "$file"; then
            echo "  (se deja $app: ya tenia un ajuste propio)"
            continue
        fi
        printf '[Desktop Entry]\nHidden=true\n%s\n' "$MARK" >"$file"
        proc="$(desktop_process "$app")"
        [ -n "$proc" ] && pkill -u "$USER" -f "^[^ ]*$proc( |\$)" 2>/dev/null
        echo "  apagado  $app"
    done

    # Al entrar al escritorio no se vuelven a abrir las ventanas que
    # quedaron abiertas (Configuracion, Konsole...).
    if command -v kwriteconfig5 >/dev/null 2>&1; then
        if ! grep -q "^kde loginMode " "$LEAN_STATE"; then
            printf 'kde loginMode %s\n' "$(kreadconfig5 --file ksmserverrc --group General --key loginMode)" >>"$LEAN_STATE"
        fi
        kwriteconfig5 --file ksmserverrc --group General --key loginMode emptySession
        echo "== Escritorio: arranca vacio (sin reabrir ventanas)"
    fi

    echo
    echo "Listo. Memoria libre ahora: $(free -m | awk '/^Mem:/ {print $7}') MB"
    echo "Para dejar todo como estaba: bash $HERE/lean-mode.sh --undo"
}

lean_off() {
    if [ ! -f "$LEAN_STATE" ]; then
        echo "No estaba en modo ligero: no hay nada que regresar."
        return 0
    fi
    local kind name state
    while read -r kind name state; do
        case "$kind" in
            unit)
                # Solo se vuelve a prender lo que estaba prendido.
                if [ "$state" = "enabled" ]; then
                    sudo -n systemctl enable --now "$name" >/dev/null 2>&1
                    echo "  prendido $name"
                fi
                ;;
            kde)
                if [ -n "${state:-}" ]; then
                    kwriteconfig5 --file ksmserverrc --group General --key "$name" "$state"
                else
                    kwriteconfig5 --file ksmserverrc --group General --key "$name" --delete
                fi
                ;;
        esac
    done <"$LEAN_STATE"

    local f
    for f in "$AUTOSTART_DIR"/*.desktop; do
        [ -f "$f" ] && grep -q "$MARK" "$f" && rm -f "$f" && echo "  prendido $(basename "$f" .desktop) (al entrar al escritorio)"
    done
    rm -f "$LEAN_STATE"
    echo "Listo: todo como estaba. (La radio sigue apagada hasta que uses RADIO START.)"
}

if ! sudo -n true 2>/dev/null; then
    echo "Esto necesita sudo sin contraseña (o correrlo con sudo a mano)."
    exit 1
fi

case "${1:-}" in
    --undo) lean_off ;;
    "")     lean_on ;;
    *)      echo "Uso: bash lean-mode.sh [--undo]"; exit 1 ;;
esac
