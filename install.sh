#!/bin/sh
# install.sh — install ev (Entity Versioning) from GitHub releases
# Usage: curl -fsSL https://raw.githubusercontent.com/sgmonda/entity-versioning/main/install.sh | sh
set -e

REPO="sgmonda/entity-versioning"
INSTALL_DIR="${HOME}/.local/bin"

detect_platform() {
  OS=$(uname -s)
  ARCH=$(uname -m)

  case "$OS" in
    Linux)  OS_PART="linux" ;;
    Darwin) OS_PART="macos" ;;
    *)      echo "Error: unsupported OS: $OS" >&2; exit 1 ;;
  esac

  case "$ARCH" in
    x86_64|amd64)  ARCH_PART="x86_64" ;;
    aarch64|arm64) ARCH_PART="aarch64" ;;
    *)             echo "Error: unsupported architecture: $ARCH" >&2; exit 1 ;;
  esac

  ASSET="ev-${OS_PART}-${ARCH_PART}"
}

get_latest_url() {
  RELEASE_URL="https://api.github.com/repos/${REPO}/releases/latest"
  # Parse download URL without jq — look for browser_download_url matching our asset
  DOWNLOAD_URL=$(
    curl -fsSL "$RELEASE_URL" \
    | tr ',' '\n' \
    | grep "browser_download_url" \
    | grep "$ASSET" \
    | head -1 \
    | sed 's/.*"browser_download_url" *: *"//;s/".*//'
  )

  if [ -z "$DOWNLOAD_URL" ]; then
    echo "Error: could not find asset '$ASSET' in the latest release." >&2
    echo "Check https://github.com/${REPO}/releases for available binaries." >&2
    exit 1
  fi
}

install_binary() {
  mkdir -p "$INSTALL_DIR"
  echo "Downloading $ASSET..."
  curl -fsSL -o "${INSTALL_DIR}/ev" "$DOWNLOAD_URL"
  chmod +x "${INSTALL_DIR}/ev"
  echo "Installed ev to ${INSTALL_DIR}/ev"
}

check_path() {
  case ":${PATH}:" in
    *":${INSTALL_DIR}:"*) ;;
    *)
      echo ""
      echo "WARNING: ${INSTALL_DIR} is not in your PATH."
      echo "Add it by running:"
      echo ""
      echo "  export PATH=\"${INSTALL_DIR}:\$PATH\""
      echo ""
      echo "Or add that line to your ~/.bashrc, ~/.zshrc, or equivalent."
      ;;
  esac
}

detect_platform
get_latest_url
install_binary
check_path

echo ""
echo "Run 'ev --help' to get started."
