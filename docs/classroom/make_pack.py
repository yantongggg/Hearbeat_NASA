"""Hearthbeat classroom pack: teacher guide, four check-up cards and a tactile map (EN and 中文).

    pip install reportlab==4.2.5
    python docs/classroom/make_pack.py            # writes hearthbeat-classroom-pack-{en,zh}.pdf here and in app/public/classroom/

Chinese text needs a CJK TrueType font: set HB_CJK_FONT / HB_CJK_FONT_BOLD (a .ttf or .ttc path);
the defaults are the macOS STHeiti fonts. Cards use large print (18 pt body) in black on white,
and each vital sign has a word label as well as a colour band, so they also work printed in grey.
"""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas
from reportlab.platypus import Paragraph, Table, TableStyle

HERE = Path(__file__).resolve().parent
W, H = A4
M = 46  # page margin (pt)
INK = colors.HexColor("#111418")
DIM = colors.HexColor("#4a5560")
RULE = colors.HexColor("#c9d0d6")
SIGN = {"rain": colors.HexColor("#2f7fc1"), "air": colors.HexColor("#c47a2c"), "climate": colors.HexColor("#c4452d")}


def fonts(lang: str) -> tuple[str, str]:
    if lang == "en":
        return "Helvetica", "Helvetica-Bold"
    reg = os.environ.get("HB_CJK_FONT", "/System/Library/Fonts/STHeiti Light.ttc")
    bold = os.environ.get("HB_CJK_FONT_BOLD", "/System/Library/Fonts/STHeiti Medium.ttc")
    pdfmetrics.registerFont(TTFont("CJK", reg, subfontIndex=0))
    pdfmetrics.registerFont(TTFont("CJK-Bold", bold, subfontIndex=0))
    pdfmetrics.registerFontFamily("CJK", normal="CJK", bold="CJK-Bold", italic="CJK", boldItalic="CJK-Bold")
    return "CJK", "CJK-Bold"


class Pen:
    """Paragraphs and tables placed top-down on a canvas, with CJK-aware wrapping."""

    def __init__(self, c: canvas.Canvas, lang: str):
        self.c, self.lang = c, lang
        self.reg, self.bold = fonts(lang)
        self.y = H - M

    def style(self, size: float, bold=False, color=INK, lead=1.32, space=0) -> ParagraphStyle:
        return ParagraphStyle("s", fontName=self.bold if bold else self.reg, fontSize=size, leading=size * lead,
                              textColor=color, alignment=TA_LEFT, spaceAfter=space,
                              wordWrap="CJK" if self.lang == "zh" else None)

    def p(self, text: str, size=12.0, bold=False, color=INK, x=M, width=W - 2 * M, gap=6.0, lead=1.32):
        para = Paragraph(text, self.style(size, bold, color, lead))
        _, h = para.wrap(width, self.y)
        para.drawOn(self.c, x, self.y - h)
        self.y -= h + gap
        return h

    def bullets(self, items: list[str], size=12.0, gap=4.0, numbered=False, x=M, width=W - 2 * M):
        for i, t in enumerate(items, 1):
            mark = f"{i}." if numbered else "•"
            para = Paragraph(t, self.style(size))
            _, h = para.wrap(width - size * 1.6, self.y)
            self.c.setFont(self.bold if numbered else self.reg, size)
            self.c.setFillColor(INK)
            self.c.drawString(x, self.y - size, mark)
            para.drawOn(self.c, x + size * 1.6, self.y - h)
            self.y -= h + gap

    def h(self, text: str, size=15.0, before=10.0, after=5.0):
        self.y -= before
        self.p(text, size, bold=True, gap=after)

    def table(self, rows: list[list[str]], widths: list[float], size=10.5, head=True):
        st = self.style(size, lead=1.28)
        sb = self.style(size, bold=True, lead=1.28)
        data = [[Paragraph(cell, sb if (head and r == 0) else st) for cell in row] for r, row in enumerate(rows)]
        t = Table(data, colWidths=widths)
        t.setStyle(TableStyle([
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("LINEBELOW", (0, 0), (-1, -1), 0.6, RULE),
            ("LINEBELOW", (0, 0), (-1, 0), 1.0, INK) if head else ("LINEBELOW", (0, 0), (-1, 0), 0.6, RULE),
            ("TOPPADDING", (0, 0), (-1, -1), 4), ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
            ("LEFTPADDING", (0, 0), (-1, -1), 0), ("RIGHTPADDING", (0, 0), (-1, -1), 8),
        ]))
        _, h = t.wrap(W - 2 * M, self.y)
        t.drawOn(self.c, M, self.y - h)
        self.y -= h + 8

    def footer(self, n: int, text: str):
        self.c.setFont(self.reg, 8.5)
        self.c.setFillColor(DIM)
        self.c.drawString(M, 26, text)
        self.c.drawRightString(W - M, 26, str(n))

    def new_page(self, n: int, foot: str):
        self.footer(n, foot)
        self.c.showPage()
        self.y = H - M


