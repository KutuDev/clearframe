# Denoiser proof of concept

This is an **audio-first, offline proof of concept** for a privacy-preserving video/audio denoiser. The quality path is `neural_denoise.py`, which uses the bundled official DeepFilterNet neural speech-enhancement engine locally. It is designed for full-band speech enhancement, whereas a conventional global FFT gate cannot reliably distinguish speech from non-stationary noise.

The bundled `before.mp4` and `after.mp4` are a *processing reference*, not clean ground truth. Their different audio channel layouts and slightly different durations mean a reference-distance score measures similarity to the paid tool, not absolute speech quality.

## Run the POC

Requires Python 3.11+, NumPy, SciPy, FFmpeg on `PATH`, and the official
`deep-filter.exe` release placed beside `neural_denoise.py`. The native binary
is intentionally excluded from version control and from the Vercel deployment.

```powershell
python neural_denoise.py before.mp4 neural-output
python benchmark.py before.mp4 after.mp4 neural-output/denoised-neural.mp4 --report neural-output/benchmark.json
```

The neural path stream-copies video and replaces only the soundtrack. It uses `--pf`, DeepFilterNet's residual-noise post-filter, and compensates model delay. The older `denoise.py` adaptive gate remains only as a portable algorithm reference; it is not the recommended quality profile.

```powershell
python denoise.py before.mp4 output-video --video-denoise
```

## Quality contract

| Metric | Target / interpretation |
| --- | --- |
| Audio log-spectral distance (LSD) | Lower than unprocessed input vs. reference. Primary regression metric. |
| Audio SI-SDR vs. reference | Higher than unprocessed input; diagnostic only, since reference is not clean ground truth. |
| Audio clipping rate | No increase; target `<= 0.01%`. |
| Audio noise-floor proxy | Quietest 10% of 20 ms RMS windows should decrease; loud-window energy stays within 1 dB. |
| Video luma SSIM vs. reference | Higher than unprocessed input; target `>= 0.95` for video-denoise profile. |
| Video temporal flicker | 95th-percentile inter-frame luma difference must not rise by over 5%. |
| Latency / speed | Faster than real time for export; interactive PWA uses 20–40 ms blocks. |

For a release-grade model, test a held-out clean-speech-plus-noise corpus: DNSMOS/ViSQOL, PESQ (where licensed), and STOI must improve over input, alongside ABX listening tests. The supplied paid-tool comparison alone cannot support a “stellar quality” claim.

## PWA port boundary

Port the DeepFilterNet engine to a SIMD WebAssembly AudioWorklet (480 sample / 10 ms blocks); a C/WASM implementation with embedded weights is available and reports 1–6 ms per frame on modern mobile/desktop hardware. The browser shell should use FFmpeg.wasm only for demux/mux, IndexedDB for local jobs, and a Service Worker for offline installation. Keep the FFT gate only as an explicit low-power fallback, never the default.
