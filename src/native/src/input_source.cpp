#include "input_source.h"

#include <algorithm>
#include <cstring>
#include <fstream>
#include <stdexcept>
#include <sys/mman.h>
#include <sys/stat.h>
#include <fcntl.h>
#include <unistd.h>

#include <nlohmann/json.hpp>

using json = nlohmann::json;

// ── Complex adapters ──────────────────────────────────────────────

void ComplexF32Adapter::copyRange(const void* src, size_t start, size_t length,
                                   std::complex<float>* dest) const {
    auto data = static_cast<const std::complex<float>*>(src);
    std::memcpy(dest, data + start, length * sizeof(std::complex<float>));
}

void ComplexF64Adapter::copyRange(const void* src, size_t start, size_t length,
                                   std::complex<float>* dest) const {
    auto data = static_cast<const std::complex<double>*>(src);
    for (size_t i = 0; i < length; i++) {
        dest[i] = std::complex<float>(
            static_cast<float>(data[start + i].real()),
            static_cast<float>(data[start + i].imag())
        );
    }
}

void ComplexS32Adapter::copyRange(const void* src, size_t start, size_t length,
                                   std::complex<float>* dest) const {
    auto data = static_cast<const int32_t*>(src);
    const float scale = 1.0f / 2147483648.0f;
    for (size_t i = 0; i < length; i++) {
        size_t idx = (start + i) * 2;
        dest[i] = std::complex<float>(data[idx] * scale, data[idx + 1] * scale);
    }
}

void ComplexS16Adapter::copyRange(const void* src, size_t start, size_t length,
                                   std::complex<float>* dest) const {
    auto data = static_cast<const int16_t*>(src);
    const float scale = 1.0f / 32768.0f;
    for (size_t i = 0; i < length; i++) {
        size_t idx = (start + i) * 2;
        dest[i] = std::complex<float>(data[idx] * scale, data[idx + 1] * scale);
    }
}

void ComplexS8Adapter::copyRange(const void* src, size_t start, size_t length,
                                  std::complex<float>* dest) const {
    auto data = static_cast<const int8_t*>(src);
    const float scale = 1.0f / 128.0f;
    for (size_t i = 0; i < length; i++) {
        size_t idx = (start + i) * 2;
        dest[i] = std::complex<float>(data[idx] * scale, data[idx + 1] * scale);
    }
}

void ComplexU8Adapter::copyRange(const void* src, size_t start, size_t length,
                                  std::complex<float>* dest) const {
    auto data = static_cast<const uint8_t*>(src);
    const float scale = 1.0f / 128.0f;
    const float offset = 127.4f;
    for (size_t i = 0; i < length; i++) {
        size_t idx = (start + i) * 2;
        dest[i] = std::complex<float>(
            (data[idx] - offset) * scale,
            (data[idx + 1] - offset) * scale
        );
    }
}

// ── Real adapters ─────────────────────────────────────────────────

void RealF32Adapter::copyRange(const void* src, size_t start, size_t length,
                                std::complex<float>* dest) const {
    auto data = static_cast<const float*>(src);
    for (size_t i = 0; i < length; i++) {
        dest[i] = std::complex<float>(data[start + i], 0.0f);
    }
}

void RealF64Adapter::copyRange(const void* src, size_t start, size_t length,
                                std::complex<float>* dest) const {
    auto data = static_cast<const double*>(src);
    for (size_t i = 0; i < length; i++) {
        dest[i] = std::complex<float>(static_cast<float>(data[start + i]), 0.0f);
    }
}

void RealS16Adapter::copyRange(const void* src, size_t start, size_t length,
                                std::complex<float>* dest) const {
    auto data = static_cast<const int16_t*>(src);
    const float scale = 1.0f / 32768.0f;
    for (size_t i = 0; i < length; i++) {
        dest[i] = std::complex<float>(data[start + i] * scale, 0.0f);
    }
}

