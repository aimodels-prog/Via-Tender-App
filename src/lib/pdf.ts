import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { type DocumentBranding, resolveDocumentBranding } from "./branding";

// Re-declaring for TypeScript support in this file
declare module "jspdf" {
  interface jsPDF {
    autoTable: any;
  }
}

export interface PDFExportOptions {
  template: "General" | "Specialized";
  branding?: DocumentBranding;
  expert: any;
  position_title: string;
}

function getPdfImageType(dataUrl: string): "PNG" | "JPEG" | "GIF" | "BMP" {
  const mime = dataUrl.match(/^data:image\/([^;]+);/i)?.[1]?.toLowerCase();
  if (mime === "jpeg" || mime === "jpg") return "JPEG";
  if (mime === "gif") return "GIF";
  if (mime === "bmp") return "BMP";
  return "PNG";
}

export async function generateReformatedCV(options: PDFExportOptions) {
  const doc = new jsPDF();
  const resolvedOptions = {
    ...options,
    branding: await resolveDocumentBranding(options.branding),
  };
  if (options.template === "Specialized") {
    return generateSpecialized(doc, resolvedOptions);
  }
  return generateDoc(doc, resolvedOptions);
}

function safeSplitText(doc: any, text: string, maxWidth: number): string[] {
  if (!text) return [];
  const blocks = String(text).split("\n");
  const result: string[] = [];

  blocks.forEach((block) => {
    const words = block
      .replace(/\r|\t|\u00A0/g, " ")
      .split(/\s+/)
      .filter(Boolean);
    let currentLine = "";

    if (words.length === 0) {
      result.push("");
      return;
    }

    words.forEach((word) => {
      const lineToTest = currentLine ? `${currentLine} ${word}` : word;
      const width = doc.getTextWidth(lineToTest);
      if (width > maxWidth) {
        if (currentLine) {
          result.push(currentLine);
          currentLine = word;
        } else {
          result.push(word);
          currentLine = "";
        }
      } else {
        currentLine = lineToTest;
      }
    });
    if (currentLine) {
      result.push(currentLine);
    }
  });

  return result;
}

function generateK1(doc: jsPDF, options: PDFExportOptions) {
  return generateDoc(doc, options);
}

function generateK2(doc: jsPDF, options: PDFExportOptions) {
  return generateDoc(doc, options);
}

function generateK9(doc: jsPDF, options: PDFExportOptions) {
  return generateDoc(doc, options);
}

