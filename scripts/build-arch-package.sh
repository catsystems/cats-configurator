#!/usr/bin/env bash

set -euo pipefail

root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)
if [[ -z ${BUILDDIR:-} ]]; then
  BUILDDIR=$(mktemp -d)
  trap 'rm -rf -- "$BUILDDIR"' EXIT
fi
export PKGDEST="${PKGDEST:-$root/src-tauri/target/arch}"
export BUILDDIR
mkdir -p -- "$BUILDDIR" "$PKGDEST"
makepkg --clean --dir "$root/packaging/arch" "$@"
