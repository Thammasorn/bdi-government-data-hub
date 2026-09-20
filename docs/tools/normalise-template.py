#!/usr/bin/env python3
"""ทำ template ที่ฝ่ายกฎหมาย **แก้ต่อจากฉบับที่ระบบใช้อยู่** ให้กลับมาเป็นรูปที่ระบบต้องการ

    python3 docs/tools/normalise-template.py <ไฟล์ที่ได้มา.docx> <ปลายทาง.docx>

ใช้กับ A4 เป็นหลัก แต่ใช้กับ A0 ได้ด้วย — เอกสารที่ไม่มีบรรทัดตัวเลือกจะโดนแค่ขั้นลบไฮไลต์
(ชุด 2026-09-20 ฝ่ายกฎหมายทาไฮไลต์ไว้ที่ `{{system.name}}` ใน A0 เพื่อบอกว่าแก้ตรงนั้น)

`build-a4-template.py` รับแบบฟอร์มเปล่า (bullet `o` กับเส้นประ) แล้วใส่ placeholder ให้ตาม
ตารางดัชนีย่อหน้า ชุด 2026-09-20 มาคนละแบบ: ฝ่ายกฎหมายเปิด `docs/A4-template.docx` ที่ระบบ
ใช้อยู่ แล้วพิมพ์ `{{tick.objective.01}} ยุทธศาสตร์ชาติ` ฯลฯ เพิ่มเข้าไปเองใน Word
placeholder จึงครบอยู่แล้ว แต่สิ่งที่ Word ทำให้โดยไม่มีใครตั้งใจต้องแก้กลับ:

- **เครื่องหมายไม่ได้อยู่ใน run ของตัวเอง** บรรทัดใหม่พิมพ์ `{{tick…}}` ปนไปกับข้อความตัวเลือก
  ใน TH SarabunPSK ซึ่งไม่มี glyph ของ ○ — fontconfig จะเลือกฟอนต์แทนให้ทีละบรรทัด และ
  วงกลมจะโตไม่เท่ากันทั้งหน้า (BDI แจ้งเมื่อ 2026-09-10) กติกาเดิมคือเครื่องหมายอยู่ใน
  `<w:r>` ของตัวเองที่ระบุ DejaVu Sans 14pt — ดูหัวไฟล์ build-a4-template.py
- **บางบรรทัดพิมพ์ต่อท้าย run ของเครื่องหมาย** ข้อความไทยจึงไปอยู่ใน DejaVu Sans 14pt
  แทน TH SarabunPSK 16pt (ข้อ 12.1 ตัวเลือกที่ 2 ในไฟล์ที่ได้มา)
- **ย่อหน้าใหม่ย่อหน้าไม่เท่ากับรายการตัวเลือกอื่น** (`ind left=720 firstLine=720` แทน
  style ListParagraph + `left=1440`) รายการวัตถุประสงค์จึงเยื้องต่างจากรายการข้ออื่น
- **ไฮไลต์เหลือง** ที่ใช้ทำเครื่องหมายบรรทัดที่เพิ่มตอนร่าง — ลบทั้งไฟล์เหมือนสคริปต์เดิม

วิธีคือ *ทุกย่อหน้าที่ขึ้นต้นด้วย `{{tick.<ช่อง>.<รหัส>}}`* ถูกเขียนใหม่เป็นรูปเดียวกันหมด:
pPr ของรายการตัวเลือก + run ของเครื่องหมาย + run เดียวของข้อความที่เหลือใน TH SarabunPSK 16pt
ย่อหน้าที่ไม่ใช่ตัวเลือกไม่แตะ นอกจากลบไฮไลต์ — ถ้อยคำ ช่องว่าง และ `…` ที่ฝ่ายกฎหมาย
วางไว้รอบช่องกรอก (`…{{dataset.objectiveOther}}…`) จึงอยู่ครบตามที่เขาต้องการให้พิมพ์ออกมา

ไม่ใช้ดัชนีย่อหน้า ต่างจาก build-a4-template.py — ที่นั่นต้องจับคู่ตำแหน่งกับชื่อฟิลด์ ที่นี่
ชื่อฟิลด์อยู่ในเอกสารแล้ว โครงเอกสารเปลี่ยนก็ยังใช้ได้โดยไม่ต้องไล่ตารางใหม่
"""
import re
import sys
import zipfile
from pathlib import Path

PARAGRAPH = re.compile(r"<w:p(?: [^>]*)?>.*?</w:p>", re.S)
TEXT_NODE = re.compile(r"(<w:t(?: [^>]*)?>)(.*?)(</w:t>)", re.S)
PPR = re.compile(r"<w:pPr>.*?</w:pPr>", re.S)
HIGHLIGHT = re.compile(r'<w:highlight w:val="[^"]*"/>')
TICK_PREFIX = re.compile(r"^\s*(\{\{tick\.[A-Za-z0-9_]+\.[A-Za-z0-9_]+\}\})\s*")

