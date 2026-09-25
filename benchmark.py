#!/usr/bin/env python3
"""Quantitative benchmark for an input, paid reference, and POC result."""
from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import tempfile
from pathlib import Path

import cv2
import numpy as np
from scipy.io import wavfile
from scipy.signal import stft


def audio_from_media(path: Path, work: Path) -> tuple[int, np.ndarray]:
    wav = work / f"{path.stem}.wav"
    subprocess.run(["ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-i", str(path), "-vn", "-ac", "1", "-ar", "48000", "-c:a", "pcm_f32le", str(wav)], check=True)
    rate, data = wavfile.read(wav)
    return rate, np.asarray(data, dtype=np.float64).reshape(-1)


def align(a: np.ndarray, b: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    return a[:min(len(a), len(b))], b[:min(len(a), len(b))]


def audio_metrics(candidate: np.ndarray, reference: np.ndarray) -> dict[str, float]:
    candidate, reference = align(candidate, reference)
    _, _, cs = stft(candidate, fs=48000, nperseg=1024, noverlap=768)
    _, _, rs = stft(reference, fs=48000, nperseg=1024, noverlap=768)
    lsd = float(np.mean(np.sqrt(np.mean((20*np.log10(np.abs(cs)+1e-8) - 20*np.log10(np.abs(rs)+1e-8))**2, axis=0))))
    scale = np.dot(candidate, reference) / (np.dot(reference, reference) + 1e-12)
    distortion = candidate - scale * reference
    windows = candidate[:len(candidate)//960*960].reshape(-1, 960)
    rms_db = 20*np.log10(np.sqrt(np.mean(windows**2, axis=1)) + 1e-12)
    return {"log_spectral_distance_db": lsd,
            "si_sdr_db": float(10*np.log10((np.sum((scale*reference)**2)+1e-12)/(np.sum(distortion**2)+1e-12))),
            "clip_percent": float(100*np.mean(np.abs(candidate) >= .999)),
            "quietest_10pct_rms_dbfs": float(np.percentile(rms_db, 10)),
            "loudest_10pct_rms_dbfs": float(np.percentile(rms_db, 90))}


def sampled_video_metrics(candidate_path: Path, reference_path: Path) -> dict[str, float]:
    a, b = cv2.VideoCapture(str(candidate_path)), cv2.VideoCapture(str(reference_path))
    count = min(int(a.get(cv2.CAP_PROP_FRAME_COUNT)), int(b.get(cv2.CAP_PROP_FRAME_COUNT)))
    positions = np.linspace(0, max(0, count - 1), min(30, count), dtype=int)
    ssims, maes, motion, previous = [], [], [], None
    for pos in positions:
        a.set(cv2.CAP_PROP_POS_FRAMES, int(pos)); b.set(cv2.CAP_PROP_POS_FRAMES, int(pos))
        ok_a, frame_a = a.read(); ok_b, frame_b = b.read()
        if not (ok_a and ok_b): continue
        x = cv2.cvtColor(frame_a, cv2.COLOR_BGR2GRAY).astype(np.float64); y = cv2.cvtColor(frame_b, cv2.COLOR_BGR2GRAY).astype(np.float64)
        c1, c2, mx, my = 6.5025, 58.5225, x.mean(), y.mean()
        ssims.append(((2*mx*my+c1)*(2*((x-mx)*(y-my)).mean()+c2))/((mx*mx+my*my+c1)*(x.var()+y.var()+c2)))
        maes.append(np.abs(x-y).mean())
        if previous is not None: motion.append(np.abs(x-previous).mean())
        previous = x
    a.release(); b.release()
    return {"luma_ssim": float(np.mean(ssims)), "luma_mae": float(np.mean(maes)), "sampled_temporal_change_p95": float(np.percentile(motion, 95)) if motion else 0.0}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("input", type=Path); parser.add_argument("reference", type=Path); parser.add_argument("candidate", type=Path)
    parser.add_argument("--report", type=Path, default=Path("benchmark.json")); args = parser.parse_args()
    if shutil.which("ffmpeg") is None: parser.error("ffmpeg must be available on PATH")
    with tempfile.TemporaryDirectory() as temp:
        work = Path(temp)
        _, source = audio_from_media(args.input, work); _, reference = audio_from_media(args.reference, work); _, candidate = audio_from_media(args.candidate, work)
        report = {"reference_note": "Paid output is a processing reference, not clean ground truth.",
                  "input_vs_reference": {"audio": audio_metrics(source, reference), "video": sampled_video_metrics(args.input, args.reference)},
                  "candidate_vs_reference": {"audio": audio_metrics(candidate, reference), "video": sampled_video_metrics(args.candidate, args.reference)}}
    args.report.parent.mkdir(parents=True, exist_ok=True); args.report.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps(report, indent=2))


if __name__ == "__main__": main()
