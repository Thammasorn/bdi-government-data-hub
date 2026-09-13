"""สร้าง `คู่มือเอกสารต้นแบบ` เป็น HTML หน้าเดียวที่ฝังฟอนต์กับภาพไว้ในตัว

    python3 docs/tools/build-template-manual.py \
        --data /tmp/vars.json \
        --images sit-evidence/document-template-manual-20260913 \
        --out docs/manuals-pdf/คู่มือ-เอกสารต้นแบบ-v1.0.html

แล้วพิมพ์เป็น PDF ด้วย `render-manual-pdf.py` (Chrome DevTools Protocol) — CSS `@media print`
ในไฟล์นี้เป็นตัวกำหนดขนาดหน้า A4 ขอบกระดาษ และการขึ้นหน้าใหม่ของแต่ละบท

**ตารางตัวแปรไม่ได้พิมพ์ด้วยมือ** มันมาจาก `TEMPLATE_VARIABLES` ในโค้ดโดยตรง ซึ่งเป็น
รายการเดียวกับที่ API ใช้ตรวจตอนอัปโหลด template คู่มือจึงไม่มีทางบอกชื่อที่ระบบไม่รู้จัก
ดึงออกมาเป็น JSON จาก checkout ที่รันอยู่:

    cat > /tmp/dumpvars.ts <<'TS'
    import { TEMPLATE_VARIABLES, VARIABLE_GROUPS, DEPRECATED_PLACEHOLDERS } from "./src/lib/document-render.js";
    process.stdout.write("JSONSTART" + JSON.stringify({
      groups: VARIABLE_GROUPS,
      variables: Object.entries(TEMPLATE_VARIABLES).map(([name, s]) => ({
        name, group: s.group, scope: s.scope ?? "both", description: s.description, example: s.example,
      })),
      deprecated: DEPRECATED_PLACEHOLDERS,
    }) + "JSONEND");
    TS
    docker compose cp /tmp/dumpvars.ts backend:/app/dumpvars.ts
    docker compose exec -T backend npx tsx dumpvars.ts \
      | sed 's/.*JSONSTART//; s/JSONEND.*//' > /tmp/vars.json
    docker compose exec -T backend rm -f /app/dumpvars.ts

ฟอนต์ TH Sarabun ที่ฝังไว้หยิบมาจาก `คู่มือ-deploy-D2-บน-Azure-Container-Apps-v2.1.html`
ซึ่งเป็น house style เดียวกัน — ถ้าไฟล์นั้นย้ายที่ ส่ง `--style` ชี้ไฟล์ใหม่
"""
import argparse
import base64
import html
import json
import re
from pathlib import Path

# ── กลุ่มตัวแปร: ลำดับที่อยากให้อ่าน ไม่ใช่ลำดับที่บังเอิญอยู่ในโค้ด ───────────────
GROUP_ORDER = [
    "agreement", "request", "org", "org_approver", "org_officer",
    "signature", "bdi", "dataset", "document", "system",
]

SCOPE_BADGE = {
    "both": ('b-cookie', 'ทุกฉบับ'),
    "organization": ('b-req', 'เฉพาะ A0–A3'),
    "dataset": ('b-prod', 'เฉพาะ A4'),
}

GROUP_NOTE = {
    "org": "ใช้ <code>{{org.address}}</code> ช่องเดียว <b>หรือ</b> แยกช่อง "
           "<code>addressNo</code> / <code>road</code> / <code>subdistrict</code> / … ก็ได้ "
           "อย่าใช้ทั้งสองแบบในที่เดียวกัน ที่อยู่จะซ้ำ",
    "signature": "ชื่อผู้ลงนามถูกบันทึกไว้ ณ เวลาที่ลงนาม ถ้าผู้ใช้เปลี่ยนชื่อบัญชีภายหลัง "
                 "เอกสารที่ลงนามแล้ว<b>ไม่เปลี่ยนตาม</b>",
    "bdi": "ที่อยู่สำนักงาน ชื่อและตำแหน่งผู้อำนวยการเป็นค่าที่ตั้งไว้ในโค้ด "
           "(<code>OFFICE_DEFAULTS</code> ใน <code>backend/src/lib/legal-values.ts</code>) "
           "เพราะฐานข้อมูลไม่มีช่องเก็บ — <b>ต้องแจ้งทีมพัฒนาให้แก้เมื่อย้ายที่ทำการหรือเปลี่ยน"
           "ผู้อำนวยการ</b> ส่วนชื่อ อีเมล และเบอร์โทรใช้ค่าจากฐานข้อมูลก่อนถ้ากรอกไว้",
    "document": "สองตัวนี้เป็นของ<b>เอกสารฉบับที่กำลังถูกสร้าง</b> ไม่ใช่ของคำขอ — "
                "ผนวกที่อัปโหลดคนละวันกับข้อตกลงหลักย่อมมีเลขเวอร์ชันของตัวเอง",
    "agreement": "วันทำข้อตกลงคือ<b>วันที่หน่วยงานนำส่งคำขอ</b> ไม่ใช่วันที่กดสร้างเอกสาร "
                 "เอกสารที่ผู้อนุมัติเปิดดูจึงลงวันที่ตรงกับฉบับที่หน่วยงานนำส่ง",
}


def esc(s):
    return html.escape(str(s), quote=False)


def data_uri(path: Path) -> str:
    return "data:image/png;base64," + base64.b64encode(path.read_bytes()).decode()


