#pragma once

#include <complex>
#include <vector>

class FilterEngine {
public:
    // Design a bandpass filter for given parameters
    // centerFreq: normalized center frequency (relative to sample rate)
    // bandwidth: normalized bandwidth
    // sampleRate: actual sample rate
    static void bandpassFilter(
        const std::complex<float>* input,
        std::complex<float>* output,
        size_t length,
        double centerFreq,
        double bandwidth,
        double sampleRate
    );
};