function generateDoc(doc: any, options: PDFExportOptions) {
  const { expert, position_title, template } = options;
  const branding = options.branding || {};
  const isK9 = template === "General";
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const startX = 15;
  const contentWidth = pageWidth - startX * 2;

  const drawHeader = (doc: any, pageNum: number) => {
    if (branding?.header_base64) {
      doc.addImage(branding.header_base64, getPdfImageType(branding.header_base64), startX, 10, contentWidth, 25);
    } else {
      doc.setFont("helvetica", "bold");
      doc.setFontSize(10);
      doc.setTextColor(0);
      doc.text(
        "MINISTRY OF TRANSPORT, COMMUNICATIONS AND INFORMATION TECHNOLOGY (MTCIT)",
        startX,
        15,
      );
      doc.text("DIRECTORATE GENERAL OF ROADS & LAND TRANSPORT", startX, 20);
      doc.setFont("helvetica", "italic");
      doc.setFontSize(9);
      doc.text(
        "Consultancy Services for Supervision of Construction of 05-Bridges at Sohar - Al-Buraimi Road",
        startX,
        25,
      );
      doc.text("Tender No: 267/2023/MTCIT/HQ-64", startX, 30);

      doc.setDrawColor(0, 85, 170); // Blue Line
      doc.setLineWidth(1);
      doc.line(startX, 33, startX + contentWidth, 33);

      doc.setDrawColor(0);
      doc.setLineWidth(0.1);
    }
  };

  const drawFooter = (doc: any, pageNum: number, totalPages: number) => {
    doc.setPage(pageNum);
    if (branding?.footer_base64) {
      doc.addImage(
        branding.footer_base64,
        getPdfImageType(branding.footer_base64),
        startX,
        pageHeight - 20,
        contentWidth,
        12,
      );
    } else {
      doc.setFont("helvetica", "bold");
      doc.setFontSize(10);
      doc.setTextColor(0, 85, 170);
      doc.text("VIA INTERNATIONAL", startX, pageHeight - 12);

      doc.setFont("helvetica", "italic");
      doc.setFontSize(10);
      doc.setTextColor(150);
      doc.text("Technical Proposal", pageWidth / 2, pageHeight - 12, {
        align: "center",
      });

      doc.setFont("helvetica", "bold");
      doc.setFontSize(9);
      doc.setTextColor(0, 85, 170);
      doc.text("ISO 9001:2008", startX + contentWidth, pageHeight - 12, {
        align: "right",
      });
    }
  };

  let y = 50;
  doc.setTextColor(0);
  doc.setFontSize(10);

  const fields = [
    ["PROPOSED POSITION:", position_title || expert.primary_position || ""],
    ["NAME OF EXPERT:", expert.name || ""],
  ];

  if (expert.birth_date) {
    fields.push(["DATE OF BIRTH:", expert.birth_date]);
  }
  if (expert.nationality) {
    fields.push(["COUNTRY OF CITIZENSHIP:", expert.nationality]);
  }

  fields.forEach((f) => {
    doc.setFont("helvetica", "bold");
    doc.text(f[0], startX, y);
    doc.setFont("helvetica", "bold");
    doc.text(f[1], startX + 55, y);
    y += 7;
  });

  y += 5;
  doc.setDrawColor(0);
  doc.setLineWidth(0.5);
  doc.line(startX, y - 2, startX + contentWidth, y - 2);
  y += 5;

  // EDUCATION
  doc.setFont("helvetica", "bold");
  doc.text("EDUCATION:", startX, y);
  y += 7;

  (expert.education || []).forEach((edu: string) => {
    doc.setFont("helvetica", "bold");
    const lines = safeSplitText(doc, `•   ${edu}`, contentWidth - 10);
    doc.text(lines, startX + 5, y);
    y += lines.length * 5 + 2;
  });

  y += 5;

  // PROFILE
  if (expert.profile_summary || expert.summary) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.text("PROFILE:", startX, y);
    y += 7;

    doc.setFont("helvetica", "normal");
    const profileLines = safeSplitText(
      doc,
      expert.profile_summary || expert.summary,
      contentWidth,
    );
    doc.text(profileLines, startX, y, { lineHeightFactor: 1.5 });
    y += profileLines.length * 5.5 + 5;
  }

  // SOFTWARE
  const softwareData = expert.software || expert.computer_skills || [];
  if (softwareData.length > 0 || typeof softwareData === "string") {
    if (y > pageHeight - 30) {
      doc.addPage();
      y = 50;
    }
    doc.setFont("helvetica", "bold");
    doc.text("Software", startX, y);
    doc.setFont("helvetica", "normal");
    const softwareStr = Array.isArray(softwareData)
      ? softwareData.join(", ")
      : softwareData;
    const softwareLines = safeSplitText(
      doc,
      softwareStr,
      contentWidth - doc.getTextWidth("Software ") - 15,
    );
    doc.text(softwareLines, startX + doc.getTextWidth("Software ") + 2, y);
    y += Math.max(1, softwareLines.length) * 5 + 3;
  }

  // TRAINING / COURSES
  const trainingArr =
    expert.training || expert.training_courses || expert.courses || [];
  if (trainingArr.length > 0) {
    if (y > pageHeight - 40) {
      doc.addPage();
      y = 50;
    }
    doc.setFont("helvetica", "bold");
    doc.text("Training/ Courses:", startX, y);
    y += 7;
    doc.setFont("helvetica", "normal");
    trainingArr.forEach((course: string) => {
      const lines = safeSplitText(doc, `•   ${course}`, contentWidth - 10);
      if (y + lines.length * 5 > pageHeight - 30) {
        doc.addPage();
        y = 50;
      }
      doc.text(lines, startX + 5, y);
      y += lines.length * 5 + 2;
    });
    y += 5;
  }

  // OTHER RELATED DETAILS
  const researchArr =
    expert.research ||
    expert.research_related ||
    expert.highlights ||
    expert.highlights_of_activities ||
    [];
  if (researchArr.length > 0) {
    if (y > pageHeight - 40) {
      doc.addPage();
      y = 50;
    }
    doc.setFont("helvetica", "bold");
    doc.text("Other Related Details", startX, y);
    y += 7;
    doc.setFont("helvetica", "normal");
    researchArr.forEach((activity: string | any) => {
      const activityStr =
        typeof activity === "string"
          ? activity
          : activity.title
            ? `${activity.title}: ${activity.description || ""}`
            : JSON.stringify(activity);
      const lines = safeSplitText(doc, `•   ${activityStr}`, contentWidth - 10);
      if (y + lines.length * 5 > pageHeight - 30) {
        doc.addPage();
        y = 50;
      }
      doc.text(lines, startX + 5, y);
      y += lines.length * 5 + 2;
    });
    y += 5;
  }

  // EMPLOYMENT TABLE
  if (y > pageHeight - 50) {
    doc.addPage();
    y = 50;
  }

  doc.setFont("helvetica", "bold");
  doc.text("EMPLOYMENT RECORD RELEVANT TO THE ASSIGNMENT:", startX, y);
  y += 5;

  const cleanStr = (s: any) => String(s || "").replace(/\r|\t|\u00A0/g, " ");
  const cleanActivityStr = (s: any) =>
    cleanStr(s)
      .replace(/\s*[•●▪▫◦]\s*/g, "\n- ")
      .replace(/\s+-\s+/g, "\n- ")
      .replace(/\n{3,}/g, "\n\n")
      .trim();

  const hasProject = (expert.employment_history || []).some(
    (h: any) => h.project && !h.country,
  );
  const col4Header = hasProject ? "Project" : "Country";
  const startsActivityPoint = (text: string) =>
    /^(review|reviewing|prepare|preparing|preparation|design|designing|analysis|checking|verify|verifying|coordination|coordinating|manage|managing|conduct|conducting|assist|assisting|ensure|ensuring|develop|developing|finalize|finalizing|facilitate|facilitating|monitor|monitoring|address|addressing|liaise|liaising|supervise|supervising|inspect|inspection|evaluate|evaluation|implement|implementation|collaborate|collaboration|interaction|responsible|project monitoring|quality control|stakeholder coordination|bill of quantities|road and bridge|utility|structural|seismic|finite element|proof checking)\b/i.test(text.trim());
  const isLikelyHeading = (text: string) =>
    /^[A-Z][A-Za-z0-9/&() -]{2,55}:$/.test(text.trim());
  const startsProjectOrResponsibility = (text: string) =>
    /^(design|design,\s*build|consultancy|contemporary|responsibilities?|review|preparation|coordination|supervision|analysis|checking|monitoring|construction|project|structural|site)\b/i.test(
      text.trim(),
    );
  const splitProjectListPoint = (text: string) => {
    const responsibilitySplit = text.split(/\s+(?=Responsibilities?\s+(?:include|included)\b)/i);
    const expanded: string[] = [];

    responsibilitySplit.forEach((part) => {
      const semicolonParts = part
        .split(/;\s+/)
        .map((item) => item.trim())
        .filter(Boolean);

      if (
        semicolonParts.length > 1 &&
        semicolonParts.filter((item) => startsProjectOrResponsibility(item)).length >= 2
      ) {
        expanded.push(...semicolonParts);
      } else if (part.trim()) {
        expanded.push(part.trim());
      }
    });

    return expanded;
  };
  const formatActivityBullets = (value: any) => {
    const marker = "<<<POINT>>>";
    const normalized = cleanStr(value)
      .replace(/[\u2022\u25cf\u25aa\u25ab\u25e6]/g, `\n${marker} `)
      .replace(/(^|\n)\s*(?:[-*]|\d+[.)]|[a-z][.)])\s+/gi, `\n${marker} `)
      .replace(/\s+/g, " ")
      .replace(new RegExp(`\\s*${marker}\\s*`, "g"), `\n${marker} `)
      .trim();
    const candidates: string[] = [];

    normalized.split(/\n+/).forEach((rawLine) => {
      const line = rawLine.replace(marker, "").trim();
      if (!line) return;
      if (rawLine.includes(marker)) {
        candidates.push(line);
        return;
      }

      line
        .split(/(?<=[.!?])\s+(?=[A-Z])/)
        .map((part) => part.trim())
        .filter(Boolean)
        .forEach((part) => {
          const previous = candidates[candidates.length - 1];
          if (!previous || startsActivityPoint(part) || isLikelyHeading(previous)) {
            candidates.push(part);
          } else {
            candidates[candidates.length - 1] = `${previous} ${part}`;
          }
        });
    });

    const points = candidates
      .map((point) => point.replace(/^[-*\u2022\s]+/, "").trim())
      .filter(Boolean)
      .flatMap(splitProjectListPoint)
      .reduce<string[]>((acc, point) => {
        const previous = acc[acc.length - 1];
        if (previous && point.length < 45 && !isLikelyHeading(point)) {
          acc[acc.length - 1] = `${previous} ${point}`;
        } else {
          acc.push(point);
        }
        return acc;
      }, []);

    return points.map((point) => `\u2022 ${point}`).join("\n");
  };

  const tableData = (expert.employment_history || []).map((h: any) => {
    let period = h.duration || "";
    if (!period) period = `${h.start_date || ""} \n${h.end_date ? "- " + h.end_date : ""}`;
    return [
    cleanStr(period),
    cleanStr(`${h.organization || h.client || ""}`),
    cleanStr(h.role || ""),
    cleanStr(hasProject ? h.project || h.client || "" : h.country || ""),
    formatActivityBullets(h.description || ""),
  ]});

  autoTable(doc, {
    startY: y,
    head: [
      [
        "Period",
        "Employing\norganization",
        "Title /position",
        col4Header,
        "Summary of activities performed\nrelevant to the Assignment",
      ],
    ],
    body: tableData,
    theme: "grid",
    styles: {
      fontSize: 8,
      cellPadding: { top: 3.5, right: 2.5, bottom: 3.5, left: 2.5 },
      textColor: [0, 0, 0],
      lineColor: [0, 0, 0],
      lineWidth: 0.1,
      overflow: "linebreak",
      valign: "top",
    },
    headStyles: {
      fillColor: [255, 255, 255],
      textColor: 0,
      fontStyle: "bold",
      halign: "center",
      lineWidth: 0.1,
      lineColor: [0, 0, 0],
    },
    columnStyles: {
      0: { cellWidth: 18, halign: "center" },
      1: { cellWidth: 27, halign: "center" },
      2: { cellWidth: 24, halign: "center" },
      3: { cellWidth: 18, halign: "center" },
      4: { cellWidth: "auto", halign: "left", cellPadding: { top: 4, right: 3, bottom: 4, left: 3 } },
    },
    rowPageBreak: "auto",
    margin: { left: startX, right: startX, top: 40, bottom: 30 },
  });

  y = (doc as any).lastAutoTable.finalY + 10;

  // ADEQUACY FOR THE ASSIGNMENT
  const adequacyItems = expert.adequacy_experience || [];
  const getAdequacyFields = (item: any) =>
    [
      ["Period", item.period || ""],
      ["Country", item.country || ""],
      ["Client", item.client || ""],
      ["Position", item.position || ""],
      ["Assignment", formatActivityBullets(item.assignment || "")],
    ].filter((f) => f[1]);
  const getAdequacyBlockHeight = (item: any) =>
    getAdequacyFields(item).reduce((height, f) => {
      const wrapLines = safeSplitText(doc, f[1], contentWidth - 45);
      return height + Math.max(1, wrapLines.length) * 5;
    }, 0);
  const firstAdequacyHeight = adequacyItems[0]
    ? getAdequacyBlockHeight(adequacyItems[0])
    : 0;

  if (y + firstAdequacyHeight + 18 > pageHeight - 30) {
    doc.addPage();
    y = 50;
  }
  doc.setFont("helvetica", "bold");
  doc.text("ADEQUACY FOR THE ASSIGNMENT - KEY EXPERIENCE:", startX, y);
  y += 5;

  adequacyItems.forEach((item: any) => {
    const af = getAdequacyFields(item);

    let blockHeight = 0;
    af.forEach((f) => {
      let fontStyle = "normal";
      if (f[0] === "Position") fontStyle = "bold";
      doc.setFont("helvetica", fontStyle);
      const wrapLines = safeSplitText(doc, f[1], contentWidth - 45);
      blockHeight += Math.max(1, wrapLines.length) * 5;
    });

    if (y + blockHeight + 5 > pageHeight - 30) {
      doc.addPage();
      y = 50;
    }

    af.forEach((f) => {
      doc.setFont("helvetica", "italic");
      const titleLines = safeSplitText(doc, f[0], 35);

      let fontStyle = "normal";
      if (f[0] === "Position") fontStyle = "bold";

      doc.setFont("helvetica", fontStyle);
      const wrapLines = safeSplitText(doc, f[1], contentWidth - 45);

      doc.setFont("helvetica", "italic");
      doc.text(f[0], startX, y);
      doc.setFont("helvetica", fontStyle);
      doc.text(wrapLines, startX + 40, y);
      y += wrapLines.length * 5;
    });
    y += 2;
  });

  if (y > pageHeight - 40) {
    doc.addPage();
    y = 50;
  }

  doc.setDrawColor(0);

  // LANGUAGE SKILLS
  doc.setFont("helvetica", "bold");
  doc.text("LANGUAGE SKILLS:", startX, y);
  y += 7;
  doc.setFont("helvetica", "normal");
  (expert.languages || []).forEach((lang: string) => {
    doc.text(`•   ${lang}`, startX + 5, y);
    y += 6;
  });

  y += 5;

  // Apply headers and footers globally
  const total = doc.getNumberOfPages();
  for (let i = 1; i <= total; i++) {
    doc.setPage(i);
    drawHeader(doc, i);
    drawFooter(doc, i, total);
  }

  return doc;
}

