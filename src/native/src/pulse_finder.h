#pragma once

#include <complex>
#include <vector>
#include <cstddef>

struct PulseRecord {
    size_t pulseNumber;
    size_t startSample;
    size_t endSample;
    double startTimeSecs;
    double endTimeSecs;
    double measuredWidthSecs;
    double centerFrequencyHz;
    double occupiedBandwidthHz;
    double priSecs;        // -1.0 for first pulse, seconds since previous pulse start
};

struct PulseFindConfig {
    double targetWidthSecs;
    double widthTolSecs;
    double targetOBWHz;
    double obwTolHz;
    double sampleRate;
    size_t startSample;   // 0 = from beginning
    size_t endSample;     // 0 = to end of file
    double thresholdDb;   // relative dB above noise floor; -1 = auto (~10 dB)
    double obwPercentile; // default 0.99
};

class PulseFinder {
public:
    std::vector<PulseRecord> find(
        const std::complex<float>* samples,
        size_t numSamples,
        const PulseFindConfig& cfg
    );

private:
    struct RawEdge { size_t start; size_t end; };

    float estimateNoiseFloor(const std::complex<float>* samples, size_t n, size_t envWin) const;

    std::vector<RawEdge> detectPulses(
        const std::complex<float>* samples,
        size_t n,
        float threshold,
        size_t envWin,
        size_t minWidthSamples,
        size_t maxWidthSamples
    ) const;

    struct OBWResult { double centerHz; double bandwidthHz; };
    OBWResult computeOBW(
        const std::complex<float>* samples,
        size_t count,
        double sampleRate,
        double percentile
    ) const;
};
