#include "feature_extractor.h"
#include "fft_engine.h"  // for g_fftwMutex

#include <algorithm>
#include <cmath>
#include <numeric>
#include <stdexcept>

FeatureExtractor::FeatureExtractor(int frameSize) : frameSize_(frameSize) {
    if (frameSize_ < 4) throw std::invalid_argument("frameSize must be >= 4");

    std::lock_guard<std::mutex> lk(g_fftwMutex);
    fftwIn_  = fftwf_alloc_complex(frameSize_);
    fftwOut_ = fftwf_alloc_complex(frameSize_);
    plan_    = fftwf_plan_dft_1d(frameSize_, fftwIn_, fftwOut_, FFTW_FORWARD, FFTW_ESTIMATE);
    if (!plan_) throw std::runtime_error("FFTW plan creation failed");
}

FeatureExtractor::~FeatureExtractor() {
    std::lock_guard<std::mutex> lk(g_fftwMutex);
    if (plan_)    { fftwf_destroy_plan(plan_); plan_ = nullptr; }
    if (fftwOut_) { fftwf_free(fftwOut_); fftwOut_ = nullptr; }
    if (fftwIn_)  { fftwf_free(fftwIn_); fftwIn_ = nullptr; }
}

std::array<float, NUM_FEATURES> FeatureExtractor::extract(const cf32* samples, size_t n) {
    std::array<float, NUM_FEATURES> feat{};

    const size_t N = static_cast<size_t>(frameSize_);
    const size_t use = std::min(n, N);

    // ── Pre-compute envelope and derived quantities ──────────────────────────
    std::vector<float> env(N, 0.0f);
    float meanEnv = 0.0f;
    for (size_t i = 0; i < use; ++i) {
        env[i] = std::abs(samples[i]);
        meanEnv += env[i];
    }
    if (use > 0) meanEnv /= static_cast<float>(use);
    if (meanEnv < 1e-12f) meanEnv = 1e-12f;

    // Normalized envelope a[i] = |x[i]| / mean(|x|)
    std::vector<float> a(N, 0.0f);
    for (size_t i = 0; i < use; ++i) a[i] = env[i] / meanEnv;

    // ── Feature 0: sigma_a ───────────────────────────────────────────────────
    float meanA = 0.0f, var_a = 0.0f;
    for (size_t i = 0; i < use; ++i) meanA += a[i];
    meanA /= static_cast<float>(use);
    for (size_t i = 0; i < use; ++i) {
        float d = a[i] - meanA;
        var_a += d * d;
    }
    var_a /= static_cast<float>(use);
    feat[0] = std::sqrt(var_a);

    // ── Feature 1: mu_42 (kurtosis of envelope) ──────────────────────────────
    float m2 = 0.0f, m4 = 0.0f;
    for (size_t i = 0; i < use; ++i) {
        float e2 = env[i] * env[i];
        m2 += e2;
        m4 += e2 * e2;
    }
    m2 /= static_cast<float>(use);
    m4 /= static_cast<float>(use);
    feat[1] = (m2 > 1e-24f) ? m4 / (m2 * m2) : 0.0f;

    // ── Instantaneous phase ──────────────────────────────────────────────────
    std::vector<float> phi(use);
    for (size_t i = 0; i < use; ++i) phi[i] = std::arg(samples[i]);

    // Unwrap phase
    std::vector<float> phiU(phi);
    for (size_t i = 1; i < use; ++i) {
        float diff = phiU[i] - phiU[i - 1];
        while (diff >  M_PI) { diff -= 2.0f * M_PI; }
        while (diff < -M_PI) { diff += 2.0f * M_PI; }
        phiU[i] = phiU[i - 1] + diff;
    }

    // Linear detrend of unwrapped phase
    // Only use samples where |x| > 0.1 * mean(|x|) for robustness
    std::vector<float> detrended;
    detrended.reserve(use);
    {
        float sumX = 0, sumY = 0, sumXX = 0, sumXY = 0;
        float threshold = 0.1f * meanEnv;
        int cnt = 0;
        for (size_t i = 0; i < use; ++i) {
            if (env[i] > threshold) {
                float xi = static_cast<float>(i);
                sumX  += xi;
                sumY  += phiU[i];
                sumXX += xi * xi;
                sumXY += xi * phiU[i];
                ++cnt;
            }
        }
        if (cnt > 1) {
            float denom = cnt * sumXX - sumX * sumX;
            float slope  = (denom != 0.0f) ? (cnt * sumXY - sumX * sumY) / denom : 0.0f;
            float intercept = (sumY - slope * sumX) / cnt;
            for (size_t i = 0; i < use; ++i) {
                if (env[i] > threshold)
                    detrended.push_back(phiU[i] - (slope * i + intercept));
            }
        } else {
            // Not enough strong samples — use raw phase
            for (size_t i = 0; i < use; ++i)
                detrended.push_back(phiU[i]);
        }
    }

    // ── Feature 2: sigma_dp ──────────────────────────────────────────────────
    if (!detrended.empty()) {
        float meanD = 0.0f;
        for (float v : detrended) meanD += v;
        meanD /= static_cast<float>(detrended.size());
        float varD = 0.0f;
        for (float v : detrended) { float d = v - meanD; varD += d * d; }
        varD /= static_cast<float>(detrended.size());
        feat[2] = std::sqrt(varD);
    }

    // ── Feature 3: sigma_af (instantaneous frequency std) ───────────────────
    if (use > 1) {
        std::vector<float> instFreq(use - 1);
        for (size_t i = 0; i + 1 < use; ++i) {
            // inst freq = arg(x[n] * conj(x[n-1]))
            cf32 prod = samples[i + 1] * std::conj(samples[i]);
            instFreq[i] = std::arg(prod);
        }
        float meanIF = 0.0f;
        for (float v : instFreq) meanIF += v;
        meanIF /= static_cast<float>(instFreq.size());
        float varIF = 0.0f;
        for (float v : instFreq) { float d = v - meanIF; varIF += d * d; }
        varIF /= static_cast<float>(instFreq.size());
        feat[3] = std::sqrt(varIF);
    }

    // ── Higher-order cumulants ───────────────────────────────────────────────
    // Moments
    cf32 m20{0.0f, 0.0f};  // mean(x^2)
    cf32 m21{0.0f, 0.0f};  // mean(|x|^2 * x) (auxiliary)
    cf32 m40{0.0f, 0.0f};  // mean(x^4)
    cf32 m41{0.0f, 0.0f};  // mean(x^3 * conj(x))
    float m42 = 0.0f;      // mean(|x|^4)
    float m_abs2 = 0.0f;   // mean(|x|^2)

    for (size_t i = 0; i < use; ++i) {
        cf32 x = samples[i];
        float abs2 = std::norm(x);  // |x|^2
        m_abs2 += abs2;
        m20    += x * x;
        m21    += cf32(abs2, 0.0f) * x;
        m40    += x * x * x * x;
        m41    += x * x * x * std::conj(x);
        m42    += abs2 * abs2;
    }
    float fn = static_cast<float>(use);
    m20 /= fn; m21 /= fn; m40 /= fn; m41 /= fn;
    m42    /= fn;
    m_abs2 /= fn;

    // C20 = mean(x^2)
    feat[4] = std::abs(m20);

    // C21 = mean(|x|^2 * x) — normalized by mean(|x|^2)^1.5
    float denom21 = (m_abs2 > 1e-24f) ? std::pow(m_abs2, 1.5f) : 1e-12f;
    feat[5] = std::abs(m21) / denom21;

    // C40 = mean(x^4) - 3 * mean(x^2)^2
    cf32 C40 = m40 - cf32(3.0f, 0.0f) * (m20 * m20);
    feat[6] = std::abs(C40);

    // C41 = mean(x^3*conj(x)) - 3*mean(x^2)*mean(|x|^2)
    cf32 C41 = m41 - cf32(3.0f, 0.0f) * m20 * cf32(m_abs2, 0.0f);
    feat[7] = std::abs(C41);

    // C42 = mean(|x|^4) - |mean(x^2)|^2 - 2*mean(|x|^2)^2
    float C42 = m42 - std::norm(m20) - 2.0f * m_abs2 * m_abs2;
    feat[8] = std::abs(C42);

    // ── Spectral features via FFTW ───────────────────────────────────────────
    // Fill FFTW input with samples (zero-padded)
    for (size_t i = 0; i < N; ++i) {
        if (i < use) {
            fftwIn_[i][0] = samples[i].real();
            fftwIn_[i][1] = samples[i].imag();
        } else {
            fftwIn_[i][0] = 0.0f;
            fftwIn_[i][1] = 0.0f;
        }
    }
    fftwf_execute(plan_);

    // Compute PSD (magnitude squared, un-normalized)
    std::vector<float> psd(N);
    for (size_t k = 0; k < N; ++k) {
        float re = fftwOut_[k][0];
        float im = fftwOut_[k][1];
        psd[k] = re * re + im * im;
    }

    float psdSum = 0.0f;
    for (float p : psd) psdSum += p;
    if (psdSum < 1e-24f) psdSum = 1e-24f;

    float psdMean = psdSum / static_cast<float>(N);

    // Feature 9: gamma_max — spectral peakedness
    float psdMax = *std::max_element(psd.begin(), psd.end());
    feat[9] = psdMax / psdMean;

    // Feature 10: spectral centroid (normalized 0-1)
    float centroidNum = 0.0f;
    for (size_t k = 0; k < N; ++k) {
        centroidNum += static_cast<float>(k) * psd[k];
    }
    float centroid = centroidNum / psdSum;
    feat[10] = centroid / static_cast<float>(N);

    // Feature 11: spectral bandwidth
    float bwNum = 0.0f;
    for (size_t k = 0; k < N; ++k) {
        float diff = static_cast<float>(k) - centroid;
        bwNum += diff * diff * psd[k];
    }
    float bw = std::sqrt(bwNum / psdSum);
    feat[11] = bw / static_cast<float>(N);

    // Feature 12: spectral flatness (Wiener entropy)
    // geomean(psd) / mean(psd) using log-sum
    float logSum = 0.0f;
    for (float p : psd) logSum += std::log(std::max(p, 1e-30f));
    float geomean = std::exp(logSum / static_cast<float>(N));
    feat[12] = geomean / psdMean;

    // Feature 13: spectral rolloff at 95%
    float target = 0.95f * psdSum;
    float cumSum = 0.0f;
    size_t rolloffBin = N - 1;
    for (size_t k = 0; k < N; ++k) {
        cumSum += psd[k];
        if (cumSum >= target) { rolloffBin = k; break; }
    }
    feat[13] = static_cast<float>(rolloffBin) / static_cast<float>(N);

    // Feature 14: spectral symmetry — correlation between left and right halves
    size_t half = N / 2;
    // Left half: bins 0..half-1, right half: bins half..N-1 reversed
    float sumLR = 0.0f, sumLL = 0.0f, sumRR = 0.0f, meanL = 0.0f, meanR = 0.0f;
    for (size_t k = 0; k < half; ++k) {
        meanL += psd[k];
        meanR += psd[N - 1 - k];
    }
    meanL /= static_cast<float>(half);
    meanR /= static_cast<float>(half);
    for (size_t k = 0; k < half; ++k) {
        float dl = psd[k] - meanL;
        float dr = psd[N - 1 - k] - meanR;
        sumLR += dl * dr;
        sumLL += dl * dl;
        sumRR += dr * dr;
    }
    float denom14 = std::sqrt(sumLL * sumRR);
    feat[14] = (denom14 > 1e-24f) ? sumLR / denom14 : 0.0f;

    return feat;
}
