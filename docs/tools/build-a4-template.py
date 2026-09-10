#!/usr/bin/env python3
"""ทำ template A4 (แบบนำส่งข้อมูล) ที่ระบบเติมข้อมูลได้ จากไฟล์ต้นฉบับของฝ่ายกฎหมาย

ต้นฉบับเป็นแบบฟอร์มกระดาษ: ตัวเลือกแต่ละข้อเป็น bullet `o` ของ Word และช่องกรอกเป็น
เส้นประกับคำว่า `text` / `number` สคริปต์นี้เปลี่ยนให้เป็น placeholder ที่ระบบรู้จัก

    python3 docs/tools/build-a4-template.py <ต้นฉบับ.docx> <ปลายทาง.docx>

**ช่องติ๊ก** ตัวเลือกทุกข้อยังพิมพ์ออกมาครบ ข้อที่ตรงกับข้อมูลในคำขอจะได้เครื่องหมายถูก
ข้อที่ไม่ตรงได้วงกลมว่าง (ผู้อ่านจึงเห็นด้วยว่าตัวเลือกอื่นมีอะไร ไม่ใช่เห็นแต่ข้อที่เลือก)
bullet เดิมถูกถอดออกเพราะจะกลายเป็นสองเครื่องหมายซ้อนกัน

*ตัวอักษร*ที่ใช้เป็นเครื่องหมายเป็นเรื่องของ backend (`lib/dataset-values.ts`) เปลี่ยนตัวอักษร
จึงไม่ต้องสร้าง template ใหม่ — แต่ **ฟอนต์กับขนาดของมันเป็นเรื่องของที่นี่**

สคริปต์วางเครื่องหมายไว้ใน `<w:r>` ของตัวเอง ที่ระบุ DejaVu Sans และขนาดตายตัว ไม่ปล่อยให้
มันไปอยู่ใน run ของข้อความตัวเลือก: ต้นฉบับตั้งฟอนต์ไว้ไม่เหมือนกันทุกบรรทัด พอ TH SarabunPSK
ไม่มี glyph ของวงกลม fontconfig ก็เลือกฟอนต์แทนคนละตัวในแต่ละบรรทัด — บางบรรทัดได้ Tahoma
บางบรรทัดได้ DejaVu Sans **วงกลมจึงโตไม่เท่ากันทั้งหน้า** (BDI แจ้ง 2026-09-10 · `pdffonts`
บน PDF ที่ออกมาลิสต์ทั้งสองฟอนต์จริง) ระบุฟอนต์เองที่ run นี้ที่เดียวก็หมดปัญหา โดยไม่ไปแตะ
ฟอนต์ของข้อความที่ฝ่ายกฎหมายจัดไว้

**ลบไฮไลต์เหลืองที่ใช้ทำเครื่องหมายช่องกรอกตอนร่าง** (BDI ขอเมื่อ 2026-09-10) — กลับคำ
ตัดสินเมื่อ 2026-08-20 ที่ให้คงไฟล์ไว้ตามที่ร่างมา ค่าที่ระบบเติมเข้าไปมีแถบเหลืองคาดอยู่ใน
เอกสารที่หน่วยงานต้องลงนาม ซึ่งอ่านเหมือนแบบฟอร์มที่ยังทำไม่เสร็จ

รหัสในชื่อ placeholder คือรหัสที่เก็บในฐานข้อมูลจริง (`lib/dataset.ts`) ไม่ใช่ข้อความบนฟอร์ม
ลำดับตัวเลือกในเอกสารกับในรหัสไม่ตรงกันทุกข้อ เช่น ข้อ 10 เอกสารเรียง "อื่น ๆ" ก่อน "ไม่ทราบ"
แต่รหัสคือ 99 กับ 98 จึงจับคู่ตามตำแหน่งในตารางนี้ ไม่ใช่ตามข้อความ
"""
import re
import sys
import zipfile
from pathlib import Path

# ── ช่องติ๊ก: ดัชนีย่อหน้า -> (ชื่อฟิลด์, รหัส) ────────────────────────────
TICKS: dict[int, tuple[str, str]] = {}


def group(start: int, field: str, codes: list[str]) -> None:
    for offset, code in enumerate(codes):
        TICKS[start + offset] = (field, code)


