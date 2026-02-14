#pragma once

#include <complex>
#include <string>
#include <vector>

struct SigMFWriteConfig {
    std::string outputPath;     // base path without extension
    std::string datatype;       // e.g., "cf32_le"
    double sampleRate = 0;
    double centerFrequency = 0;
    std::string description;
    std::string author;
    size_t sampleStart = 0;     // annotation sample start
    size_t sampleCount = 0;     // annotation sample count
};

class SigMFWriter {
public:
    // Write both .sigmf-data and .sigmf-meta files
    static void write(
        const SigMFWriteConfig& config,
        const std::complex<float>* samples,
        size_t sampleCount
    );
};
