#include "fft_engine.h"
#include <cmath>
#include <cstring>

#ifndef M_PI
#define M_PI 3.14159265358979323846
#endif

static const double Tau = M_PI * 2.0;

std::mutex g_fftwMutex;

FFTEngine::FFTEngine(int fftSize) : fftSize_(fftSize) {
    std::lock_guard<std::mutex> lock(g_fftwMutex);
    fftwIn_ = (fftwf_complex*)fftwf_malloc(sizeof(fftwf_complex) * fftSize_);
    fftwOut_ = (fftwf_complex*)fftwf_malloc(sizeof(fftwf_complex) * fftSize_);
    plan_ = fftwf_plan_dft_1d(fftSize_, fftwIn_, fftwOut_, FFTW_FORWARD, FFTW_ESTIMATE);
    generateWindow();
}

FFTEngine::~FFTEngine() {
    std::lock_guard<std::mutex> lock(g_fftwMutex);
    if (plan_) fftwf_destroy_plan(plan_);
    if (fftwIn_) fftwf_free(fftwIn_);
    if (fftwOut_) fftwf_free(fftwOut_);
}

void FFTEngine::generateWindow() {
    // Hann window: 0.5 * (1 - cos(2*pi*i / (N-1)))
    window_.resize(fftSize_);
    for (int i = 0; i < fftSize_; i++) {
        window_[i] = 0.5f * (1.0f - cosf(static_cast<float>(Tau * i / (fftSize_ - 1))));
    }
}

void FFTEngine::computePowerSpectrum(const std::complex<float>* input, float* output) {
    // Apply Hann window and copy to FFTW input
    for (int i = 0; i < fftSize_; i++) {
        fftwIn_[i][0] = input[i].real() * window_[i];
        fftwIn_[i][1] = input[i].imag() * window_[i];
    }

    // Execute FFT
    fftwf_execute(plan_);

    // Compute log power with DC centering
    // k = i ^ (fftSize >> 1) rearranges so DC is in the center
    const float invFFTSize = 1.0f / fftSize_;
    const float logMultiplier = 10.0f / log2f(10.0f);

    for (int i = 0; i < fftSize_; i++) {
        int k = i ^ (fftSize_ >> 1); // DC-center rearrangement
        float re = fftwOut_[k][0] * invFFTSize;
        float im = fftwOut_[k][1] * invFFTSize;
        float power = re * re + im * im;
        // Avoid log of zero
        if (power < 1e-20f) power = 1e-20f;
        output[i] = log2f(power) * logMultiplier;
    }
}
