# Installation

This guide covers all available installation methods for DojOps, plus upgrade, uninstall, and troubleshooting instructions.

---

## Prerequisites

- **Node.js** >= 20 (required for npm, shell script, and Homebrew methods)
- **Docker** (required for Docker method only)

---

## Installation Methods

### npm (recommended)

The simplest method if you already have Node.js installed.

```bash
npm i -g @dojops/cli
```

**Upgrade:**

```bash
npm update -g @dojops/cli
```

**Uninstall:**

```bash
npm uninstall -g @dojops/cli
```

---

### Shell Script

POSIX-compliant installer that verifies prerequisites and runs `npm install -g`.

```bash
curl -fsSL https://raw.githubusercontent.com/dojops/dojops/main/install.sh | sh
```

**Install a specific version:**

```bash
curl -fsSL https://raw.githubusercontent.com/dojops/dojops/main/install.sh | sh -s -- --version 1.0.0
```

The script will:

1. Verify Node.js >= 20 is installed
2. Verify npm is available
3. Run `npm install -g @dojops/cli`
4. Verify the `dojops` command is available

**Upgrade:** Re-run the script (installs `@latest` by default).

**Uninstall:** `npm uninstall -g @dojops/cli`

---

### Homebrew (macOS / Linux)

```bash
brew install dojops/tap/dojops
```

**Upgrade:**

```bash
brew upgrade dojops/tap/dojops
```

**Uninstall:**

```bash
brew uninstall dojops
```

> **Note**: Requires the [Homebrew](https://brew.sh/) package manager and Node.js (installed as a dependency).

---

### Docker

Run DojOps without installing anything locally. The image is published to GitHub Container Registry (GHCR).

**One-off generation:**

```bash
docker run --rm -it \
  -e OPENAI_API_KEY \
  ghcr.io/dojops/dojops "Create a Terraform config for S3"
```

**API server + dashboard:**

```bash
docker run --rm -p 3000:3000 \
  -e OPENAI_API_KEY \
  -e DOJOPS_API_KEY=your-api-key \
  ghcr.io/dojops/dojops serve
```

**With local project mount (for init/plan/apply):**

```bash
docker run --rm -it \
  -v "$(pwd)":/workspace -w /workspace \
  -e OPENAI_API_KEY \
  ghcr.io/dojops/dojops init
```

**Pin a version:**

```bash
docker run --rm -it ghcr.io/dojops/dojops:1.0.0 --version
```

**Upgrade:** Pull the latest image:

```bash
docker pull ghcr.io/dojops/dojops:latest
```

**Uninstall:** Remove the image:

```bash
docker rmi ghcr.io/dojops/dojops:latest
```

---

## Verify Installation

After installing via any method:

```bash
dojops --version     # Print version
dojops doctor        # System health check
dojops --help        # Show all commands
```

---

## Troubleshooting

### `command not found: dojops`

npm's global bin directory may not be in your PATH. Fix:

```bash
# Find npm's global prefix
npm prefix -g

# Add it to PATH (add to your shell profile for persistence)
export PATH="$(npm prefix -g)/bin:$PATH"
```

### Permission errors during `npm install -g`

Option 1 — use sudo:

```bash
sudo npm install -g @dojops/cli
```

Option 2 — configure npm to use a user-writable directory:

```bash
mkdir -p ~/.npm-global
npm config set prefix ~/.npm-global
export PATH=~/.npm-global/bin:$PATH
```

### Node.js version too old

DojOps requires Node.js >= 20. Check your version:

```bash
node --version
```

Upgrade using [nvm](https://github.com/nvm-sh/nvm):

```bash
nvm install 20
nvm use 20
```

### Docker permission denied

If you get a permission error pulling from GHCR, authenticate first:

```bash
echo $GITHUB_TOKEN | docker login ghcr.io -u USERNAME --password-stdin
```

Public images should not require authentication. If the error persists, check your Docker daemon configuration.
