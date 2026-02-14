#include "correlation_engine.h"
#include <fftw3.h>
#include <cmath>
#include <cstring>

size_t CorrelationEngine::nextPow2(size_t n) {
    size_t p = 1;
    while (p < n) p <<= 1;
    return p;
}

std::vector<float> CorrelationEngine::crossCorrelate(
    const std::complex<float>* signal,
    size_t signalLen,
    const std::complex<float>* tmpl,
    size_t tmplLen
) {
    // Zero-pad to next power of 2 >= signalLen + tmplLen - 1
    size_t fftLen = nextPow2(signalLen + tmplLen - 1);

    // Allocate FFTW buffers
    auto* sigIn  = (fftwf_complex*)fftwf_malloc(sizeof(fftwf_complex) * fftLen);
    auto* tmplIn = (fftwf_complex*)fftwf_malloc(sizeof(fftwf_complex) * fftLen);
    auto* sigFFT  = (fftwf_complex*)fftwf_malloc(sizeof(fftwf_complex) * fftLen);
    auto* tmplFFT = (fftwf_complex*)fftwf_malloc(sizeof(fftwf_complex) * fftLen);
    auto* product = (fftwf_complex*)fftwf_malloc(sizeof(fftwf_complex) * fftLen);
    auto* result  = (fftwf_complex*)fftwf_malloc(sizeof(fftwf_complex) * fftLen);

    // Zero-fill
    std::memset(sigIn, 0, sizeof(fftwf_complex) * fftLen);
    std::memset(tmplIn, 0, sizeof(fftwf_complex) * fftLen);

    // Copy input data
    for (size_t i = 0; i < signalLen; i++) {
        sigIn[i][0] = signal[i].real();
        sigIn[i][1] = signal[i].imag();
    }
    for (size_t i = 0; i < tmplLen; i++) {
        tmplIn[i][0] = tmpl[i].real();
        tmplIn[i][1] = tmpl[i].imag();
    }

    // Forward FFTs
    auto planSig = fftwf_plan_dft_1d(fftLen, sigIn, sigFFT, FFTW_FORWARD, FFTW_ESTIMATE);
    auto planTmpl = fftwf_plan_dft_1d(fftLen, tmplIn, tmplFFT, FFTW_FORWARD, FFTW_ESTIMATE);
    fftwf_execute(planSig);
    fftwf_execute(planTmpl);

    // Multiply: FFT(signal) * conj(FFT(template))
    for (size_t i = 0; i < fftLen; i++) {
        float sr = sigFFT[i][0], si = sigFFT[i][1];
        float tr = tmplFFT[i][0], ti = -tmplFFT[i][1]; // conjugate
        product[i][0] = sr * tr - si * ti;
        product[i][1] = sr * ti + si * tr;
    }

    // Inverse FFT
    auto planInv = fftwf_plan_dft_1d(fftLen, product, result, FFTW_BACKWARD, FFTW_ESTIMATE);
    fftwf_execute(planInv);

    // Compute magnitudes
    std::vector<float> output(signalLen);
    float invN = 1.0f / fftLen;
    for (size_t i = 0; i < signalLen; i++) {
        float re = result[i][0] * invN;
        float im = result[i][1] * invN;
        output[i] = std::sqrt(re * re + im * im);
    }

    // Cleanup
    fftwf_destroy_plan(planSig);
    fftwf_destroy_plan(planTmpl);
    fftwf_destroy_plan(planInv);
    fftwf_free(sigIn);
    fftwf_free(tmplIn);
    fftwf_free(sigFFT);
    fftwf_free(tmplFFT);
    fftwf_free(product);
    fftwf_free(result);

    return output;
}
