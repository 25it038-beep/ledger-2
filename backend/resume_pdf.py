"""
Resume PDF Generator using ReportLab.

Produces authentic, professional A4 PDFs with selectable text, clickable hyperlinks,
clean typography, and ATS-friendly single/dual column flowable structures.
Supports 5 distinct styling templates:
1. Minimal Professional
2. Modern Developer
3. ATS Friendly
4. Student / Internship
5. Technical
"""

import io
import re
from xml.sax.saxutils import escape as xml_escape
from typing import Dict, Any, List

from reportlab.lib.pagesizes import A4
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, HRFlowable, Table, TableStyle, KeepTogether
)
from reportlab.pdfgen import canvas


def _clean_text(val: Any) -> str:
    """Safely escape and stringify text for ReportLab XML parser."""
    if val is None:
        return ""
    s = str(val).strip()
    # Strip emojis and unsupported Unicode astral plane characters
    s = re.sub(r'[\U00010000-\U0010ffff]', '', s)
    # Normalize common non-ASCII punctuation for Helvetica WinAnsiEncoding
    s = s.replace('\u2713', '[Verified]').replace('\u2714', '[Verified]')
    s = s.replace('\u2013', '-').replace('\u2014', '--')
    s = s.replace('\u2018', "'").replace('\u2019', "'").replace('\u201c', '"').replace('\u201d', '"')
    s = s.replace('\u2022', '*').replace('\u2026', '...')
    # Encode and ignore characters that cannot be encoded in Latin-1 if using Helvetica
    s = s.encode('latin-1', 'replace').decode('latin-1')
    return xml_escape(s)


class NumberedCanvas(canvas.Canvas):
    """Adds subtle page numbering if document spans multiple pages."""
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self._saved_page_states = []

    def showPage(self):
        self._saved_page_states.append(dict(self.__dict__))
        self._startPage()

    def save(self):
        num_pages = len(self._saved_page_states)
        for state in self._saved_page_states:
            self.__dict__.update(state)
            if num_pages > 1:
                self.saveState()
                self.setFont("Helvetica", 8)
                self.setFillColor(colors.HexColor("#64748b"))
                page_str = f"Page {self._pageNumber} of {num_pages}"
                self.drawRightString(A4[0] - 36, 20, page_str)
                self.restoreState()
            super().showPage()
        super().save()