# ----------------------------------------------------------------------------- text

T = json.loads((HERE / "pack_text.json").read_text(encoding="utf-8"))


def guide(pen: Pen, t: dict, page: int) -> int:
    c = pen.c
    c.setFillColor(INK)
    pen.p(t["kicker"], 9.5, bold=True, color=DIM, gap=4)
    pen.p(t["title"], 26, bold=True, gap=2, lead=1.15)
    pen.p(t["subtitle"], 14, color=DIM, gap=12)
    c.setStrokeColor(INK); c.setLineWidth(1.2); c.line(M, pen.y + 4, W - M, pen.y + 4); pen.y -= 8
    pen.h(t["why_h"], before=2); pen.p(t["why"], 11.5)
    pen.h(t["what_h"]); pen.bullets(t["what"], 11.5)
    pen.h(t["contents_h"]); pen.table([t["contents_head"]] + t["contents"], [200, W - 2 * M - 200], 10.5)
    pen.h(t["need_h"]); pen.bullets(t["need"], 11.5)
    pen.p(t["link_line"], 11.5, gap=14)
    pen.p(t["honest"], 10, color=DIM, gap=0)
    pen.new_page(page, t["foot"]); page += 1

    pen.h(t["lesson_h"], 18, before=0)
    pen.table([t["lesson_head"]] + t["lesson"], [62, 255, W - 2 * M - 317], 10.5)
    pen.h(t["before_h"]); pen.bullets(t["before"], 11)
    pen.h(t["glance_h"])
    pen.table([t["glance_head"]] + t["glance"], [100, 165, W - 2 * M - 265], 10)
    pen.p(t["curriculum_note"], 9.5, color=DIM)
    pen.new_page(page, t["foot"]); page += 1

    pen.h(t["test_h"], 18, before=0); pen.p(t["test_intro"], 11)
    pen.bullets(t["test"], 11, numbered=True)
    pen.h(t["keys_h"]); pen.table([t["keys_head"]] + t["keys"], [110, W - 2 * M - 110], 10.5)
    pen.h(t["data_h"]); pen.bullets(t["data"], 10.5)
    assert pen.y > 40, "page 3 overflows into the footer"
    pen.new_page(page, t["foot"]); page += 1
    return page


def card(pen: Pen, t: dict, k: dict, page: int) -> int:
    c = pen.c
    col = SIGN[k["sign"]]
    c.setFillColor(col); c.rect(0, H - 14, W, 14, stroke=0, fill=1)          # colour band (top)
    c.rect(0, 0, 10, H, stroke=0, fill=1)                                       # and left edge
    pen.y = H - M + 2
    pen.p(k["label"], 12, bold=True, color=col, gap=8)
    pen.p(k["q"], 27, bold=True, gap=14, lead=1.18)
    pen.p(t["card_hear"], 15, bold=True, gap=4)
    pen.bullets(k["hear"], 17, gap=5)
    pen.y -= 6
    pen.p(t["card_how"], 15, bold=True, gap=4)
    pen.bullets(k["how"], 17, gap=5, numbered=True)
    pen.y -= 6
    pen.p(t["card_talk"], 15, bold=True, gap=4)
    pen.bullets(k["talk"], 15, gap=4)
    pen.y -= 4
    pen.p(t["card_keys"], 11.5, color=DIM, gap=3)
    pen.p(k["data"], 10, color=DIM, gap=0)
    pen.new_page(page, t["foot"])
    return page + 1


