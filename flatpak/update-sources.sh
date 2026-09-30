#!/usr/bin/env sh
# Regenerates the offline dependency lists used by the Flatpak build.
# Run after changing package-lock.json or src-tauri/Cargo.lock.
#   pip install "git+https://github.com/flatpak/flatpak-builder-tools.git#subdirectory=node" aiohttp tomlkit PyYAML
set -e
cd "$(dirname "$0")/.."
curl -sSfL -o /tmp/flatpak-cargo-generator.py \
  https://raw.githubusercontent.com/flatpak/flatpak-builder-tools/master/cargo/flatpak-cargo-generator.py
python3 /tmp/flatpak-cargo-generator.py src-tauri/Cargo.lock -o flatpak/cargo-sources.json
python3 -m flatpak_node_generator npm package-lock.json -o flatpak/node-sources.json
