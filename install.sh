#!/bin/sh
# DojOps Installer
# Usage: curl -fsSL https://raw.githubusercontent.com/dojops/dojops/main/install.sh | sh
#        curl -fsSL https://raw.githubusercontent.com/dojops/dojops/main/install.sh | sh -s -- --version 1.0.0
#
# POSIX-compliant. Works on macOS (zsh), Ubuntu (dash), Alpine (ash).
set -e

# --- Configuration ---
PACKAGE_NAME="@dojops/cli"
MIN_NODE_MAJOR=20
VERSION=""

# --- Colors (respects NO_COLOR) ---
if [ -z "${NO_COLOR:-}" ] && [ -t 1 ]; then
  RED='\033[0;31m'
  GREEN='\033[0;32m'
  YELLOW='\033[1;33m'
  CYAN='\033[0;36m'
  BOLD='\033[1m'
  RESET='\033[0m'
else
  RED=''
  GREEN=''
  YELLOW=''
  CYAN=''
  BOLD=''
  RESET=''
fi

# --- Helpers ---
info()  { printf "${CYAN}info${RESET}  %s\n" "$1"; }
warn()  { printf "${YELLOW}warn${RESET}  %s\n" "$1"; }
error() { printf "${RED}error${RESET} %s\n" "$1" >&2; }
success() { printf "${GREEN}ok${RESET}    %s\n" "$1"; }

# --- Parse arguments ---
while [ $# -gt 0 ]; do
  case "$1" in
    --version)
      shift
      if [ $# -eq 0 ]; then
        error "--version requires a value (e.g., --version 1.0.0)"
        exit 1
      fi
      VERSION="$1"
      ;;
    --version=*)
      VERSION="${1#--version=}"
      ;;
    --help|-h)
      printf "DojOps Installer\n\n"
      printf "Usage:\n"
      printf "  curl -fsSL https://raw.githubusercontent.com/dojops/dojops/main/install.sh | sh\n"
      printf "  curl -fsSL ... | sh -s -- --version 1.0.0\n\n"
      printf "Options:\n"
      printf "  --version <ver>  Install a specific version (default: latest)\n"
      printf "  --help, -h       Show this help message\n"
      exit 0
      ;;
    *)
      error "Unknown option: $1"
      exit 1
      ;;
  esac
  shift
done

# --- Banner ---
printf "\n"
printf "${BOLD}  DojOps Installer${RESET}\n"
printf "  AI DevOps Automation Engine\n"
printf "\n"

# --- Check Node.js ---
info "Checking for Node.js..."

if ! command -v node >/dev/null 2>&1; then
  error "Node.js is not installed."
  printf "\n"
  printf "  DojOps requires Node.js >= %d.\n" "$MIN_NODE_MAJOR"
  printf "\n"
  printf "  Install Node.js using one of these methods:\n"
  printf "\n"
  printf "    ${BOLD}nvm (recommended):${RESET}\n"
  printf "      curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash\n"
  printf "      nvm install %d\n" "$MIN_NODE_MAJOR"
  printf "\n"
  printf "    ${BOLD}Official installer:${RESET}\n"
  printf "      https://nodejs.org/\n"
  printf "\n"
  printf "    ${BOLD}Homebrew (macOS):${RESET}\n"
  printf "      brew install node@%d\n" "$MIN_NODE_MAJOR"
  printf "\n"
  exit 1
fi

NODE_VERSION=$(node --version 2>/dev/null | sed 's/^v//')
NODE_MAJOR=$(printf '%s' "$NODE_VERSION" | cut -d. -f1)

if [ -z "$NODE_MAJOR" ] || [ "$NODE_MAJOR" -lt "$MIN_NODE_MAJOR" ] 2>/dev/null; then
  error "Node.js v${NODE_VERSION} is too old. DojOps requires Node.js >= ${MIN_NODE_MAJOR}."
  printf "\n"
  printf "  Upgrade Node.js:\n"
  printf "    nvm install %d    # if using nvm\n" "$MIN_NODE_MAJOR"
  printf "    brew upgrade node  # if using Homebrew\n"
  printf "\n"
  exit 1
fi

success "Node.js v${NODE_VERSION} detected"

# --- Check npm ---
info "Checking for npm..."

if ! command -v npm >/dev/null 2>&1; then
  error "npm is not installed. It usually ships with Node.js."
  printf "  Reinstall Node.js from https://nodejs.org/\n"
  exit 1
fi

NPM_VERSION=$(npm --version 2>/dev/null)
success "npm v${NPM_VERSION} detected"

# --- Install DojOps ---
if [ -n "$VERSION" ]; then
  INSTALL_TARGET="${PACKAGE_NAME}@${VERSION}"
  info "Installing ${PACKAGE_NAME}@${VERSION}..."
else
  INSTALL_TARGET="${PACKAGE_NAME}@latest"
  info "Installing ${PACKAGE_NAME}@latest..."
fi

if npm install -g "$INSTALL_TARGET"; then
  success "Installation complete"
else
  error "npm install failed."
  printf "\n"
  printf "  If you see a permissions error, try:\n"
  printf "    sudo npm install -g %s\n" "$INSTALL_TARGET"
  printf "\n"
  printf "  Or configure npm to use a user-writable directory:\n"
  printf "    mkdir -p ~/.npm-global\n"
  printf "    npm config set prefix ~/.npm-global\n"
  printf "    export PATH=~/.npm-global/bin:\$PATH\n"
  printf "\n"
  exit 1
fi

# --- Verify ---
info "Verifying installation..."

if command -v dojops >/dev/null 2>&1; then
  INSTALLED_VERSION=$(dojops --version 2>/dev/null || echo "unknown")
  success "dojops ${INSTALLED_VERSION} is ready"
else
  warn "dojops command not found in PATH."
  printf "  You may need to add npm's global bin directory to your PATH:\n"
  printf "    export PATH=\"\$(npm prefix -g)/bin:\$PATH\"\n"
  printf "\n"
  exit 1
fi

# --- Next steps ---
printf "\n"
printf "${BOLD}  Next steps:${RESET}\n"
printf "\n"
printf "    1. Configure a provider:\n"
printf "       ${CYAN}dojops config${RESET}\n"
printf "\n"
printf "    2. Generate your first config:\n"
printf "       ${CYAN}dojops \"Create a Terraform config for S3\"${RESET}\n"
printf "\n"
printf "    3. Run diagnostics:\n"
printf "       ${CYAN}dojops doctor${RESET}\n"
printf "\n"
printf "  Documentation: https://github.com/dojops/dojops\n"
printf "\n"
