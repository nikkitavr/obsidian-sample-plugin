#!/usr/bin/env bash
set -euo pipefail

# Build and deploy this plugin folder into an Obsidian vault's plugins directory.
# Usage:
#   ./deploy.sh                      # deploy to default vault path
#   ./deploy.sh "/path/to/target"    # deploy to a custom target directory

# Absolute path of this project folder (plugin root)
SOURCE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Default target: Obsidian vault plugins/<project-folder-name>
PROJECT_NAME="$(basename "$SOURCE_DIR")"
DEFAULT_PLUGINS_DIR="/Users/n.vorotnikov/Documents/Obsidian Vaults/test/.obsidian/plugins"
TARGET_DIR="${1:-"$DEFAULT_PLUGINS_DIR/$PROJECT_NAME"}"

echo "Building plugin in: $SOURCE_DIR"
(cd "$SOURCE_DIR" && npm run build)

echo "Deploying to: $TARGET_DIR"
mkdir -p "$TARGET_DIR"

# Copy everything, overwrite existing files, remove stale files from target
rsync -a --delete "$SOURCE_DIR/" "$TARGET_DIR/"

echo "Done. Deployed '$PROJECT_NAME' to: $TARGET_DIR"