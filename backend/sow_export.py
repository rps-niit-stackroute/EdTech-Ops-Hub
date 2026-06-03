"""Generate a styled SOW Excel from aggregated rows."""
import io
import openpyxl
from openpyxl.styles import Font, PatternFill, Border, Side, Alignment


HEADER_FILL = PatternFill("solid", fgColor="1F2937")
GRAND_FILL = PatternFill("solid", fgColor="FDE68A")
THIN = Side(style="thin", color="9CA3AF")
BORDER = Border(left=THIN, right=THIN, top=THIN, bottom=THIN)

COLUMNS = ["S.No", "Mentor Name", "Program Name", "Project Code", "Client",
           "Month", "Sessions Conducted", "Total Hours", "Dates"]


def build_sow_excel(grouped, month_label):
    """grouped: list of {mentor, rows:[...]}. No subtotal rows; only a grand total at the bottom."""
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = f"SOW - {month_label}"[:31]

    # header row
    for ci, col in enumerate(COLUMNS, start=1):
        c = ws.cell(row=1, column=ci, value=col)
        c.font = Font(bold=True, color="FFFFFF")
        c.fill = HEADER_FILL
        c.border = BORDER
        c.alignment = Alignment(horizontal="center", vertical="center")

    r = 2
    sno = 1
    grand_sessions = 0
    grand_hours = 0.0
    for grp in grouped:
        for row in grp["rows"]:
            vals = [sno, row["mentor"], row["program_name"], row["project_code"],
                    row["client"], row["month"], row["sessions_conducted"],
                    row["total_hours"], row.get("dates", "")]
            for ci, v in enumerate(vals, start=1):
                cell = ws.cell(row=r, column=ci, value=v)
                cell.border = BORDER
            grand_sessions += row["sessions_conducted"]
            grand_hours += row["total_hours"]
            sno += 1
            r += 1

    # grand total (no S.No)
    ws.cell(row=r, column=2, value="GRAND TOTAL")
    for ci in range(1, len(COLUMNS) + 1):
        ws.cell(row=r, column=ci).fill = GRAND_FILL
        ws.cell(row=r, column=ci).font = Font(bold=True)
        ws.cell(row=r, column=ci).border = BORDER
    ws.cell(row=r, column=7, value=grand_sessions)
    ws.cell(row=r, column=8, value=round(grand_hours, 2))

    widths = [6, 22, 34, 26, 16, 14, 18, 14, 34]
    for ci, w in enumerate(widths, start=1):
        ws.column_dimensions[openpyxl.utils.get_column_letter(ci)].width = w

    out = io.BytesIO()
    wb.save(out)
    out.seek(0)
    return out.getvalue()
