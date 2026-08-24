#!/usr/bin/env python3
"""เปลี่ยนชื่อ placeholder ชุดเดิมใน .docx ให้เป็นชื่อปัจจุบัน (24 สิงหาคม 2569)

    python3 docs/tools/rename-placeholders.py <ไฟล์เข้า.docx> [ไฟล์ออก.docx]

ไม่ระบุไฟล์ออก = แก้ไฟล์เดิมในที่ (มี .bak ให้)

ตารางชื่อต้องตรงกับ DEPRECATED_PLACEHOLDERS ใน backend/src/lib/document-render.ts
ฝั่ง backend ยังเติมค่าให้ชื่อเดิมอยู่ สคริปต์นี้จึงเป็นการ "ตามเก็บ" ไม่ใช่การกู้ของพัง

Word ผ่าข้อความเป็นหลายชิ้นได้ทุกที่ — `{{signatory.firstName}}` อาจถูกแบ่งเป็นสามชิ้น
โดยมี <w:proofErr> คั่น regex บน XML ดิบจึงหาไม่เจอ ต้องต่อข้อความของทุก <w:t>
เข้าด้วยกันก่อน แล้วเขียนผลกลับลงชิ้นแรกที่ชื่อนั้นแตะ (กลไกเดียวกับ convert-field-tags.py)
"""
import re
import shutil
import sys
import zipfile
from pathlib import Path

# ชื่อเดิม -> ชื่อใหม่ ไล่ตามลำดับนี้เท่านั้น: `bdi.` ชุดลายมือชื่อต้องถูกเปลี่ยนเป็น
# `bdi_approver.` ก่อน แล้วค่อยเปลี่ยน `office.` เป็น `bdi.` ไม่งั้นจะเปลี่ยนซ้ำสองรอบ
RENAMES = [
    *((f"signatory.{f}", f"org_approver.{f}") for f in (
        "fullName", "prefix", "firstName", "lastName",
        "position", "department", "email", "phone", "nationalId",
    )),
    *((f"contact.{f}", f"org_officer.{f}") for f in (
        "fullName", "prefix", "firstName", "lastName",
        "position", "department", "email", "phone", "nationalId",
    )),
    ("approver.signature", "org_approver.signature"),
    ("approver.signedDate", "org_approver.signedDate"),
    ("bdi.signature", "bdi_approver.signature"),
    ("bdi.signedDate", "bdi_approver.signedDate"),
    ("bdi.firstName", "bdi_approver.firstName"),
    ("bdi.lastName", "bdi_approver.lastName"),
    ("bdi.endorsement", "bdi_approver.endorsement"),
    *((f"office.{f}", f"bdi.{f}") for f in (
        "name", "address", "email", "phone", "directorName", "directorPosition",
    )),
]

TEXT_NODE = re.compile(r"(<w:t(?: [^>]*)?>)(.*?)(</w:t>)", re.S)
PLACEHOLDER = re.compile(r"\{\{\s*([A-Za-z0-9_.]+)\s*\}\}")


def rename(xml: str, table: dict[str, str]) -> tuple[str, dict[str, int]]:
    nodes = [(m.start(2), m.end(2), m.group(2)) for m in TEXT_NODE.finditer(xml)]
    joined = "".join(n[2] for n in nodes)

    spans, pos = [], 0
    for i, (_s, _e, text) in enumerate(nodes):
        spans.append((pos, pos + len(text), i))
        pos += len(text)

    counts: dict[str, int] = {}
    replacements: dict[int, str] = {}
    # **ไล่จากขวาไปซ้าย** — ตำแหน่งของ match คิดจากข้อความก่อนแก้ ถ้าแก้ตัวซ้ายก่อน
    # ความยาวที่เปลี่ยนไปจะทำให้ตำแหน่งของตัวขวาเพี้ยน และตัดวงเล็บปิดหายไป
    # (A0 มี {{bdi.endorsement}}{{bdi.firstName}} ติดกันใน <w:t> ชิ้นเดียว)
    for m in reversed(list(PLACEHOLDER.finditer(joined))):
        target = table.get(m.group(1))
        if target is None:
            continue
        counts[target] = counts.get(target, 0) + 1
        touched = [sp for sp in spans if sp[1] > m.start() and sp[0] < m.end()]
        for k, (n_start, n_end, idx) in enumerate(touched):
            text = replacements.get(idx, nodes[idx][2])
            head = text[: max(0, m.start() - n_start)]
            tail = text[max(0, m.end() - n_start):] if n_end > m.end() else ""
            replacements[idx] = head + ("{{" + target + "}}" if k == 0 else "") + tail

    out = xml
    for idx in sorted(replacements, reverse=True):
        start, end, _ = nodes[idx]
        out = out[:start] + replacements[idx] + out[end:]
    return out, counts


def main() -> None:
    if len(sys.argv) not in (2, 3):
        sys.exit(__doc__)
    src = Path(sys.argv[1])
    dest = Path(sys.argv[2]) if len(sys.argv) == 3 else src
    table = dict(RENAMES)

    with zipfile.ZipFile(src) as zin:
        names = zin.namelist()
        blobs = {n: zin.read(n) for n in names}

    total: dict[str, int] = {}
    for name in names:
        # ทุกที่ที่ Word เก็บข้อความไว้ ไม่ใช่แค่ตัวเอกสาร — หัวกระดาษกับท้ายกระดาษด้วย
        if not re.match(r"^word/(document|header\d*|footer\d*|footnotes|endnotes)\.xml$", name):
            continue
        xml, counts = rename(blobs[name].decode("utf-8"), table)
        blobs[name] = xml.encode("utf-8")
        for k, v in counts.items():
            total[k] = total.get(k, 0) + v

    if not total:
        print(f"{src.name}: ไม่พบชื่อชุดเดิม ไม่ต้องแก้")
        return

    if dest == src:
        shutil.copy2(src, src.with_suffix(".docx.bak"))
    # เขียนใหม่ทั้งไฟล์โดยคงลำดับรายการเดิมไว้ — Word อ่านง่ายกว่าเมื่อ [Content_Types] มาก่อน
    with zipfile.ZipFile(dest, "w", zipfile.ZIP_DEFLATED) as zout:
        for name in names:
            zout.writestr(name, blobs[name])

    for name in sorted(total):
        print(f"  {name} x{total[name]}")
    print(f"{dest.name}: เปลี่ยนชื่อแล้ว {sum(total.values())} จุด")


if __name__ == "__main__":
    main()
