"""
EcoGuard PDF & CSV Export Service (zero external binary dependencies).
"""

import csv
import io
import textwrap


def _escape_pdf_text(text_value):
    sanitized = str(text_value).encode("latin-1", "replace").decode("latin-1")
    return sanitized.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")


def build_pdf_report(title, sections):
    """
    Build a clean, paginated PDF report from a list of (heading, lines) sections.
    """
    page_lines = []
    current_page = [("TITLE", title)]
    max_lines_per_page = 38

    for heading, lines in sections:
        block = [("HEADING", heading)]
        for raw_line in lines:
            wrapped = textwrap.wrap(str(raw_line), width=88) or [""]
            for w in wrapped:
                block.append(("BODY", w))
        block.append(("SPACER", ""))

        for item in block:
            if len(current_page) >= max_lines_per_page:
                page_lines.append(current_page)
                current_page = []
            current_page.append(item)

    if current_page:
        page_lines.append(current_page)

    objects = []
    # 1: Catalog, 2: Pages, 3: Font Regular, 4: Font Bold
    num_pages = len(page_lines)
    page_obj_ids = []

    objects.append(b"1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n")

    first_page_obj = 5
    for idx in range(num_pages):
        page_obj_ids.append(first_page_obj + idx * 2)

    kids_str = " ".join(f"{pid} 0 R" for pid in page_obj_ids)
    objects.append(
        f"2 0 obj\n<< /Type /Pages /Kids [{kids_str}] /Count {num_pages} >>\nendobj\n".encode("latin-1")
    )
    objects.append(
        b"3 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n"
    )
    objects.append(
        b"4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>\nendobj\n"
    )

    for idx, lines in enumerate(page_lines):
        page_id = first_page_obj + idx * 2
        content_id = page_id + 1

        cmds = ["BT", "50 760 Td"]
        for kind, text_val in lines:
            escaped = _escape_pdf_text(text_val)
            if kind == "TITLE":
                cmds.append("/F2 16 Tf")
                cmds.append(f"({escaped}) Tj")
                cmds.append("0 -24 Td")
            elif kind == "HEADING":
                cmds.append("/F2 12 Tf")
                cmds.append(f"({escaped}) Tj")
                cmds.append("0 -18 Td")
            elif kind == "SPACER":
                cmds.append("0 -8 Td")
            else:
                cmds.append("/F1 10 Tf")
                cmds.append(f"({escaped}) Tj")
                cmds.append("0 -15 Td")

        cmds.append("ET")
        stream_bytes = "\n".join(cmds).encode("latin-1")

        objects.append(
            (
                f"{page_id} 0 obj\n"
                f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] "
                f"/Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> "
                f"/Contents {content_id} 0 R >>\nendobj\n"
            ).encode("latin-1")
        )
        objects.append(
            f"{content_id} 0 obj\n<< /Length {len(stream_bytes)} >>\nstream\n".encode("latin-1")
            + stream_bytes
            + b"\nendstream\nendobj\n"
        )

    pdf = bytearray(b"%PDF-1.4\n")
    offsets = [0]
    for obj in objects:
        offsets.append(len(pdf))
        pdf.extend(obj)

    xref_offset = len(pdf)
    pdf.extend(f"xref\n0 {len(objects) + 1}\n".encode("latin-1"))
    pdf.extend(b"0000000000 65535 f \n")
    for offset in offsets[1:]:
        pdf.extend(f"{offset:010d} 00000 n \n".encode("latin-1"))

    pdf.extend(
        (
            f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\n"
            f"startxref\n{xref_offset}\n%%EOF\n"
        ).encode("latin-1")
    )
    return bytes(pdf)


def alerts_to_csv(alerts):
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow([
        "id",
        "location",
        "latitude",
        "longitude",
        "risk_level",
        "status",
        "ndvi",
        "vegetation_loss",
        "email_status",
        "notes",
        "created_at",
    ])
    for alert in alerts:
        writer.writerow([
            alert.id,
            alert.location,
            alert.latitude,
            alert.longitude,
            alert.risk_level,
            getattr(alert, "status", "open"),
            alert.ndvi,
            alert.vegetation_loss,
            alert.email_status,
            getattr(alert, "notes", "") or "",
            alert.created_at.isoformat() if alert.created_at else "",
        ])
    return output.getvalue()
