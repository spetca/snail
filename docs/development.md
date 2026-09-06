# Developing Snail

Snail ships desktop releases for **macOS Apple Silicon** and **Linux x64**. The release configuration is in [electron-builder.yml](../electron-builder.yml); GitHub Actions builds both platforms in [release.yml](../.github/workflows/release.yml).

## Native dependencies

Use Node.js 20 or later, npm, Git, CMake, pkg-config, and a C++17 compiler. The addon requires FFTW3F, liquid-dsp, and nlohmann-json.

On macOS, install the Xcode command-line tools and dependencies:

```bash
xcode-select --install
brew install node cmake pkg-config fftw liquid-dsp nlohmann-json
```

On Ubuntu/Debian, install the build tools and headers. Install Node.js 20+ separately if your distribution's version is older:

```bash
sudo apt-get update
sudo apt-get install -y build-essential git cmake pkg-config autoconf automake libtool libfftw3-dev nlohmann-json3-dev
```

The Linux release workflow builds liquid-dsp from source:

```bash
git clone --depth 1 https://github.com/jgaeddert/liquid-dsp.git /tmp/snail-liquid-dsp
cd /tmp/snail-liquid-dsp
./bootstrap.sh
./configure
make -j"$(nproc)"
sudo make install
sudo ldconfig
```

## Build and run

```bash
git clone https://github.com/spetca/snail.git
cd snail
npm ci

# Build the addon for the installed Electron runtime.
ELECTRON_VERSION=$(node -p "require('./node_modules/electron/package.json').version")
npx cmake-js compile -d src/native --runtime electron --runtime-version "$ELECTRON_VERSION"

npm run dev
```

`npm run build` typechecks the renderer and main process, then builds the Electron app. To package locally:

```bash
npm run build
npm run dist
```

Artifacts appear in `dist/`: an ARM64 DMG on macOS, or x64 AppImage and DEB packages on Linux. Package on the corresponding platform; native DSP dependencies are platform-specific.

## Checks

```bash
npm test
npm run test:native
npm run test:desktop
npm run build
```

Native tests require the compiled addon. Desktop tests run Electron with a temporary profile and synthetic data. The Python reader integration test runs when Python 3 with NumPy is available, otherwise that check is skipped.

To create larger development recordings, use the generators in `test/fixtures/` with the dependencies from `test/fixtures/requirements.txt`. Keep generated recordings out of commits.

## README screenshots

After building the native addon and app:

```bash
npm run screenshots
```

[test/capture-readme.cjs](../test/capture-readme.cjs) generates a small, deterministic RF recording in a temporary directory, runs the real renderer/IPC/native DSP, detects events, and accepts a few fixture labels. It captures five views under `pics/features/`: inspection, detection, dataset export, FFT analysis, and constellation analysis. The FFT uses the generated RF fixture; the constellation uses a second generated QPSK fixture with noise. Dedicated analysis windows use the built production renderer and native IPC. It does not use personal recordings or the normal application profile. Only the screenshot images remain after a successful run.

The capture script changes application state for repeatable framing, but uses actual FFT samples, detection results, review persistence, and UI components. It does not fabricate matching results or edit pixels after capture. Chromium's nonfatal resize-observer notification is ignored while the layout settles; other renderer errors fail the capture.

## Releases

A pushed Git tag matching `v*` starts the release workflow. It builds the native addon and application, packages macOS ARM64 and Linux x64 installers, then creates a GitHub Release with artifacts and generated notes.

After merging the desired changes, start from an up-to-date `main` with a clean tracked worktree:

```bash
git switch main
git pull --ff-only origin main
npm version minor -m "Release v%s"
git push origin main
# Push the exact tag created by npm version, for example:
git push origin v0.5.0
```

Choose the version intentionally; `minor` is only an example. `npm version` updates package metadata and creates the version commit/tag. If branch protection requires pull requests, merge the version bump first and create the release tag on the resulting `main` commit instead. Never move an already published release tag.

The current release workflow builds and typechecks, but does not run the regression suites automatically. Run the checks above before tagging.
