#pragma once

#include <complex>
#include <memory>
#include <string>
#include <cstddef>

// Sample adapter base class - ported from inspectrum/src/inputsource.cpp
class SampleAdapter {
public:
    virtual ~SampleAdapter() = default;
    virtual size_t sampleSize() const = 0;
    virtual void copyRange(const void* src, size_t start, size_t length,
                           std::complex<float>* dest) const = 0;
};

// Complex adapters
class ComplexF32Adapter : public SampleAdapter {
public:
    size_t sampleSize() const override { return 8; }
    void copyRange(const void* src, size_t start, size_t length,
                   std::complex<float>* dest) const override;
};

class ComplexF64Adapter : public SampleAdapter {
public:
    size_t sampleSize() const override { return 16; }
    void copyRange(const void* src, size_t start, size_t length,
                   std::complex<float>* dest) const override;
};

class ComplexS32Adapter : public SampleAdapter {
public:
    size_t sampleSize() const override { return 8; }
    void copyRange(const void* src, size_t start, size_t length,
                   std::complex<float>* dest) const override;
};

class ComplexS16Adapter : public SampleAdapter {
public:
    size_t sampleSize() const override { return 4; }
    void copyRange(const void* src, size_t start, size_t length,
                   std::complex<float>* dest) const override;
};

class ComplexS8Adapter : public SampleAdapter {
public:
    size_t sampleSize() const override { return 2; }
    void copyRange(const void* src, size_t start, size_t length,
                   std::complex<float>* dest) const override;
};

class ComplexU8Adapter : public SampleAdapter {
public:
    size_t sampleSize() const override { return 2; }
    void copyRange(const void* src, size_t start, size_t length,
                   std::complex<float>* dest) const override;
};

// Real adapters
class RealF32Adapter : public SampleAdapter {
public:
    size_t sampleSize() const override { return 4; }
    void copyRange(const void* src, size_t start, size_t length,
                   std::complex<float>* dest) const override;
};

class RealF64Adapter : public SampleAdapter {
public:
    size_t sampleSize() const override { return 8; }
    void copyRange(const void* src, size_t start, size_t length,
                   std::complex<float>* dest) const override;
};

class RealS16Adapter : public SampleAdapter {
public:
    size_t sampleSize() const override { return 2; }
    void copyRange(const void* src, size_t start, size_t length,
                   std::complex<float>* dest) const override;
};

class RealS8Adapter : public SampleAdapter {
public:
    size_t sampleSize() const override { return 1; }
    void copyRange(const void* src, size_t start, size_t length,
                   std::complex<float>* dest) const override;
};

class RealU8Adapter : public SampleAdapter {
public:
    size_t sampleSize() const override { return 1; }
    void copyRange(const void* src, size_t start, size_t length,
                   std::complex<float>* dest) const override;
};

// Input source: manages mmap'd file and sample adapter
class InputSource {
public:
    InputSource();
    ~InputSource();

    void open(const std::string& path, const std::string& format = "");
    void close();

    size_t totalSamples() const { return totalSamples_; }
    size_t fileSize() const { return fileSize_; }
    const std::string& format() const { return format_; }
    double sampleRate() const { return sampleRate_; }
    double centerFrequency() const { return centerFrequency_; }
    const std::string& sigmfMetaJson() const { return sigmfMetaJson_; }

    void getSamples(size_t start, size_t length, std::complex<float>* dest) const;
    void getSamplesStrided(size_t start, size_t length, size_t stride, std::complex<float>* dest) const;

private:
    void detectFormat(const std::string& path, const std::string& overrideFormat);
    void createAdapter();
    void parseSigMF(const std::string& metaPath);

    std::unique_ptr<SampleAdapter> adapter_;
    void* mmapData_ = nullptr;
    size_t fileSize_ = 0;
    size_t totalSamples_ = 0;
    int fd_ = -1;
    std::string format_;
    double sampleRate_ = 1000000.0;
    double centerFrequency_ = 0.0;
    std::string sigmfMetaJson_;
};

// Factory function
std::unique_ptr<SampleAdapter> createAdapter(const std::string& format);
