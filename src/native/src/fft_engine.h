#pragma once

#include <complex>
#include <vector>
#include <mutex>
#include <fftw3.h>

// FFTW planner is not thread-safe even with FFTW_ESTIMATE.
// All plan creation/destruction must be serialized through this mutex.
extern std::mutex g_fftwMutex;

class FFTEngine {
public:
    explicit FFTEngine(int fftSize);
    ~FFTEngine();

    // Compute FFT on input samples, output log power spectrum (dB)
    // Applies Hann window, computes FFT, DC-centers, returns log power
    void computePowerSpectrum(const std::complex<float>* input, float* output);

    // New generic computeFFT for the FFT window
    void computeFFT(
        const std::complex<float>* input, 
        int inputLen,
        float* output,
        bool shift,
        bool logScale,
        const std::string& windowType
    );

    int size() const { return fftSize_; }

private:
    void generateWindow();

    int fftSize_;
    std::vector<float> window_;
    fftwf_complex* fftwIn_ = nullptr;
    fftwf_complex* fftwOut_ = nullptr;
    fftwf_plan plan_ = nullptr;
};
