#include "sigmf_writer.h"
#include <fstream>
#include <stdexcept>
#include <nlohmann/json.hpp>

using json = nlohmann::json;

void SigMFWriter::write(
    const SigMFWriteConfig& config,
    const std::complex<float>* samples,
    size_t sampleCount
) {
    // Write .sigmf-data (raw binary samples)
    std::string dataPath = config.outputPath + ".sigmf-data";
    {
        std::ofstream dataFile(dataPath, std::ios::binary);
        if (!dataFile.good()) {
            throw std::runtime_error("Failed to create data file: " + dataPath);
        }
        dataFile.write(reinterpret_cast<const char*>(samples),
                       sampleCount * sizeof(std::complex<float>));
    }

    // Write .sigmf-meta (JSON metadata)
    std::string metaPath = config.outputPath + ".sigmf-meta";
    {
        json meta;

        // Global
        meta["global"] = {
            {"core:datatype", config.datatype.empty() ? "cf32_le" : config.datatype},
            {"core:version", "1.0.0"}
        };
        if (config.sampleRate > 0) {
            meta["global"]["core:sample_rate"] = config.sampleRate;
        }
        if (!config.description.empty()) {
            meta["global"]["core:description"] = config.description;
        }
        if (!config.author.empty()) {
            meta["global"]["core:author"] = config.author;
        }

        // Captures
        json capture = {
            {"core:sample_start", 0}
        };
        if (config.centerFrequency != 0) {
            capture["core:frequency"] = config.centerFrequency;
        }
        meta["captures"] = json::array({capture});

        // Annotations (if we have a meaningful range)
        meta["annotations"] = json::array();
        if (config.sampleCount > 0) {
            meta["annotations"].push_back({
                {"core:sample_start", config.sampleStart},
                {"core:sample_count", config.sampleCount}
            });
        }

        std::ofstream metaFile(metaPath);
        if (!metaFile.good()) {
            throw std::runtime_error("Failed to create meta file: " + metaPath);
        }
        metaFile << meta.dump(2);
    }
}
