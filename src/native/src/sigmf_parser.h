#pragma once

#include <string>
#include <vector>

struct SigMFAnnotation {
    size_t sampleStart;
    size_t sampleCount;
    double freqLowerEdge;
    double freqUpperEdge;
    std::string label;
    std::string comment;
};

struct SigMFMetadata {
    std::string datatype;
    double sampleRate = 0;
    double centerFrequency = 0;
    std::string description;
    std::string author;
    std::vector<SigMFAnnotation> annotations;
};

class SigMFParser {
public:
    static SigMFMetadata parse(const std::string& jsonContent);
    static SigMFMetadata parseFile(const std::string& metaPath);
};