void RealS8Adapter::copyRange(const void* src, size_t start, size_t length,
                                std::complex<float>* dest) const {
    auto data = static_cast<const int8_t*>(src);
    const float scale = 1.0f / 128.0f;
    for (size_t i = 0; i < length; i++) {
        dest[i] = std::complex<float>(data[start + i] * scale, 0.0f);
    }
}

void RealU8Adapter::copyRange(const void* src, size_t start, size_t length,
                                std::complex<float>* dest) const {
    auto data = static_cast<const uint8_t*>(src);
    const float scale = 1.0f / 128.0f;
    const float offset = 127.4f;
    for (size_t i = 0; i < length; i++) {
        dest[i] = std::complex<float>((data[start + i] - offset) * scale, 0.0f);
    }
}

// ── Adapter factory ───────────────────────────────────────────────

std::unique_ptr<SampleAdapter> createAdapter(const std::string& fmt) {
    if (fmt == "cf32") return std::make_unique<ComplexF32Adapter>();
    if (fmt == "cf64") return std::make_unique<ComplexF64Adapter>();
    if (fmt == "cs32") return std::make_unique<ComplexS32Adapter>();
    if (fmt == "cs16") return std::make_unique<ComplexS16Adapter>();
    if (fmt == "cs8")  return std::make_unique<ComplexS8Adapter>();
    if (fmt == "cu8")  return std::make_unique<ComplexU8Adapter>();
    if (fmt == "rf32") return std::make_unique<RealF32Adapter>();
    if (fmt == "rf64") return std::make_unique<RealF64Adapter>();
    if (fmt == "rs16") return std::make_unique<RealS16Adapter>();
    if (fmt == "rs8")  return std::make_unique<RealS8Adapter>();
    if (fmt == "ru8")  return std::make_unique<RealU8Adapter>();
    return std::make_unique<ComplexF32Adapter>(); // default
}

// ── InputSource ───────────────────────────────────────────────────

InputSource::InputSource() = default;

InputSource::~InputSource() {
    close();
}

void InputSource::close() {
    if (mmapData_ && fileSize_ > 0) {
        munmap(mmapData_, fileSize_);
        mmapData_ = nullptr;
    }
    if (fd_ >= 0) {
        ::close(fd_);
        fd_ = -1;
    }
    fileSize_ = 0;
    totalSamples_ = 0;
}

void InputSource::open(const std::string& path, const std::string& overrideFormat) {
    close();

    // Detect format from extension or override
    detectFormat(path, overrideFormat);
    createAdapter();

    // Determine the data file path
    std::string dataPath = path;

    // If .sigmf-meta was opened, find the .sigmf-data partner
    if (path.size() > 11 && path.substr(path.size() - 11) == ".sigmf-meta") {
        dataPath = path.substr(0, path.size() - 11) + ".sigmf-data";
        parseSigMF(path);
    }
    // If .sigmf-data was opened, look for .sigmf-meta partner
    else if (path.size() > 11 && path.substr(path.size() - 11) == ".sigmf-data") {
        std::string metaPath = path.substr(0, path.size() - 11) + ".sigmf-meta";
        std::ifstream test(metaPath);
        if (test.good()) {
            parseSigMF(metaPath);
        }
    }

    // Open and mmap the data file
    fd_ = ::open(dataPath.c_str(), O_RDONLY);
    if (fd_ < 0) {
        throw std::runtime_error("Failed to open file: " + dataPath);
    }

    struct stat st;
    if (fstat(fd_, &st) < 0) {
        ::close(fd_);
        fd_ = -1;
        throw std::runtime_error("Failed to stat file: " + dataPath);
    }

    fileSize_ = st.st_size;
    totalSamples_ = fileSize_ / adapter_->sampleSize();

    mmapData_ = mmap(nullptr, fileSize_, PROT_READ, MAP_PRIVATE, fd_, 0);
    if (mmapData_ == MAP_FAILED) {
        mmapData_ = nullptr;
        ::close(fd_);
        fd_ = -1;
        throw std::runtime_error("Failed to mmap file: " + dataPath);
    }
}

