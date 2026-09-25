#!/usr/bin/env python3
"""Production-quality POC using the bundled DeepFilterNet neural enhancer.

The binary is the official DeepFilterNet v0.5.6 Windows release. It is used
only as a local inference engine: video never leaves this machine.
"""
from __future__ import annotations

import argparse
import shutil
import subprocess
from pathlib import Path


def call(command: list[str]) -> None:
    subprocess.run(command, check=True)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", type=Path)
    parser.add_argument("output_dir", type=Path)
    parser.add_argument("--post-filter", action="store_true", default=True,
                        help="enable the neural model's stronger residual-noise post-filter (default)")
    args = parser.parse_args()
    root = Path(__file__).parent
    engine = root / "deep-filter.exe"
    if not engine.is_file(): parser.error("Missing deep-filter.exe; see README.md setup.")
    if not args.input.is_file(): parser.error(f"Missing input: {args.input}")
    if shutil.which("ffmpeg") is None: parser.error("ffmpeg must be on PATH")
    args.output_dir.mkdir(parents=True, exist_ok=True)
    source = args.output_dir / "source-48k-mono.wav"
    enhanced_dir = args.output_dir / "deepfilter"
    enhanced_dir.mkdir(exist_ok=True)
    enhanced = enhanced_dir / source.name
    output = args.output_dir / "denoised-neural.mp4"
    call(["ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-i", str(args.input),
          "-vn", "-ac", "1", "-ar", "48000", "-c:a", "pcm_f32le", str(source)])
    command = [str(engine), "-D", "-o", str(enhanced_dir)]
    if args.post_filter: command.append("--pf")
    call([*command, str(source)])
    call(["ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-i", str(args.input),
          "-i", str(enhanced), "-map", "0:v:0", "-map", "1:a:0", "-c:v", "copy",
          "-c:a", "aac", "-b:a", "192k", "-shortest", "-movflags", "+faststart", str(output)])
    print(f"Created {output}")


if __name__ == "__main__": main()
