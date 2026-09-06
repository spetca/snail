#include "spectrogram_worker.h"
#include <algorithm>

// Tile contains multiple FFT lines
static const int TILE_LINES = 256;

SpectrogramWorker::SpectrogramWorker(
    Napi::Env env,
    Napi::Promise::Deferred deferred,
    std::shared_ptr<const InputSource> source,
    size_t startSample,
    int fftSize,
    int stride,
    size_t endSample
) : Napi::AsyncWorker(env),
    deferred_(deferred),
    source_(source),
    startSample_(startSample),
    fftSize_(fftSize),
    stride_(stride),
    endSample_(endSample) {}

void SpectrogramWorker::Execute() {
    FFTEngine fft(fftSize_);

    int stride = stride_;
    int numLines = TILE_LINES;

    // Compute lines for all samples, including partial windows at the end
    // (getSamples zero-pads beyond the file boundary)
    size_t maxLines = 0;
    size_t total = std::min(source_->totalSamples(), endSample_);
    if (startSample_ < total) {
        maxLines = (total - startSample_ - 1) / stride + 1;
    }
    numLines = static_cast<int>(std::min(static_cast<size_t>(numLines), maxLines));
    if (numLines <= 0) {
        SetError("No samples available for tile");
        return;
    }

    result_.resize(numLines * fftSize_);

    // Buffer for reading samples
    std::vector<std::complex<float>> sampleBuf(fftSize_);

    for (int line = 0; line < numLines; line++) {
        size_t sampleOffset = startSample_ + line * stride;
        std::fill(sampleBuf.begin(), sampleBuf.end(), std::complex<float>(0, 0));
        source_->getSamples(sampleOffset, std::min(static_cast<size_t>(fftSize_), total - sampleOffset), sampleBuf.data());

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
