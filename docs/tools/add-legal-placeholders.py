#!/usr/bin/env python3
"""Turn the pristine legal templates into placeholder templates the app can fill.

The originals in `assets/document-template/` are paper forms: every field is a
dotted blank drawn with tab stops. This writes the same documents with each
blank replaced by a `{{...}}` placeholder, into
`backend/src/assets/legal-templates/`, which is where `seed:masters` picks them
up to publish version 1 of each `legal.legal_document`.

Run it once. **After that the .docx in backend/src/assets/legal-templates is the
source of truth** — BDI staff edit it in Word and upload it through
`POST /api/admin/legal-documents/:code/versions`, and nothing here runs again.
This script exists to record exactly what was changed against the originals.

    python3 docs/tools/add-legal-placeholders.py

Only A0 has fields. A1–A3 are annexes with no blanks anywhere in them, so they
are copied through untouched; they still get versioned and rendered by the same
pipeline, because what the organisation signs has to be pinned to a version.
"""
import re
import shutil
import sys
import zipfile
from pathlib import Path

SRC = Path("/hdd1tb/bdi-project/assets/document-template")
DEST = Path(__file__).resolve().parents[2] / "backend/src/assets/legal-templates"

# Word splits a sentence into many runs (rsid tracking, spell-check, language
# hints), so a blank is not one element but a row of them. `is_filler` finds the
# pieces that only draw the blank; `collapse_fillers` fuses each row into one
# run holding SENTINEL, which makes the paragraph's text predictable enough to
# do plain string replacement on.
P_SPLIT = re.compile(r"<w:p(?: [^>]*)?>|</w:p>")
RUN = re.compile(r"<w:r(?: [^>]*)?>.*?</w:r>", re.S)
T = re.compile(r"<w:t(?: [^>]*)?>(.*?)</w:t>", re.S)
TAB = "<w:tab/>"
SENTINEL = ""
FILLER_CHARS = set(" .… \t")
DOTS = re.compile(r"[.…]{2,}")


def paragraphs(xml):
    out, depth, start = [], 0, None
    for m in P_SPLIT.finditer(xml):
        if m.group(0).startswith("</"):
            depth -= 1
            if depth == 0:
                out.append((start, m.end()))
        else:
            if depth == 0:
                start = m.start()
            depth += 1
    return out


def run_text(run):
    return "".join(m.group(1) for m in T.finditer(run))


def is_filler(run):
    txt = run_text(run)
    if txt and not set(txt) <= FILLER_CHARS:
        return False
    return TAB in run or txt != ""


def set_run_text(run, text):
    """Put `text` in the run and drop its tabs, so the blank stops being drawn."""
    run = run.replace(TAB, "")
    first = True

    def sub(m):
        nonlocal first
        if first:
            first = False
            return f'<w:t xml:space="preserve">{text}</w:t>'
        return '<w:t xml:space="preserve"></w:t>'

    new, n = T.subn(sub, run)
    if n:
        return new
    # A run that was nothing but a tab has no w:t to write into.
    body = f'<w:t xml:space="preserve">{text}</w:t>'
    if "</w:rPr>" in run:
        return run.replace("</w:rPr>", "</w:rPr>" + body, 1)
    return run.replace("</w:r>", body + "</w:r>")


def collapse_fillers(para):
    runs = [(m.start(), m.end(), m.group(0)) for m in RUN.finditer(para)]
    groups, cur = [], []
    for r in runs:
        if is_filler(r[2]):
            cur.append(r)
        else:
            if cur:
                groups.append(cur)
            cur = []
    if cur:
        groups.append(cur)

    # A lone run of spaces between two words is not a blank — collapsing it
        # would eat ordinary spacing. Only groups that actually draw a rule
    # (a tab stop, or two dots or more) count.
    def draws_a_rule(group):
        return any(TAB in r[2] or DOTS.search(run_text(r[2])) for r in group)

    for group in reversed([g for g in groups if draws_a_rule(g)]):
        para = para[: group[0][0]] + set_run_text(group[0][2], SENTINEL) + para[group[-1][1] :]
    return para


def replace_text(para, old, new):
    """Replace `old` in the paragraph's concatenated text, across run boundaries.

    Everything lands in the first run the match touches; the rest are emptied.
    That keeps the formatting of the run the field started in.
    """
    runs = [(m.start(), m.end(), m.group(0)) for m in RUN.finditer(para)]
    spans, pos = [], 0
    for s, e, r in runs:
        t = run_text(r)
        spans.append((pos, pos + len(t), s, e, r))
        pos += len(t)

    whole = "".join(run_text(r[2]) for r in runs)
    at = whole.find(old)
    if at < 0:
        sys.exit(f"anchor not found: {old!r}\n           in: {whole!r}")
    if whole.find(old, at + 1) >= 0:
        sys.exit(f"anchor is ambiguous, it appears twice: {old!r}")
    end = at + len(old)

    touched = [sp for sp in spans if sp[1] > at and sp[0] < end]
    for sp in reversed(touched):
        t0, t1, s, e, r = sp
        text = run_text(r)
        head = text[: max(0, at - t0)]
        tail = text[max(0, end - t0) :] if t1 > end else ""
        body = head + (new if sp is touched[0] else "") + tail
        para = para[:s] + set_run_text(r, body) + para[e:]
    return para


