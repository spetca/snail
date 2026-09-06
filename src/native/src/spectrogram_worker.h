#pragma once

#include <napi.h>
#include "input_source.h"
#include "fft_engine.h"

// Async worker that computes an FFT tile (multiple FFT lines)
class SpectrogramWorker : public Napi::AsyncWorker {
public:
    SpectrogramWorker(
        Napi::Env env,
        Napi::Promise::Deferred deferred,
        std::shared_ptr<const InputSource> source,
        size_t startSample,
        int fftSize,
        int stride,
        size_t endSample
    );

    void Execute() override;
    void OnOK() override;
    void OnError(const Napi::Error& error) override;

private:
    Napi::Promise::Deferred deferred_;
    std::shared_ptr<const InputSource> source_;
    size_t startSample_;
    int fftSize_;
    int stride_;
    size_t endSample_;
    std::vector<float> result_;
};
