#include <napi.h>
#include "input_source.h"
#include "fft_engine.h"
#include "spectrogram_worker.h"
#include "filter_engine.h"
#include "correlation_engine.h"
#include "sigmf_writer.h"
#include "feature_extractor.h"
#include "classifier.h"
#include "pulse_finder.h"

// Global input source (single file at a time)
static InputSource g_source;

// Global classifier (shared across calls)
static Classifier g_classifier;

// ── openFile(path, format?) -> FileInfo ──────────────────────────

Napi::Value OpenFile(const Napi::CallbackInfo& info) {
    auto env = info.Env();

    std::string path = info[0].As<Napi::String>().Utf8Value();
    std::string format;
    if (info.Length() > 1 && info[1].IsString()) {
        format = info[1].As<Napi::String>().Utf8Value();
    }

    size_t viewStart = 0, viewLength = 0;
    if (info.Length() > 2 && info[2].IsObject()) {
        auto opts = info[2].As<Napi::Object>();
        if (opts.Has("viewStart") && opts.Get("viewStart").IsNumber())
            viewStart = static_cast<size_t>(opts.Get("viewStart").As<Napi::Number>().DoubleValue());
        if (opts.Has("viewLength") && opts.Get("viewLength").IsNumber())
            viewLength = static_cast<size_t>(opts.Get("viewLength").As<Napi::Number>().DoubleValue());
    }

    try {
        g_source.open(path, format, viewStart, viewLength);
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
    result.Set("fileTotal", Napi::Number::New(env, static_cast<double>(g_source.fullFileSamples())));

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

// ── computeFFT(config) -> Promise<FFTResult> ────────────────────

class FFTWorker : public Napi::AsyncWorker {
public:
    FFTWorker(
        Napi::Env env,
        Napi::Promise::Deferred deferred,
        size_t startSample,
        size_t length,
        int fftSize,
        const std::string& window,
        bool shift,
        bool logScale
    ) : Napi::AsyncWorker(env),
        deferred_(deferred),
        startSample_(startSample),
        length_(length),
        fftSize_(fftSize),
        window_(window),
        shift_(shift),
        logScale_(logScale) {}

    void Execute() override {
        size_t totalSamples = g_source.totalSamples();
        if (totalSamples == 0 || startSample_ >= totalSamples) {
            result_.assign(4, logScale_ ? -120.0f : 0.0f);
            return;
        }

        // FFT size = next power of 2 >= selection length.
        // Falls back to the configured fftSize_ when no selection is provided.
        size_t selLen = (length_ > 0) ? length_ : static_cast<size_t>(fftSize_);
        selLen = std::min(selLen, totalSamples - startSample_);
        if (selLen < 4) selLen = 4;

        // Cap at 2^20 (~1M) to avoid OOM on huge selections
        const size_t MAX_FFT = 1u << 20;
        int actualFFTSize = 4;
        while (static_cast<size_t>(actualFFTSize) < selLen && static_cast<size_t>(actualFFTSize) < MAX_FFT) {
            actualFFTSize <<= 1;
        }

        if (actualFFTSize <= 0 || actualFFTSize > static_cast<int>(MAX_FFT)) {
            SetError("FFT size out of range");
            return;
        }

        // Read exactly the selected samples; zero-pad remainder up to actualFFTSize
        std::vector<std::complex<float>> signal(actualFFTSize, {0.0f, 0.0f});
        size_t readLen = std::min(selLen, totalSamples - startSample_);
        g_source.getSamples(startSample_, readLen, signal.data());

        result_.resize(actualFFTSize);
        FFTEngine engine(actualFFTSize);
        engine.computeFFT(signal.data(), actualFFTSize, result_.data(), shift_, logScale_, window_);
    }

    void OnOK() override {
        auto env = Env();
        auto res = Napi::Object::New(env);
        auto data = Napi::Float32Array::New(env, result_.size());
        std::memcpy(data.Data(), result_.data(), result_.size() * sizeof(float));
        res.Set("data", data);
        
        float minP = 1e20f, maxP = -1e20f;
        for (float p : result_) {
            if (p < minP) minP = p;
            if (p > maxP) maxP = p;
        }
        res.Set("minPower", Napi::Number::New(env, minP));
        res.Set("maxPower", Napi::Number::New(env, maxP));
        
        deferred_.Resolve(res);
    }

    void OnError(const Napi::Error& error) override {
        deferred_.Reject(error.Value());
    }

private:
    Napi::Promise::Deferred deferred_;
    size_t startSample_;
    size_t length_;
    int fftSize_;
    std::string window_;
    bool shift_;
    bool logScale_;
    std::vector<float> result_;
};

Napi::Value ComputeFFT(const Napi::CallbackInfo& info) {
    auto env = info.Env();
    auto config = info[0].As<Napi::Object>();

    size_t startSample = static_cast<size_t>(config.Get("startSample").As<Napi::Number>().DoubleValue());
    size_t length = static_cast<size_t>(config.Get("length").As<Napi::Number>().DoubleValue());
    int fftSize = config.Get("fftSize").As<Napi::Number>().Int32Value();
    std::string window = config.Get("window").As<Napi::String>().Utf8Value();
    bool shift = config.Get("shift").As<Napi::Boolean>().Value();
    bool logScale = (config.Get("scale").As<Napi::String>().Utf8Value() == "log");

    auto deferred = Napi::Promise::Deferred::New(env);
    auto worker = new FFTWorker(env, deferred, startSample, length, fftSize, window, shift, logScale);
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

// ── extractFeatures({ startSample, sampleCount, frameSize }) → { features: Float32Array, frameCount } ──

Napi::Value ExtractFeatures(const Napi::CallbackInfo& info) {
    auto env = info.Env();
    auto config = info[0].As<Napi::Object>();

    size_t startSample = static_cast<size_t>(config.Get("startSample").As<Napi::Number>().DoubleValue());
    size_t sampleCount = static_cast<size_t>(config.Get("sampleCount").As<Napi::Number>().DoubleValue());
    int frameSize = 256;
    if (config.Has("frameSize") && config.Get("frameSize").IsNumber())
        frameSize = config.Get("frameSize").As<Napi::Number>().Int32Value();
    if (frameSize < 4) frameSize = 256;

    auto result = Napi::Object::New(env);
    try {
        // Clamp to file bounds
        size_t total = g_source.totalSamples();
        if (startSample >= total) {
            result.Set("features", Napi::Float32Array::New(env, 0));
            result.Set("frameCount", Napi::Number::New(env, 0));
            return result;
        }
        if (startSample + sampleCount > total)
            sampleCount = total - startSample;

        size_t frameCount = sampleCount / static_cast<size_t>(frameSize);
        if (frameCount == 0) {
            result.Set("features", Napi::Float32Array::New(env, 0));
            result.Set("frameCount", Napi::Number::New(env, 0));
            return result;
        }

        FeatureExtractor extractor(frameSize);
        std::vector<float> featureMat(frameCount * NUM_FEATURES);

        std::vector<cf32> frame(frameSize);
        for (size_t fi = 0; fi < frameCount; ++fi) {
            size_t offset = startSample + fi * static_cast<size_t>(frameSize);
            g_source.getSamples(offset, static_cast<size_t>(frameSize), frame.data());
            auto feat = extractor.extract(frame.data(), static_cast<size_t>(frameSize));
            for (int k = 0; k < NUM_FEATURES; ++k)
                featureMat[fi * NUM_FEATURES + k] = feat[k];
        }

        auto arr = Napi::Float32Array::New(env, featureMat.size());
        std::memcpy(arr.Data(), featureMat.data(), featureMat.size() * sizeof(float));
        result.Set("features", arr);
        result.Set("frameCount", Napi::Number::New(env, static_cast<double>(frameCount)));
    } catch (const std::exception& e) {
        Napi::Error::New(env, e.what()).ThrowAsJavaScriptException();
        return env.Undefined();
    }
    return result;
}

// ── loadClassifier(modelPath) → { success, labels?, error? } ─────────────────

Napi::Value LoadClassifier(const Napi::CallbackInfo& info) {
    auto env = info.Env();
    std::string modelPath = info[0].As<Napi::String>().Utf8Value();

    auto result = Napi::Object::New(env);
    std::string err;
    bool ok = g_classifier.load(modelPath, err);
    result.Set("success", Napi::Boolean::New(env, ok));
    if (!ok) {
        result.Set("error", Napi::String::New(env, err));
    } else {
        auto labelsArr = Napi::Array::New(env, g_classifier.labels().size());
        for (size_t i = 0; i < g_classifier.labels().size(); ++i)
            labelsArr.Set(static_cast<uint32_t>(i), Napi::String::New(env, g_classifier.labels()[i]));
        result.Set("labels", labelsArr);
    }
    return result;
}

// ── classifyRegion({ startSample, sampleCount, frameSize }) → Array<ClassifyFrame> ──

Napi::Value ClassifyRegion(const Napi::CallbackInfo& info) {
    auto env = info.Env();
    auto config = info[0].As<Napi::Object>();

    size_t startSample = static_cast<size_t>(config.Get("startSample").As<Napi::Number>().DoubleValue());
    size_t sampleCount = static_cast<size_t>(config.Get("sampleCount").As<Napi::Number>().DoubleValue());
    int frameSize = 256;
    if (config.Has("frameSize") && config.Get("frameSize").IsNumber())
        frameSize = config.Get("frameSize").As<Napi::Number>().Int32Value();
    if (frameSize < 4) frameSize = 256;

    if (!g_classifier.loaded()) {
        Napi::Error::New(env, "No classifier loaded").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    auto arr = Napi::Array::New(env);
    try {
        size_t total = g_source.totalSamples();
        if (startSample >= total)
            return arr;
        if (startSample + sampleCount > total)
            sampleCount = total - startSample;

        size_t frameCount = sampleCount / static_cast<size_t>(frameSize);
        if (frameCount == 0) return arr;

        FeatureExtractor extractor(frameSize);
        std::vector<cf32> frame(frameSize);
        uint32_t resultIdx = 0;

        for (size_t fi = 0; fi < frameCount; ++fi) {
            size_t offset = startSample + fi * static_cast<size_t>(frameSize);
            g_source.getSamples(offset, static_cast<size_t>(frameSize), frame.data());
            auto feat = extractor.extract(frame.data(), static_cast<size_t>(frameSize));

            float conf = 0.0f;
            int labelIdx = g_classifier.classify(feat, conf);
            std::string label = g_classifier.labelFor(labelIdx);

            auto obj = Napi::Object::New(env);
            obj.Set("sampleStart", Napi::Number::New(env, static_cast<double>(offset)));
            obj.Set("sampleCount", Napi::Number::New(env, static_cast<double>(frameSize)));
            obj.Set("label", Napi::String::New(env, label));
            obj.Set("confidence", Napi::Number::New(env, static_cast<double>(conf)));
            arr.Set(resultIdx++, obj);
        }
    } catch (const std::exception& e) {
        Napi::Error::New(env, e.what()).ThrowAsJavaScriptException();
        return env.Undefined();
    }
    return arr;
}

// ── findPulses(config) -> Promise<PulseRecord[]> ─────────────────────────────

class PulseFinderWorker : public Napi::AsyncWorker {
public:
    PulseFinderWorker(Napi::Env env, Napi::Promise::Deferred deferred, PulseFindConfig cfg)
        : Napi::AsyncWorker(env), deferred_(deferred), cfg_(std::move(cfg)) {}

    void Execute() override {
        try {
            size_t total = g_source.totalSamples();
            if (total == 0) return;

            size_t start = cfg_.startSample;
            size_t end   = (cfg_.endSample > 0 && cfg_.endSample <= total) ? cfg_.endSample : total;
            if (start >= end) return;

            // Cap at 50M samples (~400 MB) to avoid OOM
            const size_t MAX_SAMPLES = 50000000;
            size_t count = std::min(end - start, MAX_SAMPLES);

            samples_.resize(count);
            g_source.getSamples(start, count, samples_.data());

            PulseFindConfig localCfg = cfg_;
            localCfg.startSample = 0;
            localCfg.endSample   = count;

            PulseFinder finder;
            records_ = finder.find(samples_.data(), count, localCfg);

            // Offset sample indices back to file-absolute
            for (auto& r : records_) {
                r.startSample += start;
                r.endSample   += start;
            }
        } catch (const std::bad_alloc&) {
            SetError("Out of memory: search region is too large. Use Current View or Cursor selection.");
        } catch (const std::exception& e) {
            SetError(std::string("Pulse search failed: ") + e.what());
        } catch (...) {
            SetError("Pulse search failed: unknown error");
        }
    }

    void OnOK() override {
        auto env = Env();
        auto arr = Napi::Array::New(env, records_.size());
        for (size_t i = 0; i < records_.size(); i++) {
            const auto& r = records_[i];
            auto obj = Napi::Object::New(env);
            obj.Set("pulseNumber",         Napi::Number::New(env, static_cast<double>(r.pulseNumber)));
            obj.Set("startSample",         Napi::Number::New(env, static_cast<double>(r.startSample)));
            obj.Set("endSample",           Napi::Number::New(env, static_cast<double>(r.endSample)));
            obj.Set("startTimeSecs",       Napi::Number::New(env, r.startTimeSecs));
            obj.Set("endTimeSecs",         Napi::Number::New(env, r.endTimeSecs));
            obj.Set("measuredWidthSecs",   Napi::Number::New(env, r.measuredWidthSecs));
            obj.Set("centerFrequencyHz",   Napi::Number::New(env, r.centerFrequencyHz));
            obj.Set("occupiedBandwidthHz", Napi::Number::New(env, r.occupiedBandwidthHz));
            obj.Set("priSecs",             Napi::Number::New(env, r.priSecs));
            arr.Set(static_cast<uint32_t>(i), obj);
        }
        deferred_.Resolve(arr);
    }

    void OnError(const Napi::Error& err) override { deferred_.Reject(err.Value()); }

private:
    Napi::Promise::Deferred deferred_;
    PulseFindConfig cfg_;
    std::vector<std::complex<float>> samples_;
    std::vector<PulseRecord> records_;
};

Napi::Value FindPulses(const Napi::CallbackInfo& info) {
    auto env = info.Env();
    auto cfg_js = info[0].As<Napi::Object>();

    PulseFindConfig cfg;
    cfg.targetWidthSecs = cfg_js.Get("targetWidthSecs").As<Napi::Number>().DoubleValue();
    cfg.widthTolSecs    = cfg_js.Get("widthTolSecs").As<Napi::Number>().DoubleValue();
    cfg.targetOBWHz     = cfg_js.Get("targetOBWHz").As<Napi::Number>().DoubleValue();
    cfg.obwTolHz        = cfg_js.Get("obwTolHz").As<Napi::Number>().DoubleValue();
    cfg.sampleRate      = cfg_js.Get("sampleRate").As<Napi::Number>().DoubleValue();
    cfg.startSample     = cfg_js.Has("startSample") ? static_cast<size_t>(cfg_js.Get("startSample").As<Napi::Number>().DoubleValue()) : 0;
    cfg.endSample       = cfg_js.Has("endSample")   ? static_cast<size_t>(cfg_js.Get("endSample").As<Napi::Number>().DoubleValue())   : 0;
    cfg.thresholdDb     = cfg_js.Has("thresholdDb") ? cfg_js.Get("thresholdDb").As<Napi::Number>().DoubleValue() : -1.0;
    cfg.obwPercentile   = cfg_js.Has("obwPercentile") ? cfg_js.Get("obwPercentile").As<Napi::Number>().DoubleValue() : 0.99;

    auto deferred = Napi::Promise::Deferred::New(env);
    (new PulseFinderWorker(env, deferred, cfg))->Queue();
    return deferred.Promise();
}

// ── Module init ──────────────────────────────────────────────────

Napi::Object Init(Napi::Env env, Napi::Object exports) {
    exports.Set("openFile", Napi::Function::New(env, OpenFile));
    exports.Set("getSamples", Napi::Function::New(env, GetSamples));
    exports.Set("computeFFTTile", Napi::Function::New(env, ComputeFFTTile));
    exports.Set("exportSigMF", Napi::Function::New(env, ExportSigMF));
    exports.Set("correlate", Napi::Function::New(env, Correlate));
    exports.Set("computeFFT", Napi::Function::New(env, ComputeFFT));
    exports.Set("readFileSamples", Napi::Function::New(env, ReadFileSamples));
    exports.Set("extractFeatures", Napi::Function::New(env, ExtractFeatures));
    exports.Set("loadClassifier", Napi::Function::New(env, LoadClassifier));
    exports.Set("classifyRegion", Napi::Function::New(env, ClassifyRegion));
    exports.Set("findPulses", Napi::Function::New(env, FindPulses));
    return exports;
}

NODE_API_MODULE(snail_native, Init)
