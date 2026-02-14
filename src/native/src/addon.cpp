#include <napi.h>
#include "input_source.h"
#include "fft_engine.h"
#include "spectrogram_worker.h"
#include "filter_engine.h"
#include "correlation_engine.h"
#include "sigmf_writer.h"

// Global input source (single file at a time)
static InputSource g_source;

// ── openFile(path, format?) -> FileInfo ──────────────────────────

Napi::Value OpenFile(const Napi::CallbackInfo& info) {
    auto env = info.Env();

    std::string path = info[0].As<Napi::String>().Utf8Value();
    std::string format;
    if (info.Length() > 1 && info[1].IsString()) {
        format = info[1].As<Napi::String>().Utf8Value();
    }

    try {
        g_source.open(path, format);
    } catch (const std::exception& e) {
        Napi::Error::New(env, e.what()).ThrowAsJavaScriptException();
        return env.Undefined();
    }

    auto result = Napi::Object::New(env);
    result.Set("path", Napi::String::New(env, path));
    result.Set("format", Napi::String::New(env, g_source.format()));
    result.Set("sampleRate", Napi::Number::New(env, g_source.sampleRate()));
    result.Set("totalSamples", Napi::Number::New(env, static_cast<double>(g_source.totalSamples())));
    result.Set("fileSize", Napi::Number::New(env, static_cast<double>(g_source.fileSize())));

    if (g_source.centerFrequency() != 0) {
        result.Set("centerFrequency", Napi::Number::New(env, g_source.centerFrequency()));
    }

    return result;
}

// ── getSamples(start, length) -> Float32Array ────────────────────

Napi::Value GetSamples(const Napi::CallbackInfo& info) {
    auto env = info.Env();

    size_t start = static_cast<size_t>(info[0].As<Napi::Number>().DoubleValue());
    size_t length = static_cast<size_t>(info[1].As<Napi::Number>().DoubleValue());

    // Clamp to available
    if (start >= g_source.totalSamples()) {
        return Napi::Float32Array::New(env, 0);
    }
    if (start + length > g_source.totalSamples()) {
        length = g_source.totalSamples() - start;
    }

    // Allocate complex samples then flatten to interleaved I/Q
    std::vector<std::complex<float>> samples(length);
    try {
        g_source.getSamples(start, length, samples.data());
    } catch (const std::exception& e) {
        Napi::Error::New(env, e.what()).ThrowAsJavaScriptException();
        return env.Undefined();
    }

    // Return interleaved I/Q as Float32Array
    auto result = Napi::Float32Array::New(env, length * 2);
    auto data = reinterpret_cast<const float*>(samples.data());
    std::memcpy(result.Data(), data, length * 2 * sizeof(float));

    return result;
}

// ── computeFFTTile(startSample, fftSize, zoomLevel) -> Promise<Float32Array> ──

Napi::Value ComputeFFTTile(const Napi::CallbackInfo& info) {
    auto env = info.Env();

    size_t startSample = static_cast<size_t>(info[0].As<Napi::Number>().DoubleValue());
    int fftSize = info[1].As<Napi::Number>().Int32Value();
    int zoomLevel = info[2].As<Napi::Number>().Int32Value();

    auto deferred = Napi::Promise::Deferred::New(env);
    auto worker = new SpectrogramWorker(env, deferred, g_source, startSample, fftSize, zoomLevel);
    worker->Queue();

    return deferred.Promise();
}

// ── exportSigMF(config) -> {success, error?} ────────────────────

