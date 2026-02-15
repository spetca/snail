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

    if (!g_source.sigmfMetaJson().empty()) {
        result.Set("sigmfMetaJson", Napi::String::New(env, g_source.sigmfMetaJson()));
    }

    return result;
}

// ── getSamples(start, length) -> Float32Array ────────────────────

Napi::Value GetSamples(const Napi::CallbackInfo& info) {
    auto env = info.Env();

    size_t start = static_cast<size_t>(info[0].As<Napi::Number>().DoubleValue());
    size_t length = static_cast<size_t>(info[1].As<Napi::Number>().DoubleValue());
    size_t stride = 1;
    if (info.Length() > 2 && info[2].IsNumber()) {
        stride = static_cast<size_t>(info[2].As<Napi::Number>().DoubleValue());
    }

    if (stride < 1) stride = 1;

    // Check bounds
    if (start >= g_source.totalSamples()) {
        return Napi::Float32Array::New(env, 0);
    }

    // Calculate max possible samples we can read with this stride
    // start + (count - 1) * stride < totalSamples
    // (count - 1) * stride < totalSamples - start
    // count - 1 < (totalSamples - start) / stride
    // count < (totalSamples - start) / stride + 1
    size_t maxLen = (g_source.totalSamples() - start + stride - 1) / stride;
    if (length > maxLen) {
        length = maxLen;
    }

    // Allocate complex samples then flatten to interleaved I/Q
    std::vector<std::complex<float>> samples(length);
    try {
        if (stride > 1) {
            g_source.getSamplesDetected(start, length, stride, samples.data());
        } else {
            g_source.getSamplesStrided(start, length, stride, samples.data());
        }
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

// ── computeFFTTile(startSample, fftSize, stride) -> Promise<Float32Array> ──

Napi::Value ComputeFFTTile(const Napi::CallbackInfo& info) {
    auto env = info.Env();

    size_t startSample = static_cast<size_t>(info[0].As<Napi::Number>().DoubleValue());
    int fftSize = info[1].As<Napi::Number>().Int32Value();
    int stride = info[2].As<Napi::Number>().Int32Value();

    auto deferred = Napi::Promise::Deferred::New(env);
    auto worker = new SpectrogramWorker(env, deferred, g_source, startSample, fftSize, stride);
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
        const std::string& mode,
        size_t windowStart,
        size_t windowLen,
        const std::string& secondPath = "",
        const std::string& secondFormat = "",
        size_t tu = 0,
        size_t cpLen = 0
    ) : Napi::AsyncWorker(env),
        deferred_(deferred),
        mode_(mode),
        windowStart_(windowStart),
        windowLen_(windowLen),
        secondPath_(secondPath),
        secondFormat_(secondFormat),
        tu_(tu),
        cpLen_(cpLen) {}

    void Execute() override {
        // Read search window from current (main) file
        std::vector<std::complex<float>> signal(windowLen_);
        g_source.getSamples(windowStart_, windowLen_, signal.data());

        if (mode_ == "file") {
            // Open second file as the pattern/template to search for
            InputSource secondSource;
            secondSource.open(secondPath_, secondFormat_);

            size_t patternLen = secondSource.totalSamples();
            std::vector<std::complex<float>> pattern(patternLen);
            secondSource.getSamples(0, patternLen, pattern.data());

            // Cross-correlate: the shorter sequence slides through the longer one
            // signal = cursor window from main file, pattern = entire second file
            if (patternLen <= windowLen_) {
                // Normal case: small pattern slides through large window
                result_ = CorrelationEngine::crossCorrelate(
                    signal.data(), windowLen_,
                    pattern.data(), patternLen
                );
            } else {
                // Pattern is larger (e.g. correlating file with itself):
                // slide the window through the pattern
                result_ = CorrelationEngine::crossCorrelate(
                    pattern.data(), patternLen,
                    signal.data(), windowLen_
                );
            }
        } else if (mode_ == "self") {
            // Self-correlation (Schmidl & Cox)
            result_ = CorrelationEngine::selfCorrelate(
                signal.data(), windowLen_,
                tu_, cpLen_
            );
        }
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
    std::string mode_;
    size_t windowStart_;
    size_t windowLen_;
    std::string secondPath_;
    std::string secondFormat_;
    size_t tu_;
    size_t cpLen_;
    std::vector<float> result_;
};

Napi::Value Correlate(const Napi::CallbackInfo& info) {
    auto env = info.Env();
    auto config = info[0].As<Napi::Object>();

    std::string mode = config.Get("mode").As<Napi::String>().Utf8Value();
    size_t windowStart = static_cast<size_t>(config.Get("windowStart").As<Napi::Number>().DoubleValue());
    size_t windowLength = static_cast<size_t>(config.Get("windowLength").As<Napi::Number>().DoubleValue());

    std::string secondPath, secondFormat;
    size_t tu = 0, cpLen = 0;

    if (mode == "file") {
        secondPath = config.Get("patternFilePath").As<Napi::String>().Utf8Value();
        if (config.Has("patternFileFormat") && config.Get("patternFileFormat").IsString()) {
            secondFormat = config.Get("patternFileFormat").As<Napi::String>().Utf8Value();
        }
    } else if (mode == "self") {
        tu = static_cast<size_t>(config.Get("tu").As<Napi::Number>().DoubleValue());
        cpLen = static_cast<size_t>(config.Get("cpLen").As<Napi::Number>().DoubleValue());
    }

    auto deferred = Napi::Promise::Deferred::New(env);
    auto worker = new CorrelationWorker(
        env, deferred, mode, windowStart, windowLength,
        secondPath, secondFormat, tu, cpLen
    );
    worker->Queue();

    return deferred.Promise();
}

// ── readFileSamples(path, format, start, length) -> Float32Array ──
// Reads samples from an arbitrary file without disturbing g_source

Napi::Value ReadFileSamples(const Napi::CallbackInfo& info) {
    auto env = info.Env();

    std::string path = info[0].As<Napi::String>().Utf8Value();
    std::string format = info[1].As<Napi::String>().Utf8Value();
    size_t start = static_cast<size_t>(info[2].As<Napi::Number>().DoubleValue());
    size_t length = static_cast<size_t>(info[3].As<Napi::Number>().DoubleValue());

    InputSource source;
    try {
        source.open(path, format);
    } catch (const std::exception& e) {
        Napi::Error::New(env, e.what()).ThrowAsJavaScriptException();
        return env.Undefined();
    }

    if (start >= source.totalSamples()) {
        return Napi::Float32Array::New(env, 0);
    }
    if (start + length > source.totalSamples()) {
        length = source.totalSamples() - start;
    }

    std::vector<std::complex<float>> samples(length);
    try {
        source.getSamples(start, length, samples.data());
    } catch (const std::exception& e) {
        Napi::Error::New(env, e.what()).ThrowAsJavaScriptException();
        return env.Undefined();
    }

    auto result = Napi::Float32Array::New(env, length * 2);
    auto data = reinterpret_cast<const float*>(samples.data());
    std::memcpy(result.Data(), data, length * 2 * sizeof(float));

    return result;
}

// ── Module init ──────────────────────────────────────────────────

Napi::Object Init(Napi::Env env, Napi::Object exports) {
    exports.Set("openFile", Napi::Function::New(env, OpenFile));
    exports.Set("getSamples", Napi::Function::New(env, GetSamples));
    exports.Set("computeFFTTile", Napi::Function::New(env, ComputeFFTTile));
    exports.Set("exportSigMF", Napi::Function::New(env, ExportSigMF));
    exports.Set("correlate", Napi::Function::New(env, Correlate));
    exports.Set("readFileSamples", Napi::Function::New(env, ReadFileSamples));
    return exports;
}

NODE_API_MODULE(snail_native, Init)
