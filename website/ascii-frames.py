"""Turn an animated GIF into ASCII brightness frames for the website hero.

Usage: python3 website/ascii-frames.py docs/demo.gif _site/assets/demo-ascii.json

Output: {"cols", "rows", "ms", "frames": [...]}. Each frame is one string of
cols*rows digits (0-9), the brightness of each cell; index.html maps digits to
characters and colors. Needs Pillow (pip install pillow).
"""
import json
import sys

from PIL import Image, ImageEnhance, ImageSequence

COLS, ROWS = 160, 45  # 16:9 with monospace cells about twice as tall as wide
CONTRAST = 1.6


def main(src, out):
    im = Image.open(src)
    frames, durations = [], []
    for frame in ImageSequence.Iterator(im):
        durations.append(frame.info.get("duration") or 100)
        g = ImageEnhance.Contrast(frame.convert("L")).enhance(CONTRAST)
        px = g.resize((COLS, ROWS), Image.LANCZOS).load()
        frames.append("".join(str(min(9, px[x, y] * 10 // 256)) for y in range(ROWS) for x in range(COLS)))
    ms = round(sum(durations) / len(durations))
    with open(out, "w") as f:
        json.dump({"cols": COLS, "rows": ROWS, "ms": ms, "frames": frames}, f, separators=(",", ":"))
    print(f"{len(frames)} frames, {ms} ms each -> {out}")


if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    main(sys.argv[1], sys.argv[2])