def on_land(rings: list, lon: float, lat: float) -> bool:
    """Even-odd ray casting over every land ring (lon/lat degrees)."""
    inside = False
    for ring in rings:
        n = len(ring)
        for i in range(n):
            (x1, y1), (x2, y2) = ring[i], ring[(i + 1) % n]
            if (y1 > lat) != (y2 > lat) and lon < x1 + (lat - y1) * (x2 - x1) / (y2 - y1):
                inside = not inside
    return inside


def tactile_map(pen: Pen, t: dict, page: int) -> int:
    c = pen.c
    pen.p(t["map_title"], 22, bold=True, gap=4)
    pen.p(t["map_intro"], 11, gap=8)
    land = json.loads((HERE / "sea-land-110m.json").read_text())
    lon0, lon1, lat0, lat1 = 90.0, 130.0, -12.0, 22.0
    fw = W - 2 * M
    fh = fw * (lat1 - lat0) / (lon1 - lon0)
    fx, fy = M, pen.y - fh
    X = lambda lon: fx + (lon - lon0) / (lon1 - lon0) * fw          # noqa: E731
    Y = lambda lat: fy + (lat - lat0) / (lat1 - lat0) * fh          # noqa: E731
    c.saveState()
    clip = c.beginPath(); clip.rect(fx, fy, fw, fh); c.clipPath(clip, stroke=0, fill=0)
    # land: outline 1.5 mm, plus a sparse dot texture so land and sea feel different
    paths = []
    for ring in land["rings"]:
        p = c.beginPath()
        for i, (lon, lat) in enumerate(ring):
            (p.moveTo if i == 0 else p.lineTo)(X(lon), Y(lat))
        p.close(); paths.append(p)
    c.setFillColor(colors.black)
    step = 4.2 * mm
    yy, row = fy + step / 2, 0
    while yy < fy + fh:
        xx = fx + (step / 2 if row % 2 else step / 4)
        lat = lat0 + (yy - fy) / fh * (lat1 - lat0)
        while xx < fx + fw:
            lon = lon0 + (xx - fx) / fw * (lon1 - lon0)
            if on_land(land["rings"], lon, lat):
                c.circle(xx, yy, 0.55 * mm, stroke=0, fill=1)
            xx += step
        yy += step; row += 1
    c.setStrokeColor(colors.black); c.setLineWidth(1.5 * mm); c.setLineJoin(1)
    for p in paths:
        c.drawPath(p, stroke=1, fill=0)
    # equator: dashed
    c.setLineWidth(0.8 * mm); c.setDash(3 * mm, 3 * mm)
    c.line(fx, Y(0), fx + fw, Y(0)); c.setDash()
    c.restoreState()
    c.setLineWidth(1.2); c.rect(fx, fy, fw, fh, stroke=1, fill=0)
    # cities: four distinct symbols, 7 mm, with a white ring so they stand apart from the coast
    s = 3.5 * mm

    def sym(kind: str, x: float, y: float, size: float = s):
        c.setFillColor(colors.white); c.circle(x, y, size + 1.6 * mm, stroke=0, fill=1)
        c.setFillColor(colors.black)
        if kind == "circle":
            c.circle(x, y, size, stroke=0, fill=1)
        elif kind == "square":
            c.rect(x - size, y - size, 2 * size, 2 * size, stroke=0, fill=1)
        elif kind == "triangle":
            p = c.beginPath(); p.moveTo(x, y + size * 1.15); p.lineTo(x - size * 1.1, y - size * .85); p.lineTo(x + size * 1.1, y - size * .85); p.close()
            c.drawPath(p, stroke=0, fill=1)
        else:  # diamond
            p = c.beginPath(); p.moveTo(x, y + size * 1.2); p.lineTo(x + size * 1.2, y); p.lineTo(x, y - size * 1.2); p.lineTo(x - size * 1.2, y); p.close()
            c.drawPath(p, stroke=0, fill=1)
    cities = [("circle", 3.14, 101.69), ("square", -6.2, 106.85), ("triangle", 1.55, 110.34), ("diamond", 13.75, 100.5)]
    for kind, lat, lon in cities:
        sym(kind, X(lon), Y(lat))
    # north arrow (top right)
    ax, ay = fx + fw - 12 * mm, fy + fh - 22 * mm
    c.setFillColor(colors.white); c.rect(ax - 7 * mm, ay - 3 * mm, 14 * mm, 22 * mm, stroke=0, fill=1)
    c.setFillColor(colors.black)
    p = c.beginPath(); p.moveTo(ax, ay + 16 * mm); p.lineTo(ax - 4.5 * mm, ay + 6 * mm); p.lineTo(ax + 4.5 * mm, ay + 6 * mm); p.close(); c.drawPath(p, stroke=0, fill=1)
    c.setLineWidth(1.2 * mm); c.line(ax, ay, ax, ay + 7 * mm)
    c.setFont(pen.bold, 13); c.drawCentredString(ax, ay - 2 * mm - 9, "N")
    pen.y = fy - 14
    # legend: symbol, place (large print), a line for the braille label
    pen.p(t["legend_title"], 13, bold=True, gap=6)
    c.setFont(pen.bold, 10); c.setFillColor(DIM)
    c.drawString(M + 16 * mm, pen.y - 10, t["legend_head"][1]); c.drawString(M + 105 * mm, pen.y - 10, t["legend_head"][2])
    pen.y -= 18
    row_h = 9 * mm
    kinds = [k for k, _, _ in cities] + ["equator"]
    for kind, name in zip(kinds, t["legend"]):
        cy = pen.y - row_h / 2
        if kind == "equator":
            c.setStrokeColor(colors.black); c.setLineWidth(0.8 * mm); c.setDash(2.5 * mm, 2.5 * mm)
            c.line(M, cy, M + 12 * mm, cy); c.setDash()
        else:
            sym(kind, M + 6 * mm, cy, 2.8 * mm)
        c.setFillColor(INK); c.setFont(pen.reg, 13); c.drawString(M + 16 * mm, cy - 4.5, name)
        c.setStrokeColor(DIM); c.setLineWidth(0.6); c.line(M + 105 * mm, cy - 5, W - M, cy - 5)
        pen.y -= row_h
    pen.y -= 6
    pen.p(t["map_note"], 9.5, color=DIM)
    pen.new_page(page, t["foot"])
    return page + 1


def build(lang: str, out: Path) -> None:
    t = T[lang]
    c = canvas.Canvas(str(out), pagesize=A4)
    c.setTitle(t["pdf_title"]); c.setAuthor("Hearthbeat"); c.setSubject(t["subtitle"])
    pen = Pen(c, lang)
    page = guide(pen, t, 1)
    for k in t["cards"]:
        page = card(pen, t, k, page)
    tactile_map(pen, t, page)
    c.save()


if __name__ == "__main__":
    import shutil
    langs = sys.argv[1:] or ["en", "zh"]
    app_copy = HERE.parent.parent / "app" / "public" / "classroom"   # served by the web app too
    app_copy.mkdir(parents=True, exist_ok=True)
    for lang in langs:
        out = HERE / f"hearthbeat-classroom-pack-{lang}.pdf"
        build(lang, out)
        shutil.copyfile(out, app_copy / out.name)
        print("wrote", out, "and", app_copy / out.name)
