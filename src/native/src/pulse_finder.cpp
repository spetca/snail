#include "pulse_finder.h"
#include "fft_engine.h"

#include <algorithm>
#include <cmath>
#include <vector>

#ifndef M_PI
#define M_PI 3.14159265358979323846
#endif

// ── Noise floor estimation ────────────────────────────────────────────────────
//
// Sample N evenly-spaced points, compute instantaneous power, take the
// 10th-percentile as a proxy for the noise floor.

float PulseFinder::estimateNoiseFloor(
    const std::complex<float>* samples,
    size_t n,
    size_t envWin
) const {
    const size_t probeCount = std::min<size_t>(8192, n);
    const size_t step = n / probeCount;

    std::vector<float> powers;
    powers.reserve(probeCount);

    // Compute block-RMS at each probe point
    for (size_t i = 0; i < probeCount; i++) {
        size_t idx = i * step;
        size_t w = std::min(envWin, n - idx);
        float acc = 0.0f;
        for (size_t j = idx; j < idx + w; j++) {
            float re = samples[j].real(), im = samples[j].imag();
            acc += re * re + im * im;
        }
        powers.push_back(acc / static_cast<float>(w));
    }

    std::sort(powers.begin(), powers.end());
    // 10th percentile
    size_t idx10 = static_cast<size_t>(powers.size() * 0.10);
    return powers[idx10];
}

// ── Pulse edge detection ──────────────────────────────────────────────────────
//
// Compute a sliding-window power envelope, then find stretches above threshold.
// Uses a decimated scan for speed, then trims edges at full resolution.

std::vector<PulseFinder::RawEdge> PulseFinder::detectPulses(
    const std::complex<float>* samples,
    size_t n,
    float threshold,
    size_t envWin,
    size_t minWidthSamples,
    size_t maxWidthSamples
) const {
    std::vector<RawEdge> result;

    // Scan with stride = envWin/4 for speed
    const size_t scanStride = std::max<size_t>(1, envWin / 4);

    bool inPulse = false;
    size_t pulseStartScan = 0;

    auto envelope = [&](size_t center) -> float {
        size_t lo = center >= envWin / 2 ? center - envWin / 2 : 0;
        size_t hi = std::min(n, lo + envWin);
        float acc = 0.0f;
        for (size_t j = lo; j < hi; j++) {
            float re = samples[j].real(), im = samples[j].imag();
            acc += re * re + im * im;
        }
        return acc / static_cast<float>(hi - lo);
    };

    // First pass: find candidate regions at decimated rate
    std::vector<RawEdge> candidates;
    for (size_t i = 0; i < n; i += scanStride) {
        bool above = envelope(i) > threshold;
        if (above && !inPulse) {
            inPulse = true;
            pulseStartScan = i;
        } else if (!above && inPulse) {
            inPulse = false;
            size_t width = i - pulseStartScan;
            // Pre-filter by width (loose check at scan resolution)
            if (width >= minWidthSamples / 2 && width <= maxWidthSamples * 2) {
                candidates.push_back({ pulseStartScan, i });
            }
        }
    }
    if (inPulse) {
        candidates.push_back({ pulseStartScan, n });
    }

    // Second pass: refine each candidate's start/end at full resolution
    for (auto& c : candidates) {
        // Walk backward from coarse start to find true rising edge
        size_t refineBack = c.start >= envWin ? c.start - envWin : 0;
        size_t trueStart = c.start;
        for (size_t i = refineBack; i <= c.start; i++) {
            if (envelope(i) > threshold) { trueStart = i; break; }
        }

        // Walk forward from coarse end to find true falling edge
        size_t refineFwd = std::min(n, c.end + envWin);
        size_t trueEnd = c.end;
        for (size_t i = c.end; i < refineFwd; i++) {
            if (envelope(i) <= threshold) { trueEnd = i; break; }
        }

        size_t width = trueEnd - trueStart;
        if (width >= minWidthSamples && width <= maxWidthSamples) {
            result.push_back({ trueStart, trueEnd });
        }
    }

    return result;
}

// ── 99% OBW ──────────────────────────────────────────────────────────────────
//
// ITU method: find the band that contains `percentile` fraction of total power,
// slicing 0.5*(1-percentile) from each end of the cumulative PSD.

