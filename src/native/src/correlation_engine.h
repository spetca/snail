#pragma once

#include <complex>
#include <vector>

class CorrelationEngine {
public:
    // FFT-based cross-correlation: xcorr = IFFT(FFT(signal) * conj(FFT(template)))
    // Returns magnitude of correlation output
    static std::vector<float> crossCorrelate(
        const std::complex<float>* signal,
        size_t signalLen,
        const std::complex<float>* tmpl,
        size_t tmplLen
    );

    // CP Self-correlation (Poor man's Schmidl & Cox)
    static std::vector<float> selfCorrelate(
        const std::complex<float>* signal,
        size_t signalLen,
        size_t tu,
        size_t cpLen
    );

private:
    static size_t nextPow2(size_t n);
};
