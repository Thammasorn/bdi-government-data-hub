#!/usr/bin/env python3
"""แปลงแท็กแบบ <table.column> ในเอกสารต้นแบบ ให้เป็น placeholder มาตรฐานของระบบ

ฝ่ายกฎหมายส่งเอกสารที่ทำเครื่องหมายช่องกรอกไว้ด้วยชื่อคอลัมน์ในฐานข้อมูล เช่น
`<organization.name_th>` ซึ่งอ่านง่ายสำหรับคนเขียนเอกสาร แต่ระบบรู้จักเฉพาะชื่อใน
TEMPLATE_VARIABLES (`{{org.name}}`) สคริปต์นี้แปลงให้ และล้มทันทีถ้าพบแท็กที่ยังไม่มี
ปลายทาง — ดีกว่าปล่อยให้เหลือ `<...>` ค้างในเอกสารที่หน่วยงานต้องลงนาม

    python3 docs/tools/convert-field-tags.py <ไฟล์เข้า.docx> <ไฟล์ออก.docx>

สิ่งที่ทำนอกจากแปลงแท็ก:

* **เติม placeholder ที่ฉบับนี้ยังไม่ได้ทำเครื่องหมายไว้** — วันที่ทำข้อตกลง ชื่อระบบ
  และตราเห็นชอบ ฉบับที่ใช้อยู่มีครบทั้งสาม ถ้าไม่เติมกลับไป เอกสารใหม่จะถอยหลัง
* **ลบไฮไลต์และตัวอักษรสีแดง** ที่ใช้ทำเครื่องหมายช่องกรอกตอนร่าง ถ้าปล่อยไว้
  ค่าที่เติมเข้าไปจะมีแถบไฮไลต์คาดอยู่ในเอกสารฉบับจริง
"""
import html
import re
import shutil
import sys
import zipfile
from pathlib import Path

# แท็กของฝ่ายกฎหมาย -> placeholder ของระบบ
# ค่า None = ตั้งใจไม่แปลง (ยังไม่มีปลายทาง) จะทำให้สคริปต์ล้มพร้อมบอกชื่อ
TAG_MAP = {
    "organization.name_th": "org.name",
    "organization.address": "org.addressNo",
    "organization.street": "org.road",
    "organization.sub_district": "org.subdistrict",
    "organization.district": "org.district",
    "organization.province": "org.province",
    "org_approver.firstname_th": "signatory.firstName",
    "org_approver.lastname_th": "signatory.lastName",
    "org_approver.position_th": "signatory.position",
    "bdi_approver.firstname_th": "bdi.firstName",
    "bdi_approver.lastname_th": "bdi.lastName",
    "user.firstname_th": "contact.firstName",
    "user.lastname_th": "contact.lastName",
    "download_datetime": "printedDateTime",
}

# `signature_confirmation.confirmed_at` ปรากฏสองที่ และเป็นวันที่ลงนามของ**คนละฝ่าย**
# ช่องซ้ายคือสำนักงาน ช่องขวาคือหน่วยงาน จึงแปลงตามลำดับที่พบ ไม่ใช่ค่าเดียวกันทั้งสองที่
ORDERED_TAGS = {
    "signature_confirmation.confirmed_at": ["bdi.signedDate", "approver.signedDate"],
}

# Word ผ่าข้อความเป็นหลายชิ้นภายในไฟล์ (rsid, ตัวตรวจคำสะกด) แท็กหนึ่งอันจึงถูกแบ่งเป็น
# `&lt;` ชิ้นหนึ่ง ชื่อชิ้นหนึ่ง `&gt;` อีกชิ้นหนึ่ง โดยมี <w:proofErr> คั่นกลาง — regex บน XML
# ดิบจึงหาไม่เจอ ต้องต่อข้อความของทุก <w:t> ในไฟล์เข้าด้วยกันก่อน แล้วค่อยแทนที่และเขียนกลับ
# ช่องที่ฉบับนี้ยังไม่ได้ทำเครื่องหมายไว้ แต่ฉบับที่ใช้อยู่มี — ถ้าไม่เติมกลับ เอกสารใหม่จะถอยหลัง
# (ข้อความค้นหาเป็นข้อความที่ต่อกันแล้วจากทุก <w:t> จึงไม่มีอักขระ tab ปนอยู่)
GAP_FILLS = [
    # วันที่ทำข้อตกลง — เดิมเป็นเส้นประกับ tab ไม่มีแท็ก
    (
        "เมื่อวันที่       .เดือน .พ.ศ.  ณ ",
        "เมื่อวันที่ {{agreement.day}} เดือน {{agreement.month}} พ.ศ. {{agreement.year}} ณ ",
    ),
    # ชื่อระบบที่หน่วยงานลงทะเบียนไว้
    ("ลงทะเบียนไว้กับระบบ.....", "ลงทะเบียนไว้กับระบบ {{system.name}}"),
    # ต้นฉบับวาง <org_approver.firstname_th><org_approver.lastname_th> ติดกันไม่มีช่องว่าง
    # ค่าที่เติมจะกลายเป็น "ธนิทลุพ" ติดกันเป็นคำเดียว
    (
        "{{signatory.firstName}}{{signatory.lastName}}",
        "{{signatory.firstName}} {{signatory.lastName}}",
    ),
    # ตราเห็นชอบของสำนักงาน วางไว้บรรทัดเหนือบรรทัดลงนามในช่องของสำนักงาน
    # ({{bdi.endorsement}} คืนค่าที่ลงท้ายด้วยการขึ้นบรรทัดใหม่ และว่างจนกว่าจะอนุมัติ)
    ("ลงนาม  {{bdi.firstName}}", "{{bdi.endorsement}}ลงนาม  {{bdi.firstName}}"),
]

