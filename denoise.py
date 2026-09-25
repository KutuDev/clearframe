#!/usr/bin/env python3
"""Portable, adaptive spectral denoiser POC for WAV, audio, and video files."""
from __future__ import annotations

import argparse
import shutil
import subprocess
from pathlib import Path

import numpy as np
from scipy.io import wavfile


def stft_denoise(samples: np.ndarray, sample_rate: int, strength: float = 1.15,
                 frame_size: int = 2048, hop_size: int = 512) -> np.ndarray:
    """Denoise mono float samples with a smooth, adaptive Wiener spectral gate.

    Noise is the 15th percentile of each frequency bin across the program. This
    avoids assuming the beginning is silent. This pure function is the PWA/WASM
    port boundary.
    """
    if samples.ndim != 1 or not len(samples):
        raise ValueError("samples must be a non-empty mono array")
    if not 0 < strength <= 2:
        raise ValueError("strength must be in (0, 2]")
    pad = frame_size
    padded = np.pad(samples.astype(np.float64), (pad, pad))
    window = np.sqrt(np.hanning(frame_size))
    starts = range(0, len(padded) - frame_size + 1, hop_size)
    spectra = np.array([np.fft.rfft(padded[i:i + frame_size] * window) for i in starts])
    power = np.abs(spectra) ** 2
    noise = np.convolve(np.percentile(power, 15, axis=0), np.ones(5) / 5, mode="same")
    noise = np.maximum(noise, 1e-12)
    raw_gain = np.maximum(1.0 - strength * noise[None, :] / (power + 1e-12), 0.10)
    gains = np.empty_like(raw_gain)
    gains[0] = raw_gain[0]
    for i in range(1, len(raw_gain)):
        gains[i] = 0.72 * gains[i - 1] + 0.28 * raw_gain[i]
    output, weights = np.zeros_like(padded), np.zeros_like(padded)
    for spectrum, gain, start in zip(spectra, gains, starts):
        frame = np.fft.irfft(spectrum * gain, n=frame_size) * window
        output[start:start + frame_size] += frame
        weights[start:start + frame_size] += window ** 2
    return (output / np.maximum(weights, 1e-10))[pad:pad + len(samples)].astype(np.float32)


def run(command: list[str]) -> None:
    subprocess.run(command, check=True)


def read_wav(path: Path) -> tuple[int, np.ndarray]:
    rate, data = wavfile.read(path)
    if data.dtype.kind in "iu":
        data = data.astype(np.float32) / np.iinfo(data.dtype).max
    return rate, data.astype(np.float32)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", type=Path); parser.add_argument("output_dir", type=Path)
    parser.add_argument("--strength", type=float, default=1.15)
    parser.add_argument("--video-denoise", action="store_true", help="also apply FFmpeg hqdn3d")
    args = parser.parse_args()
    if not args.input.is_file(): parser.error(f"input file does not exist: {args.input}")
    if shutil.which("ffmpeg") is None: parser.error("ffmpeg must be available on PATH")
    args.output_dir.mkdir(parents=True, exist_ok=True)
    wav_path, denoised_wav, output_path = (args.output_dir / "source.wav", args.output_dir / "denoised.wav", args.output_dir / "denoised.mp4")
    run(["ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-i", str(args.input), "-vn", "-ac", "1", "-ar", "48000", "-c:a", "pcm_f32le", str(wav_path)])
    rate, audio = read_wav(wav_path)
    channels = audio[:, None] if audio.ndim == 1 else audio
    processed = np.column_stack([stft_denoise(channels[:, i], rate, args.strength) for i in range(channels.shape[1])])
    wavfile.write(denoised_wav, rate, processed[:, 0] if processed.shape[1] == 1 else processed)
    video_args = ["-vf", "hqdn3d=1.5:1.5:3:3", "-c:v", "libx264", "-crf", "18", "-preset", "medium"] if args.video_denoise else ["-c:v", "copy"]
    run(["ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-i", str(args.input), "-i", str(denoised_wav), "-map", "0:v:0", "-map", "1:a:0", *video_args, "-c:a", "aac", "-b:a", "192k", "-shortest", "-movflags", "+faststart", str(output_path)])
    print(f"Created {output_path}")


if __name__ == "__main__":
    main()
