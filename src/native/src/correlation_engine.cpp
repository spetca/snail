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

    // Compute cumulative energies for O(1) range energy lookup
    std::vector<float> sigCumEnergy(signalLen + 1, 0.0f);
    for (size_t i = 0; i < signalLen; i++) {
        float r = signal[i].real();
        float im = signal[i].imag();
        sigCumEnergy[i + 1] = sigCumEnergy[i] + (r * r + im * im);
    }

    std::vector<float> tmplCumEnergy(tmplLen + 1, 0.0f);
    for (size_t i = 0; i < tmplLen; i++) {
        float r = tmpl[i].real();
        float im = tmpl[i].imag();
        tmplCumEnergy[i + 1] = tmplCumEnergy[i] + (r * r + im * im);
    }

    // Prepare full linear output range: lag k from -(tmplLen - 1) to (signalLen - 1)
    size_t outLen = signalLen + tmplLen - 1;
    std::vector<float> output(outLen);
    float invN = 1.0f / fftLen;

    for (size_t i = 0; i < outLen; i++) {
        // Lag k: - (tmplLen - 1) up to (signalLen - 1)
        int k = static_cast<int>(i) - (static_cast<int>(tmplLen) - 1);
        
        // FFT index for lag k
        size_t fftIdx = (k >= 0) ? static_cast<size_t>(k) : (fftLen + k);
        
        float re = result[fftIdx][0] * invN;
        float im = result[fftIdx][1] * invN;
        float mag = std::sqrt(re * re + im * im);

        // Define overlap region
        int overlapStartSig = std::max(0, k);
        int overlapEndSig = std::min(static_cast<int>(signalLen), k + static_cast<int>(tmplLen));
        float eSig = sigCumEnergy[overlapEndSig] - sigCumEnergy[overlapStartSig];

        int overlapStartTmpl = std::max(0, -k);
        int overlapEndTmpl = std::min(static_cast<int>(tmplLen), static_cast<int>(signalLen) - k);
        float eTmpl = tmplCumEnergy[overlapEndTmpl] - tmplCumEnergy[overlapStartTmpl];

        float den = std::sqrt(eSig * eTmpl);
        if (den > 1e-12f) {
            output[i] = mag / den;
        } else {
            output[i] = 0.0f;
        }
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

std::vector<float> CorrelationEngine::selfCorrelate(
    const std::complex<float>* signal,
    size_t signalLen,
    size_t tu,
    size_t cpLen
) {
    if (signalLen < tu + cpLen) return {};

    size_t outLen = signalLen - tu - cpLen + 1;
    std::vector<float> output(outLen);

    std::complex<float> currentProductSum(0, 0);
    float currentEnergyA = 0;
    float currentEnergyB = 0;

    // Initialize first window
    for (size_t i = 0; i < cpLen; i++) {
        currentProductSum += signal[i] * std::conj(signal[i + tu]);
        currentEnergyA += std::norm(signal[i]);
        currentEnergyB += std::norm(signal[i + tu]);
    }

    auto getMag = [&](const std::complex<float>& ps, float ea, float eb) {
        float den = std::sqrt(ea * eb);
        if (den > 1e-12f) return std::abs(ps) / den;
        return 0.0f;
    };

    output[0] = getMag(currentProductSum, currentEnergyA, currentEnergyB);

    // Slide window
    for (size_t j = 1; j < outLen; j++) {
        size_t oldIdx = j - 1;
        size_t newIdx = j + cpLen - 1;

        currentProductSum -= signal[oldIdx] * std::conj(signal[oldIdx + tu]);
        currentProductSum += signal[newIdx] * std::conj(signal[newIdx + tu]);

        currentEnergyA -= std::norm(signal[oldIdx]);
        currentEnergyA += std::norm(signal[newIdx]);

        currentEnergyB -= std::norm(signal[oldIdx + tu]);
        currentEnergyB += std::norm(signal[newIdx + tu]);

        output[j] = getMag(currentProductSum, currentEnergyA, currentEnergyB);
    }

    return output;
}