TEXT_NODE = re.compile(r"(<w:t(?: [^>]*)?>)(.*?)(</w:t>)", re.S)
TAG = re.compile(r"&lt;\s*([A-Za-z0-9_.]+)\s*&gt;")
HIGHLIGHT = re.compile(r"<w:highlight w:val=\"[^\"]*\"/>")
TODO_RED = re.compile(r"<w:color w:val=\"FF0000\"(?: [^>]*)?/>")


def convert(xml: str) -> tuple[str, dict[str, int], list[str]]:
    """แทนที่แท็กที่อาจถูกผ่าข้าม <w:t> หลายชิ้น

    ผลลัพธ์ทั้งก้อนลงใน <w:t> ชิ้นแรกที่แท็กนั้นแตะ ชิ้นที่เหลือถูกล้างเป็นค่าว่าง —
    รูปแบบตัวอักษรของชิ้นแรกจึงเป็นรูปแบบของค่าที่เติมเข้าไป
    """
    nodes = [(m.start(2), m.end(2), m.group(2)) for m in TEXT_NODE.finditer(xml)]
    joined = "".join(n[2] for n in nodes)

    # ตำแหน่งใน joined -> ดัชนีของ node
    spans: list[tuple[int, int, int]] = []
    pos = 0
    for i, (_s, _e, text) in enumerate(nodes):
        spans.append((pos, pos + len(text), i))
        pos += len(text)

    counts: dict[str, int] = {}
    unknown: list[str] = []
    seen: dict[str, int] = {}
    edits: list[tuple[int, int, str]] = []  # (node index, ตำแหน่งเริ่มในข้อความของ node, ...)

    replacements: dict[int, str] = {}  # node index -> ข้อความใหม่
    for m in TAG.finditer(joined):
        name = m.group(1)
        if name in ORDERED_TAGS:
            order = ORDERED_TAGS[name]
            i = seen.get(name, 0)
            seen[name] = i + 1
            target = order[i] if i < len(order) else order[-1]
        elif name in TAG_MAP:
            target = TAG_MAP[name]
        else:
            unknown.append(name)
            continue
        counts[target] = counts.get(target, 0) + 1

        touched = [sp for sp in spans if sp[1] > m.start() and sp[0] < m.end()]
        for k, (n_start, n_end, idx) in enumerate(touched):
            text = replacements.get(idx, nodes[idx][2])
            head = text[: max(0, m.start() - n_start)]
            tail = text[max(0, m.end() - n_start) :] if n_end > m.end() else ""
            replacements[idx] = head + ("{{" + target + "}}" if k == 0 else "") + tail

    if not replacements:
        return xml, counts, unknown

    out = xml
    for idx in sorted(replacements, reverse=True):
        start, end, _ = nodes[idx]
        out = out[:start] + replacements[idx] + out[end:]
    # ข้อความที่ถูกล้างจนว่างต้องคง xml:space ไว้ ไม่งั้น Word ตัดช่องว่างรอบ ๆ ทิ้ง
    return out, counts, unknown


def fill_gaps(xml: str) -> list[str]:
    """เติม placeholder ที่ฉบับนี้ยังไม่มี — คืนรายการที่เติมสำเร็จ"""
    applied: list[str] = []
    for old, new in GAP_FILLS:
        result, ok = splice(xml, old, new)
        if ok:
            xml = result
            applied.append(new)
    return xml, applied


