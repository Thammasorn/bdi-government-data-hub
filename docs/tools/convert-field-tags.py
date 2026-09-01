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
* **เก็บกวาดเส้นประกับจุดไข่ปลา** ที่เคยใช้วาดช่องว่าง ในย่อหน้าที่มี placeholder แล้ว
  ไม่งั้นเอกสารฉบับจริงจะอ่านเหมือนแบบฟอร์มที่ยังไม่ได้กรอก (`ตั้งอยู่เลขที่ ...578...`)

รองรับแท็กสองรูปแบบ: `<organization.name_th>` แบบเดิม และ
`<(bdi_approver) signature_confirmation.confirmed_at>` ที่ระบุฝ่ายไว้ในวงเล็บ ซึ่งชุด
2026-08-31 เริ่มใช้ — แบบหลังไม่ต้องเดาจากลำดับซ้าย-ขวาในหน้ากระดาษว่าช่องไหนของใคร
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
    "org_approver.firstname_th": "org_approver.firstName",
    "org_approver.lastname_th": "org_approver.lastName",
    "org_approver.position_th": "org_approver.position",
    "bdi_approver.firstname_th": "bdi_approver.firstName",
    "bdi_approver.lastname_th": "bdi_approver.lastName",
    "user.firstname_th": "org_officer.firstName",
    "user.lastname_th": "org_officer.lastName",
    "download_datetime": "printedDateTime",
    "legal_document_version.version_number": "document.version",
    "legal_document_version.effective_at": "document.effectiveDate",
}

# แท็กที่ฝ่ายกฎหมายระบุ**ฝ่าย**ไว้ในวงเล็บนำหน้า เช่น
# `<(bdi_approver) signature_confirmation.confirmed_at>` — ชุด 2026-08-31 เริ่มเขียนแบบนี้
# ซึ่งดีกว่า ORDERED_TAGS ข้างล่างตรงที่ไม่ต้องเดาจากลำดับซ้าย-ขวาในเอกสาร
QUALIFIED_TAGS = {
    ("bdi_approver", "signature_confirmation.confirmed_at"): "bdi_approver.signedDate",
    ("org_approver", "signature_confirmation.confirmed_at"): "org_approver.signedDate",
}

# `signature_confirmation.confirmed_at` ปรากฏสองที่ และเป็นวันที่ลงนามของ**คนละฝ่าย**
# ช่องซ้ายคือสำนักงาน ช่องขวาคือหน่วยงาน จึงแปลงตามลำดับที่พบ ไม่ใช่ค่าเดียวกันทั้งสองที่
ORDERED_TAGS = {
    "signature_confirmation.confirmed_at": ["bdi_approver.signedDate", "org_approver.signedDate"],
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
        "{{org_approver.firstName}}{{org_approver.lastName}}",
        "{{org_approver.firstName}} {{org_approver.lastName}}",
    ),
    # ตราเห็นชอบของสำนักงาน วางไว้บรรทัดเหนือบรรทัดลงนามในช่องของสำนักงาน
    # ({{bdi_approver.endorsement}} คืนค่าที่ลงท้ายด้วยการขึ้นบรรทัดใหม่ และว่างจนกว่าจะอนุมัติ)
    #
    # สองบรรทัด เพราะช่องว่างหน้าชื่อไม่เท่ากันในแต่ละชุดที่ได้รับมา ชุด 2026-08-12 เขียน
    # "ลงนาม  <ชื่อ>" (สองช่องว่าง) ชุด 2026-08-31 เขียน "ลงนาม ...<ชื่อ>" — อันที่ไม่ตรง
    # จะไม่ทำอะไรเลย (splice คืนค่าเดิมเมื่อหาไม่เจอ) สคริปต์จึงยังแปลงได้ทั้งสองชุด
    ("ลงนาม  {{bdi_approver.firstName}}", "{{bdi_approver.endorsement}}ลงนาม  {{bdi_approver.firstName}}"),
    ("ลงนาม ...{{bdi_approver.firstName}}", "{{bdi_approver.endorsement}}ลงนาม ...{{bdi_approver.firstName}}"),
]

