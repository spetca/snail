# Snail: RF reverse engineering and labeling roadmap

Working plan — September 5, 2026. This is the current product and reliability plan; older local brainstorming may remain in the ignored `notes/` directory.

The product goal: open an unfamiliar recording, discover its transmissions, understand their structure, label a few examples, find related signals across recordings, and export a reproducible training dataset. Every exported example should lead back to the original samples, the analyst's evidence, and the processing recipe that produced it.

The first flagship workflow should be **“label one burst, find more like it, review the matches, export a dataset.”** It connects the existing spectrogram, correlation, annotations, feature extractor, and classifier into something useful before requiring a large new model.

## 1. Reliability audit

### Fixed in this change

| Finding | Trigger and impact | Change |
| --- | --- | --- |
| Cursor panel crashes React | Enabling cursors mounts `CursorInfoSection`, which referenced undefined `showAbsoluteFrequency` and `fileInfo`. The application can disappear into its dark background. | Pass frequency mode and center frequency explicitly; regression coverage for both display modes. |
| Constellation FFT has broken swaps | Two adjacent destructuring assignments without semicolons are parsed as a continued expression. FFTs needing bit-reversal swaps can fail. | Separate the assignments, extract the FFT utility, compare its complex output with a direct DFT. |
| New cursor selections have zero bandwidth | Dragging a new selection updated X2 only, leaving Y2 at its starting position. | Give rectangle creation its own drag mode and update both endpoints. |
| Cursor drags stop at the overlay edge | Mouse-leave ended the drag before pointer release. | Use pointer capture and handle cancellation/lost capture. |
| Moving a selection shrinks it at boundaries | Each endpoint was clamped independently. | Clamp the translation of the rectangle as a whole. |
| Hidden annotations intercept selections | Hit-testing ignored the visibility toggle. | Respect visibility for hit-testing and detail cards; skip vertically offscreen boxes when drawing. |
| Cursors block wheel navigation | The overlay intercepted wheel events intended for its sibling canvas. | Put the overlay inside the spectrogram's wheel-handling container. |
| Overlay dimensions become stale | Cursor drawing did not subscribe to viewport dimensions. | Redraw on viewport width/height changes. |
| Coordinate helpers disagree with rendering | `useCursors` omitted scroll offset; helpers used fractional FFT stride; frequency conversion ignored Y zoom/scroll. | Match the integer renderer stride and the viewport transform. |
| Scrollbar misrepresents the viewport | App used a fixed 800-pixel width and fractional stride. | Use measured viewport width and integer stride. |
| Correlation hook sends obsolete fields | Its request shape no longer matched `CorrelateRequest`. | Use the current window/pattern fields and explicit file mode. The main correlation pane already uses these fields. |
| Production builds miss type errors | Vite transpiled these errors into runnable JavaScript. | Add a renderer type-check gate to `npm run build`; fix existing renderer typing/configuration errors needed for the gate. |

The original cursor crash was reproduced by rendering the pre-change panel: `ReferenceError: showAbsoluteFrequency is not defined`. The patched panel renders successfully under the same state.

### Foundation slice implemented

The follow-up implementation adds:

- A new recording ID for every successful open, including reopening the same path. Main-process IPC checks the ID before work starts and before returning results. Late feature-export dialogs also recheck before writing. Renderer jobs reject old results, and overlapping opens cannot repopulate a newer view.
- Native FFT, spectrogram, correlation, and pulse workers retain a shared immutable source reference. A new source is published only after it opens successfully. Recording changes reset playback, selections, annotations, classification results, correlation, and export dialogs; analysis windows close so their old DSP state cannot operate on the new source. Application preferences and the loaded classifier remain available.
- A physical selection model in sample indices and baseband Hz. Cursor pixels are derived from it. Scrolling, zooming, FFT-size changes, fitting, resizing, and cursor visibility preserve that selection. Viewport changes no longer send redundant selection FFT updates.
- Capture-aware annotation rendering and writing. Imported SigMF edges default to RF; boxes are drawn at the appropriate baseband frequency for each intersected capture. New selections crossing capture boundaries are saved as separate segments. Missing capture frequency is treated as unknown/baseband, not inherited from an earlier segment.
- An explicit **Imported frequency bounds → Legacy Snail (baseband)** option. It changes interpretation without guessing from numeric values. The annotation dialog explains that saving in legacy mode converts existing frequency annotations to RF. Saving returns the complete metadata to the UI and restores RF interpretation.
- Atomic metadata replacement, preservation of unrelated metadata, correct `.sigmf-meta` paths, raw-IQ sidecars with the actual datatype/sample rate, and rejection of malformed metadata rather than replacing it with an empty document.
- React error recovery, visible tile/shader errors, a spectrogram retry button, and WebGL context restoration.
- A native FFT buffer-overflow fix: selections larger than the FFT cap can no longer copy beyond the capped allocation. A tile-length calculation also clamps before converting large sample counts to an integer.
- Filtered export now receives the selected frequency bounds, validates them, and records the RF center after NCO tuning. Exports spanning different RF tunings are explicitly rejected until multi-capture export is implemented; select one capture segment at a time.