def generate_resume_pdf(resume_data: Dict[str, Any]) -> bytes:
    """
    Renders the provided resume JSON into a production-grade PDF document.
    Returns the binary content as bytes.
    """
    buffer = io.BytesIO()
    doc = SimpleDocTemplate(
        buffer,
        pagesize=A4,
        leftMargin=36,
        rightMargin=36,
        topMargin=36,
        bottomMargin=36
    )

    template_id = resume_data.get("template", "minimal_professional")
    personal = resume_data.get("personal", {})
    summary = resume_data.get("summary", "")
    education = resume_data.get("education", [])
    skills = resume_data.get("skills", {})
    projects = resume_data.get("projects", [])
    experience = resume_data.get("experience", [])
    certifications = resume_data.get("certifications", [])
    achievements = resume_data.get("achievements", [])
    languages = resume_data.get("languages", [])

    # Color Palette per Template
    if template_id == "modern_developer":
        primary_color = colors.HexColor("#0f766e")    # Teal accent
        heading_color = colors.HexColor("#0f172a")    # Deep Slate
        text_color = colors.HexColor("#334155")       # Slate
        line_color = colors.HexColor("#0f766e")
        font_family = "Helvetica"
    elif template_id == "technical":
        primary_color = colors.HexColor("#1d4ed8")    # Cobalt Blue
        heading_color = colors.HexColor("#020617")    # Dark
        text_color = colors.HexColor("#1e293b")
        line_color = colors.HexColor("#94a3b8")
        font_family = "Helvetica"
    elif template_id == "student_internship":
        primary_color = colors.HexColor("#4338ca")    # Indigo
        heading_color = colors.HexColor("#1e1b4b")
        text_color = colors.HexColor("#312e81")
        line_color = colors.HexColor("#6366f1")
        font_family = "Helvetica"
    elif template_id == "ats_friendly":
        primary_color = colors.HexColor("#000000")    # Pure High-Contrast Black
        heading_color = colors.HexColor("#000000")
        text_color = colors.HexColor("#111111")
        line_color = colors.HexColor("#000000")
        font_family = "Helvetica"
    else:  # minimal_professional
        primary_color = colors.HexColor("#1e293b")    # Charcoal
        heading_color = colors.HexColor("#0f172a")
        text_color = colors.HexColor("#334155")
        line_color = colors.HexColor("#cbd5e1")
        font_family = "Helvetica"

    styles = getSampleStyleSheet()

    title_style = ParagraphStyle(
        "ResumeTitle",
        fontName=f"{font_family}-Bold",
        fontSize=20,
        leading=24,
        textColor=heading_color,
        alignment=0 if template_id in ["modern_developer", "technical"] else 1
    )

    contact_style = ParagraphStyle(
        "ContactInfo",
        fontName=font_family,
        fontSize=9,
        leading=13,
        textColor=colors.HexColor("#475569"),
        alignment=0 if template_id in ["modern_developer", "technical"] else 1
    )

    section_heading_style = ParagraphStyle(
        "SectionHeading",
        fontName=f"{font_family}-Bold",
        fontSize=11,
        leading=15,
        textColor=primary_color,
        spaceBefore=8,
        spaceAfter=3,
        keepWithNext=True
    )

    body_style = ParagraphStyle(
        "BodyTextCustom",
        fontName=font_family,
        fontSize=9,
        leading=12.5,
        textColor=text_color
    )

    bullet_style = ParagraphStyle(
        "BulletCustom",
        fontName=font_family,
        fontSize=8.5,
        leading=12,
        textColor=text_color,
        leftIndent=12,
        firstLineIndent=-8
    )

    subhead_bold = ParagraphStyle(
        "SubheadBold",
        fontName=f"{font_family}-Bold",
        fontSize=9.5,
        leading=13,
        textColor=heading_color
    )

    subhead_right = ParagraphStyle(
        "SubheadRight",
        fontName=font_family,
        fontSize=8.5,
        leading=13,
        textColor=colors.HexColor("#64748b"),
        alignment=2
    )

    story = []

    # 1. Header (Personal Info)
    name = _clean_text(personal.get("name", "Candidate"))
    story.append(Paragraph(name, title_style))
    story.append(Spacer(1, 4))

    contact_parts = []
    if personal.get("email"):
        em = _clean_text(personal.get("email"))
        contact_parts.append(f'<a href="mailto:{em}"><font color="{primary_color.hexval()}">{em}</font></a>')
    if personal.get("phone"):
        contact_parts.append(_clean_text(personal.get("phone")))
    if personal.get("location"):
        contact_parts.append(_clean_text(personal.get("location")))
    if personal.get("linkedin"):
        li = _clean_text(personal.get("linkedin"))
        contact_parts.append(f'<a href="{li}"><font color="{primary_color.hexval()}">LinkedIn</font></a>')
    if personal.get("github"):
        gh = _clean_text(personal.get("github"))
        contact_parts.append(f'<a href="{gh}"><font color="{primary_color.hexval()}">GitHub</font></a>')
    if personal.get("portfolio"):
        pf = _clean_text(personal.get("portfolio"))
        contact_parts.append(f'<a href="{pf}"><font color="{primary_color.hexval()}">Portfolio</font></a>')

    if contact_parts:
        sep = " &bull; " if template_id != "ats_friendly" else " | "
        contact_line = sep.join(contact_parts)
        story.append(Paragraph(contact_line, contact_style))
        story.append(Spacer(1, 8))

    story.append(HRFlowable(width="100%", thickness=1.2 if template_id == "ats_friendly" else 0.8, color=line_color, spaceBefore=0, spaceAfter=8))

    # Helper function for section divider
    def add_section_header(title: str):
        story.append(Paragraph(title.upper() if template_id in ["ats_friendly", "minimal_professional"] else title, section_heading_style))
        if template_id != "ats_friendly":
            story.append(HRFlowable(width="100%", thickness=0.5, color=line_color, spaceBefore=2, spaceAfter=6))
        else:
            story.append(HRFlowable(width="100%", thickness=0.5, color=colors.black, spaceBefore=1, spaceAfter=4))

    # Determine Section Ordering based on target/template
    target = resume_data.get("target", "General")
    if template_id == "student_internship" or target == "Student / Internship":
        section_order = ["summary", "education", "skills", "projects", "achievements", "experience", "certifications", "languages"]
    elif template_id == "technical":
        section_order = ["summary", "skills", "projects", "experience", "education", "certifications", "achievements", "languages"]
    else:
        section_order = ["summary", "skills", "experience", "projects", "education", "certifications", "achievements", "languages"]

    # 2. Iterate sections
    for sec in section_order:
        if sec == "summary" and summary:
            add_section_header("Professional Summary" if template_id != "ats_friendly" else "Summary")
            story.append(Paragraph(_clean_text(summary), body_style))
            story.append(Spacer(1, 6))

        elif sec == "skills" and skills:
            add_section_header("Technical Skills" if template_id != "ats_friendly" else "Skills")
            for cat_name, cat_skills in skills.items():
                if not cat_skills:
                    continue
                skills_str = ", ".join([_clean_text(s) for s in cat_skills])
                line = f"<b>{_clean_text(cat_name)}:</b> {skills_str}"
                story.append(Paragraph(line, bullet_style))
            story.append(Spacer(1, 6))

        elif sec == "experience" and experience:
            add_section_header("Experience & Internships" if template_id != "ats_friendly" else "Experience")
            for exp in experience:
                role = _clean_text(exp.get("role", "Developer"))
                org = _clean_text(exp.get("organization", ""))
                duration = _clean_text(exp.get("duration", ""))
                
                left_p = Paragraph(f"<b>{role}</b> &mdash; {org}" if org else f"<b>{role}</b>", subhead_bold)
                right_p = Paragraph(f"<i>{duration}</i>", subhead_right)
                
                tbl = Table([[left_p, right_p]], colWidths=[380, 143])
                tbl.setStyle(TableStyle([
                    ("VALIGN", (0, 0), (-1, -1), "TOP"),
                    ("LEFTPADDING", (0, 0), (-1, -1), 0),
                    ("RIGHTPADDING", (0, 0), (-1, -1), 0),
                    ("BOTTOMPADDING", (0, 0), (-1, -1), 2),
                    ("TOPPADDING", (0, 0), (-1, -1), 0),
                ]))
                story.append(tbl)

                resps = exp.get("responsibilities", [])
                if isinstance(resps, list):
                    for r in resps:
                        story.append(Paragraph(f"&bull;&nbsp;&nbsp;{_clean_text(r)}", bullet_style))
                elif resps:
                    story.append(Paragraph(f"&bull;&nbsp;&nbsp;{_clean_text(resps)}", bullet_style))
                story.append(Spacer(1, 4))
            story.append(Spacer(1, 4))

        elif sec == "projects" and projects:
            add_section_header("Projects")
            for p in projects:
                name = _clean_text(p.get("name", "Project"))
                techs = ", ".join([_clean_text(t) for t in p.get("technologies", [])])
                link = p.get("link", "")
                
                name_str = f"<b>{name}</b>"
                if techs:
                    name_str += f" | <i>{techs}</i>"
                if link:
                    clean_link = _clean_text(link)
                    name_str += f' &nbsp;[<a href="{clean_link}"><font color="{primary_color.hexval()}">Link</font></a>]'

                story.append(Paragraph(name_str, subhead_bold))

                desc = p.get("description", "")
                if desc:
                    story.append(Paragraph(f"&bull;&nbsp;&nbsp;{_clean_text(desc)}", bullet_style))

                ach = p.get("achievements", "")
                if ach:
                    story.append(Paragraph(f"&bull;&nbsp;&nbsp;<b>Key Result:</b> {_clean_text(ach)}", bullet_style))

                story.append(Spacer(1, 4))
            story.append(Spacer(1, 4))

        elif sec == "education" and education:
            add_section_header("Education")
            for edu in education:
                degree = _clean_text(edu.get("degree", ""))
                institution = _clean_text(edu.get("institution", ""))
                branch = _clean_text(edu.get("branch", ""))
                year = _clean_text(edu.get("year", ""))
                cgpa = _clean_text(edu.get("cgpa", ""))

                title_line = f"<b>{degree}</b>"
                if branch and branch not in degree:
                    title_line += f" in {branch}"
                if institution:
                    title_line += f" &mdash; {institution}"

                left_p = Paragraph(title_line, subhead_bold)
                right_p = Paragraph(f"<i>{year}</i>", subhead_right)

                tbl = Table([[left_p, right_p]], colWidths=[380, 143])
                tbl.setStyle(TableStyle([
                    ("VALIGN", (0, 0), (-1, -1), "TOP"),
                    ("LEFTPADDING", (0, 0), (-1, -1), 0),
                    ("RIGHTPADDING", (0, 0), (-1, -1), 0),
                    ("BOTTOMPADDING", (0, 0), (-1, -1), 2),
                    ("TOPPADDING", (0, 0), (-1, -1), 0),
                ]))
                story.append(tbl)

                if cgpa:
                    story.append(Paragraph(f"&bull;&nbsp;&nbsp;<b>Academic Score:</b> {cgpa}", bullet_style))
                story.append(Spacer(1, 4))
            story.append(Spacer(1, 4))

        elif sec == "certifications" and certifications:
            add_section_header("Certifications")
            for cert in certifications:
                c_name = _clean_text(cert.get("name", ""))
                issuer = _clean_text(cert.get("issuer", ""))
                date = _clean_text(cert.get("date", ""))
                cred = cert.get("credential_url", "")

                cert_line = f"<b>{c_name}</b>"
                if issuer:
                    cert_line += f" &mdash; {issuer}"
                if cred:
                    clean_cred = _clean_text(cred)
                    cert_line += f' [<a href="{clean_cred}"><font color="{primary_color.hexval()}">Verify</font></a>]'

                left_p = Paragraph(cert_line, subhead_bold)
                right_p = Paragraph(f"<i>{date}</i>", subhead_right)

                tbl = Table([[left_p, right_p]], colWidths=[400, 123])
                tbl.setStyle(TableStyle([
                    ("VALIGN", (0, 0), (-1, -1), "TOP"),
                    ("LEFTPADDING", (0, 0), (-1, -1), 0),
                    ("RIGHTPADDING", (0, 0), (-1, -1), 0),
                    ("BOTTOMPADDING", (0, 0), (-1, -1), 2),
                    ("TOPPADDING", (0, 0), (-1, -1), 0),
                ]))
                story.append(tbl)
            story.append(Spacer(1, 6))

        elif sec == "achievements" and achievements:
            add_section_header("Achievements & Honors")
            for ach in achievements:
                a_title = _clean_text(ach.get("title", ""))
                desc = _clean_text(ach.get("description", ""))
                date = _clean_text(ach.get("date", ""))

                left_p = Paragraph(f"<b>{a_title}</b>", subhead_bold)
                right_p = Paragraph(f"<i>{date}</i>", subhead_right)

                tbl = Table([[left_p, right_p]], colWidths=[400, 123])
                tbl.setStyle(TableStyle([
                    ("VALIGN", (0, 0), (-1, -1), "TOP"),
                    ("LEFTPADDING", (0, 0), (-1, -1), 0),
                    ("RIGHTPADDING", (0, 0), (-1, -1), 0),
                    ("BOTTOMPADDING", (0, 0), (-1, -1), 2),
                    ("TOPPADDING", (0, 0), (-1, -1), 0),
                ]))
                story.append(tbl)
                if desc:
                    story.append(Paragraph(f"&bull;&nbsp;&nbsp;{desc}", bullet_style))
                story.append(Spacer(1, 3))
            story.append(Spacer(1, 6))

        elif sec == "languages" and languages:
            add_section_header("Languages")
            lang_str = ", ".join([_clean_text(l) for l in languages])
            story.append(Paragraph(lang_str, body_style))
            story.append(Spacer(1, 6))

    # Build the document using the NumberedCanvas
    doc.build(story, canvasmaker=NumberedCanvas)
    return buffer.getvalue()
