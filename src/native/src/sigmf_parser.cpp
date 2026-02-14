#include "sigmf_parser.h"
#include <fstream>
#include <nlohmann/json.hpp>

using json = nlohmann::json;

SigMFMetadata SigMFParser::parse(const std::string& jsonContent) {
    SigMFMetadata meta;

    auto doc = json::parse(jsonContent);

    // Global section
    if (doc.contains("global")) {
        auto& global = doc["global"];
        if (global.contains("core:datatype"))
            meta.datatype = global["core:datatype"].get<std::string>();
        if (global.contains("core:sample_rate"))
            meta.sampleRate = global["core:sample_rate"].get<double>();
        if (global.contains("core:description"))
            meta.description = global["core:description"].get<std::string>();
        if (global.contains("core:author"))
            meta.author = global["core:author"].get<std::string>();
    }

    // Captures section
    if (doc.contains("captures") && doc["captures"].is_array() && !doc["captures"].empty()) {
        auto& cap = doc["captures"][0];
        if (cap.contains("core:frequency"))
            meta.centerFrequency = cap["core:frequency"].get<double>();
    }

    // Annotations section
    if (doc.contains("annotations") && doc["annotations"].is_array()) {
        for (auto& ann : doc["annotations"]) {
            SigMFAnnotation a;
            a.sampleStart = ann.value("core:sample_start", size_t(0));
            a.sampleCount = ann.value("core:sample_count", size_t(0));
            a.freqLowerEdge = ann.value("core:freq_lower_edge", 0.0);
            a.freqUpperEdge = ann.value("core:freq_upper_edge", 0.0);
            a.label = ann.value("core:label", std::string());
            a.comment = ann.value("core:comment", std::string());
            meta.annotations.push_back(a);
        }
    }

    return meta;
}

SigMFMetadata SigMFParser::parseFile(const std::string& metaPath) {
    std::ifstream file(metaPath);
    if (!file.good()) {
        throw std::runtime_error("Cannot open SigMF meta file: " + metaPath);
    }
    std::string content((std::istreambuf_iterator<char>(file)),
                        std::istreambuf_iterator<char>());
    return parse(content);
}
