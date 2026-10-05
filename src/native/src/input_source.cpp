#include "input_source.h"

#include <algorithm>
#include <cstring>
#include <fstream>
#include <stdexcept>
#include <sys/mman.h>
#include <sys/stat.h>
#include <fcntl.h>
#include <unistd.h>
#include <memory>
#include <filesystem>
#include <limits>

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

// Wrap the scalar adapter so every DSP consumer sees one channel in sample-frame units.
class InterleavedAdapter : public SampleAdapter {
    std::unique_ptr<SampleAdapter> base_;
    size_t channels_, channel_, componentBytes_;
    bool swap_;
public:
    InterleavedAdapter(std::unique_ptr<SampleAdapter> base, size_t channels, size_t channel,
                       size_t componentBytes, bool swap)
        : base_(std::move(base)), channels_(channels), channel_(channel), componentBytes_(componentBytes), swap_(swap) {}
    size_t sampleSize() const override { return base_->sampleSize() * channels_; }
    void copyRange(const void* src, size_t start, size_t length, std::complex<float>* dest) const override {
        if (channels_ == 1 && !swap_) { base_->copyRange(src, start, length, dest); return; }
        for (size_t i = 0; i < length; ++i) {
            const auto bytes = static_cast<const unsigned char*>(src) +
                ((start + i) * channels_ + channel_) * base_->sampleSize();
            // Also align potentially unaligned input before typed adapter reads.
            alignas(16) unsigned char sample[16];
            std::memcpy(sample, bytes, base_->sampleSize());
            if (swap_) {
                for (size_t j = 0; j < base_->sampleSize(); j += componentBytes_)
                    std::reverse(sample + j, sample + j + componentBytes_);
            }
            base_->copyRange(sample, 0, 1, dest + i);
        }
    }
};

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
    fullFileSamples_ = 0;
    viewOffset_ = 0;
    numChannels_ = 1;
    channel_ = 0;
    sigmfMetaJson_.clear();
    sampleRate_ = 1000000;
    centerFrequency_ = 0;
    dataPath_.clear();
}

void InputSource::open(const std::string& path, const std::string& overrideFormat,
                       size_t viewStart, size_t viewLength, size_t channel) {
    close();
    channel_ = channel;

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

    if (channel_ >= numChannels_) throw std::runtime_error("Channel index is outside this recording");
    if (!dataPath_.empty()) dataPath = dataPath_;
    dataPath_ = dataPath;

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
    if (!sigmfMetaJson_.empty() && fileSize_ % adapter_->sampleSize() != 0)
        throw std::runtime_error("SigMF data ends with an incomplete sample frame");
    fullFileSamples_ = fileSize_ / adapter_->sampleSize();

    mmapData_ = mmap(nullptr, fileSize_, PROT_READ, MAP_PRIVATE, fd_, 0);
    if (mmapData_ == MAP_FAILED) {
        mmapData_ = nullptr;
        ::close(fd_);
        fd_ = -1;
        throw std::runtime_error("Failed to mmap file: " + dataPath);
    }

    // Apply view window
    if (viewStart > 0 || viewLength > 0) {
        viewOffset_ = (viewStart < fullFileSamples_) ? viewStart : 0;
        size_t remaining = fullFileSamples_ - viewOffset_;
        totalSamples_ = (viewLength > 0 && viewLength < remaining) ? viewLength : remaining;
    } else {
        viewOffset_ = 0;
        totalSamples_ = fullFileSamples_;
    }
}

void InputSource::getSamples(size_t start, size_t length, std::complex<float>* dest) const {
    if (!mmapData_ || !adapter_) {
        throw std::runtime_error("No file open");
    }
    size_t actualLength = length;
    if (start + length > totalSamples_) {
        actualLength = (start < totalSamples_) ? totalSamples_ - start : 0;
    }
    if (actualLength > 0) {
        adapter_->copyRange(mmapData_, viewOffset_ + start, actualLength, dest);
    }
    for (size_t i = actualLength; i < length; i++) {
        dest[i] = std::complex<float>(0.0f, 0.0f);
    }
}

