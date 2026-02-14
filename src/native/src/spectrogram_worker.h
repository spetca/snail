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
        InputSource& source,
        size_t startSample,
        int fftSize,
        int zoomLevel
    );

    void Execute() override;
    void OnOK() override;
    void OnError(const Napi::Error& error) override;

private:
    Napi::Promise::Deferred deferred_;
    InputSource& source_;
    size_t startSample_;
    int fftSize_;
    int zoomLevel_;
    std::vector<float> result_;
};
