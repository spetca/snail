#pragma once

#include <string>
#include <vector>
#include "feature_extractor.h"

// PCA + Mahalanobis distance classifier.
// Loads a model.json produced by scripts/train_classifier.py.
//
// model.json format:
// {
//   "n_components": 3,
//   "pca_mean": [...],           // float[15]
//   "pca_components": [[...]],   // float[n_components][15]
//   "classes": [
//     { "label": "lora", "centroid": [x,y,z], "inv_cov": [[...]] }
//   ]
// }

struct ClassEntry {
    std::string label;
    std::vector<float> centroid;          // length n_components
    std::vector<std::vector<float>> invCov; // [n_components][n_components]
};

struct ClassifyFrame {
    size_t sampleStart;
    size_t sampleCount;
    std::string label;
    float confidence;  // 0-1, higher is better
};

class Classifier {
public:
    // Load model from JSON file.  Returns false on parse/IO error.
    bool load(const std::string& path, std::string& errorOut);

    // True if a model has been loaded successfully.
    bool loaded() const { return loaded_; }

    // Labels of known classes in load order.
    const std::vector<std::string>& labels() const { return labels_; }

    // Classify a single feature vector.
    // Returns the label index with best score and a confidence in [0,1].
    int classify(const std::array<float, NUM_FEATURES>& features, float& confidenceOut) const;

    // Human-readable label for an index, "" if out of range.
    std::string labelFor(int idx) const;

private:
    bool loaded_ = false;
    int nComponents_ = 0;
    std::vector<float> pcaMean_;                   // [15]
    std::vector<std::vector<float>> pcaComponents_; // [n_components][15]
    std::vector<ClassEntry> classes_;
    std::vector<std::string> labels_;

    // Project feature vector through PCA, returns reduced vector
    std::vector<float> project(const std::array<float, NUM_FEATURES>& feat) const;

    // Mahalanobis distance^2 from a projected vector to a class centroid
    float mahalanobis2(const std::vector<float>& proj, const ClassEntry& cls) const;
};