TEXT_NODE = re.compile(r"(<w:t(?: [^>]*)?>)(.*?)(</w:t>)", re.S)
TAG = re.compile(r"&lt;\s*(?:\(([A-Za-z0-9_]+)\)\s*)?([A-Za-z0-9_.]+)\s*&gt;")
# อะไรก็ตามที่ "หน้าตาเหมือนแท็ก" — ใช้ตรวจของที่เหลือค้างหลังแปลง TAG ไม่ยอมรับ
# วงเล็บหรือช่องว่างกลางชื่อ ถ้าฝ่ายกฎหมายเขียนรูปแบบใหม่มาอีก มันจะหลุดเงียบ ๆ
# ทั้งที่เป็น `<...>` ที่ต้องแปลง — ตัวนี้จับไว้ให้สคริปต์ล้มแทน
TAG_SHAPED = re.compile(r"&lt;\s*[A-Za-z0-9_.()][A-Za-z0-9_.() ]*\s*&gt;")
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

    # เลือกปลายทางตามลำดับที่อ่านเจอ (ORDERED_TAGS อาศัยลำดับซ้าย-ขวา) ...
    resolved: list[tuple[re.Match[str], str]] = []
    for m in TAG.finditer(joined):
        qualifier, name = m.group(1), m.group(2)
        if qualifier is not None:
            # ฝ่ายถูกระบุมาแล้ว จึงไม่ต้องเดาจากลำดับ และคู่ที่ไม่รู้จักต้องล้ม
            # ไม่ใช่ตกไปที่ TAG_MAP ซึ่งจะแปลผิดฝ่ายเงียบ ๆ
            target = QUALIFIED_TAGS.get((qualifier, name))
            if target is None:
                unknown.append(f"({qualifier}) {name}")
                continue
        elif name in ORDERED_TAGS:
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
        resolved.append((m, target))

    # ... แต่ **เขียนกลับจากขวาไปซ้าย** ตำแหน่งของ match คิดจากข้อความก่อนแก้ ถ้าแก้
    # ตัวซ้ายก่อน ความยาวที่เปลี่ยนไปจะทำให้ตัวขวาที่อยู่ใน <w:t> ชิ้นเดียวกันถูกตัดผิดที่
    for m, target in reversed(resolved):
        touched = [sp for sp in spans if sp[1] > m.start() and sp[0] < m.end()]
        for k, (n_start, n_end, idx) in enumerate(touched):
            text = replacements.get(idx, nodes[idx][2])
            head = text[: max(0, m.start() - n_start)]
            tail = text[max(0, m.end() - n_start) :] if n_end > m.end() else ""
            replacements[idx] = head + ("{{" + target + "}}" if k == 0 else "") + tail

    out = xml
    for idx in sorted(replacements, reverse=True):
        start, end, _ = nodes[idx]
        out = out[:start] + replacements[idx] + out[end:]
    # ข้อความที่ถูกล้างจนว่างต้องคง xml:space ไว้ ไม่งั้น Word ตัดช่องว่างรอบ ๆ ทิ้ง

    # เหลือ `<...>` ที่หน้าตาเหมือนแท็กแต่ TAG อ่านไม่ออก (รูปแบบใหม่ที่ยังไม่รองรับ)
    # ต้องล้มเหมือนแท็กที่ไม่มีปลายทาง ไม่ใช่ปล่อยผ่านไปค้างในเอกสารที่ต้องลงนาม
    rest = "".join(m.group(2) for m in TEXT_NODE.finditer(out))
    unknown += [html.unescape(m.group(0)) for m in TAG_SHAPED.finditer(rest)]
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
# ชุด 2026-08-31 วาดช่องกรอกด้วยจุดไข่ปลาคร่อมแท็ก (`...<org.name>...`, `…<org.name>…`)
# บางชิ้นอยู่ใน run เดียวกับข้อความจริง เช่น "วันที่ ..." — ตัดเฉพาะจุด เหลือช่องว่างไว้หนึ่งช่อง
DOTS = re.compile(r"\s*(?:\.{2,}|\u2026+)\s*")


