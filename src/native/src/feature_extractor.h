#pragma once

#include <array>
#include <complex>
#include <cstddef>
#include <fftw3.h>
#include <mutex>
#include <vector>

using cf32 = std::complex<float>;

// 15 AMC features per 256-sample frame, all O(N), real-time safe
// Feature index mapping:
//  0: sigma_a     - std(|x| / mean(|x|))
//  1: mu_42       - kurtosis of envelope
//  2: sigma_dp    - std of detrended instantaneous phase
//  3: sigma_af    - std of instantaneous frequency
//  4: |C20|       - 2nd order cumulant
//  5: |C21|       - normalized mixed cumulant
//  6: |C40|       - 4th order cumulant
//  7: |C41|       - mixed 4th order cumulant
//  8: |C42|       - 4th order cumulant (symmetric)
//  9: gamma_max   - spectral peak ratio
// 10: sp_centroid - spectral centroid (normalized 0-1)
// 11: sp_bandwidth- spectral bandwidth
// 12: sp_flatness - Wiener entropy (geometric/arithmetic mean ratio)
// 13: sp_rolloff  - 95% energy rolloff point (normalized)
// 14: sp_symmetry - left/right PSD correlation

static constexpr int NUM_FEATURES = 15;

class FeatureExtractor {
public:
    explicit FeatureExtractor(int frameSize);
    ~FeatureExtractor();

    // Extract features from up to frameSize_ samples.
    // If n < frameSize_, remaining samples are treated as zero.
    std::array<float, NUM_FEATURES> extract(const cf32* samples, size_t n);

private:
    int frameSize_;
    fftwf_complex* fftwIn_  = nullptr;
    fftwf_complex* fftwOut_ = nullptr;
    fftwf_plan plan_        = nullptr;
};