Napi::Value ExportSigMF(const Napi::CallbackInfo& info) {
    auto env = info.Env();
    auto config = info[0].As<Napi::Object>();

    std::string outputPath = config.Get("outputPath").As<Napi::String>().Utf8Value();
    size_t startSample = static_cast<size_t>(config.Get("startSample").As<Napi::Number>().DoubleValue());
    size_t endSample = static_cast<size_t>(config.Get("endSample").As<Napi::Number>().DoubleValue());
    double sampleRate = config.Get("sampleRate").As<Napi::Number>().DoubleValue();
    bool applyBandpass = config.Get("applyBandpass").As<Napi::Boolean>().Value();

    std::string description, author;
    if (config.Has("description") && config.Get("description").IsString())
        description = config.Get("description").As<Napi::String>().Utf8Value();
    if (config.Has("author") && config.Get("author").IsString())
        author = config.Get("author").As<Napi::String>().Utf8Value();

    double centerFreq = 0;
    if (config.Has("centerFrequency") && config.Get("centerFrequency").IsNumber())
        centerFreq = config.Get("centerFrequency").As<Napi::Number>().DoubleValue();

    auto result = Napi::Object::New(env);

    try {
        size_t count = endSample - startSample;
        std::vector<std::complex<float>> samples(count);
        g_source.getSamples(startSample, count, samples.data());

        std::complex<float>* outputSamples = samples.data();
        std::vector<std::complex<float>> filtered;

        if (applyBandpass) {
            double bandpassLow = 0, bandpassHigh = 0;
            if (config.Has("bandpassLow") && config.Get("bandpassLow").IsNumber())
                bandpassLow = config.Get("bandpassLow").As<Napi::Number>().DoubleValue();
            if (config.Has("bandpassHigh") && config.Get("bandpassHigh").IsNumber())
                bandpassHigh = config.Get("bandpassHigh").As<Napi::Number>().DoubleValue();

            double bpCenter = (bandpassLow + bandpassHigh) / 2.0;
            double bpBandwidth = std::abs(bandpassHigh - bandpassLow);

            filtered.resize(count);
            FilterEngine::bandpassFilter(
                samples.data(), filtered.data(), count,
                bpCenter, bpBandwidth, sampleRate
            );
            outputSamples = filtered.data();
        }

        SigMFWriteConfig writeConfig;
        writeConfig.outputPath = outputPath;
        writeConfig.sampleRate = sampleRate;
        writeConfig.centerFrequency = centerFreq;
        writeConfig.description = description;
        writeConfig.author = author;
        writeConfig.sampleStart = 0;
        writeConfig.sampleCount = count;

        SigMFWriter::write(writeConfig, outputSamples, count);

        result.Set("success", Napi::Boolean::New(env, true));
    } catch (const std::exception& e) {
        result.Set("success", Napi::Boolean::New(env, false));
        result.Set("error", Napi::String::New(env, e.what()));
    }

    return result;
}

// ── correlate(templateStart, templateLen, secondFile, format?) -> Promise<Float32Array> ──

class CorrelationWorker : public Napi::AsyncWorker {
public:
    CorrelationWorker(
        Napi::Env env,
        Napi::Promise::Deferred deferred,
        size_t tmplStart,
        size_t tmplLen,
        const std::string& secondPath,
        const std::string& secondFormat
    ) : Napi::AsyncWorker(env),
        deferred_(deferred),
        tmplStart_(tmplStart),
        tmplLen_(tmplLen),
        secondPath_(secondPath),
        secondFormat_(secondFormat) {}

    void Execute() override {
        // Read template from current file
        std::vector<std::complex<float>> tmpl(tmplLen_);
        g_source.getSamples(tmplStart_, tmplLen_, tmpl.data());

        // Open second file
        InputSource secondSource;
        secondSource.open(secondPath_, secondFormat_);

        // Read entire second file
        size_t sigLen = secondSource.totalSamples();
        std::vector<std::complex<float>> signal(sigLen);
        secondSource.getSamples(0, sigLen, signal.data());

        // Cross-correlate
        result_ = CorrelationEngine::crossCorrelate(
            signal.data(), sigLen,
            tmpl.data(), tmplLen_
        );
    }

    void OnOK() override {
        auto env = Env();
        auto buf = Napi::Float32Array::New(env, result_.size());
        std::memcpy(buf.Data(), result_.data(), result_.size() * sizeof(float));
        deferred_.Resolve(buf);
    }

    void OnError(const Napi::Error& error) override {
        deferred_.Reject(error.Value());
    }

private:
    Napi::Promise::Deferred deferred_;
    size_t tmplStart_;
    size_t tmplLen_;
    std::string secondPath_;
    std::string secondFormat_;
    std::vector<float> result_;
};

Napi::Value Correlate(const Napi::CallbackInfo& info) {
    auto env = info.Env();

    size_t tmplStart = static_cast<size_t>(info[0].As<Napi::Number>().DoubleValue());
    size_t tmplLen = static_cast<size_t>(info[1].As<Napi::Number>().DoubleValue());
    std::string secondPath = info[2].As<Napi::String>().Utf8Value();
    std::string secondFormat;
    if (info.Length() > 3 && info[3].IsString()) {
        secondFormat = info[3].As<Napi::String>().Utf8Value();
    }

    auto deferred = Napi::Promise::Deferred::New(env);
    auto worker = new CorrelationWorker(env, deferred, tmplStart, tmplLen, secondPath, secondFormat);
    worker->Queue();

    return deferred.Promise();
}

// ── Module init ──────────────────────────────────────────────────

Napi::Object Init(Napi::Env env, Napi::Object exports) {
    exports.Set("openFile", Napi::Function::New(env, OpenFile));
    exports.Set("getSamples", Napi::Function::New(env, GetSamples));
    exports.Set("computeFFTTile", Napi::Function::New(env, ComputeFFTTile));
    exports.Set("exportSigMF", Napi::Function::New(env, ExportSigMF));
    exports.Set("correlate", Napi::Function::New(env, Correlate));
    return exports;
}

NODE_API_MODULE(snail_native, Init)