void InputSource::getSamples(size_t start, size_t length, std::complex<float>* dest) const {
    if (!mmapData_ || !adapter_) {
        throw std::runtime_error("No file open");
    }
    size_t end = start + length;
    if (end > totalSamples_) {
        length = totalSamples_ - start;
    }
    adapter_->copyRange(mmapData_, start, length, dest);
}

void InputSource::detectFormat(const std::string& path, const std::string& overrideFormat) {
    if (!overrideFormat.empty()) {
        format_ = overrideFormat;
        return;
    }

    // Extract extension
    auto dotPos = path.rfind('.');
    if (dotPos == std::string::npos) {
        format_ = "cf32";
        return;
    }

    std::string ext = path.substr(dotPos + 1);
    // Convert to lowercase
    std::transform(ext.begin(), ext.end(), ext.begin(), ::tolower);

    // Extension to format mapping (ported from inspectrum)
    static const std::unordered_map<std::string, std::string> extMap = {
        {"cfile", "cf32"}, {"cf32", "cf32"}, {"fc32", "cf32"}, {"raw", "cf32"}, {"iq", "cf32"},
        {"cf64", "cf64"}, {"fc64", "cf64"},
        {"cs32", "cs32"}, {"sc32", "cs32"}, {"c32", "cs32"},
        {"cs16", "cs16"}, {"sc16", "cs16"}, {"c16", "cs16"},
        {"cs8", "cs8"}, {"sc8", "cs8"}, {"c8", "cs8"},
        {"cu8", "cu8"}, {"uc8", "cu8"},
        {"sigmf-data", "cf32"}, {"sigmf-meta", "cf32"},
        {"f32", "rf32"}, {"f64", "rf64"},
        {"s16", "rs16"}, {"s8", "rs8"}, {"u8", "ru8"}
    };

    auto it = extMap.find(ext);
    format_ = (it != extMap.end()) ? it->second : "cf32";
}

void InputSource::createAdapter() {
    adapter_ = ::createAdapter(format_);
}

void InputSource::parseSigMF(const std::string& metaPath) {
    std::ifstream file(metaPath);
    if (!file.good()) return;

    std::string content((std::istreambuf_iterator<char>(file)),
                        std::istreambuf_iterator<char>());
    sigmfMetaJson_ = content;

    try {
        auto meta = json::parse(content);

        // Parse datatype from global
        if (meta.contains("global") && meta["global"].contains("core:datatype")) {
            std::string dt = meta["global"]["core:datatype"];
            // Map SigMF datatypes to our format codes
            static const std::unordered_map<std::string, std::string> dtMap = {
                {"cf32_le", "cf32"}, {"cf32_be", "cf32"},
                {"cf64_le", "cf64"}, {"cf64_be", "cf64"},
                {"ci32_le", "cs32"}, {"ci32_be", "cs32"},
                {"ci16_le", "cs16"}, {"ci16_be", "cs16"},
                {"ci8", "cs8"},
                {"cu8", "cu8"},
                {"rf32_le", "rf32"}, {"rf32_be", "rf32"},
                {"rf64_le", "rf64"}, {"rf64_be", "rf64"},
                {"ri16_le", "rs16"}, {"ri16_be", "rs16"},
                {"ri8", "rs8"},
                {"ru8", "ru8"}
            };
            auto it = dtMap.find(dt);
            if (it != dtMap.end()) {
                format_ = it->second;
                createAdapter();
            }
        }

        // Parse sample rate
        if (meta.contains("global") && meta["global"].contains("core:sample_rate")) {
            sampleRate_ = meta["global"]["core:sample_rate"].get<double>();
        }

        // Parse center frequency from captures
        if (meta.contains("captures") && meta["captures"].is_array() && !meta["captures"].empty()) {
            auto& cap = meta["captures"][0];
            if (cap.contains("core:frequency")) {
                centerFrequency_ = cap["core:frequency"].get<double>();
            }
        }
    } catch (const json::exception&) {
        // Invalid JSON, continue with defaults
    }
}
