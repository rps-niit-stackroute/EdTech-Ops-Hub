"""Generate a styled SOW Excel from aggregated rows."""
import io
import openpyxl
from openpyxl.styles import Font, PatternFill, Border, Side, Alignment


HEADER_FILL = PatternFill("solid", fgColor="1F2937")
SUBTOTAL_FILL = PatternFill("solid", fgColor="E5E7EB")
GRAND_FILL = PatternFill("solid", fgColor="FDE68A")
THIN = Side(style="thin", color="9CA3AF")
BORDER = Border(left=THIN, right=THIN, top=THIN, bottom=THIN)

COLUMNS = ["Mentor Name", "Program Name", "Project Code", "Client",
           "Month", "Sessions Conducted", "Total Hours"]
KEYS = ["mentor", "program_name", "project_code", "client", "month",
        "sessions_conducted", "total_hours"]


def build_sow_excel(grouped, month_label):
    """grouped: list of {mentor, rows:[...], subtotal_sessions, subtotal_hours}
    plus we compute grand totals here. Returns bytes."""
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = f"SOW - {month_label}"[:31]

    # header
    for ci, col in enumerate(COLUMNS, start=1):
        c = ws.cell(row=1, column=ci, value=col)
        c.font = Font(bold=True, color="FFFFFF")
        c.fill = HEADER_FILL
        c.border = BORDER
        c.alignment = Alignment(horizontal="center", vertical="center")

    r = 2
    grand_sessions = 0
    grand_hours = 0.0
    for grp in grouped:
        for row in grp["rows"]:
            vals = [row["mentor"], row["program_name"], row["project_code"],
                    row["client"], row["month"], row["sessions_conducted"], row["total_hours"]]
            for ci, v in enumerate(vals, start=1):
                cell = ws.cell(row=r, column=ci, value=v)
                cell.border = BORDER
            r += 1
        # subtotal
        st = ws.cell(row=r, column=1, value=f"{grp['mentor']} — Subtotal")
        for ci in range(1, 8):
            ws.cell(row=r, column=ci).fill = SUBTOTAL_FILL
            ws.cell(row=r, column=ci).font = Font(bold=True)
            ws.cell(row=r, column=ci).border = BORDER
        ws.cell(row=r, column=6, value=grp["subtotal_sessions"])
        ws.cell(row=r, column=7, value=round(grp["subtotal_hours"], 2))
        grand_sessions += grp["subtotal_sessions"]
        grand_hours += grp["subtotal_hours"]
        r += 1

    # grand total
    ws.cell(row=r, column=1, value="GRAND TOTAL")
    for ci in range(1, 8):
        ws.cell(row=r, column=ci).fill = GRAND_FILL
        ws.cell(row=r, column=ci).font = Font(bold=True)
        ws.cell(row=r, column=ci).border = BORDER
    ws.cell(row=r, column=6, value=grand_sessions)
    ws.cell(row=r, column=7, value=round(grand_hours, 2))

    widths = [22, 34, 26, 16, 12, 18, 14]
    for ci, w in enumerate(widths, start=1):
        ws.column_dimensions[openpyxl.utils.get_column_letter(ci)].width = w

    out = io.BytesIO()
    wb.save(out)
    out.seek(0)
    return out.getvalue()