Verification completed locally:

| Check | Result / coverage |
| --- | --- |
| `npm test` | 14 passing tests: rendering regressions, physical coordinates, recording resets, stale request/result rejection, overlapping opens, capture-aware bounds, metadata preservation/migration, malformed JSON, and raw sidecars. |
| `cmake --build src/native/build -j 4` | Native addon rebuilt successfully. |
| `npm run test:native` | 4 passing tests with temporary IQ files: 24 queued FFT/tile/correlation jobs while switching recordings, failed opens, oversized FFT selection, and filtered export frequency/bounds. Requires a built addon and native libraries. |
| `npm run test:desktop` | Hidden Electron smoke suite passed on macOS: real cursor clicks/rectangle dragging, wheel zoom, resizing, no redundant FFT updates, WebGL loss/restoration, and file switching. Uses synthetic FFT data and mocked IPC; it tests the actual React/WebGL components. Requires a desktop-capable Electron environment. |
| `npm run build` | Renderer/main type checks and main/preload/renderer bundles pass. |

This closes the first foundation implementation slice, not all M0 acceptance gates. Native DSP and desktop UI are tested separately; packaged-app tests, Linux/DPI coverage, and real-capture end-to-end validation still remain.

### Confirmed code gaps to address next

| Priority | Evidence | Consequence / required work |
| --- | --- | --- |
| P0 | `ControlsPanel.tsx::handleExtract` forwards annotation time bounds but not frequency bounds. | A box around one narrowband signal trains on the whole wideband mixture. Channelize each event before feature extraction and retain the transform/source mapping. |
| P1 | Metadata writes are atomic but there is no project revision journal. | Add revision checks, backups, undo/redo, and complete validation against a pinned SigMF schema. |
| P1 | `classifier.cpp::classify` always chooses a known class and calls `exp(-0.5*d²)` confidence. | The score is not a calibrated probability of correctness. Add unknown/reject behavior, validation-based thresholds, and calibration before trusting automated acceptance. |
| P1 | `utils/pulseDetect.ts` samples at stride 512 with a 50-chunk limit. | Short bursts can be skipped; a navigation scan is not a complete recording detector. Build a separate exhaustive, multiresolution event detector with explicit coverage. |

Remaining inspection/export work: broad native parameter validation, SigMF datatype/endian handling, probe accuracy when opening metadata files, direct opening of raw sidecars through `core:dataset`, preservation of capture timestamps/annotations in cropped exports, FIR delay/source alignment, and multi-capture exports. The RF axis currently reports tuning at the left edge of the viewport; the UI calls this out for multiple captures. Full-band feature extraction and synchronous classification still need bounded jobs before large automated runs.

Remaining desktop checks: drag beyond every edge and release outside; overlapping and hidden annotation interactions; short recordings near EOF; auxiliary analysis windows with real native IPC; packaged macOS and Linux at normal/high DPI. The synthetic smoke suite is a regression check, not a claim of performance or RFML accuracy.

### Implemented: first detection and review slice

The toolbar's **Detect & label** panel now scans the current view, cursor time range, or full recording. Current view includes its visible frequency band and estimates noise within that band; the run retains these frequency bounds. Highlights have stronger contrast and a minimum four-pixel display extent for very small events, while stored bounds remain exact. A desktop regression checks painted highlights before selection with cursors disabled, horizontal scrolling, and vertical zoom. A streaming spectral-energy detector uses native, overlapping FFT windows, a median spectral noise estimate, hysteresis, minimum duration/bin support, and configurable gap tolerance. Candidate tracks continue across FFT tiles and split at capture retunes. Optional inclusive minimum/maximum pulse-width and bandwidth limits filter completed candidates before they enter the queue. The panel also filters existing queue entries without deleting their decisions; pulse width measures the detected rectangle, including FFT support and bridged gaps. Bounds are stored in seconds/Hz in detector run settings and displayed as milliseconds/kHz. FFT reads stop at scan/capture boundaries, including partial final windows.

