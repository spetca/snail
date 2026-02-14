#include "filter_engine.h"
#include <cmath>
#include <liquid/liquid.h>

#ifndef M_PI
#define M_PI 3.14159265358979323846
#endif

static const double Tau = M_PI * 2.0;

void FilterEngine::bandpassFilter(
    const std::complex<float>* input,
    std::complex<float>* output,
    size_t length,
    double centerFreq,
    double bandwidth,
    double sampleRate
) {
    // Normalized cutoff frequency
    float cutoff = static_cast<float>(bandwidth / sampleRate / 2.0);
    cutoff = std::min(cutoff, 0.49f); // Ensure valid range

    // NCO frequency for mix-down
    float ncoFreq = static_cast<float>(Tau * centerFreq / sampleRate);

    // Design Kaiser-windowed FIR filter
    float attenuation = 60.0f;
    unsigned int filterLen = estimate_req_filter_len(std::min(cutoff, 0.05f), attenuation);
    if (filterLen < 4) filterLen = 4;

    std::vector<float> taps(filterLen);
    liquid_firdes_kaiser(filterLen, cutoff, attenuation, 0.0f, taps.data());

    // Create NCO for mix-down to baseband
    nco_crcf mix = nco_crcf_create(LIQUID_NCO);
    nco_crcf_set_frequency(mix, ncoFreq);
    nco_crcf_set_phase(mix, 0.0f);

    // Mix down to baseband
    auto temp = std::make_unique<std::complex<float>[]>(length);
    nco_crcf_mix_block_down(
        mix,
        const_cast<liquid_float_complex*>(reinterpret_cast<const liquid_float_complex*>(input)),
        reinterpret_cast<liquid_float_complex*>(temp.get()),
        length
    );
    nco_crcf_destroy(mix);

    // Apply FIR filter
    firfilt_crcf filter = firfilt_crcf_create(taps.data(), filterLen);
    for (size_t i = 0; i < length; i++) {
        firfilt_crcf_push(filter, *reinterpret_cast<liquid_float_complex*>(&temp[i]));
        firfilt_crcf_execute(filter, reinterpret_cast<liquid_float_complex*>(&output[i]));
    }
    firfilt_crcf_destroy(filter);
}