def preserve(open_tag: str) -> str:
    """บังคับ xml:space="preserve" ให้ <w:t> ที่กำลังจะถือข้อความมีช่องว่างหัวหรือท้าย

    ไม่งั้น Word และ LibreOffice ตัดช่องว่างนั้นทิ้ง แล้วค่าที่เติมจะไปติดกับคำข้างเคียง
    กลายเป็น "วันที่๑ กันยายน" หรือชื่อกับนามสกุลติดกันเป็นคำเดียว
    """
    if "xml:space" in open_tag:
        return open_tag
    return open_tag[:-1].rstrip() + ' xml:space="preserve">'


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
                return preserve(t.group(1)) + " " + t.group(3)
            stripped = DOTS.sub(" ", text)
            if stripped != text:
                return preserve(t.group(1)) + stripped + t.group(3)
            return t.group(0)

        para = TEXT_NODE.sub(node, para)

        # การตัดจุดทิ้งช่องว่างไว้ข้างละหนึ่ง ต่อกับช่องว่างที่ต้นฉบับมีอยู่แล้วจึงกลายเป็น
        # สองสามช่องคั่นระหว่างคำกับค่าที่เติม ยุบให้เหลือช่องเดียว โดยนับข้ามชิ้นด้วย —
        # ช่องว่างที่ซ้อนกันมักอยู่คนละ <w:t> (ชิ้นหนึ่งคือจุด อีกชิ้นคือข้อความ)
        space_before = False

        def squeeze(t: re.Match[str]) -> str:
            nonlocal space_before
            text = t.group(2)
            if not text:
                return t.group(0)
            out = re.sub(r" {2,}", " ", text)
            if space_before:
                out = out.lstrip(" ")
            if out:
                space_before = out.endswith(" ")
            return t.group(0) if out == text else preserve(t.group(1)) + out + t.group(3)

        para = TEXT_NODE.sub(squeeze, para)
        if para != before:
            cleaned += 1
        return para

    return PARAGRAPH.sub(fix, xml), cleaned


def splice(xml: str, old: str, new: str) -> tuple[str, bool]:
    """แทนที่ข้อความที่อาจถูกผ่าข้าม <w:t> หลายชิ้น (กลไกเดียวกับ convert)

    **ตัดหัวและท้ายที่เหมือนกันออกก่อน** แล้วค่อยแก้เฉพาะช่วงที่ต่างกันจริง สำคัญกับการ
    "แทรกข้อความข้างหน้า" อย่างตราเห็นชอบ: ถ้าไม่ตัด ทั้งช่วงจะถูกกวาดไปกองใน <w:t>
    ชิ้นแรก แล้วรูปแบบตัวอักษรของชิ้นที่เหลือหายไปด้วย — ช่องกรอกใน A0 ขีดเส้นใต้ไว้
    ชื่อผู้ลงนามจึงเสียเส้นใต้ไปครึ่งหนึ่ง (ชื่อไม่มี นามสกุลมี) ซึ่งเห็นได้ในเอกสารจริง
    """
    nodes = [(m.start(2), m.end(2), m.group(2)) for m in TEXT_NODE.finditer(xml)]
    joined = "".join(n[2] for n in nodes)
    at = joined.find(old)
    if at < 0:
        return xml, False
    end = at + len(old)

    head_len = 0
    while head_len < len(old) and head_len < len(new) and old[head_len] == new[head_len]:
        head_len += 1
    tail_len = 0
    while (
        tail_len < len(old) - head_len
        and tail_len < len(new) - head_len
        and old[len(old) - 1 - tail_len] == new[len(new) - 1 - tail_len]
    ):
        tail_len += 1
    at += head_len
    end -= tail_len
    new = new[head_len : len(new) - tail_len]

    spans, pos = [], 0
    for i, (_s, _e, text) in enumerate(nodes):
        spans.append((pos, pos + len(text), i))
        pos += len(text)

    replacements: dict[int, str] = {}
    touched = [sp for sp in spans if sp[1] > at and sp[0] < end]
    if not touched:
        # การแทรกล้วน ๆ (ช่วงที่ต่างกันยาวศูนย์) — ใส่ไว้ใน <w:t> ที่ครอบตำแหน่งนั้น
        # เลือกชิ้นที่ตำแหน่งตกอยู่ข้างใน ไม่ใช่ชิ้นก่อนหน้าที่บังเอิญจบพอดีที่นั่น
        # ข้อความที่แทรกจะได้รูปแบบของข้อความที่มันไปอยู่ข้างหน้า ซึ่งเป็นสิ่งที่ต้องการ
        spot = next((sp for sp in spans if sp[0] <= at < sp[1]), spans[-1])
        text = nodes[spot[2]][2]
        cut = max(0, at - spot[0])
        replacements[spot[2]] = text[:cut] + new + text[cut:]
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