Proposed events have UUIDs, original-bound fingerprints, baseband sample/frequency bounds, detector/run provenance, a measured peak-above-noise score, review status, and revision history. Orange dashed overlays distinguish pending candidates; queue selection focuses the physical cursors. Review supports bounds/label/comment edits, accept, reject, and restore. Acceptance writes a capture-aware SigMF annotation with RF frequency edges, proposal UUID, and provenance in its comment. Metadata retries are idempotent by UUID; malformed existing metadata is preserved and reported as an error.

Projects are atomically saved as bounded JSON under Electron's user-data `event-projects/` directory. This is a deliberately small initial persistence implementation, preceding the indexed database proposed below. Identity includes canonical data path, size, modification time, format, sample count/rate, and captures; it is **not a full IQ content hash**. Moving or modifying a source creates another project. Exact detector/config/bounds rescans preserve accepted, edited, and rejected proposals; changing settings or scan boundaries may propose overlapping events. Accepted annotations are immutable in this review panel.

Scans run one at a time, consume native FFT tiles of at most 256 rows, yield between tiles, checkpoint approximately every two seconds, and retain finalized candidates when cancelled. A recording switch discards pending results. Interrupted runs reopen as cancelled, requiring a rescan to complete coverage. Limits are 2,000 proposals, 100 runs, and 32 MB per project; reaching a limit is explicit and does not claim full coverage. Queue management now supports reset: the previous project is archived under user-data `event-projects/archive/<UUID>/`, then proposals and scan history are cleared. Accepted SigMF annotations remain untouched; export accepted datasets before resetting if needed. New scans can propose previously accepted regions again. Queue review waits until the scan finishes or is cancelled.

Validation: 23 TypeScript/renderer regression tests and six native regression tests pass, along with the production build. Detection tests cover tile continuity, gap tolerance, short-spike rejection, capture splitting, cancellation/file switches, persisted decisions, exact-rescan deduplication, malformed metadata, and legacy-migration acceptance retries. A native synthetic tone burst is localized within one FFT window of its known boundaries; a bounded native FFT matches an independently truncated source. The Electron smoke test exercises cursor drag/zoom/resize, graphics-context recovery, and the candidate editor/acceptance path using synthetic API responses. These are correctness checks, not a measured real-capture precision/recall benchmark.

Current limits: single FFT resolution, median noise estimation rather than calibrated CFAR, rectangular boxes, no automatic protocol classification, no split/merge or batch review, no accepted-label undo, no reviewer identity/taxonomy enforcement, and no resumable mid-track state. The minimum-frame support is conservative when tracks merge. Dense wideband activity and overlapping signals need richer detectors and evaluation. Partial-file load windows are rejected because their original sample offset is not exposed to this workflow; open the whole file and limit the scan range instead. Sample-rate corrections must be saved and the recording reopened before detection. Source-offset handling for existing manual annotations also needs an audit.

### Implemented: accepted-event export and first channelizer

Accepted review revisions can now be exported as a source manifest, cf32 IQ crops, or tuned/filtered cf32 IQ. Exports include full-source and per-artifact SHA-256, detector/review lineage, exact sample mapping, original metadata snapshots, and unassigned recording groups. A bundled Python reader loads verified complex64 memmaps. Versioned channelization recipes include oscillator phase origin and FIR coefficients; centered filtering preserves event sample alignment and stops context at capture boundaries. The output rate remains unchanged. Exports show progress/cancellation and publish a new folder only when complete.

The implementation and limits are documented in [Accepted-event datasets](dataset-export.md). Validation now passes 33 TypeScript/renderer/export tests, seven native tests, the production build, and the Electron smoke test. This includes native export/reopen, filter alignment/isolation fixtures, cancellation cleanup, and Python/NumPy checksum verification. The Python integration test skips when Python with NumPy is unavailable; it ran successfully in this workspace.

This delivers part of M2/M3's data plumbing, not complete dataset delivery: resampling, headless replay, taxonomy, automated split/leakage checks, collection export, and real-capture evaluation remain open.

## 2. A label model suitable for RFML

A single free-text class is insufficient. Separate observations from interpretations:

- **Recording:** stable ID, content hash, source path, datatype, sample rate, capture segments, RF tuning, timestamps, receiver/session/environment, quality flags.
- **Event:** stable ID; integer sample start/count; frequency bounds with an explicit reference; optional time-frequency polygon or mask for chirps/hops; parent burst/packet/track; links to original samples.
- **Labels:** independent modulation, protocol family, channel/access behavior, signal role, and optional emitter hypothesis. Distinguish “unknown,” “ambiguous,” “noise,” and “not reviewed.” Do not infer device identity from modulation alone.
- **Evidence:** measured bandwidth, duration, SNR estimate and estimator settings, symbol-rate candidates, periodicity, decoder/CRC results, correlation template, and analyst notes.
- **Provenance:** manual/rule/model origin, model and preprocessing versions, raw score, calibrated confidence if available, review status, reviewer, timestamps, superseded revision, taxonomy version.
- **Relationships:** burst contains packets; packets belong to a candidate conversation; events may share a hopping track or similarity cluster. Relationships can carry uncertainty separately from labels.

