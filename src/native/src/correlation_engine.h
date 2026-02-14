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

private:
    static size_t nextPow2(size_t n);
};
