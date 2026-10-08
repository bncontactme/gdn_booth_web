#!/usr/bin/env bash
# ============================================================================
#  install.sh — Pone el Photo Booth en el Switch (se corre UNA vez)
#  ---------------------------------------------------------------------
#  Deja dos iconos, en el escritorio y en el menu de aplicaciones:
#      Photo Booth          prende el booth a pantalla completa
#      Detener Photo Booth  lo apaga
#
#      bash install.sh               solo los iconos
#      bash install.sh --autostart   ademas se prende solo al encender
#      bash install.sh --remove      quita todo
# ============================================================================

set -eu
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

DATA="${XDG_DATA_HOME:-$HOME/.local/share}"
DEST="$DATA/gdn-photobooth"
APPS="$DATA/applications"
AUTOSTART="${XDG_CONFIG_HOME:-$HOME/.config}/autostart"
DESKTOP_DIR="$(xdg-user-dir DESKTOP 2>/dev/null || true)"
# Sin escritorio configurado xdg-user-dir responde $HOME: ahi no se ponen.
[ "$DESKTOP_DIR" = "$HOME" ] && DESKTOP_DIR=""
[ -z "$DESKTOP_DIR" ] && [ -d "$HOME/Desktop" ] && DESKTOP_DIR="$HOME/Desktop"

ENTRIES=(gdn-photobooth gdn-photobooth-stop)

if [ "${1:-}" = "--remove" ]; then
    [ -x "$DEST/stop.sh" ] && "$DEST/stop.sh" || true
    for e in "${ENTRIES[@]}"; do
        rm -f "$APPS/$e.desktop" "$AUTOSTART/$e.desktop"
        [ -n "$DESKTOP_DIR" ] && rm -f "$DESKTOP_DIR/$e.desktop"
    done
    rm -rf "$DEST"
    echo "Listo: se quito el Photo Booth (las fotos pendientes siguen guardadas"
    echo "en ~/.local/state/gdn-photobooth)."
    exit 0
fi

mkdir -p "$DEST" "$APPS"
install -m 755 "$HERE/start.sh" "$HERE/stop.sh" "$HERE/check.sh" "$HERE/lean-mode.sh" "$DEST/"
install -m 644 "$HERE/common.sh" "$DEST/"
ICON="process-stop"
if [ -f "$HERE/../assets/logo.jpg" ]; then
    install -m 644 "$HERE/../assets/logo.jpg" "$DEST/icon.jpg"
    ICON="$DEST/icon.jpg"
fi

write_entry() {   # archivo  nombre  comando  icono  descripcion
    cat >"$1" <<EOF
[Desktop Entry]
Type=Application
Name=$2
Comment=$5
Exec=$3
Icon=$4
Terminal=false
Categories=Graphics;Photography;
EOF
    chmod +x "$1"
}

write_entry "$APPS/gdn-photobooth.desktop" "Photo Booth" \
    "$DEST/start.sh" "$ICON" "Prende el photo booth a pantalla completa"
write_entry "$APPS/gdn-photobooth-stop.desktop" "Detener Photo Booth" \
    "$DEST/stop.sh" "process-stop" "Apaga el photo booth"

if [ -n "$DESKTOP_DIR" ] && [ -d "$DESKTOP_DIR" ]; then
    for e in "${ENTRIES[@]}"; do
        cp "$APPS/$e.desktop" "$DESKTOP_DIR/"
        # GNOME no deja abrir iconos del escritorio que no se marcaron como
        # confiables.
        gio set "$DESKTOP_DIR/$e.desktop" metadata::trusted true 2>/dev/null || true
    done
fi

# KDE (el Switch) guarda el menu en cache: asi los iconos salen de una vez.
command -v kbuildsycoca5 >/dev/null 2>&1 && kbuildsycoca5 >/dev/null 2>&1 || true

if [ "${1:-}" = "--autostart" ]; then
    mkdir -p "$AUTOSTART"
    cp "$APPS/gdn-photobooth.desktop" "$AUTOSTART/"
    echo "Se prende solo al entrar al escritorio."
else
    rm -f "$AUTOSTART/gdn-photobooth.desktop"
fi

echo "Listo. Iconos instalados:"
echo "  Photo Booth          -> $DEST/start.sh"
echo "  Detener Photo Booth  -> $DEST/stop.sh"
[ -n "$DESKTOP_DIR" ] && echo "  (tambien en $DESKTOP_DIR)"
echo
echo "Revisando el Switch…"
bash "$DEST/check.sh"
