#!/usr/bin/env bash
# Build a runnable Snail checkout, including its native DSP addon.
set -euo pipefail
cd "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
install_deps=false
for arg in "$@"; do
  case "$arg" in
    --install-deps) install_deps=true ;;
    --help|-h)
      echo 'Usage: ./install.sh [--install-deps]'
      echo 'Checks prerequisites, runs npm ci, builds native DSP for Electron, builds the app, and opens a test recording.'
      echo '--install-deps installs system libraries via Homebrew (macOS) or apt (Debian/Ubuntu).'
      echo 'Install Node.js 20+, npm, and Git first. macOS also needs Xcode command-line tools and Homebrew.'
      exit 0 ;;
    *) echo "Unknown option: $arg" >&2; exit 2 ;;
  esac
done
trap 'echo "Snail setup failed at line $LINENO. Fix the error above, then rerun ./install.sh. See docs/development.md." >&2' ERR
case "$(uname -s)" in
  Darwin)
    if ! xcode-select -p >/dev/null 2>&1; then
      echo 'Install the compiler with: xcode-select --install'; exit 1
    fi
    if "$install_deps"; then
      command -v brew >/dev/null || { echo 'Install Homebrew from https://brew.sh first.'; exit 1; }
      brew install cmake pkg-config fftw liquid-dsp nlohmann-json
    fi
    if command -v brew >/dev/null; then
      brew_prefix=$(brew --prefix)
      export CMAKE_PREFIX_PATH="$brew_prefix${CMAKE_PREFIX_PATH:+:$CMAKE_PREFIX_PATH}"
      export PKG_CONFIG_PATH="$brew_prefix/lib/pkgconfig${PKG_CONFIG_PATH:+:$PKG_CONFIG_PATH}"
    fi
    ;;
  Linux)
    if "$install_deps"; then
      command -v apt-get >/dev/null || { echo 'Automatic dependency installation supports Debian/Ubuntu. See docs/development.md for other distributions.'; exit 1; }
      privilege=()
      if [[ $(id -u) -ne 0 ]]; then privilege=(sudo); fi
      "${privilege[@]}" apt-get update
      sound_package=libasound2
      if apt-cache show libasound2t64 >/dev/null 2>&1; then sound_package=libasound2t64; fi
      "${privilege[@]}" apt-get install -y build-essential cmake pkg-config libfftw3-dev libliquid-dev nlohmann-json3-dev libgtk-3-0 libnss3 "$sound_package" libgbm1
    fi
    ;;
  *) echo 'Source builds currently support macOS and Linux.'; exit 1 ;;
esac
for tool in node npm git cmake pkg-config c++; do
  command -v "$tool" >/dev/null || { echo "Missing $tool. See docs/development.md, or rerun with --install-deps for system build tools."; exit 1; }
done
node -e 'if (Number(process.versions.node.split(".")[0]) < 20) { console.error("Node.js 20 or newer is required"); process.exit(1) }'
pkg-config --exists fftw3f || { echo 'Missing FFTW3F. Rerun ./install.sh --install-deps or install libfftw3-dev.'; exit 1; }
echo 'Installing locked Node dependencies…'
npm ci
electron_version=$(node -p "require('./node_modules/electron/package.json').version")
echo "Building native DSP for Electron ${electron_version}..."
# Reconfigure from scratch to discard stale runtime/architecture paths from previous builds.
./node_modules/.bin/cmake-js rebuild -d src/native --runtime electron --runtime-version "$electron_version"
echo 'Building application…'
npm run build
echo 'Verifying native file reading in Electron…'
ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron test/install-smoke.cjs
echo 'Snail is ready. Run npm start to launch, or npm run dev for development.'