# Which paragraph index carries which field. The indexes are stable for these
# files; `replace_text` fails loudly rather than silently mangling a document if
# an anchor moves, which is the point of naming the source text in full.
A0_EDITS = [
    # เมื่อวันที่ ___ เดือน ___ พ.ศ. ___  — the decorative dots between the blanks
    # go with them; the rendered sentence reads as a sentence, not a form.
    (4, f"{SENTINEL}เดือน{SENTINEL}.พ.ศ. {SENTINEL}ณ ",
        "{{agreement.day}} เดือน {{agreement.month}} พ.ศ. {{agreement.year}} ณ "),
    # The counterparty: name, address, who signs for it and in what post.
    (5, f"{SENTINEL}ตั้งอยู่เลขที่ {SENTINEL} ถนน {SENTINEL} แขวง/ตำบล {SENTINEL} เขต/อำเภอ "
        f"{SENTINEL}จังหวัด {SENTINEL}โดย{SENTINEL} ตำแหน่ง {SENTINEL} ผู้มีอำนาจ",
        "{{org.name}} ตั้งอยู่เลขที่ {{org.addressNo}} ถนน {{org.road}} "
        "แขวง/ตำบล {{org.subdistrict}} เขต/อำเภอ {{org.district}} "
        "จังหวัด {{org.province}} โดย {{signatory.fullName}} "
        "ตำแหน่ง {{signatory.position}} ผู้มีอำนาจ"),
    # "ทางไปรษณีย์อิเล็กทรอนิกส์ที่ลงทะเบียนไว้กับระบบ....." — the name of this system.
    (12, "ระบบ.....", "ระบบ {{system.name}}"),
    # Signature block: one table, two cells. Left cell is BDI, right is the agency.
    (20, f"ลงนาม{SENTINEL}วันที่ ..............................",
        "{{bdi.endorsement}}ลงนาม {{bdi.signature}} วันที่ {{bdi.signedDate}}"),
    (21, "ชื่อหน่วยงาน", "{{org.name}}"),
    (23, f"ลงนาม{SENTINEL}ลงนามผ่านระบบอิเล็กทรอนิกส์ วันที่ ........................",
        "ลงนาม {{approver.signature}} ลงนามผ่านระบบอิเล็กทรอนิกส์ วันที่ {{approver.signedDate}}"),
    (30, f"พิมพ์จากระบบโดย{SENTINEL}", "พิมพ์จากระบบโดย {{printedBy}}"),
    (31, "วันที่.......................................", "วันที่ {{printedAt}}"),
]

TEMPLATES = [
    ("A0", "A[0] ข้อตกลง.docx", A0_EDITS),
    ("A1", "A[1] ผนวก_1_ข้อตกลงในการประมวลผลข้อมูล DPA.docx", []),
    ("A2", "A[2] ผนวก_2_ข้อมูลส่วนบุคคล PDPA.docx", []),
    ("A3", "A[3] ผนวก_3_ข้อตกลงรักษาความลับ NDA.docx", []),
]


# The original marks the unfinished "ระบบ....." blank as an author's TODO — yellow
# highlight *and* red text. Both are the marking, not formatting: left in, the rendered
# agreement ships with a highlighter stripe and red lettering through the name of the
# system itself. Only A0 is touched, and only these two runs carry the marking there
# (A1–A3 use red for genuine drafting emphasis and are copied through untouched).
HIGHLIGHT = re.compile(r'<w:highlight w:val="yellow"/>')
TODO_RED = re.compile(r'<w:color w:val="FF0000"(?: [^>]*)?/>')


def rewrite(xml, edits):
    xml = TODO_RED.sub("", HIGHLIGHT.sub("", xml))
    body_at = xml.index("<w:body>")
    head, body = xml[:body_at], xml[body_at:]
    spans = paragraphs(body)

    wanted = sorted({i for i, _, _ in edits})
    for i in reversed(wanted):
        s, e = spans[i]
        para = collapse_fillers(body[s:e])
        for idx, old, new in edits:
            if idx == i:
                para = replace_text(para, old, new)
        body = body[:s] + para + body[e:]
        spans = paragraphs(body)
    return head + body


def main():
    DEST.mkdir(parents=True, exist_ok=True)
    for code, filename, edits in TEMPLATES:
        src, out = SRC / filename, DEST / f"{code}.docx"
        if not src.exists():
            sys.exit(f"missing source template: {src}")
        if not edits:
            shutil.copyfile(src, out)
            print(f"{code}: copied unchanged ({out.name})")
            continue

        with zipfile.ZipFile(src) as zin:
            names = zin.namelist()
            blobs = {n: zin.read(n) for n in names}
        blobs["word/document.xml"] = rewrite(
            blobs["word/document.xml"].decode("utf-8"), edits
        ).encode("utf-8")

        with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as zout:
            for n in names:
                zout.writestr(n, blobs[n])
        print(f"{code}: {len(edits)} fields placed ({out.name})")


if __name__ == "__main__":
    main()