group(5, "dataType", ["1", "2", "3", "9"])
group(10, "dataTopic", ["01", "02", "03", "04", "05", "06", "07", "99"])
group(32, "updateFrequencyUnit",
      ["A", "S", "Q", "M", "W", "D", "B", "H", "N", "R", "O", "U"])
group(46, "deliveryFrequency", ["1", "2", "3", "4", "5"])
group(52, "geoCoverage",
      ["00", "01", "02", "03", "04", "05", "06", "07", "08", "09", "10", "11", "98", "99"])
group(68, "dataFormat", ["1", "2", "3", "4"])
group(74, "dataCategory", ["a", "b", "c", "d"])
group(79, "containsPersonalData", ["true", "false"])
group(86, "personalDataProcessingPeriod", ["a", "b"])
group(89, "dataClassification", ["01", "02", "03", "04", "05"])
group(95, "licenseId", ["G0", "G2", "G5"])
group(100, "allowOriginalRawDataRetention", ["true", "false"])
group(103, "allowOriginalRawDataSharing", ["true", "false"])
# 16.1 มีบรรทัด "ระบุระบบเชื่อมโยงข้อมูลที่อนุญาต" คั่นระหว่าง อนุญาต กับ ไม่อนุญาต
# สองตัวเลือกจึงไม่ติดกัน — group() ใช้ไม่ได้ ต้องเขียนทีละข้อ
TICKS[107] = ("allowTransformedRawDataSharing", "true")
TICKS[109] = ("allowTransformedRawDataSharing", "false")
group(111, "allowTransformedRawDataGdxSharing", ["true", "false"])
group(114, "allowAggregatedDataSharing", ["true", "false"])
group(117, "authorizePersonalDataAnonymization", ["true", "false"])

# ── ย่อหน้าที่เป็น bullet ในต้นฉบับแต่ **ไม่ใช่ตัวเลือก** ───────────────────
#
# ข้อ 16.1 มีบรรทัด "ระบุระบบเชื่อมโยงข้อมูลที่อนุญาต…" อยู่ใต้ตัวเลือก "อนุญาต" และถูกจัดเป็น
# bullet ระดับเดียวกัน ถ้าปล่อยไว้ วงกลมหน้าบรรทัดจะอ่านเป็นตัวเลือกที่สาม ทั้งที่เป็นช่องกรอก
DEBULLET: set[int] = {108}

# ── ช่องกรอก: ดัชนีย่อหน้า -> (ข้อความเดิมที่ต้องแทน, placeholder) ─────────
# ข้อความเดิมคือเครื่องหมายช่องกรอกบนกระดาษ (เส้นประ / คำว่า text / number)
FIELDS: list[tuple[int, str, str]] = [
    (17, "WHOLE", "อื่น ๆ {{dataset.dataTopicOther}}"),
    (20, "DOTS", "{{dataset.title}}"),
    (22, "DOTS", "{{dataset.nameEn}}"),
    (23, "MARKER", "{{dataset.dataFields}}"),
    (24, "WHOLE", "องค์กร {{org.name}}"),
    (25, "MARKER", "{{dataset.maintainer}}"),
    (26, "MARKER", "{{dataset.maintainerEmail}}"),
    (27, "MARKER", "{{dataset.tags}}"),
    (28, "MARKER", "{{dataset.notes}}"),
    (29, "MARKER", "{{dataset.objective}}"),
    (44, "MARKER", "{{dataset.updateFrequencyInterval}}"),
    (65, "WHOLE", "อื่น ๆ {{dataset.geoCoverageOther}}"),
    (66, "MARKER", "{{dataset.dataSource}}"),
    (71, "ANGLE", "{{dataset.dataFormatOther}}"),
    (82, "MARKER", "{{dataset.personalDataTypes}}"),
    (84, "MARKER", "{{dataset.dataSubjectCategories}}"),
    (87, "WHOLE", "อื่น ๆ ระบุ ระยะเวลา "
                  "{{dataset.personalDataPeriodYear}} ปี {{dataset.personalDataPeriodMonth}} เดือน"),
    (108, "MARKER", "{{dataset.transformedSharingPlatforms}}"),
    # ── ท้ายเอกสาร — ชุด 2026-09-09 เพิ่มบล็อกนี้เข้ามา ฉบับ 2026-08-12 ไม่มี ──
    (122, "TAIL", " {{org.name}}"),
    (124, "DOTS", "{{org_approver.signature}}"),
    (125, "DOTS", "{{org_approver.signedDate}}"),
    (128, "DOTS", "{{printedBy}}"),
    (129, "DOTS", "{{printedDateTime}}"),
    (130, "DOTS", "{{document.version}}"),
    (131, "DOTS", "{{document.effectiveDate}}"),
]