PARAGRAPH = re.compile(r"<w:p(?: [^>]*)?>.*?</w:p>", re.S)
TAB = re.compile(r"<w:tab/>")
DECORATION = re.compile(r"^[\s.\u00a0]*\.[\s.\u00a0]*$")


def tidy(xml: str) -> int:
    """เก็บกวาดเส้นประที่เคยใช้วาดช่องว่าง ในย่อหน้าที่มี placeholder แล้ว

    ช่องกรอกในต้นฉบับวาดด้วย tab stop กับจุด เมื่อแทนที่ด้วย placeholder แล้ว ของเดิม
    ยังอยู่และจะ render ออกมาเป็นช่องว่างกว้าง ๆ กับจุดลอย ๆ คั่นระหว่างค่าที่เติม
    เช่น "ตั้งอยู่เลขที่ 578    . ถนน" — ทำให้เอกสารฉบับจริงอ่านเหมือนแบบฟอร์มที่ยังไม่กรอก

    แตะเฉพาะย่อหน้าที่มี placeholder และเฉพาะ run ที่มีแต่ช่องว่างกับจุด ซึ่งในย่อหน้าพวกนั้น
    เป็นเส้นประของช่องกรอกทั้งหมด
    """
    cleaned = 0

    def fix(m: re.Match[str]) -> str:
        nonlocal cleaned
        para = m.group(0)
        if "{{" not in para:
            return para
        before = para
        para = TAB.sub("", para)

        def node(t: re.Match[str]) -> str:
            text = t.group(2)
            if text and DECORATION.match(text):
                return t.group(1) + " " + t.group(3)
            return t.group(0)

        para = TEXT_NODE.sub(node, para)
        if para != before:
            cleaned += 1
        return para

    return PARAGRAPH.sub(fix, xml), cleaned


def splice(xml: str, old: str, new: str) -> tuple[str, bool]:
    """แทนที่ข้อความที่อาจถูกผ่าข้าม <w:t> หลายชิ้น (กลไกเดียวกับ convert)"""
    nodes = [(m.start(2), m.end(2), m.group(2)) for m in TEXT_NODE.finditer(xml)]
    joined = "".join(n[2] for n in nodes)
    at = joined.find(old)
    if at < 0:
        return xml, False
    end = at + len(old)

    spans, pos = [], 0
    for i, (_s, _e, text) in enumerate(nodes):
        spans.append((pos, pos + len(text), i))
        pos += len(text)

    replacements: dict[int, str] = {}
    touched = [sp for sp in spans if sp[1] > at and sp[0] < end]
    for k, (n_start, n_end, idx) in enumerate(touched):
        text = nodes[idx][2]
        head = text[: max(0, at - n_start)]
        tail = text[max(0, end - n_start) :] if n_end > end else ""
        replacements[idx] = head + (new if k == 0 else "") + tail

    out = xml
    for idx in sorted(replacements, reverse=True):
        start, stop, _ = nodes[idx]
        out = out[:start] + replacements[idx] + out[stop:]
    return out, True


def main() -> None:
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    src, out = Path(sys.argv[1]), Path(sys.argv[2])

    with zipfile.ZipFile(src) as zin:
        names = zin.namelist()
        blobs = {n: zin.read(n) for n in names}

    total: dict[str, int] = {}
    unknown: list[str] = []
    for name in names:
        if not re.match(r"^word/(document|header\d*|footer\d*)\.xml$", name):
            continue
        xml = blobs[name].decode("utf-8")
        xml, counts, missing = convert(xml)
        if name == "word/document.xml":
            xml, filled = fill_gaps(xml)
            for f in filled:
                print(f"  เติมช่องที่ยังไม่มีแท็ก: {f[:70]}")
        xml, cleaned = tidy(xml)
        if cleaned:
            print(f"  เก็บกวาดเส้นประในย่อหน้าที่มี placeholder: {cleaned} ย่อหน้า")
        xml = TODO_RED.sub("", HIGHLIGHT.sub("", xml))
        blobs[name] = xml.encode("utf-8")
        for k, v in counts.items():
            total[k] = total.get(k, 0) + v
        unknown += missing

    if unknown:
        sys.exit(
            "แท็กที่ยังไม่มีปลายทางใน TAG_MAP: "
            + ", ".join(sorted(set(unknown)))
            + "\nเพิ่มลง TAG_MAP (และเพิ่มตัวแปรในระบบถ้ายังไม่มี) ก่อนแปลง"
        )

    out.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as zout:
        for n in names:
            zout.writestr(n, blobs[n])

    print(f"เขียน {out}")
    for k in sorted(total):
        print(f"  {{{{{k}}}}} x{total[k]}")


if __name__ == "__main__":
    main()
