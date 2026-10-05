# Developing Snail

Snail ships desktop releases for **macOS Apple Silicon** and **Linux x64**. The release configuration is in [electron-builder.yml](../electron-builder.yml); GitHub Actions builds both platforms in [release.yml](../.github/workflows/release.yml).

## Install and run from a source checkout

Install **Node.js 20+**, npm and Git. On macOS, also install [Homebrew](https://brew.sh) and run `xcode-select --install` once to get the compiler.

```bash
git clone https://github.com/spetca/snail.git
cd snail
./install.sh --install-deps
npm start
```

`install.sh` installs system packages when `--install-deps` is supplied, runs `npm ci`, rebuilds native DSP for the installed Electron version, builds the app, and verifies a generated SigMF recording using Electron's Node runtime. It stops on any failure. It works from any working directory and can be rerun after fixing dependencies. The script uses Homebrew on macOS and apt on Debian/Ubuntu; apt may request your sudo password. It never runs npm as root.

If system packages are already installed, use `./install.sh` or `npm run setup`. **`npm install` / `npm ci` alone only installs JavaScript dependencies; it does not prepare the native reader.** Run `npm run dev` after setup for live development; `npm start` launches the built app.

### System dependencies

The build needs a C++17 compiler, CMake, pkg-config, FFTW3F, liquid-dsp, and nlohmann-json headers. For manual macOS setup:

```bash
brew install cmake pkg-config fftw liquid-dsp nlohmann-json
```

For manual Debian/Ubuntu setup (install Node.js 20+ separately if the distro provides an older version):

```bash
sudo apt-get update
sudo apt-get install -y build-essential git cmake pkg-config libfftw3-dev libliquid-dev nlohmann-json3-dev libgtk-3-0 libnss3 libasound2 libgbm1
```

On other Linux distributions, install equivalent development packages and Electron runtime libraries using the distribution package manager, then run `./install.sh`. Windows builds are not supported.

### Troubleshooting

- **Native addon unavailable / error opening a recording:** rerun `./install.sh` from your checkout and restart Snail. A successful install ends with a real native SigMF read check.
- **Missing FFTW, liquid-dsp, or JSON headers:** run `./install.sh --install-deps`, or install the development packages listed above. CMake reports the missing library/header.
- **Compiler unavailable on macOS:** complete `xcode-select --install` before rerunning setup.
- **Changed architecture, Node or Electron version:** rerun the installer; it rebuilds the addon from scratch for the current Electron runtime.
- **Download failures:** setup requires network access to npm and Electron's headers/releases. Correct proxy/network configuration and rerun; a partial installation is not reported as successful.
- **Linux display/runtime errors:** launch in a graphical desktop session with the Electron runtime libraries installed. The installer verifies native reading without requiring a display; it does not validate desktop display configuration.

## Packaging

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
npm run test:gpu
npm run build
```

Native tests require the compiled addon. Desktop tests run Electron with a temporary profile and synthetic data. The Python reader integration test runs when Python 3 with NumPy is available, otherwise that check is skipped.

To create larger development recordings, use the generators in `test/fixtures/` with the dependencies from `test/fixtures/requirements.txt`. Keep generated recordings out of commits.

## GPU checks and profiling

`npm run test:gpu` compares WebGL FFT power against native FFTW for random complex samples, verifies tone orientation/window scaling and silence, and checks CPU fallback when floating-point rendering is unavailable or computation fails. It requires a graphical desktop (a hidden test window is used).

```bash
# Also exercise the vendor-independent software driver.
SNAIL_GPU_SOFTWARE=1 npm run test:gpu
# Print warm GPU upload/FFT/output timings (disk and IPC excluded).
SNAIL_GPU_BENCHMARK=1 npm run test:gpu
# Linux without a display:
SNAIL_GPU_SOFTWARE=1 xvfb-run -a npm run test:gpu
```

GPU display uses WebGL2 `EXT_color_buffer_float`, RG32F intermediates, precomputed Hann/twiddle coefficients, and R16F power textures. A completion fence measures the optional GPU path without blocking `gl.finish()`. Backend selection includes sample-read IPC cost; no vendor name or theoretical core count is used to assume a GPU is faster. CPU FFT results are shared with compatible power-trace requests. CPU measurements and exports never use quantized display textures.

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

The release workflow uses the source installer on both platforms, including its native file-read check, and runs the JavaScript and native regression suites before packaging. Run the desktop checks locally before tagging.
