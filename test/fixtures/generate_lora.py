#!/usr/bin/env python3
"""
Generate a ~1GB LoRa-like frequency hopping IQ file in cf32 format with SigMF metadata.

Simulates multiple LoRa CSS (Chirp Spread Spectrum) transmissions hopping across
channels in the 915 MHz US ISM band. Written in chunks for memory efficiency.
"""

import json
import time
import numpy as np

# === Configuration ===
SAMPLE_RATE = 1_000_000          # 1 MHz
CENTER_FREQ = 915_000_000        # 915 MHz
TOTAL_SAMPLES = 134_217_728      # exactly 1 GiB at 8 bytes/sample
CHUNK_SIZE = 1_000_000           # 1M samples per chunk (~8 MB)

# LoRa signal parameters
CHIRP_BW = 125_000               # 125 kHz per channel
SYMBOL_SAMPLES = 1000            # ~1ms per symbol at 1 MSps (SF7-like)
PREAMBLE_SYMBOLS = 8             # up-chirps
SYNC_SYMBOLS = 2                 # down-chirps
MIN_PAYLOAD_SYMBOLS = 10
MAX_PAYLOAD_SYMBOLS = 30

# Channel center offsets (Hz) relative to center freq, spread across 1 MHz BW
CHANNEL_OFFSETS = [-375_000, -225_000, -75_000, 75_000, 225_000, 375_000]

# SNR / noise
SIGNAL_AMPLITUDE = 0.5
NOISE_SIGMA = SIGNAL_AMPLITUDE * 10 ** (-15 / 20)  # 15 dB below signal

# Transmission scheduling
NUM_TRANSMISSIONS = 600
SEED = 42

OUTPUT_BASE = "test_lora_hopping"
DATA_FILE = f"{OUTPUT_BASE}.sigmf-data"
META_FILE = f"{OUTPUT_BASE}.sigmf-meta"


def generate_chirp(num_samples, bw, sample_rate, up=True):
    """Generate a single linear chirp symbol (up or down)."""
    t = np.arange(num_samples, dtype=np.float64) / sample_rate
    direction = 1.0 if up else -1.0
    freq = direction * bw * (t / t[-1] - 0.5)
    phase = 2.0 * np.pi * np.cumsum(freq) / sample_rate
    return np.exp(1j * phase).astype(np.complex64)


def build_packet(rng, symbol_samples, bw, sample_rate):
    """Build one LoRa-like packet: preamble + sync + payload chirps."""
    up_chirp = generate_chirp(symbol_samples, bw, sample_rate, up=True)
    down_chirp = generate_chirp(symbol_samples, bw, sample_rate, up=False)

    symbols = []
    for _ in range(PREAMBLE_SYMBOLS):
        symbols.append(up_chirp)
    for _ in range(SYNC_SYMBOLS):
        symbols.append(down_chirp)
    num_payload = rng.integers(MIN_PAYLOAD_SYMBOLS, MAX_PAYLOAD_SYMBOLS + 1)
    for _ in range(num_payload):
        shift = rng.integers(0, symbol_samples)
        shifted = np.roll(up_chirp, shift)
        symbols.append(shifted)

    return np.concatenate(symbols)


def schedule_transmissions(rng):
    """Pre-compute a schedule of all transmissions."""
    schedule = []
    for _ in range(NUM_TRANSMISSIONS):
        num_payload = rng.integers(MIN_PAYLOAD_SYMBOLS, MAX_PAYLOAD_SYMBOLS + 1)
        total_symbols = PREAMBLE_SYMBOLS + SYNC_SYMBOLS + num_payload
        total_len = total_symbols * SYMBOL_SAMPLES
        max_start = TOTAL_SAMPLES - total_len
        start = int(rng.integers(0, max(1, max_start)))
        channel_idx = int(rng.integers(0, len(CHANNEL_OFFSETS)))
        schedule.append({
            "start": start,
            "end": start + total_len,
            "channel_idx": channel_idx,
            "num_payload": int(num_payload),
            "pkt_len": total_len,
        })
    schedule.sort(key=lambda x: x["start"])
    return schedule


