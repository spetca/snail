# Accepted-event datasets

In **Detect & label**, accept the events you want to use, then select the dataset contents and click **Export accepted dataset**. Choose a parent folder. Snail creates a new `snail-dataset-<UUID>` directory; repeated exports do not replace existing datasets. The export uses the accepted revisions at the time it starts. Pending and rejected proposals are excluded.

## Contents

| Mode | Output |
| --- | --- |
| Labels and source manifest | `manifest.json` and `read_dataset.py`; no IQ copies. |
| Manifest + unfiltered IQ crops | One `.sigmf-data` / `.sigmf-meta` pair per accepted event, plus the manifest and reader. |
| Manifest + tuned and filtered IQ | The same artifacts, with each event mixed to DC and low-pass filtered. |

All materialized IQ is interleaved **little-endian complex float32**, using the existing native sample-format conversion. Integer and real source formats are converted; unfiltered does not mean the original datatype is copied. The sample rate and event sample count are preserved in both IQ modes.

Hashing reads the entire source file with bounded buffers, even for manifest-only exports. The UI shows hashing and writing progress and supports cancellation. A recording switch cancels pending work. Output remains under a hidden `.partial` name until completion; failures and cancellations remove that partial directory. An abrupt application or machine shutdown may leave a hidden partial directory, which is not a completed dataset. Jobs do not yet resume after restart.

## Manifest version 1

`generator` is `snail-dataset-1`; `schemaVersion` is `1`.

- `source`: canonical original path, format, sample rate/count, size, modification time, whole-file SHA-256, capture segments, and the SigMF metadata snapshot held when the recording was opened. That snapshot may predate new accepted annotations; each event carries its accepted review revision separately.
- `project`: project identity, snapshot revision, and detector run history/settings.
- `events[].event`: accepted event UUID, label/comment, source sample and baseband frequency bounds, detector evidence, and review history.
- `events[].capture`: original capture bounds and RF tuning. Events must lie wholly inside one capture.
- `events[].sourceMapping`: `startSample`, `sampleStep: 1`, and `sampleCount`. Output sample `n` is centered at original sample `startSample + n`.
- `events[].recipe`: null for unfiltered/manifest-only output, or the versioned channelization recipe, including exact FIR coefficients, tuning, sample rates, phase origin, and boundary policy.
- `events[].iq`: relative artifact paths, `cf32_le` datatype, sample rate/count, and the IQ artifact's SHA-256. Absent in manifest-only mode.
- `events[].groupId`: `sha256:<source checksum>`. All events from the same source bytes have the same group, including overlapping events and repeated exports.
- `events[].split`: `unassigned`. Snail does not silently assign events to a training set.

Assign entire recording groups to train/validation/test **before** making windows or augmentations. Related recordings from the same receiver session or device may need a broader shared group; a source checksum alone cannot enforce that. Duplicate exports and related windows must not be split independently. Dataset split generation and leakage validation are future work.

Exported SigMF annotations start at sample zero and retain their original RF frequency edges. Channelized captures use the original RF tuning plus the mix frequency as their new center. Original capture metadata, including timestamps if present, remains in the manifest; output capture timestamps are not synthesized yet. Unknown source metadata fields are retained in the snapshot, not copied indiscriminately onto transformed recordings.

## Channelization recipe

`snail-channel-1` mixes with a negative-frequency oscillator referenced to the event's first sample. It applies a symmetric Hann-windowed sinc FIR with unity DC gain. Its nominal passband half-width is half the accepted event bandwidth. The transition width is the smaller of one quarter of that bandwidth and 90% of the remaining positive-frequency room to Nyquist. The sinc cutoff lies halfway through that transition. Filter length is the next odd integer at or above `4 * sampleRate / transitionHz`, capped at 2,049 taps; unsupported narrow channels are rejected before export begins.

The filter is evaluated with context on both sides of every output sample. Symmetric centering compensates the usual FIR group delay, retaining exactly one output sample per source time step. Context may extend outside the accepted event within its capture, but never crosses a capture boundary. Missing context at capture edges is zero-padded, so boundary transients are expected. Recipe coefficients and context length are saved for replay. There is no resampling, decimation, automatic gain normalization, carrier recovery, or overlap separation in this version.

Full-band events should use unfiltered IQ export. Very narrow channels need a future multistage channelizer. Filter isolation is approximate; validate it against the signal and interference conditions you intend to train on. A synthetic test checks at least 60 dB rejection for its particular far-out-of-band tone; this is not a universal stopband guarantee.

## Python use

The included reader lists manifest entries with standard Python:

```bash
python3 /path/to/dataset/read_dataset.py /path/to/dataset
```

For IQ access, install NumPy in your Python environment and import the reader from the exported dataset directory:

```python
from read_dataset import Dataset

dataset = Dataset('/path/to/dataset')
record = dataset.events[0]
iq = dataset.read_iq(0)  # read-only complex64 memmap; verifies size and SHA-256
label = record['event']['label']
group = dataset.group_id(0)
original_sample = dataset.source_sample(0, 123)
```

`read_iq` requires materialized IQ. Manifest-only exports expose source coordinates and labels but do not yet include a lazy reader for every original IQ format. Verification can be skipped explicitly with `verify=False` after establishing artifact integrity. The reader checks that relative IQ paths stay inside the dataset directory.

## Validation and remaining work

Regression tests exercise accepted-only snapshots, byte-exact cf32 crops, repeated-export reproducibility, source/recording changes, cancellation cleanup, malformed sample responses, sample alignment, capture-boundary isolation, tuned RF coordinates, and Python checksum verification. A native integration test exports through the real sample reader and reopens the result. Electron smoke coverage checks the export controls with synthetic API responses.

Still needed: resampling with rational source mapping, headless recipe replay, source relocations, dataset schema validation, taxonomy enforcement, group split tooling, collection exports, disk-space estimation, background worker isolation for larger filters, and real-capture performance/quality benchmarks. The first implementation yields between bounded 2,048-sample processing chunks and permits one export job at a time; it does not promise production throughput on long collections.