Keep machine proposals separate from accepted annotations. Reviewer approval creates a versioned change; rerunning a model must not overwrite human decisions. Preserve overlapping signals and multiple valid labels rather than forcing one class per time window.

Use a local project database (start with SQLite) for events, jobs, revisions, and search. Keep raw IQ immutable and external; store derived artifacts in a content-addressed cache. SigMF remains the interchange format, with documented namespaced extensions for Snail-specific provenance. Validate against a pinned schema and preserve metadata fields the app does not understand. SigMF specifies RF frequency edges when the RF frequency is known, and requires both frequency edges or neither; capture-aware conversion is essential. [SigMF specification](https://sigmf.org/)

## 3. Automated labeling pipeline

1. **Ingest and assess.** Validate metadata, identify capture discontinuities, estimate noise/clipping/DC/IQ imbalance, and construct a coarse overview. Index incrementally with visible progress; allow work on a selected range immediately.
2. **Propose events.** Start with local noise estimation, adaptive energy thresholds/CFAR, hysteresis, and connected regions in a spectrogram. Use multiple resolutions for short/wide and long/narrow events. Treat noise-only and continuous-carrier recordings explicitly. Save detection parameters and coverage.
3. **Refine and channelize.** Refine time/frequency boundaries, group nearby regions conservatively, and flag possible overlap. Mix each candidate to baseband, filter, and resample with anti-aliasing. Preserve source offsets, rational rate changes, tuning offsets, filter delay, and context padding. Stitch chunk-edge events once using overlap and stable IDs.
4. **Measure and retrieve.** Compute existing statistical features plus duration/bandwidth/envelope/cyclic features as justified by validation. Add learned embeddings later. Rank “similar to this” matches using frequency/rate-normalized representations and template correlation; show evidence for each match.
5. **Categorize with abstention.** Combine analyst rules, model suggestions, and validated decoder evidence. Report competing hypotheses and unknowns. Use per-class acceptance thresholds evaluated across SNR, receiver, and capture conditions. A high similarity score alone must not imply a verified protocol label.
6. **Review efficiently.** Present a keyboard-driven queue with synchronized spectrogram/IQ/measurements, accept/reject/edit/split/merge, batch apply, and undo. Prioritize uncertain, diverse, novel, and disagreeing examples. Periodically audit high-confidence proposals as well.
7. **Improve deliberately.** Retrain from accepted labels, preserve previous model versions, compare held-out performance, and surface class imbalance and confusion. Keep a frozen evaluation corpus outside the active-learning loop.
8. **Export and reproduce.** Produce accepted event manifests and optional channelized IQ/windows, label masks, preprocessing recipes, source hashes, taxonomy/model revisions, and split assignments. A headless CLI must execute the same recipe as the GUI.

Start local and CPU-capable; use bounded native workers for DSP and an isolated Python worker for model experimentation. A versioned request/result contract should include recording ID, job ID, input hash, parameters, output schema, progress, cancellation, and errors. Cap memory/concurrency and support resume. Never allocate an entire long recording just to classify it.

## 4. Reverse engineering features worth building

| Feature | Analyst value | Dependencies / useful first version |
| --- | --- | --- |
| “Find more like this” | Label one distinctive burst and retrieve candidates throughout a recording or collection. | Event index, channelization, correlation/features; preview matches before batch approval. |
| Linked analysis workbench | Selecting a burst updates spectrogram, amplitude/phase/instantaneous-frequency traces, PSD, constellation, eye diagram, and bit view. | Shared physical selection and processing recipe; preserve settings per event. |
| Burst and hopping explorer | See dwell time, channel spacing, hop transitions, repetition intervals, occupancy, and candidate track associations. | Extend existing hop table/visualizer with editable event links and missed/overlapping-event indicators. |
| Symbol-rate and modulation hypotheses | Compare FSK tone separation, PSK/QAM constellations, OFDM cyclic-prefix timing, and chirp slope/rate candidates. | Estimators return ranked candidates and error/ambiguity information; analyst can override. |
| Demodulation recipe builder | Reuse tuning → filtering → resampling → carrier/timing recovery → slicing across related bursts. | Parameterized DSP graph, cached intermediate outputs, before/after plots, source-coordinate mapping. |
| Packet/bit laboratory | Align packets, search preambles/sync words, compare hex/bits, test inversion/differential/Manchester hypotheses, visualize entropy and changing fields. | Demodulated bits with sample mapping; save hypotheses, not just the final bitstream. |
| Decoder evidence | Test framing, CRC, whitening, and byte/bit order; attach successful and failed checks to events. | Isolated decoder adapters, bounded runs, golden vectors. A coincidental CRC match needs repeated framing evidence. |
| Controlled-capture comparisons | Compare recordings taken while changing one device setting; locate repeatable field changes. | Capture groups, aligned packets, analyst notes, diff views and repeatability checks. |
| Similarity atlas and collection search | Search by bandwidth, duration, RF range, label, SNR, session, and waveform similarity; inspect clusters of unknowns. | Indexed events and embeddings; every atlas point opens its original evidence. |
| Reproducible investigation notebook | Save bookmarks, measurements, screenshots, hypotheses, recipes, and conclusions with one-click return to source. | Project persistence, revisions, exportable report bundle. |

## 5. RFML dataset delivery and evaluation

Provide a Python dataset reader plus manifests for existing training pipelines. Each example should identify source recording, event, crop, label state, processing recipe, and split; support both lazy raw-IQ access and materialized derived arrays. Consider a TorchSig adapter after the internal schema and export contract stabilize; its documented datasets, transforms, and SigMF ingestion tutorials make it a relevant integration point. [TorchSig tutorials](https://torchsig.com/dist/tutorials.html)

Split by recording/session/device or another declared deployment-relevant group **before** cropping or augmentation. Related packets, overlapping windows, and augmented copies must stay together. Add duplicate detection and source-group checks to exports. Keep ambiguous/unknown labels explicit; unlabeled regions are not automatically negative examples.

Track detector precision/recall and boundary error separately from classification. Report per-class confusion, macro-F1, unknown rejection, calibration, overlap performance, and results by SNR/receiver/session. Measure analyst minutes per accepted event and correction rate, not just inference speed. Synthetic fixtures need noise, interference, fades, CFO, timing offsets, imbalance, clipped samples, overlapping transmissions, hopping/chirps, continuous carriers, short bursts, and chunk-boundary cases. Retain real held-out captures to measure the synthetic-to-real gap.

Proposed product targets, to validate on documented hardware and datasets: under 50 ms p95 for cached cursor/selection feedback; no cursor-dependent FFT recomputation; bounded memory during hour-long processing; resumable/cancellable analysis; substantially faster review than manual boxing at equal accepted-label quality. Establish baselines before promising a throughput multiplier or accuracy percentage.

## 6. Delivery order and acceptance gates

| Milestone | Deliverable | Exit criterion |
| --- | --- | --- |
| M0 — dependable inspection | This patch, error recovery, recording/job identity, source lifetime audit, physical selection coordinates, SigMF frequency migration. | Desktop smoke matrix passes; file-switch stress tests reject stale results; exports reimport at correct time/frequency; unknown metadata survives edits. |
| M1 — event project and review | Persistent event schema, taxonomy, undo/redo, atomic saves, adaptive detector, editable boxes and review queue. | Ground-truth fixture evaluation is reported; chunk-boundary events appear once; crash/restart retains accepted edits and analysis coverage. |
| M2 — label one, retrieve many | Channelized features, template library, similarity retrieval, model proposals with abstention, batch review. | Demonstrate the whole workflow on unseen recordings; measure analyst time, false proposals, and correction rate against manual labeling. |
| M3 — reproducible RFML delivery | Headless jobs, Python reader, dataset manifests, deterministic group splits, lineage and evaluation reports. | Same input/recipe/version yields equivalent outputs; no source-group leakage; every example resolves to original samples. |
| M4 — deeper protocol workbench | Linked demodulation, rate estimation, bits/packets, hopping associations, decoder adapters, investigation reports. | A saved recipe replays on a second capture and recovers known fixture packets; measurements remain traceable to samples. |

M0 precedes production automation. M1's event model enables both M2 and the later reverse engineering tools. Keep cloud collaboration, a plugin marketplace, live multi-receiver ingestion, and end-to-end protocol guessing outside the first release; they need contracts and trustworthy data that do not exist yet.

Versioned event proposals, the first detector/review loop, channelization at the original sample rate, and accepted-event manifests are now implemented. The next slice should add “find more like this” over measured event features with analyst-reviewed matches, followed by batch review, taxonomy controls, and a held-out detection benchmark. Resampling and headless recipe replay should extend the existing source-mapping contract. M1 and M3 remain incomplete until their remaining review and evaluation gates are met.