def main():
    print("=== LoRa-like IQ File Generator ===")
    print(f"Total samples: {TOTAL_SAMPLES:,}")
    print(f"File size: {TOTAL_SAMPLES * 8 / 1e9:.3f} GB ({TOTAL_SAMPLES * 8:,} bytes)")
    print(f"Channels: {len(CHANNEL_OFFSETS)} at offsets {CHANNEL_OFFSETS} Hz")
    print(f"Transmissions: {NUM_TRANSMISSIONS}")
    print()

    rng = np.random.default_rng(SEED)
    t0 = time.time()

    print("Scheduling transmissions...")
    schedule = schedule_transmissions(rng)

    print("Generating packet waveforms...")
    packets = []
    pkt_rng = np.random.default_rng(SEED + 1)
    for tx in schedule:
        pkt = build_packet(pkt_rng, SYMBOL_SAMPLES, CHIRP_BW, SAMPLE_RATE)
        packets.append(pkt)

    print(f"Writing {DATA_FILE} in chunks of {CHUNK_SIZE:,} samples...")
    num_chunks = (TOTAL_SAMPLES + CHUNK_SIZE - 1) // CHUNK_SIZE
    report_interval = max(1, num_chunks // 10)

    noise_rng = np.random.default_rng(SEED + 2)

    with open(DATA_FILE, "wb") as f:
        active_txs = []
        tx_pointer = 0

        for chunk_idx in range(num_chunks):
            chunk_start = chunk_idx * CHUNK_SIZE
            chunk_end = min(chunk_start + CHUNK_SIZE, TOTAL_SAMPLES)
            chunk_len = chunk_end - chunk_start

            # Generate noise floor
            noise = noise_rng.normal(0, NOISE_SIGMA, (chunk_len, 2)).astype(np.float32)
            chunk = noise[:, 0] + 1j * noise[:, 1]

            # Add new transmissions that start before this chunk ends
            while tx_pointer < len(schedule) and schedule[tx_pointer]["start"] < chunk_end:
                active_txs.append(tx_pointer)
                tx_pointer += 1

            # Process active transmissions
            still_active = []
            for ti in active_txs:
                tx = schedule[ti]
                if tx["end"] <= chunk_start:
                    continue
                still_active.append(ti)

                pkt = packets[ti]
                pkt_len = len(pkt)
                freq_offset = CHANNEL_OFFSETS[tx["channel_idx"]]

                # Overlap between [chunk_start, chunk_end) and [tx.start, tx.end)
                overlap_start = max(chunk_start, tx["start"])
                overlap_end = min(chunk_end, tx["end"])
                if overlap_start >= overlap_end:
                    continue

                # Indices within the chunk buffer
                buf_start = overlap_start - chunk_start
                buf_end = buf_start + (overlap_end - overlap_start)

                # Indices within the packet waveform
                pkt_start = overlap_start - tx["start"]
                pkt_end = pkt_start + (overlap_end - overlap_start)

                # Safety: clamp to actual packet length
                if pkt_end > pkt_len:
                    pkt_end = pkt_len
                    buf_end = buf_start + (pkt_end - pkt_start)

                n = pkt_end - pkt_start
                if n <= 0:
                    continue

                seg = pkt[pkt_start:pkt_end].copy()

                # Frequency-shift to channel
                if freq_offset != 0:
                    t_idx = np.arange(pkt_start, pkt_end, dtype=np.float64)
                    shift = np.exp(1j * 2.0 * np.pi * freq_offset * t_idx / SAMPLE_RATE).astype(np.complex64)
                    seg *= shift

                chunk[buf_start:buf_end] += SIGNAL_AMPLITUDE * seg

            active_txs = still_active

            chunk.astype(np.complex64).tofile(f)

            if chunk_idx % report_interval == 0 or chunk_idx == num_chunks - 1:
                pct = (chunk_idx + 1) / num_chunks * 100
                elapsed = time.time() - t0
                print(f"  {pct:5.1f}% ({chunk_idx + 1}/{num_chunks} chunks) - {elapsed:.1f}s elapsed")

    elapsed = time.time() - t0
    print(f"\nData file written: {DATA_FILE}")
    print(f"Elapsed time: {elapsed:.1f}s")

    # Write SigMF metadata
    meta = {
        "global": {
            "core:datatype": "cf32_le",
            "core:sample_rate": SAMPLE_RATE,
            "core:version": "1.0.0",
            "core:description": "Simulated LoRa-like CSS frequency hopping IQ data"
        },
        "captures": [
            {
                "core:sample_start": 0,
                "core:frequency": CENTER_FREQ
            }
        ],
        "annotations": []
    }

    with open(META_FILE, "w") as f:
        json.dump(meta, f, indent=2)
    print(f"Metadata file written: {META_FILE}")
    print("Done.")


if __name__ == "__main__":
    main()
