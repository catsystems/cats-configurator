#!/usr/bin/env bash

set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "Usage: $0 <AppImage>" >&2
  exit 2
fi

image="$(realpath "$1")"
workdir="$(mktemp -d)"
trap 'rm -rf "$workdir"' EXIT

offset="$("$image" --appimage-offset)"
if [[ ! "$offset" =~ ^[0-9]+$ ]]; then
  echo "Could not determine the AppImage runtime offset." >&2
  exit 1
fi

(
  cd "$workdir"
  "$image" --appimage-extract >/dev/null
)

appdir="$workdir/squashfs-root"
shopt -s nullglob
wayland_libraries=("$appdir"/usr/lib/libwayland-*.so*)
if [[ ${#wayland_libraries[@]} -eq 0 ]]; then
  echo "The AppImage already uses host Wayland libraries."
  exit 0
fi

rm -- "${wayland_libraries[@]}"

patched="$workdir/patched.AppImage"
mksquashfs "$appdir" "$patched" \
  -offset "$offset" \
  -comp zstd \
  -root-owned \
  -noappend \
  -b 128K \
  -no-progress >/dev/null
dd if="$image" of="$patched" bs="$offset" count=1 conv=notrunc status=none
chmod --reference="$image" "$patched"
mv -- "$patched" "$image"

echo "Removed ${#wayland_libraries[@]} bundled Wayland libraries from $(basename "$image")."