void InputSource::getSamplesStrided(size_t start, size_t length, size_t stride, std::complex<float>* dest) const {
    if (!mmapData_ || !adapter_) {
        throw std::runtime_error("No file open");
    }

    // Optimization for stride=1
    if (stride == 1) {
        getSamples(start, length, dest);
        return;
    }

    for (size_t i = 0; i < length; i++) {
        size_t srcIdx = start + i * stride;
        if (srcIdx < totalSamples_) {
            adapter_->copyRange(mmapData_, viewOffset_ + srcIdx, 1, &dest[i]);
        } else {
            dest[i] = std::complex<float>(0.0f, 0.0f);
        }
    }
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
    if (!file.good()) throw std::runtime_error("Cannot open SigMF metadata: " + metaPath);

    std::string content((std::istreambuf_iterator<char>(file)),
                        std::istreambuf_iterator<char>());
    sigmfMetaJson_ = content;

    auto meta = json::parse(content);
    const auto& global = meta.at("global");
    const auto channels = global.value("core:num_channels", json(1));
    if (!channels.is_number_integer() || channels.get<double>() < 1 ||
        channels.get<double>() > 9007199254740991.0)
        throw std::runtime_error("Invalid SigMF core:num_channels");
    numChannels_ = channels.get<size_t>();
    const std::string dt = global.at("core:datatype").get<std::string>();
    static const std::unordered_map<std::string, std::string> dtMap = {
        {"cf32_le", "cf32"}, {"cf32_be", "cf32"}, {"cf64_le", "cf64"}, {"cf64_be", "cf64"},
        {"ci32_le", "cs32"}, {"ci32_be", "cs32"}, {"ci16_le", "cs16"}, {"ci16_be", "cs16"},
        {"ci8", "cs8"}, {"cu8", "cu8"}, {"rf32_le", "rf32"}, {"rf32_be", "rf32"},
        {"rf64_le", "rf64"}, {"rf64_be", "rf64"}, {"ri16_le", "rs16"}, {"ri16_be", "rs16"},
        {"ri8", "rs8"}, {"ru8", "ru8"}
    };
    const auto it = dtMap.find(dt);
    if (it == dtMap.end()) throw std::runtime_error("Unsupported SigMF datatype: " + dt);
    format_ = it->second;
    createAdapter();
    if (numChannels_ > std::numeric_limits<size_t>::max() / adapter_->sampleSize())
        throw std::runtime_error("SigMF sample frame is too large");
    const size_t componentBytes = adapter_->sampleSize() / (dt[0] == 'c' ? 2 : 1);
    const uint16_t endianTest = 1;
    const bool littleEndian = *reinterpret_cast<const uint8_t*>(&endianTest) == 1;
    const bool swap = componentBytes > 1 && (littleEndian != (dt.substr(dt.size() - 3) == "_le"));
    adapter_ = std::make_unique<InterleavedAdapter>(std::move(adapter_), numChannels_, channel_, componentBytes, swap);
    if (global.contains("core:sample_rate")) {
        sampleRate_ = global.at("core:sample_rate").get<double>();
        if (!std::isfinite(sampleRate_) || sampleRate_ <= 0) throw std::runtime_error("Invalid SigMF sample rate");
    }
    if (global.value("core:trailing_bytes", 0) != 0)
        throw std::runtime_error("SigMF datasets with trailing bytes are not supported");
    if (global.contains("core:dataset")) {
        const auto name = global.at("core:dataset").get<std::string>();
        if (name.empty() || name == "." || name == ".." || name.find_first_of("/\\") != std::string::npos)
            throw std::runtime_error("SigMF core:dataset must be a filename in the metadata directory");
        dataPath_ = (std::filesystem::path(metaPath).parent_path() / name).string();
    }
    if (meta.contains("captures")) {
        for (const auto& capture : meta.at("captures")) {
            if (capture.value("core:header_bytes", 0) != 0)
                throw std::runtime_error("SigMF datasets with capture headers are not supported");
        }
        if (!meta.at("captures").empty())
            centerFrequency_ = meta.at("captures")[0].value("core:frequency", 0.0);
    }

}

void InputSource::getSamplesDetected(size_t start, size_t length, size_t stride, std::complex<float>* dest) const {
    if (!mmapData_ || !adapter_) {
        throw std::runtime_error("No file open");
    }

    if (stride == 1) {
        getSamples(start, length, dest);
        return;
    }

    std::vector<std::complex<float>> buffer(std::min(stride, size_t(65536)));

    for (size_t i = 0; i < length; i++) {
        size_t blockStart = start + i * stride;

        if (blockStart >= totalSamples_) {
            dest[i] = std::complex<float>(0.0f, 0.0f);
            continue;
        }

        size_t blockLen = stride;
        if (blockStart + blockLen > totalSamples_) {
            blockLen = totalSamples_ - blockStart;
        }

        float maxMag = -1.0f;
        std::complex<float> maxSample(0.0f, 0.0f);
        // A zoomed-out pixel may span gigabytes. Keep scratch memory bounded.
        for (size_t offset = 0; offset < blockLen; offset += buffer.size()) {
            const size_t count = std::min(buffer.size(), blockLen - offset);
            adapter_->copyRange(mmapData_, viewOffset_ + blockStart + offset, count, buffer.data());
            for (size_t j = 0; j < count; j++) {
                float mag = std::abs(buffer[j].real()) + std::abs(buffer[j].imag());
                if (mag > maxMag) { maxMag = mag; maxSample = buffer[j]; }
            }
        }
        dest[i] = maxSample;
    }
}
