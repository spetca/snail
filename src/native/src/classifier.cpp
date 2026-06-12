#include "classifier.h"

#include <fstream>
#include <cmath>
#include <limits>
#include <stdexcept>

#include <nlohmann/json.hpp>

using json = nlohmann::json;

bool Classifier::load(const std::string& path, std::string& errorOut) {
    loaded_ = false;
    classes_.clear();
    labels_.clear();
    pcaMean_.clear();
    pcaComponents_.clear();

    std::ifstream f(path);
    if (!f.is_open()) {
        errorOut = "Cannot open model file: " + path;
        return false;
    }

    json j;
    try {
        f >> j;
    } catch (const json::exception& e) {
        errorOut = std::string("JSON parse error: ") + e.what();
        return false;
    }

    try {
        nComponents_ = j.at("n_components").get<int>();

        // PCA mean
        auto& jMean = j.at("pca_mean");
        pcaMean_.resize(NUM_FEATURES);
        for (int i = 0; i < NUM_FEATURES; ++i)
            pcaMean_[i] = jMean.at(i).get<float>();

        // PCA components [n_components][15]
        auto& jComp = j.at("pca_components");
        pcaComponents_.resize(nComponents_);
        for (int c = 0; c < nComponents_; ++c) {
            pcaComponents_[c].resize(NUM_FEATURES);
            for (int f = 0; f < NUM_FEATURES; ++f)
                pcaComponents_[c][f] = jComp.at(c).at(f).get<float>();
        }

        // Classes
        for (auto& jCls : j.at("classes")) {
            ClassEntry ce;
            ce.label = jCls.at("label").get<std::string>();

            auto& jCen = jCls.at("centroid");
            ce.centroid.resize(nComponents_);
            for (int c = 0; c < nComponents_; ++c)
                ce.centroid[c] = jCen.at(c).get<float>();

            auto& jInv = jCls.at("inv_cov");
            ce.invCov.resize(nComponents_, std::vector<float>(nComponents_));
            for (int r = 0; r < nComponents_; ++r)
                for (int c = 0; c < nComponents_; ++c)
                    ce.invCov[r][c] = jInv.at(r).at(c).get<float>();

            labels_.push_back(ce.label);
            classes_.push_back(std::move(ce));
        }
    } catch (const json::exception& e) {
        errorOut = std::string("Model format error: ") + e.what();
        return false;
    }

    if (classes_.empty()) {
        errorOut = "Model has no classes";
        return false;
    }

    loaded_ = true;
    return true;
}

std::vector<float> Classifier::project(const std::array<float, NUM_FEATURES>& feat) const {
    std::vector<float> proj(nComponents_, 0.0f);
    for (int c = 0; c < nComponents_; ++c) {
        float sum = 0.0f;
        for (int f = 0; f < NUM_FEATURES; ++f)
            sum += pcaComponents_[c][f] * (feat[f] - pcaMean_[f]);
        proj[c] = sum;
    }
    return proj;
}

float Classifier::mahalanobis2(const std::vector<float>& proj, const ClassEntry& cls) const {
    // d^2 = (proj - centroid)^T * inv_cov * (proj - centroid)
    std::vector<float> diff(nComponents_);
    for (int c = 0; c < nComponents_; ++c)
        diff[c] = proj[c] - cls.centroid[c];

    float d2 = 0.0f;
    for (int r = 0; r < nComponents_; ++r) {
        float tmp = 0.0f;
        for (int c = 0; c < nComponents_; ++c)
            tmp += cls.invCov[r][c] * diff[c];
        d2 += tmp * diff[r];
    }
    return d2;
}

int Classifier::classify(const std::array<float, NUM_FEATURES>& features, float& confidenceOut) const {
    if (!loaded_ || classes_.empty()) {
        confidenceOut = 0.0f;
        return -1;
    }

    auto proj = project(features);

    float bestD2 = std::numeric_limits<float>::max();
    int bestIdx = 0;
    for (int i = 0; i < static_cast<int>(classes_.size()); ++i) {
        float d2 = mahalanobis2(proj, classes_[i]);
        if (d2 < bestD2) {
            bestD2 = d2;
            bestIdx = i;
        }
    }

    // Confidence: convert distance to a 0-1 score using exponential decay.
    // d2=0 → confidence=1, d2=large → confidence≈0
    confidenceOut = std::exp(-0.5f * bestD2);
    // Clamp to [0, 1]
    if (confidenceOut < 0.0f) confidenceOut = 0.0f;
    if (confidenceOut > 1.0f) confidenceOut = 1.0f;

    return bestIdx;
}

std::string Classifier::labelFor(int idx) const {
    if (idx < 0 || idx >= static_cast<int>(labels_.size())) return "";
    return labels_[idx];
}