# pPr ของรายการตัวเลือก — ตัวเดียวกับที่ build-a4-template.py ทิ้งไว้ในทุกบรรทัดตัวเลือก
# (ListParagraph ย่อ 1440 twip · ฟอนต์และขนาดตั้งไว้ที่ระดับย่อหน้าด้วยเพื่อ paragraph mark)
OPTION_PPR = (
    "<w:pPr>"
    '<w:pStyle w:val="ListParagraph"/>'
    '<w:ind w:left="1440"/>'
    "<w:rPr>"
    '<w:rFonts w:ascii="TH SarabunPSK" w:eastAsia="TH Sarabun PSK" w:hAnsi="TH SarabunPSK" w:cs="TH SarabunPSK"/>'
    '<w:color w:val="000000" w:themeColor="text1"/>'
    '<w:sz w:val="32"/><w:szCs w:val="32"/>'
    "</w:rPr>"
    "</w:pPr>"
)

# เครื่องหมายอยู่ใน run ของตัวเอง ฟอนต์และขนาดตายตัว — เหตุผลอยู่ในหัวไฟล์ build-a4-template.py
TICK_RUN = (
    "<w:r><w:rPr>"
    '<w:rFonts w:ascii="DejaVu Sans" w:hAnsi="DejaVu Sans" w:cs="DejaVu Sans"/>'
    '<w:sz w:val="28"/><w:szCs w:val="28"/>'
    "</w:rPr>"
    '<w:t xml:space="preserve">{mark} </w:t></w:r>'
)

# ข้อความตัวเลือก — ฟอนต์เดียวกับที่ฝ่ายกฎหมายตั้งไว้กับทุกบรรทัดตัวเลือกในฉบับ 2026-09-09
TEXT_RUN = (
    "<w:r><w:rPr>"
    '<w:rFonts w:ascii="TH SarabunPSK" w:eastAsia="TH Sarabun PSK" w:hAnsi="TH SarabunPSK" w:cs="TH SarabunPSK"/>'
    '<w:color w:val="000000" w:themeColor="text1"/>'
    '<w:sz w:val="32"/><w:szCs w:val="32"/>'
    "</w:rPr>"
    '<w:t xml:space="preserve">{text}</w:t></w:r>'
)


def paragraph_text(seg: str) -> str:
    """ข้อความของย่อหน้าตามที่อยู่ใน XML (ยัง escape อยู่) ต่อกันไม่ว่า Word จะผ่าเป็นกี่ run"""
    return "".join(m.group(2) for m in TEXT_NODE.finditer(seg))


def rebuild_option(seg: str, mark: str, rest: str) -> str:
    """เขียนย่อหน้าตัวเลือกใหม่ทั้งย่อหน้า — เก็บไว้แค่แท็กเปิดของ <w:p>"""
    open_tag = seg[: seg.index(">") + 1]
    return open_tag + OPTION_PPR + TICK_RUN.format(mark=mark) + TEXT_RUN.format(text=rest) + "</w:p>"


def main() -> None:
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    src, out = Path(sys.argv[1]), Path(sys.argv[2])
    with zipfile.ZipFile(src) as zin:
        names = zin.namelist()
        blobs = {n: zin.read(n) for n in names}

    xml = blobs["word/document.xml"].decode("utf-8")
    options = 0

    def visit(m: re.Match[str]) -> str:
        nonlocal options
        seg = m.group(0)
        text = paragraph_text(seg)
        prefix = TICK_PREFIX.match(text)
        if not prefix:
            return seg
        options += 1
        rest = text[prefix.end():]
        return rebuild_option(seg, prefix.group(1), rest)

    xml = PARAGRAPH.sub(visit, xml)
    xml, highlights = HIGHLIGHT.subn("", xml)

    blobs["word/document.xml"] = xml.encode("utf-8")
    out.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as zout:
        for n in names:
            zout.writestr(n, blobs[n])

    ph = sorted(set(re.findall(r"\{\{([^}]+)\}\}", "".join(
        paragraph_text(p.group(0)) for p in PARAGRAPH.finditer(xml)
    ))))
    ticks = [p for p in ph if p.startswith("tick.")]
    print(f"เขียน {out}")
    print(f"  ย่อหน้าตัวเลือกที่เขียนใหม่ {options} · ช่องติ๊ก {len(ticks)} · placeholder ทั้งหมด {len(ph)}")
    print(f"  ลบไฮไลต์ {highlights} จุด")


if __name__ == "__main__":
    main()
