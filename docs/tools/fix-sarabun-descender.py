#!/usr/bin/env python3
"""
ขยาย descender ของ Sarabun ให้คลุมตัว _ (underscore)

Sarabun ชุด CI วาด `_` ที่ y = -223 ถึง -289 (Regular) / -319 (Bold) หน่วยต่อ em 1000
แต่ประกาศ descender ไว้แค่ -232 ทั้งใน `hhea` และ `OS/2` (USE_TYPO_METRICS เปิดอยู่) ตัว `_`
จึงอยู่ใต้เส้น descender เกือบทั้งตัว — ในย่อหน้าธรรมดาเบราว์เซอร์ยังวาดหมึกที่ล้นกล่องบรรทัดได้
แต่ใน `<input>` Chrome ตัดข้อความไว้ที่กล่อง ascent+descent ของฟอนต์ ผู้ใช้จึงเห็น `_`
เป็นช่องว่าง (feedback 2026-09-21) แก้ด้วย CSS ไม่ได้ เพราะการตัดนั้นไม่สนใจ `line-height`

สคริปต์นี้แก้แค่ตัวเลข descender เป็น -330 (คลุม Bold ที่ -319) ไม่แตะรูปตัวอักษรเลย
ผลข้างเคียงเดียวคือกล่องบรรทัดใน `line-height: normal` สูงขึ้นราว 1.5px ที่ 15px

ใช้เมื่อได้ฟอนต์ชุดใหม่จาก CI:

    pip install fonttools
    python3 docs/tools/fix-sarabun-descender.py            # แก้ frontend/public/fonts/Sarabun-*.ttf ในที่
"""
from __future__ import annotations

import sys
from pathlib import Path

from fontTools.pens.boundsPen import BoundsPen
from fontTools.ttLib import TTFont

DESCENDER = -330
FONTS = Path(__file__).resolve().parents[2] / "frontend" / "public" / "fonts"


def fix(path: Path) -> None:
    font = TTFont(path)
    glyph_set = font.getGlyphSet()
    underscore = font.getBestCmap()[ord("_")]
    pen = BoundsPen(glyph_set)
    glyph_set[underscore].draw(pen)
    lowest = pen.bounds[1]
    if lowest < DESCENDER:
        sys.exit(f"{path.name}: `_` ลงไปถึง {lowest} ต่ำกว่า {DESCENDER} — ปรับ DESCENDER ก่อน")

    before = (font["hhea"].descent, font["OS/2"].sTypoDescender)
    font["hhea"].descent = DESCENDER
    font["OS/2"].sTypoDescender = DESCENDER
    # usWinDescent (567) กว้างกว่าอยู่แล้ว ไม่ต้องแตะ
    font.save(path)
    print(f"{path.name}: `_` ต่ำสุด {lowest} · descender {before} -> {DESCENDER}")


def main() -> None:
    paths = sorted(FONTS.glob("Sarabun-*.ttf"))
    if not paths:
        sys.exit(f"ไม่พบ Sarabun-*.ttf ใน {FONTS}")
    for path in paths:
        fix(path)


if __name__ == "__main__":
    main()