function generateSpecialized(doc: any, options: PDFExportOptions) {
  const { expert, position_title } = options;
  const branding = options.branding || {};
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const startX = 20;
  const contentWidth = pageWidth - startX * 2;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.setTextColor(0, 100, 200);
  doc.text("FORM TECH-6", 105, 42, { align: "center" });
  doc.text("CURRICULUM VITAE (CV)", 105, 48, { align: "center" });

  let y = 55;

  // Boxed Info
  doc.setDrawColor(0);
  doc.setLineWidth(0.5);
  doc.rect(startX, y, contentWidth, 30);

  doc.setFontSize(10);
  doc.setTextColor(0);

  const rows = [
    ["PROPOSED POSITION:", position_title || expert.primary_position],
    ["NAME OF EXPERT:", expert.name],
    ["DATE OF BIRTH:", expert.birth_date || "N/A"],
    ["COUNTRY OF CITIZENSHIP:", expert.nationality],
  ];

  rows.forEach((row, i) => {
    doc.setFont("helvetica", "bold");
    doc.text(row[0], startX, y + 7 + i * 6);
    doc.setFont("helvetica", "normal");
    doc.text(row[1], startX + 55, y + 7 + i * 6);
    if (i < 3)
      doc.line(startX, y + 9 + i * 6, startX + contentWidth, y + 9 + i * 6);
  });

  y += 40;

  // Education
  doc.setFont("helvetica", "bold");
  doc.text("EDUCATION:", startX, y);
  y += 6;
  doc.setFont("helvetica", "normal");
  (expert.education || []).forEach((edu: string) => {
    const lines = safeSplitText(doc, `• ${edu}`, contentWidth - 10);
    doc.text(lines, startX + 5, y);
    y += lines.length * 5 + 2;
  });

  y += 5;

  // Profile
  doc.setFont("helvetica", "bold");
  doc.text("PROFILE:", startX, y);
  y += 6;
  doc.setFont("helvetica", "normal");
  const profileLines = safeSplitText(
    doc,
    expert.profile_summary || expert.summary || "No profile available",
    contentWidth,
  );
  doc.text(profileLines, startX, y);
  y += profileLines.length * 5 + 10;

  // Employment Record Table
  doc.setFont("helvetica", "bold");
  doc.text("EMPLOYMENT RECORD RELEVANT TO THE ASSIGNMENT:", startX, y);
  y += 5;

  const cleanStr = (s: any) => String(s || "").replace(/\r|\t|\u00A0/g, " ");

  const tableData = (expert.employment_history || []).map((h: any) => [
    cleanStr(`${h.start_date || ""} - ${h.end_date || ""}`),
    cleanStr(`Employer: ${h.client || ""}\nPositions held: ${h.role || ""}`),
    cleanStr(h.country || ""),
    cleanStr(h.description || ""),
  ]);

  autoTable(doc, {
    startY: y,
    head: [
      ["Period", "Employing organization", "Country", "Summary of activities"],
    ],
    body: tableData,
    styles: { fontSize: 8, cellPadding: 3 },
    headStyles: { fillColor: [220, 220, 220], textColor: 0, fontStyle: "bold" },
    columnStyles: {
      0: { cellWidth: 25 },
      1: { cellWidth: 50 },
      2: { cellWidth: 25 },
      3: { cellWidth: "auto" },
    },
    rowPageBreak: "avoid",
    margin: { left: startX, right: startX, top: 40, bottom: 30 },
  });

  // Bottom info & Signature
  doc.addPage();
  y = 20;
  doc.setFont("helvetica", "bold");
  doc.text("Certification:", startX, y);
  y += 6;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  const cert =
    "I, the undersigned, certify that to the best of my knowledge and belief, this CV correctly describes myself, my qualifications, and my experience, and I am available, as and when necessary, to undertake the assignment in case of an award. I understand that any misstatement or misrepresentation described herein may lead to my disqualification or dismissal by the Client, and/or sanctions by the Bank.";
  const certLines = safeSplitText(doc, cert, contentWidth);
  doc.text(certLines, startX, y);

  y += 30;
  doc.setFont("helvetica", "bold");
  doc.text(expert.name, startX, y);
  doc.text(new Date().toLocaleDateString(), 150, y);
  doc.line(startX, y + 2, startX + 50, y + 2);
  doc.line(150, y + 2, 185, y + 2);
  doc.setFont("helvetica", "normal");
  doc.text("Name of Expert", startX, y + 6);
  doc.text("Date", 150, y + 6);

  // Header/Footer loop
  const pageCount = doc.internal.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);

    // Header
    if (branding?.header_base64) {
      doc.addImage(branding.header_base64, getPdfImageType(branding.header_base64), startX, 10, contentWidth, 25);
    }

    // Footer
    doc.setFontSize(7);
    doc.setTextColor(100);

    if (branding?.footer_base64) {
      doc.addImage(
        branding.footer_base64,
        getPdfImageType(branding.footer_base64),
        startX,
        275,
        contentWidth,
        12,
      );
    }

    doc.text(`GENERATED CV | FORM TECH-6`, 105, 290, { align: "center" });
    doc.text(`Page ${i} of ${pageCount}`, 180, 290);
  }

  return doc;
}