# เครื่องหมายอยู่ใน run ของตัวเอง ฟอนต์และขนาดตายตัว — ดูเหตุผลในหัวไฟล์
# 28 = 14pt ครึ่งพอยต์ตามที่ Word นับ ซึ่งพอดีกับข้อความตัวเลือกที่ตั้งไว้ 32 (16pt)
# วงกลมของ DejaVu Sans สูงกว่าตัวอักษรไทยที่ขนาดเท่ากัน
TICK_RUN = (
    "<w:r><w:rPr>"
    '<w:rFonts w:ascii="DejaVu Sans" w:hAnsi="DejaVu Sans" w:cs="DejaVu Sans"/>'
    '<w:sz w:val="28"/><w:szCs w:val="28"/>'
    "</w:rPr>"
    '<w:t xml:space="preserve">{mark} </w:t></w:r>'
)

PARAGRAPH = re.compile(r"<w:p(?: [^>]*)?>.*?</w:p>", re.S)
TEXT_NODE = re.compile(r"(<w:t(?: [^>]*)?>)(.*?)(</w:t>)", re.S)
NUMPR = re.compile(r"<w:numPr>.*?</w:numPr>", re.S)
PPR = re.compile(r"(<w:pPr>)(.*?)(</w:pPr>)", re.S)
DOTS = re.compile(r"[.…\s]{6,}")
MARKER = re.compile(r"[….\s]*(?:text|number)[….\s]*", re.I)
ANGLE = re.compile(r"[.…]*&lt;[^&]*&gt;[.…]*")


def paragraph_text(seg: str) -> str:
    return "".join(m.group(2) for m in TEXT_NODE.finditer(seg))


def set_text(seg: str, new_full: str) -> str:
    """เขียนข้อความทั้งย่อหน้าใหม่ลงใน <w:t> ชิ้นแรก แล้วล้างชิ้นที่เหลือ"""
    first = True

    def sub(m: re.Match[str]) -> str:
        nonlocal first
        if first:
            first = False
            return '<w:t xml:space="preserve">' + new_full + "</w:t>"
        return '<w:t xml:space="preserve"></w:t>'

    out, n = TEXT_NODE.subn(sub, seg)
    return out if n else seg


HIGHLIGHT = re.compile(r'<w:highlight w:val="[^"]*"/>')


def debullet(seg: str) -> str:
    """ถอด bullet ของ Word ออก โดยคงระยะย่อหน้าที่ bullet เคยให้ไว้"""
    seg = NUMPR.sub("", seg)
    # ไม่มี numPr แล้ว ระยะย่อหน้าจะยุบไปชิดขอบ — ตั้ง indent ให้เท่าที่ bullet เคยให้
    if "<w:ind " not in seg:
        seg = PPR.sub(lambda m: m.group(1) + m.group(2) + '<w:ind w:left="1440"/>' + m.group(3), seg, count=1)
    return seg


def tick(seg: str, field: str, code: str) -> str:
    """แทรก run ของเครื่องหมายไว้หน้าสุดของย่อหน้า และถอด bullet ของ Word ออก

    **แทรกเป็น run ใหม่ ไม่ใช่เติมข้อความเข้าไปใน run เดิม** — run เดิมเป็นของข้อความ
    ตัวเลือกซึ่งฝ่ายกฎหมายตั้งฟอนต์ไว้ไม่เหมือนกันทุกบรรทัด ถ้าเครื่องหมายไปอาศัยอยู่ในนั้น
    ขนาดที่ออกมาจะไม่เท่ากันทั้งหน้า (ดูหัวไฟล์)
    """
    seg = debullet(seg)
    run = TICK_RUN.format(mark="{{tick." + field + "." + code + "}}")
    # หลัง </w:pPr> ถ้ามี ไม่งั้นหลังแท็กเปิดย่อหน้า — run ต้องมาหลัง pPr เสมอตามสคีมา
    close = seg.find("</w:pPr>")
    if close != -1:
        at = close + len("</w:pPr>")
    else:
        at = seg.index(">") + 1
    return seg[:at] + run + seg[at:]