def figure(img: Path, caption: str, lead: str = "") -> str:
    return (
        f'<figure>{lead}'
        f'<div class="figbox shotbox"><img class="shot" src="{data_uri(img)}" alt=""></div>'
        f'<figcaption>{caption}</figcaption></figure>'
    )


def var_table(variables, group) -> str:
    rows = []
    for v in variables:
        cls, label = SCOPE_BADGE[v["scope"]]
        rows.append(
            "<tr>"
            f'<td><span class="var">{{{{{esc(v["name"])}}}}}</span></td>'
            f'<td class="dim">{esc(v["description"])}</td>'
            f'<td><span class="ex">{esc(v["example"])}</span></td>'
            f'<td><span class="b {cls}">{label}</span></td>'
            "</tr>"
        )
    note = GROUP_NOTE.get(group)
    note_html = f'<div class="note">{note}</div>' if note else ""
    return (
        '<div class="tw"><table class="var-table"><thead><tr>'
        "<th>ตัวแปร</th><th>ได้อะไร</th><th>ตัวอย่างค่า</th><th>ใช้กับ</th>"
        "</tr></thead><tbody>" + "".join(rows) + "</tbody></table></div>" + note_html
    )


def chapter(num, cid, title, body) -> str:
    return (
        f'<section class="chapter" id="{cid}">'
        f'<h2><span class="cnum">บทที่ {num}</span>{esc(title)}</h2>'
        f'<div class="body">{body}</div></section>'
    )


