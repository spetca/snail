#!/usr/bin/env python3
"""Generate test chirp IQ files at different SNR levels with matching SigMF metadata."""

import json
import numpy as np

# Parameters
num_samples = 65536
sample_rate = 1_000_000  # 1 MSps
f_start = -100_000       # -100 kHz
f_end = 100_000          # +100 kHz
center_freq = 100_000_000  # 100 MHz

# Time vector
t = np.arange(num_samples) / sample_rate

# Generate linear chirp: instantaneous frequency sweeps from f_start to f_end
# Phase is integral of frequency: phi(t) = 2*pi * (f_start*t + 0.5*(f_end - f_start)*t^2 / T)
T = num_samples / sample_rate  # total duration
chirp_rate = (f_end - f_start) / T
phase = 2 * np.pi * (f_start * t + 0.5 * chirp_rate * t**2)
chirp_signal = np.exp(1j * phase).astype(np.complex64)

# Signal power (should be ~1.0)
signal_power = np.mean(np.abs(chirp_signal) ** 2)

# SNR configurations: (label, snr_db)
configs = [
    ("test_chirp_high_snr", 30),
    ("test_chirp_med_snr", 10),
    ("test_chirp_low_snr", 0),
]

for name, snr_db in configs:
    # Calculate noise power from SNR
    noise_power = signal_power / (10 ** (snr_db / 10))
    noise_std = np.sqrt(noise_power / 2)  # /2 because complex: real and imag each get half

    # Generate complex Gaussian noise
    noise = (np.random.randn(num_samples) + 1j * np.random.randn(num_samples)).astype(np.complex64) * noise_std

    # Combine signal and noise
    output = chirp_signal + noise

    # Write .cf32 file (complex64 is natively interleaved float32 pairs)
    cf32_path = f"{name}.cf32"
    output.astype(np.complex64).tofile(cf32_path)
    print(f"Wrote {cf32_path} ({output.nbytes} bytes, {num_samples} samples, SNR={snr_db} dB)")

    # Write matching .sigmf-meta file
    meta = {
        "global": {
            "core:datatype": "cf32_le",
            "core:sample_rate": sample_rate,
            "core:version": "1.0.0",
            "core:description": f"Test chirp signal ({f_start/1000:.0f} kHz to {f_end/1000:.0f} kHz sweep) with {snr_db} dB SNR",
        },
        "captures": [
            {
                "core:sample_start": 0,
                "core:frequency": center_freq,
            }
        ],
        "annotations": [],
    }
    meta_path = f"{name}.sigmf-meta"
    with open(meta_path, "w") as f:
        json.dump(meta, f, indent=2)
    print(f"Wrote {meta_path}")

print("\nDone. Generated 3 chirp IQ files with matching SigMF metadata.")
