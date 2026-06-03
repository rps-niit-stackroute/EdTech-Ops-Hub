"""Shared Excel/date/time parsing helpers."""
import re
import os
from copy import copy
from datetime import datetime, date

MONTHS_FULL = ["january", "february", "march", "april", "may", "june", "july",
               "august", "september", "october", "november", "december"]
MONTHS_ABBR = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep",
               "oct", "nov", "dec"]


def ordinal(n):
    if 10 <= n % 100 <= 20:
        suf = "th"
    else:
        suf = {1: "st", 2: "nd", 3: "rd"}.get(n % 10, "th")
    return suf


def parse_time_to_24h(value):
    """Parse '10:00 AM', '10:00', '6PM', '6 PM', '12:00 PM' -> 'HH:MM' (24h). Returns None on fail."""
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.strftime("%H:%M")
    s = str(value).strip().upper()
    if not s:
        return None
    s = s.replace("(IST)", "").strip()
    m = re.search(r'(\d{1,2})\s*[:\.]?\s*(\d{2})?\s*(AM|PM)?', s)
    if not m:
        return None
    hh = int(m.group(1))
    mm = int(m.group(2)) if m.group(2) else 0
    ap = m.group(3)
    if ap == "AM":
        if hh == 12:
            hh = 0
    elif ap == "PM":
        if hh != 12:
            hh += 12
    if hh > 23 or mm > 59:
        return None
    return f"{hh:02d}:{mm:02d}"


def time_to_minutes(hhmm):
    if not hhmm:
        return None
    try:
        h, m = str(hhmm).split(":")
        return int(h) * 60 + int(m)
    except Exception:
        return None


def parse_date_flexible(value):
    """Return ISO 'YYYY-MM-DD' from many formats / datetime, else None."""
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.strftime("%Y-%m-%d")
    if isinstance(value, date):
        return value.strftime("%Y-%m-%d")
    s = str(value).strip()
    if not s:
        return None
    fmts = ["%Y-%m-%d", "%d-%b-%Y", "%d-%B-%Y", "%d/%m/%Y", "%m/%d/%Y",
            "%d-%m-%Y", "%d %b %Y", "%d %B %Y", "%Y/%m/%d", "%d/%m/%y",
            "%m/%d/%y", "%d-%b-%y"]
    for f in fmts:
        try:
            return datetime.strptime(s, f).strftime("%Y-%m-%d")
        except Exception:
            continue
    # try day ordinal month year e.g. 20th May 2026
    m = re.search(r'(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]+)\s*(\d{4})?', s)
    if m:
        day = int(m.group(1))
        mon = m.group(2).lower()[:3]
        if mon in MONTHS_ABBR:
            yr = int(m.group(3)) if m.group(3) else datetime.now().year
            try:
                return date(yr, MONTHS_ABBR.index(mon) + 1, day).strftime("%Y-%m-%d")
            except Exception:
                return None
    return None


def parse_duration_to_minutes(value):
    """Parse '1h 7m 35s', '55m 13s', '3h', '01:07:35', '2h 59m 52s' -> float minutes."""
    if value is None:
        return 0.0
    s = str(value).strip()
    if not s:
        return 0.0
    # HH:MM:SS or H:MM:SS
    cm = re.fullmatch(r'(\d{1,3}):(\d{1,2}):(\d{1,2})', s)
    if cm:
        h, m, sec = int(cm.group(1)), int(cm.group(2)), int(cm.group(3))
        return h * 60 + m + sec / 60.0
    # token style
    total = 0.0
    found = False
    hm = re.search(r'(\d+)\s*h', s, re.I)
    mm = re.search(r'(\d+)\s*m(?!s)', s, re.I)
    sm = re.search(r'(\d+)\s*s', s, re.I)
    if hm:
        total += int(hm.group(1)) * 60
        found = True
    if mm:
        total += int(mm.group(1))
        found = True
    if sm:
        total += int(sm.group(1)) / 60.0
        found = True
    if found:
        return total
    # plain number = minutes
    try:
        return float(s)
    except Exception:
        return 0.0


def copy_cell_style(src, dst):
    """Copy visual style (font, fill, border, alignment, number format) src->dst cell."""
    try:
        if src.has_style:
            dst.font = copy(src.font)
            dst.fill = copy(src.fill)
            dst.border = copy(src.border)
            dst.alignment = copy(src.alignment)
            dst.number_format = src.number_format
            dst.protection = copy(src.protection)
    except Exception:
        pass


def normalize_teams_name(raw):
    """'Saleem, Abdul Baseer (Cognizant)' -> 'Abdul Baseer Saleem'. Strips company in parens."""
    if not raw:
        return ""
    s = str(raw).strip()
    s = re.sub(r'\([^)]*\)', '', s).strip()  # strip company
    if "," in s:
        parts = s.split(",", 1)
        last = parts[0].strip()
        first = parts[1].strip()
        s = f"{first} {last}".strip()
    return re.sub(r'\s+', ' ', s).strip()


def rename_with_new_date(orig_filename, new_iso_date):
    """Replace the date segment in the filename with new date, keeping the same format.
    e.g. NIIT_CNA_20thMay.xlsx + 2026-05-22 -> NIIT_CNA_22ndMay.xlsx
    """
    try:
        nd = datetime.strptime(new_iso_date, "%Y-%m-%d")
    except Exception:
        return orig_filename
    base, ext = os.path.splitext(orig_filename)
    if not ext:
        ext = ".xlsx"

    # Pattern: day + optional ordinal + optional space + month name (abbr or full)
    pat = re.compile(r'(\d{1,2})(st|nd|rd|th)?(\s*)([A-Za-z]{3,9})')

    def repl(m):
        month_tok = m.group(4)
        mtl = month_tok.lower()
        is_full = mtl in MONTHS_FULL
        is_abbr = mtl in MONTHS_ABBR
        if not (is_full or is_abbr):
            return m.group(0)
        day = nd.day
        had_ord = m.group(2) is not None
        space = m.group(3)
        if is_full:
            new_month = nd.strftime("%B")
        else:
            new_month = nd.strftime("%b")
        # preserve case style of original token
        if month_tok.isupper():
            new_month = new_month.upper()
        elif month_tok.islower():
            new_month = new_month.lower()
        out = str(day)
        if had_ord:
            out += ordinal(day)
        out += space + new_month
        return out

    new_base, n = pat.subn(repl, base)
    if n == 0:
        # Try numeric date dd-mm-yyyy etc -> just append
        new_base = base + "_" + nd.strftime("%d-%b-%Y")
    return new_base + ext