def field(seg: str, kind: str, replacement: str) -> str:
    text = paragraph_text(seg)
    if kind == "DOTS":
        # เส้นประกินช่องว่างหน้ามันไปด้วย ถ้าแทนตรง ๆ ค่าจะไปติดกับป้าย เช่น
        # "วันที่นำส่ง22 สิงหาคม 2569" — คืนช่องว่างหนึ่งช่องเสมอ
        new = DOTS.sub(" " + replacement, text, count=1) if DOTS.search(text) else text + " " + replacement
    elif kind == "MARKER":
        new = MARKER.sub(" " + replacement, text, count=1) if MARKER.search(text) else text + " " + replacement
    elif kind == "ANGLE":
        new = ANGLE.sub(" " + replacement, text, count=1) if ANGLE.search(text) else text + " " + replacement
    elif kind == "TAIL":
        new = text.rstrip() + replacement
    elif kind == "WHOLE":
        new = replacement
    else:
        raise SystemExit(f"ไม่รู้จักชนิดช่องกรอก {kind}")
    return set_text(seg, new)


def main() -> None:
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    src, out = Path(sys.argv[1]), Path(sys.argv[2])
    with zipfile.ZipFile(src) as zin:
        names = zin.namelist()
        blobs = {n: zin.read(n) for n in names}

    xml = blobs["word/document.xml"].decode("utf-8")
    paras = [(m.start(), m.end(), m.group(0)) for m in PARAGRAPH.finditer(xml)]
    edits: dict[int, str] = {}

    # **ช่องกรอกก่อน ช่องติ๊กทีหลัง** — `field()` เขียนข้อความทั้งย่อหน้าลง <w:t> ชิ้นแรก
    # ถ้าแทรก run ของเครื่องหมายไปก่อน มันจะกลายเป็นชิ้นแรกแล้วถูกเขียนทับ
    for idx, kind, replacement in FIELDS:
        edits[idx] = field(paras[idx][2], kind, replacement)

    for idx in DEBULLET:
        edits[idx] = debullet(edits.get(idx, paras[idx][2]))

    for idx, (field_name, code) in TICKS.items():
        if idx >= len(paras):
            sys.exit(f"ย่อหน้า {idx} ไม่มีในเอกสาร — โครงเอกสารเปลี่ยนไปจากที่ตารางนี้อ้างอิง")
        edits[idx] = tick(edits.get(idx, paras[idx][2]), field_name, code)

    for idx in sorted(edits, reverse=True):
        start, end, _ = paras[idx]
        xml = xml[:start] + edits[idx] + xml[end:]

    # ไฮไลต์เหลืองที่ใช้ทำเครื่องหมายช่องกรอกตอนร่าง — ลบทั้งไฟล์ ไม่ใช่เฉพาะย่อหน้าที่แก้
    # เพราะฝ่ายกฎหมายทาไว้คร่อมทั้งบรรทัดบ้าง ทั้งหัวข้อบ้าง (BDI ขอเมื่อ 2026-09-10)
    xml, highlights = HIGHLIGHT.subn("", xml)

    blobs["word/document.xml"] = xml.encode("utf-8")
    out.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as zout:
        for n in names:
            zout.writestr(n, blobs[n])

    ph = sorted(set(re.findall(r"\{\{([^}]+)\}\}", xml)))
    print(f"เขียน {out}")
    print(f"  ช่องติ๊ก {len(TICKS)} ช่อง · ช่องกรอก {len(FIELDS)} ช่อง · placeholder ทั้งหมด {len(ph)}")
    print(f"  ลบไฮไลต์ {highlights} จุด")


if __name__ == "__main__":
    main()
