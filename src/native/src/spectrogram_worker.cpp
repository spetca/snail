#include "spectrogram_worker.h"
#include <algorithm>

// Tile contains multiple FFT lines
static const int TILE_LINES = 256;

SpectrogramWorker::SpectrogramWorker(
    Napi::Env env,
    Napi::Promise::Deferred deferred,
    InputSource& source,
    size_t startSample,
    int fftSize,
    int zoomLevel
) : Napi::AsyncWorker(env),
    deferred_(deferred),
    source_(source),
    startSample_(startSample),
    fftSize_(fftSize),
    zoomLevel_(zoomLevel) {}

void SpectrogramWorker::Execute() {
    FFTEngine fft(fftSize_);

    int stride = fftSize_ / zoomLevel_;
    int numLines = TILE_LINES;

    // Only compute lines where the full FFT window fits in the file
    // This avoids zero-padded windows that create spectral artifacts at the boundary
    size_t maxLines = 0;
    size_t total = source_.totalSamples();
    if (startSample_ + fftSize_ <= total) {
        maxLines = (total - startSample_ - fftSize_) / stride + 1;
    }
    numLines = std::min(numLines, static_cast<int>(maxLines));
    if (numLines <= 0) {
        SetError("No samples available for tile");
        return;
    }

    result_.resize(numLines * fftSize_);

    // Buffer for reading samples
    std::vector<std::complex<float>> sampleBuf(fftSize_);

    for (int line = 0; line < numLines; line++) {
        size_t sampleOffset = startSample_ + line * stride;
        source_.getSamples(sampleOffset, fftSize_, sampleBuf.data());

        // Compute power spectrum for this line
        fft.computePowerSpectrum(sampleBuf.data(), result_.data() + line * fftSize_);
    }
}

void SpectrogramWorker::OnOK() {
    auto env = Env();
    auto buf = Napi::Float32Array::New(env, result_.size());
    std::memcpy(buf.Data(), result_.data(), result_.size() * sizeof(float));
    deferred_.Resolve(buf);
}

void SpectrogramWorker::OnError(const Napi::Error& error) {
    deferred_.Reject(error.Value());
}