PulseFinder::OBWResult PulseFinder::computeOBW(
    const std::complex<float>* samples,
    size_t count,
    double sampleRate,
    double percentile
) const {
    if (count < 4) return { 0.0, 0.0 };

    // FFT size = next power of 2 >= count, capped at 4096 for speed
    // (frequency resolution = sampleRate/fftSize; 4096 @ 1MHz = ~244 Hz/bin)
    int fftSize = 4;
    while (static_cast<size_t>(fftSize) < count && fftSize < 4096) fftSize <<= 1;

    // Build power spectrum (DC-centered, linear scale)
    std::vector<float> power(fftSize);
    {
        FFTEngine eng(fftSize);
        std::vector<float> out(fftSize);
        eng.computeFFT(samples, static_cast<int>(count), out.data(),
                       /*shift=*/true, /*logScale=*/false, "hann");
        // out is amplitude; square it for power
        for (int i = 0; i < fftSize; i++) {
            power[i] = out[i] * out[i];
        }
    }

    // Cumulative power
    double total = 0.0;
    for (float p : power) total += p;
    if (total < 1e-30) return { 0.0, 0.0 };

    const double tail = (1.0 - percentile) * 0.5; // 0.5% each side for 99%

    // Find low bin: cumulative reaches tail*total
    double cum = 0.0;
    int lowBin = 0;
    for (int i = 0; i < fftSize; i++) {
        cum += power[i];
        if (cum >= tail * total) { lowBin = i; break; }
    }

    // Find high bin: cumulative from end reaches tail*total
    cum = 0.0;
    int highBin = fftSize - 1;
    for (int i = fftSize - 1; i >= 0; i--) {
        cum += power[i];
        if (cum >= tail * total) { highBin = i; break; }
    }

    if (highBin < lowBin) highBin = lowBin;

    const double binWidth = sampleRate / fftSize;

    // DC-centered: bin 0 = -sr/2, bin fftSize/2 = DC (0 Hz)
    const double freqLow  = (lowBin  - fftSize / 2) * binWidth;
    const double freqHigh = (highBin - fftSize / 2) * binWidth;

    return {
        (freqLow + freqHigh) * 0.5,   // center (offset from DC)
        freqHigh - freqLow             // bandwidth
    };
}

// ── Main entry point ─────────────────────────────────────────────────────────

std::vector<PulseRecord> PulseFinder::find(
    const std::complex<float>* samples,
    size_t numSamples,
    const PulseFindConfig& cfg
) {
    if (numSamples == 0 || cfg.sampleRate <= 0) return {};

    const double sr = cfg.sampleRate;
    const size_t targetWidthSamples = static_cast<size_t>(cfg.targetWidthSecs * sr);
    const size_t tolSamples = static_cast<size_t>(cfg.widthTolSecs * sr);
    const size_t minWidthSamples = targetWidthSamples > tolSamples
        ? targetWidthSamples - tolSamples : 1;
    const size_t maxWidthSamples = targetWidthSamples + tolSamples;

    // Envelope window: ~1/16 of target pulse width, min 8, max 512
    const size_t envWin = std::max<size_t>(8, std::min<size_t>(512, targetWidthSamples / 16));

    // Noise floor + threshold
    float noiseFloor = estimateNoiseFloor(samples, numSamples, envWin);
    const double threshDb = (cfg.thresholdDb > 0) ? cfg.thresholdDb : 10.0;
    float threshold = noiseFloor * static_cast<float>(std::pow(10.0, threshDb / 10.0));

    // Detect pulses by width
    auto edges = detectPulses(samples, numSamples, threshold,
                              envWin, minWidthSamples, maxWidthSamples);

    // For each candidate, compute OBW and filter
    const double obwPercentile = (cfg.obwPercentile > 0 && cfg.obwPercentile < 1)
        ? cfg.obwPercentile : 0.99;

    std::vector<PulseRecord> result;
    result.reserve(edges.size());

    for (const auto& e : edges) {
        size_t count = e.end - e.start;
        if (count == 0) continue;

        auto obw = computeOBW(samples + e.start, count, sr, obwPercentile);

        // Filter by OBW tolerance
        double obwDiff = std::abs(obw.bandwidthHz - cfg.targetOBWHz);
        if (obwDiff > cfg.obwTolHz) continue;

        PulseRecord rec;
        rec.startSample = e.start;
        rec.endSample   = e.end;
        rec.startTimeSecs = e.start / sr;
        rec.endTimeSecs   = e.end   / sr;
        rec.measuredWidthSecs = count / sr;
        rec.centerFrequencyHz = obw.centerHz;
        rec.occupiedBandwidthHz = obw.bandwidthHz;
        rec.priSecs = -1.0;
        rec.pulseNumber = 0; // filled below

        result.push_back(rec);
    }

    // Number pulses and compute PRI
    for (size_t i = 0; i < result.size(); i++) {
        result[i].pulseNumber = i + 1;
        if (i > 0) {
            result[i].priSecs = result[i].startTimeSecs - result[i - 1].startTimeSecs;
        }
    }

    return result;
}