def build(data, images: Path, style_src: Path, page_of=None) -> str:
    css = re.search(r"<style>(.*?)</style>", style_src.read_text(encoding="utf-8"), re.S).group(1)
    faces = "".join(re.findall(r"@font-face\{[^}]*\}", css))
    base_css = re.sub(r"@font-face\{[^}]*\}", "", css)

    variables = data["variables"]
    groups = data["groups"]
    by_group = {g: [v for v in variables if v["group"] == g] for g in groups}
    total = len(variables)

    # ── บทที่ 1 ────────────────────────────────────────────────────────────
    c1 = f"""
<p class="lead">เอกสารข้อตกลงที่ระบบสร้างให้แต่ละหน่วยงาน มาจากไฟล์ <b>Word (<code>.docx</code>)</b>
ฉบับเดียวที่เก็บไว้ในระบบ ตรงไหนที่ต้องการให้ระบบเติมข้อมูลให้ ก็พิมพ์ <b>ชื่อตัวแปรในวงเล็บปีกกาสองชั้น</b>
ลงไปตรงนั้น</p>

{figure(images / "A0-template-crop.png",
        "<b>ต้นแบบ</b> — ย่อหน้าคู่สัญญาใน A0 ตรงที่เป็น <code>{{…}}</code> คือช่องที่ระบบจะเติมให้")}

{figure(images / "A0-rendered-crop.png",
        "<b>เอกสารฉบับจริง</b> — ย่อหน้าเดียวกันหลังระบบเติมค่าของคำขอ ORG-REG-2026-0003 "
        "รูปแบบตัวอักษรของช่อง (เส้นใต้แบบจุด) ติดไปกับค่าที่เติมด้วย")}

<h3>สิ่งที่ผู้เขียนเอกสารทำเองได้ทั้งหมด</h3>
<ul>
  <li>ย้ายตัวแปรไปไว้ที่อื่นในเอกสาร</li>
  <li>ลบตัวแปรที่ไม่ต้องการออก</li>
  <li>ใช้ตัวแปรเดิมซ้ำกี่ที่ก็ได้</li>
  <li>แก้ถ้อยคำ จัดหน้า เปลี่ยนตาราง เพิ่มหรือลบหน้า</li>
  <li>ทำเอกสารฉบับใหม่ที่หยิบตัวแปรชุดใดก็ได้จากบทที่ 2</li>
</ul>

<div class="note caution"><span class="nlabel">ต้องให้ทีมพัฒนาทำก่อน</span>
ใช้ชื่อตัวแปร<b>ใหม่ที่ยังไม่มีในบทที่ 2</b> เพราะต้องมีคนบอกระบบก่อนว่าชื่อนั้นไปเอาข้อมูลมาจากไหน —
ระบบจะ<b>ปฏิเสธไฟล์</b>ที่มีชื่อแปลกปลอมตั้งแต่ตอนอัปโหลด ไม่ปล่อยให้ไปเจอช่องว่างเปล่าในเอกสาร
ที่หน่วยงานลงนามแล้ว</div>

<h3>ตัวแปรใช้ได้กับทุกฉบับ ไม่ใช่แค่ A0</h3>
<p>ระบบดูจากไฟล์ว่ามี <code>{{{{…}}}}</code> หรือไม่ ไม่ได้ดูจากรหัสเอกสาร ฉบับที่มีตัวแปรจะถูกสร้างใหม่
ด้วยข้อมูลของแต่ละคำขอ ฉบับที่ไม่มีจะใช้ไฟล์กลางร่วมกันทุกหน่วยงาน (เร็วกว่าและไม่เปลืองที่เก็บ)
เอาตัวแปรออกก็กลับไปใช้ไฟล์กลางเอง — ไม่ต้องแจ้งใครทั้งสองทาง</p>

<div class="tw"><table class="doc-table"><thead><tr>
<th>รหัส</th><th>เอกสาร</th><th>ใช้กับเส้นทาง</th><th>วันนี้มีตัวแปรกี่ตัว</th>
</tr></thead><tbody>
<tr><td><span class="var">A0</span></td><td>ข้อตกลงหลักในการบริหารจัดการและการแบ่งปันข้อมูล</td><td class="dim">ลงทะเบียนหน่วยงาน</td><td>20</td></tr>
<tr><td><span class="var">A1</span></td><td>ผนวก 1 สัญญารักษาความลับ (NDA)</td><td class="dim">ลงทะเบียนหน่วยงาน</td><td>0</td></tr>
<tr><td><span class="var">A2</span></td><td>ผนวก 2 ข้อตกลงการประมวลผลข้อมูล (DPA)</td><td class="dim">ลงทะเบียนหน่วยงาน</td><td>0</td></tr>
<tr><td><span class="var">A3</span></td><td>ผนวก 3 ข้อตกลงประมวลผลข้อมูลส่วนบุคคล (PDPA)</td><td class="dim">ลงทะเบียนหน่วยงาน</td><td>0</td></tr>
<tr><td><span class="var">A4</span></td><td>แบบนำส่งข้อมูล</td><td class="dim">ลงทะเบียนชุดข้อมูล</td><td>100</td></tr>
</tbody></table></div>
<p class="tabcap">ผนวก 1–3 ยังไม่มีตัวแปรเลยแม้ตัวเดียว ใส่เพิ่มได้ทันทีถ้าต้องการ เช่นให้ทุกผนวกมี
<code>{{{{org.name}}}}</code> กับ <code>{{{{requestNumber}}}}</code> ที่หัวกระดาษ</p>
"""

    # ── บทที่ 2 ────────────────────────────────────────────────────────────
    parts = [f"""
<p class="lead">ทั้งหมด <b>{total} ตัว</b> — รายการนี้เป็นตัวเดียวกับที่ระบบใช้ตรวจไฟล์ตอนอัปโหลด
และเป็นตัวเดียวกับที่ <code>GET /api/admin/legal-documents</code> คืนมา (มาจากที่เดียวกันในโค้ด
จึงไม่มีทางไม่ตรงกัน)</p>

<p>คอลัมน์ <b>ใช้กับ</b> บอกว่าตัวแปรนั้นมีค่าให้เติมในเอกสารของเส้นทางไหน ใส่ผิดเส้นทาง
จะถูกปฏิเสธตั้งแต่ตอนอัปโหลดพร้อมบอกชื่อที่ผิด</p>

<div class="note"><span class="nlabel">ค่าที่ยังไม่เกิดขึ้น จะออกมาเป็นช่องว่าง</span>
ลายมือชื่อของฝ่ายที่ยังไม่ลงนาม และวันที่อนุมัติของคำขอที่ยังไม่อนุมัติ ออกมาเป็น<b>ช่องว่าง</b>
ไม่ใช่คำว่า &ldquo;ไม่มี&rdquo; หรือขีดกลาง — เพื่อให้ช่องลายมือชื่อที่ว่างสื่อว่ายังไม่มีการลงนาม
ถ้าต้องการเส้นให้เซ็น ให้วาดเส้นใต้หรือพิมพ์จุดไว้ในเอกสารเอง</div>
"""]
    for g in GROUP_ORDER:
        vs = by_group.get(g) or []
        if not vs:
            continue
        parts.append(f"<h3>{esc(groups[g])} <span class=\"cnt\">{len(vs)} ตัว</span></h3>")
        parts.append(var_table(vs, g))
    c2 = "".join(parts)

    # ── บทที่ 3 — ช่องติ๊ก ─────────────────────────────────────────────────
    tick_rows = "".join(
        f'<tr><td><span class="var">{esc(f)}</span></td><td><span class="ex">{esc(c)}</span></td></tr>'
        for f, c in data["tickFields"]
    )
    c3 = f"""
<p class="lead">แบบนำส่งข้อมูล (A4) เป็นแบบฟอร์มที่มีตัวเลือกให้กา ระบบกาให้ตามที่ผู้กรอกเลือกไว้
ด้วยตัวแปรรูปแบบ <code>{{{{tick.&lt;ฟิลด์&gt;.&lt;รหัส&gt;}}}}</code></p>

<pre><code>{{{{tick.dataType.1}}}} ข้อมูลระเบียน
{{{{tick.dataType.2}}}} ข้อมูลภูมิสารสนเทศ
{{{{tick.dataType.3}}}} ข้อมูลรวม (สถิติ)
{{{{tick.dataType.9}}}} ข้อมูลอื่น ๆ</code></pre>

<p>ได้ผลเป็น <b>✔</b> สำหรับข้อที่ตรงกับคำขอ และ <b>☐</b> สำหรับข้อที่ไม่ตรง — ตัวเลือกทุกข้อยัง
พิมพ์ออกมาครบ ผู้อ่านจึงเห็นว่ามีตัวเลือกอะไรและไม่ได้เลือกอะไร เหมือนแบบฟอร์มกระดาษ</p>

<div class="note caution"><span class="nlabel">รหัส ไม่ใช่ข้อความบนฟอร์ม</span>
รหัสที่ใส่ต่อท้ายคือ<b>รหัสที่เก็บในฐานข้อมูล</b> ไม่ใช่ข้อความที่พิมพ์บนกระดาษ ฟิลด์ที่เป็น
ใช่/ไม่ใช่ใช้รหัส <code>true</code> / <code>false</code> เสมอ เช่น
<code>{{{{tick.containsPersonalData.true}}}}</code></div>

<h3>ฟิลด์กับรหัสที่ A4 ฉบับปัจจุบันใช้อยู่</h3>
<div class="tw"><table class="tick-table"><thead><tr><th>ฟิลด์</th><th>รหัสที่ใช้ได้</th></tr></thead>
<tbody>{tick_rows}</tbody></table></div>
<p class="tabcap">รายการเต็มดูได้จาก <code>GET /api/dataset-choices</code> ซึ่งเป็นรายการเดียวกับที่
ระบบใช้ตั้งชื่อช่องติ๊ก (ฟิลด์ใช่/ไม่ใช่ไม่อยู่ในนั้น รหัสเป็น <code>true</code>/<code>false</code> เสมอ)</p>

<div class="note"><b>เพิ่มตัวเลือกใหม่ในระบบแล้วช่องติ๊กใหม่ใช้ได้ทันที</b> โดยไม่ต้องแก้โค้ดตัวแปลง
<b>แต่การเพิ่มตัวเลือกไม่ได้เพิ่มบรรทัดในเอกสารให้</b> — ถ้าอยากให้ตัวเลือกใหม่ปรากฏบนกระดาษ
ต้องเพิ่มบรรทัด <code>{{{{tick.&lt;ฟิลด์&gt;.&lt;รหัสใหม่&gt;}}}}</code> ในไฟล์ <code>.docx</code>
แล้วอัปโหลดเวอร์ชันใหม่ด้วยตัวเอง (บทที่ 5) · ตัวเลือกที่มีในระบบแต่ไม่มีในเอกสารก็ได้ ระบบไม่บังคับ
ว่าเอกสารต้องมีช่องติ๊กครบทุกรหัส</div>
"""

    # ── บทที่ 4 — ข้อควรระวังตอนพิมพ์ ──────────────────────────────────────
    c4 = """
<div class="tw"><table class="care-table"><thead><tr><th>เรื่อง</th><th>ทำ</th><th>ไม่ทำ</th></tr></thead>
<tbody>
<tr><td>วงเล็บ</td><td><span class="var">{{org.name}}</span> สองชั้น</td><td><span class="ex">{org.name}</span> ชั้นเดียว</td></tr>
<tr><td>ตัวพิมพ์</td><td>ตรงตามบทที่ 2 เช่น <span class="var">org_approver.fullName</span></td><td><span class="ex">Org_Approver.FullName</span></td></tr>
<tr><td>ช่องว่าง</td><td>ไม่มีช่องว่างในชื่อ</td><td><span class="ex">{{org. name}}</span></td></tr>
<tr><td>การพิมพ์</td><td>พิมพ์ชื่อให้จบในครั้งเดียว</td><td>พิมพ์ทีละตัวอักษรแล้วมาแก้ตรงกลาง</td></tr>
</tbody></table></div>

<div class="note caution"><span class="nlabel">ข้อสุดท้ายสำคัญที่สุด</span>
Word แบ่งข้อความเป็นชิ้นเล็ก ๆ ภายในไฟล์เวลาเราแก้ไปแก้มา ระบบรวมชิ้นเหล่านั้นกลับก่อนแทนที่อยู่แล้ว
แต่วิธีที่ปลอดภัยที่สุดคือ <b>ลบชื่อเก่าทิ้งทั้งชุดแล้วพิมพ์ใหม่</b> ไม่ใช่แก้แทรกกลางชื่อเดิม —
ชื่อที่ถูกผ่าเป็นหลายชิ้นจะถูกมองข้ามเงียบ ๆ แล้วโผล่เป็น <code>{{…}}</code> ในเอกสารฉบับจริง</div>

<p>จัดรูปแบบตัวอักษรของตัวแปรได้ตามปกติ (ตัวหนา ขีดเส้นใต้ สีอะไรก็ได้) ค่าที่เติมเข้าไปจะรับรูปแบบนั้น
มาด้วย — เช่นในเอกสาร A0 ช่องที่อยู่ถูกขีดเส้นใต้แบบจุดไว้ ค่าที่เติมจึงมีเส้นจุดใต้ตัวหนังสือ
(เทียบสองภาพในบทที่ 1)</p>

<h3>ถ้าไฟล์ที่ได้มาทำเครื่องหมายช่องกรอกด้วยชื่อคอลัมน์</h3>
<p>เอกสารที่ฝ่ายกฎหมายส่งมาบางฉบับทำเครื่องหมายช่องกรอกด้วยชื่อคอลัมน์ในฐานข้อมูลแบบ
<code>&lt;organization.name_th&gt;</code> ซึ่งอ่านง่ายตอนร่าง แต่ระบบรู้จักเฉพาะชื่อในบทที่ 2 —
ใช้สคริปต์แปลงได้ ไม่ต้องแก้มือทีละอัน:</p>

<pre><code>python3 docs/tools/convert-field-tags.py "A[0] ข้อตกลง_with_fields.docx" A0.docx</code></pre>

<p>สคริปต์จะแปลงแท็กตามตารางในตัวมันเองและ<b>ล้มทันทีถ้าพบแท็กที่ยังไม่มีปลายทาง</b> พร้อมบอกชื่อ ·
เติม placeholder ที่ฉบับนั้นยังไม่ได้ทำเครื่องหมายไว้แต่ฉบับที่ใช้อยู่มี · ลบไฮไลต์และตัวอักษรสีแดง
ที่ใช้ทำเครื่องหมายช่องกรอกตอนร่าง (ถ้าปล่อยไว้ ค่าที่เติมเข้าไปจะมีแถบไฮไลต์คาดอยู่ในเอกสารฉบับจริง) ·
เก็บกวาดเส้นประกับ tab stop ที่เคยใช้วาดช่องว่าง</p>

<div class="note"><b>อย่าแก้ <code>.docx</code> ด้วยมือแล้วอัปโหลด</b> ถ้าไฟล์มาในรูปแบบนั้น —
ส่วน A4 สร้างด้วย <code>docs/tools/build-a4-template.py</code> ซึ่งตรึงฟอนต์ของช่องติ๊กไว้ด้วย
ซึ่งการแก้มือทำตกได้ง่าย</div>
"""

    # ── บทที่ 5 — วิธีอัปเดตเอกสาร ─────────────────────────────────────────
    c5 = f"""
<p class="lead">เอกสารหนึ่งฉบับมีสองอย่างที่แก้ได้ และแก้คนละทางกัน — <b>เนื้อไฟล์</b> (อัปโหลด
<code>.docx</code> เวอร์ชันใหม่) กับ <b>ข้อมูลประจำตัวของเอกสาร</b> (ชื่อสั้น คำเตือน และบังคับ/ไม่บังคับ)
ทั้งสองทางใช้ <code>x-admin-token</code> จาก <code>.env</code> และไม่ต้อง deploy ใหม่</p>

<div class="note"><span class="nlabel">ทั้งชุดอยู่ใน Postman แล้ว</span>
<code>docs/bdi-admin-portal.postman_collection.json</code> หมวด <b>L1–L4</b> — นำเข้า Postman
พร้อม environment ของ checkout ที่ต้องการ แล้วกดส่งได้เลย ไม่ต้องพิมพ์ <code>curl</code> เอง</div>

<h3>5.1 · เผยแพร่เนื้อเอกสารเวอร์ชันใหม่</h3>
<p><b>นี่คือทางเดียวที่เอกสารต้นแบบฉบับใหม่จะขึ้นระบบ</b> — template ที่ใช้จริงคือแถวในฐานข้อมูล
ไม่ใช่ไฟล์ใน repo ไฟล์ใน <code>backend/src/assets/legal-templates/</code> แค่ seed เวอร์ชัน 1
ให้ฐานข้อมูลเปล่าเท่านั้น</p>

<pre><code>curl -X POST $BASE/api/admin/legal-documents/A0/versions \\
  -H "x-admin-token: $ADMIN_API_TOKEN" \\
  -F "file=@A0.docx;type=application/vnd.openxmlformats-officedocument.wordprocessingml.document"</code></pre>

<p>เปลี่ยน <code>A0</code> เป็นรหัสเอกสารที่ต้องการ (<code>A0</code>–<code>A4</code>)</p>

<div class="tw"><table class="resp-table"><thead><tr><th>ตอบกลับ</th><th>แปลว่า</th></tr></thead><tbody>
<tr><td><span class="var">201</span></td><td>เผยแพร่แล้ว · ฉบับก่อนหน้ากลายเป็น <code>SUPERSEDED</code> ทันที · คำตอบคืน <code>placeholders</code> ทั้งหมดที่พบในไฟล์ <b>ไล่ดูให้ครบว่าช่องที่ตั้งใจใส่ถูกอ่านเจอจริง</b></td></tr>
<tr><td><span class="var">400</span></td><td>ไม่รับไฟล์ และ<b>ไม่มีอะไรเปลี่ยนในระบบ</b> — ใช้ชื่อตัวแปรที่ไม่มีในบทที่ 2 (ข้อความจะบอกชื่อที่ผิดและเสนอชื่อใกล้เคียง) หรือ LibreOffice เปิดไฟล์ไม่ได้ หรือไฟล์ไม่ใช่ <code>.docx</code> จริง หรือเกิน 20 MB</td></tr>
<tr><td><span class="var">404</span></td><td>ไม่มีเอกสารรหัสนี้</td></tr>
</tbody></table></div>

<div class="note"><b>หลักฐานเก่าไม่เสียหาย</b> — <code>legal_acceptance</code> ชี้ที่ <b>เวอร์ชัน</b>
ไม่ใช่ที่รหัสเอกสาร คนที่ลงนามไปแล้วจึงยังผูกกับไฟล์ที่เขาเห็นจริง เอกสารที่หน่วยงานเซ็นไว้
ไม่เปลี่ยนตามการแก้ครั้งใหม่ ส่วนคำขอที่ยังไม่ลงนามจะได้ฉบับใหม่ตอนเปิดอ่านครั้งถัดไป</div>

<h3>5.2 · แก้ชื่อสั้น คำเตือน และบังคับ/ไม่บังคับ</h3>
<p>สามช่องนี้เป็นถ้อยคำและนโยบายที่ฝ่ายกฎหมายสั่งเปลี่ยนได้ <b>โดยไม่ต้องแตะไฟล์ <code>.docx</code></b>
ส่งมาช่องเดียวหรือหลายช่องพร้อมกันก็ได้ ช่องที่ไม่ได้ส่งมาไม่ถูกแตะ</p>

<pre><code>curl -X PATCH $BASE/api/admin/legal-documents/A3 \\
  -H "x-admin-token: $ADMIN_API_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{{"shortname": "ผนวก 3", "legalNotice": "หากหน่วยงาน…", "isRequired": false}}'</code></pre>

<h4>shortname — ชื่อที่ผู้ใช้เห็นแทนรหัส</h4>
<p>รหัส <code>A0</code>–<code>A4</code> เป็นของภายในระบบ หน้าจอไม่พิมพ์มันออกมา สิ่งที่ผู้ใช้เห็นคือ
<code>shortname</code> — ทั้งในรายการเอกสาร หัวกล่องลงนาม ชื่อไฟล์ที่ดาวน์โหลด และบรรทัดที่บอกว่า
หน่วยงานระบุฉบับไหนว่าไม่เกี่ยวข้อง</p>

{figure(images / "fig-shortname-list.png",
        "การ์ด <b>เอกสารข้อตกลง</b> ในหน้าคำขอ — สี่ฉบับถูกเรียกด้วย <code>shortname</code> "
        "ของตัวเอง ไม่มีรหัส <code>A0</code>–<code>A3</code> โผล่ที่ไหน")}

<div class="note"><b>ต้องไม่ซ้ำกับฉบับอื่น</b> — ส่งชื่อที่ฉบับอื่นถืออยู่จะได้ <code>409</code>
พร้อมบอกว่าซ้ำกับรหัสไหน · <b>ปล่อยว่างได้</b> ส่ง <code>null</code> (หรือสตริงว่าง) เพื่อล้างทิ้ง
ฉบับที่ไม่มีชื่อสั้นจะตกกลับไปใช้<b>ชื่อเต็ม</b> ไม่ใช่ตกกลับไปใช้รหัส — วันนี้ A4 เป็นฉบับเดียวที่เป็นแบบนั้น</div>

<h4>legalNotice — คำเตือนใต้บรรทัด &ldquo;เอกสารฉบับที่ n จาก m&rdquo;</h4>
<p><b>ไม่ใช่เนื้อเอกสาร</b> และไม่เข้าไปอยู่ในไฟล์ <code>.docx</code> — เป็นบรรทัดที่ระบบแสดงบนหน้าจอ
<b>ในกล่องอ่าน/ลงนามของผู้มีอำนาจเท่านั้น</b> ซึ่งเป็นขั้นเดียวที่มีปุ่มให้กดตามที่คำเตือนสั่ง</p>

{figure(images / "fig-notice-head.png",
        "หัวกล่องลงนามของผนวก 3 — บรรทัดสีเหลืองคือ <code>legalNotice</code> ของฉบับนั้น "
        "ส่วนหัวเรื่อง <b>ผนวก 3</b> คือ <code>shortname</code>")}

{figure(images / "fig-required-head.png",
        "เทียบกับข้อตกลงหลักซึ่ง <code>legalNotice</code> เป็น <code>null</code> — "
        "ไม่มีคำเตือน ก็ไม่มีกล่อง")}

<h4>isRequired — บังคับ หรือข้ามได้</h4>
<p>ฉบับที่ตั้ง <code>isRequired: false</code> จะมีปุ่ม <b>ไม่เกี่ยวข้อง</b> เพิ่มขึ้นมาทางซ้ายของปุ่ม
<b>เห็นชอบ</b> ให้ผู้มีอำนาจกดข้ามได้ ฉบับที่ถูกข้ามจะไม่ถูกบันทึกเป็นการยอมรับ และไม่ถูกส่งต่อไปให้
ฝ่าย BDI เห็นชอบด้วย</p>

{figure(images / "fig-notice-buttons.png",
        "ท้ายกล่องของผนวก 3 (<code>isRequired: false</code>) — มีปุ่ม <b>ไม่เกี่ยวข้อง</b>")}

{figure(images / "fig-required-buttons.png",
        "ท้ายกล่องของข้อตกลงหลัก (<code>isRequired: true</code>) — มีแต่ <b>เห็นชอบ</b> "
        "ข้ามไม่ได้")}

<div class="note caution"><span class="nlabel">คำเตือนกับปุ่มเป็นคนละเรื่องกัน</span>
<code>legalNotice</code> แสดงเมื่อมีค่า จบแค่นั้น — ฉบับบังคับที่มีคำเตือนก็ขึ้น มันแค่จะไม่มีปุ่มให้กด
ถ้าคำเตือนสั่งให้กดปุ่ม <b>ไม่เกี่ยวข้อง</b> ต้องตั้ง <code>isRequired: false</code> ให้ฉบับนั้นด้วย
ไม่งั้นผู้ใช้จะอ่านคำเตือนแล้วหาปุ่มไม่เจอ</div>

<div class="note warn"><span class="nlabel">ระวังตอน seed ใหม่</span>
<code>seed:masters</code> เขียนทับ <code>shortname</code> กับ <code>legalNotice</code> ด้วยค่าใน
<code>LEGAL_DOCUMENTS</code> ของสคริปต์ทุกครั้งที่รัน (<code>isRequired</code> ไม่ถูกเขียนทับ
โดยตั้งใจ) — <b>ถ้าเปลี่ยนถ้อยคำถาวร ให้แจ้งทีมพัฒนาแก้ในสคริปต์ด้วย</b> ไม่งั้นการ seed รอบถัดไป
จะดึงค่ากลับ</div>

<h3>5.3 · ดูของที่มีอยู่ก่อนสั่งแก้</h3>
<pre><code>curl $BASE/api/admin/legal-documents -H "x-admin-token: $ADMIN_API_TOKEN"</code></pre>
<p>คืนเอกสารทุกฉบับพร้อม <code>shortname</code> · <code>legalNotice</code> · <code>isRequired</code>
ที่เป็นอยู่ตอนนี้ ประวัติเวอร์ชันทั้งหมด (เรียงจากใหม่ไปเก่า ฉบับที่ใช้อยู่คือฉบับที่ <code>status</code>
เป็น <code>PUBLISHED</code>) และ <b>รายชื่อตัวแปรทั้งหมดในบทที่ 2 พร้อมคำอธิบายและตัวอย่าง</b> —
เอาไว้เทียบว่าชื่อที่พิมพ์ลงเอกสารสะกดถูกไหมก่อนอัปโหลด</p>
"""

    # ── บทที่ 6 ────────────────────────────────────────────────────────────
    c6 = """
<ol>
  <li>อัปโหลดขึ้น <b>checkout สำหรับทดสอบก่อน</b> ไม่ใช่ยิงขึ้น production ตรง ๆ</li>
  <li>อ่านรายชื่อตัวแปรที่ตอบกลับมาใน <code>201</code> ว่าครบตามที่ใส่ไว้ ถ้าตัวไหนหาย มักเป็นเพราะ
      พิมพ์ผิดหรือชื่อถูกแบ่งชิ้นตามบทที่ 4</li>
  <li>เปิดคำขอที่รอลงนามอยู่ กดดูเอกสาร แล้วตรวจว่าค่าขึ้นถูกช่อง</li>
  <li>ตรวจว่า<b>การแบ่งหน้าไม่เพี้ยน</b> — ค่าที่ยาวกว่าที่คาด (ชื่อหน่วยงานยาว ๆ) จะดันบรรทัดถัดไป
      ซึ่งเป็นเรื่องปกติและถูกต้อง แต่ควรดูว่าหน้าสุดท้ายไม่กลายเป็นหน้าที่มีบรรทัดเดียว</li>
  <li>ถ้าแก้ <code>shortname</code> หรือ <code>legalNotice</code> ให้เปิดกล่องลงนามของคำขอจริงดู
      ว่าถ้อยคำขึ้นถูกฉบับ — เทียบกับภาพในบทที่ 5.2</li>
</ol>

<div class="note"><b>เลขหน้าในเอกสารจะเป็นเลขอารบิก</b>แม้ต้นแบบตั้งเป็นเลขไทย เป็นข้อจำกัดของตัวแปลง
ซึ่งตอนนี้ตรงกับที่ต้องการพอดี: ค่าทุกตัวที่ระบบใส่ลงไปเป็นเลขอารบิกอยู่แล้ว</div>
"""

    # ── ภาคผนวก — ชื่อชุดเดิม ──────────────────────────────────────────────
    dep_rows = "".join(
        f'<tr><td><span class="var">{{{{{esc(old)}}}}}</span></td>'
        f'<td><span class="var">{{{{{esc(new)}}}}}</span></td></tr>'
        for old, new in sorted(data["deprecated"].items())
    )
    ap = f"""
<p class="lead">ชื่อชุดเดิมบอกไม่ตรงกับบทบาทจริงในระบบ — <code>signatory</code> กับ
<code>approver</code> เป็น<b>คนเดียวกัน</b> (ผู้มีอำนาจอนุมัติของหน่วยงาน) ส่วน <code>bdi</code>
ถูกใช้ปนกันทั้งกับผู้ลงนามฝ่ายสำนักงานและกับตัวสำนักงานเอง ชื่อใหม่แยกสองเรื่องนี้ออกจากกัน</p>

<div class="note"><b>เอกสารเดิมยังใช้งานได้ตามปกติ ไม่ต้องรีบแก้</b> ระบบยังเติมค่าให้ชื่อชุดเดิม
และยังรับไฟล์ที่ใช้ชื่อเดิมตอนอัปโหลด — เพียงแต่ตอบกลับมาพร้อม <code>deprecatedPlaceholders</code>
ว่าไฟล์นั้นยังใช้ชื่อไหนอยู่บ้าง <b>แต่เอกสารฉบับใหม่ให้ใช้ชื่อใหม่เท่านั้น</b> ·
<code>docs/tools/rename-placeholders.py</code> แปลงให้ได้ทั้งไฟล์</div>

<div class="tw"><table class="dep-table"><thead><tr><th>ชื่อเดิม</th><th>ชื่อที่ถูกต้อง</th></tr></thead>
<tbody>{dep_rows}</tbody></table></div>
"""

    toc_items = [
        ("c1", "1", "เอกสารต้นแบบทำงานอย่างไร"),
        ("c2", "2", f"ตัวแปรที่ใช้ได้ทั้งหมด ({total} ตัว)"),
        ("c3", "3", "ช่องติ๊กในแบบนำส่งข้อมูล"),
        ("c4", "4", "ข้อควรระวังตอนพิมพ์ตัวแปร"),
        ("c5", "5", "วิธีอัปเดตเอกสาร"),
        ("c6", "6", "ตรวจงานก่อนใช้จริง"),
        ("ap1", "ก", "ชื่อตัวแปรชุดเดิมที่ยังรองรับ"),
    ]
    toc = "".join(
        '<li><div class="toc-line">'
        f'<span class="lbl">{n} · {esc(t)}</span><span class="dots"></span>'
        f'<span class="pg">{(page_of or {}).get(cid, "")}</span></div></li>'
        for cid, n, t in toc_items
    )

    extra_css = """
.shotbox{padding:10px;background:#f7f8fc;}
.shot{display:block;width:100%;height:auto;border:1px solid var(--rule);background:#fff;}
h3 .cnt{font-size:15px;font-weight:400;color:var(--subtle);margin-inline-start:8px;}
.var-table{table-layout:fixed;}
.var-table th:nth-child(1),.var-table td:nth-child(1){width:32%;}
.var-table th:nth-child(2),.var-table td:nth-child(2){width:33%;}
.var-table th:nth-child(3),.var-table td:nth-child(3){width:24%;}
.var-table th:nth-child(4),.var-table td:nth-child(4){width:11%;}
.var-table td .var{white-space:normal;overflow-wrap:anywhere;}
.var-table td .ex{overflow-wrap:anywhere;}
.var-table .b{white-space:nowrap;font-size:13px;padding:0 5px;}
.tick-table th:nth-child(1),.tick-table td:nth-child(1){width:44%;}
.doc-table th:nth-child(1),.doc-table td:nth-child(1){width:10%;}
.doc-table th:nth-child(4),.doc-table td:nth-child(4){width:18%;}
.resp-table th:nth-child(1),.resp-table td:nth-child(1){width:14%;}
.care-table th:nth-child(1),.care-table td:nth-child(1){width:18%;}
.dep-table{table-layout:fixed;}
.dep-table td .var{white-space:normal;overflow-wrap:anywhere;}
figure + figure{margin-top:14px;}
figure,.figbox,.shot{break-inside:avoid;page-break-inside:avoid;}
@media print{
  .shot{width:100%;}
  .shotbox{padding:6px;}
  figure{break-inside:avoid;}
  .var-table{font-size:10.5pt;}
  .var-table td .var{font-size:.76em;}
  .var-table td .ex{font-size:.8em;}
  .dep-table{font-size:11pt;}
}
"""

    return f"""<title>คู่มือเอกสารต้นแบบ — ระบบกลางเพื่อการแบ่งปันข้อมูลดิจิทัล (D2)</title>
<style>{faces}{base_css}{extra_css}</style>
<div class="toolbar"><button onclick="window.print()">พิมพ์ / บันทึกเป็น PDF</button></div>
<div class="doc">

<header class="cover">
  <div class="cover-org">สถาบันข้อมูลขนาดใหญ่ (องค์การมหาชน) · Big Data Institute</div>
  <div class="cover-rule"></div>
  <h1>คู่มือเอกสารต้นแบบ</h1>
  <div class="cover-sub">ตัวแปรที่ใช้ได้ และวิธีอัปเดตเอกสารข้อตกลง</div>
  <div class="cover-sys">ระบบกลางเพื่อการแบ่งปันข้อมูลดิจิทัล (D2)</div>
  <div class="doc-control"><dl>
    <dt>สำหรับ</dt><dd>ผู้เขียนเอกสารและผู้ดูแลระบบ — ไม่ต้องเขียนโค้ด</dd>
    <dt>ฉบับ</dt><dd>1.0</dd>
    <dt>วันที่</dt><dd>13 กันยายน 2569</dd>
    <dt>ตัวแปรทั้งหมด</dt><dd>{total} ตัว</dd>
    <dt>เอกสารที่ครอบคลุม</dt><dd>A0 · A1 · A2 · A3 · A4</dd>
  </dl></div>
  <p class="cover-note">อ่านจบแล้วจะแก้ถ้อยคำในเอกสาร ย้ายช่องกรอก เผยแพร่เวอร์ชันใหม่
  และเปลี่ยนชื่อสั้น คำเตือน หรือสถานะบังคับของเอกสารได้เองโดยไม่ต้องรอทีมพัฒนา ·
  กลไกเบื้องหลัง (ทำไมต้องเป็น <code>.docx</code>, ตัวแปลงคืออะไร, เก็บเวอร์ชันอย่างไร)
  อยู่ที่ <code>docs/17-legal-document-rendering.md</code></p>
</header>

<nav class="toc"><h2>สารบัญ</h2><ol>{toc}</ol></nav>

{chapter("1", "c1", "เอกสารต้นแบบทำงานอย่างไร", c1)}
{chapter("2", "c2", f"ตัวแปรที่ใช้ได้ทั้งหมด ({total} ตัว)", c2)}
{chapter("3", "c3", "ช่องติ๊กในแบบนำส่งข้อมูล", c3)}
{chapter("4", "c4", "ข้อควรระวังตอนพิมพ์ตัวแปร", c4)}
{chapter("5", "c5", "วิธีอัปเดตเอกสาร", c5)}
{chapter("6", "c6", "ตรวจงานก่อนใช้จริง", c6)}
<section class="chapter" id="ap1">
  <h2><span class="cnum">ภาคผนวก ก</span>ชื่อตัวแปรชุดเดิมที่ยังรองรับ</h2>
  <div class="body">{ap}</div>
</section>

<p class="docfoot">สร้างจาก <code>docs/tools/build-template-manual.py</code> · ตารางตัวแปรมาจาก
<code>TEMPLATE_VARIABLES</code> ในโค้ดโดยตรง · ภาพประกอบเก็บจาก checkout จริงด้วย
<code>sit-evidence/document-template-manual-20260913/capture.mjs</code></p>

</div>
"""


def main():
    ap_ = argparse.ArgumentParser()
    ap_.add_argument("--data", required=True, type=Path)
    ap_.add_argument("--images", required=True, type=Path)
    ap_.add_argument("--out", required=True, type=Path)
    ap_.add_argument("--pages", type=Path, help="JSON {chapterId: pageNumber} สำหรับเติมเลขหน้าในสารบัญ")
    ap_.add_argument(
        "--style",
        type=Path,
        default=Path("/hdd1tb/bdi-project/คู่มือ-deploy-D2-บน-Azure-Container-Apps-v2.1.html"),
        help="ไฟล์ HTML ที่ยืม @font-face กับ house style มา",
    )
    a = ap_.parse_args()

    data = json.loads(a.data.read_text(encoding="utf-8"))
    pages = json.loads(a.pages.read_text(encoding="utf-8")) if a.pages else None
    a.out.parent.mkdir(parents=True, exist_ok=True)
    a.out.write_text(build(data, a.images, a.style, pages), encoding="utf-8")
    print(f"{a.out} — {a.out.stat().st_size / 1024:.0f} KB")


if __name__ == "__main__":
    main()
