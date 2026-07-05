import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  Table,
  TableRow,
  TableCell,
  BorderStyle,
  WidthType,
  AlignmentType,
  Header,
  Footer,
  ImageRun,
} from "docx";
import { saveAs } from "file-saver";
import type { PDFExportOptions } from "./pdf";
import { resolveDocumentBranding } from "./branding";

function dataUrlToUint8Array(dataUrl: string) {
  const base64 = dataUrl.split(",")[1] || "";
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function getDocxImageType(dataUrl: string): "jpg" | "png" | "gif" | "bmp" {
  const mime = dataUrl.match(/^data:image\/([^;]+);/i)?.[1]?.toLowerCase();
  if (mime === "jpeg" || mime === "jpg") return "jpg";
  if (mime === "gif") return "gif";
  if (mime === "bmp") return "bmp";
  return "png";
}

export async function generateDocxCV(options: PDFExportOptions) {
  const { expert, position_title, template } = options;
  const branding = await resolveDocumentBranding(options.branding);

  const isGeneral = template === "General";
  const cleanText = (value: any) =>
    String(value || "").replace(/\r|\t|\u00A0/g, " ").trim();
  const formatBulletLines = (value: any) => {
    const text = cleanText(value);
    if (!text) return [];
    const lines = text
      .replace(/[\u2022\u25cf\u25aa\u25ab\u25e6]/g, "\n- ")
      .split(/\n+/)
      .map((line) => line.trim())
      .filter(Boolean);

    if (lines.length > 1) {
      return lines.map((line) => line.replace(/^[-*\u2022]\s*/, "").trim());
    }

    return text
      .split(/;\s+/)
      .map((line) => line.trim().replace(/[.;]\s*$/, ""))
      .filter(Boolean);
  };
  const bulletParagraphs = (value: any, italics = false) => {
    const bullets = formatBulletLines(value);
    if (bullets.length === 0) return [new Paragraph("")];
    return bullets.map(
      (line) =>
        new Paragraph({
          children: [
            new TextRun({ text: "\u2022 ", italics }),
            new TextRun({ text: line, italics }),
          ],
          spacing: { after: 80 },
        }),
    );
  };

  const header = new Header({
    children: branding.header_base64
      ? [
          new Paragraph({
            children: [
              new ImageRun({
                type: getDocxImageType(branding.header_base64),
                data: dataUrlToUint8Array(branding.header_base64),
                transformation: { width: 520, height: 72 },
              }),
            ],
            alignment: AlignmentType.CENTER,
            spacing: { after: 300 },
          }),
        ]
      : [
          new Paragraph({
            children: [
              new TextRun({
                text: "MINISTRY OF TRANSPORT, COMMUNICATIONS AND INFORMATION TECHNOLOGY (MTCIT)",
                bold: true,
                size: 22,
              }),
              new TextRun({
                text: "\nDIRECTORATE GENERAL OF ROADS & LAND TRANSPORT",
                bold: true,
                size: 22,
              }),
              new TextRun({
                text: "\nConsultancy Services for Supervision of Construction of 05-Bridges at Sohar - Al-Buraimi Road",
                italics: true,
                size: 20,
              }),
              new TextRun({
                text: "\nTender No: 267/2023/MTCIT/HQ-64",
                italics: true,
                size: 20,
              }),
            ],
            border: {
              bottom: {
                color: "0055AA",
                space: 10,
                style: BorderStyle.THICK,
                size: 12,
              },
            },
            spacing: { after: 300 },
          }),
        ],
  });

  const footer = new Footer({
    children: branding.footer_base64
      ? [
          new Paragraph({
            children: [
              new ImageRun({
                type: getDocxImageType(branding.footer_base64),
                data: dataUrlToUint8Array(branding.footer_base64),
                transformation: { width: 520, height: 35 },
              }),
            ],
            alignment: AlignmentType.CENTER,
          }),
        ]
      : [
          new Paragraph({
            children: [
              new TextRun({
                text: "VIA INTERNATIONAL\t",
                bold: true,
                color: "0055AA",
                size: 16,
              }),
              new TextRun({
                text: "Technical Proposal",
                italics: true,
                color: "888888",
                size: 20,
              }),
              new TextRun({ text: "\tISO 9001:2008", color: "0055AA", size: 14 }),
            ],
            alignment: AlignmentType.CENTER,
          }),
        ],
  });

  const doc = new Document({
    sections: [
      {
        properties: {
          page: {
            margin: {
              top: 1440,
              right: 1701,
              bottom: 1440,
              left: 1701,
            },
          },
        },
        headers: {
          default: header,
        },
        footers: {
          default: footer,
        },
        children: [
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            borders: {
              top: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
              bottom: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
              left: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
              right: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
              insideHorizontal: {
                style: BorderStyle.NONE,
                size: 0,
                color: "FFFFFF",
              },
              insideVertical: {
                style: BorderStyle.NONE,
                size: 0,
                color: "FFFFFF",
              },
            },
            rows: [
              new TableRow({
                children: [
                  new TableCell({
                    children: [
                      new Paragraph({
                        children: [
                          new TextRun({
                            text: "PROPOSED POSITION:",
                            bold: true,
                          }),
                        ],
                      }),
                    ],
                    width: { size: 30, type: WidthType.PERCENTAGE },
                  }),
                  new TableCell({
                    children: [
                      new Paragraph({
                        children: [
                          new TextRun({
                            text:
                              position_title || expert.primary_position || "",
                            bold: true,
                          }),
                        ],
                      }),
                    ],
                    width: { size: 70, type: WidthType.PERCENTAGE },
                  }),
                ],
              }),
              new TableRow({
                children: [
                  new TableCell({
                    children: [
                      new Paragraph({
                        children: [
                          new TextRun({ text: "NAME OF EXPERT:", bold: true }),
                        ],
                      }),
                    ],
                  }),
                  new TableCell({
                    children: [
                      new Paragraph({
                        children: [
                          new TextRun({ text: expert.name || "", bold: true }),
                        ],
                      }),
                    ],
                  }),
                ],
              }),
              ...(expert.birth_date
                ? [
                    new TableRow({
                      children: [
                        new TableCell({
                          children: [
                            new Paragraph({
                              children: [
                                new TextRun({
                                  text: "DATE OF BIRTH:",
                                  bold: true,
                                }),
                              ],
                            }),
                          ],
                        }),
                        new TableCell({
                          children: [
                            new Paragraph({ text: expert.birth_date }),
                          ],
                        }),
                      ],
                    }),
                  ]
                : []),
              ...(expert.nationality
                ? [
                    new TableRow({
                      children: [
                        new TableCell({
                          children: [
                            new Paragraph({
                              children: [
                                new TextRun({
                                  text: "COUNTRY OF CITIZENSHIP:",
                                  bold: true,
                                }),
                              ],
                            }),
                          ],
                        }),
                        new TableCell({
                          children: [
                            new Paragraph({ text: expert.nationality }),
                          ],
                        }),
                      ],
                    }),
                  ]
                : []),
            ],
          }),

          new Paragraph({
            children: [new TextRun({ text: "EDUCATION:", bold: true })],
            spacing: { before: 400, after: 100 },
          }),
          ...(expert.education || []).map(
            (edu: string) =>
              new Paragraph({
                text: `• ${edu}`,
                spacing: { after: 100 },
              }),
          ),

          ...(expert.profile_summary || expert.summary
            ? [
                new Paragraph({
                  children: [new TextRun({ text: "PROFILE:", bold: true })],
                  spacing: { before: 400, after: 100 },
                }),
                new Paragraph({
                  text: expert.profile_summary || expert.summary || "",
                  spacing: { after: 400 },
                }),
              ]
            : []),

          ...((expert.software || expert.computer_skills || []).length > 0 ||
          typeof (expert.software || expert.computer_skills) === "string"
            ? [
                new Paragraph({
                  children: [
                    new TextRun({ text: "Software:", bold: true }),
                    new TextRun({
                      text: ` ${Array.isArray(expert.software || expert.computer_skills) ? (expert.software || expert.computer_skills).join(", ") : expert.software || expert.computer_skills}`,
                    }),
                  ],
                  spacing: { before: 400, after: 400 },
                }),
              ]
            : []),

          ...((
            expert.training ||
            expert.training_courses ||
            expert.courses ||
            []
          ).length > 0
            ? [
                new Paragraph({
                  children: [
                    new TextRun({ text: "Training/ Courses:", bold: true }),
                  ],
                  spacing: { before: 400, after: 100 },
                }),
                ...(
                  expert.training ||
                  expert.training_courses ||
                  expert.courses ||
                  []
                ).map(
                  (course: string) =>
                    new Paragraph({
                      text: `• ${course}`,
                      spacing: { after: 100 },
                    }),
                ),
              ]
            : []),

          ...((
            expert.research ||
            expert.research_related ||
            expert.highlights ||
            expert.highlights_of_activities ||
            []
          ).length > 0
            ? [
                new Paragraph({
                  children: [
                    new TextRun({
                      text: "Research etc other Related:",
                      bold: true,
                    }),
                  ],
                  spacing: { before: 400, after: 100 },
                }),
                ...(
                  expert.research ||
                  expert.research_related ||
                  expert.highlights ||
                  expert.highlights_of_activities ||
                  []
                ).map(
                  (activity: string | any) =>
                    new Paragraph({
                      text: `• ${typeof activity === "string" ? activity : activity.title ? `${activity.title}: ${activity.description || ""}` : JSON.stringify(activity)}`,
                      spacing: { after: 100 },
                    }),
                ),
              ]
            : []),

          new Paragraph({
            children: [
              new TextRun({
                text: "EMPLOYMENT RECORD RELEVANT TO THE ASSIGNMENT:",
                bold: true,
              }),
            ],
            spacing: { before: 400, after: 100 },
          }),
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            borders: {
              top: { style: BorderStyle.SINGLE, size: 1 },
              bottom: { style: BorderStyle.SINGLE, size: 1 },
              left: { style: BorderStyle.SINGLE, size: 1 },
              right: { style: BorderStyle.SINGLE, size: 1 },
              insideHorizontal: { style: BorderStyle.SINGLE, size: 1 },
              insideVertical: { style: BorderStyle.SINGLE, size: 1 },
            },
            rows: [
              new TableRow({
                tableHeader: true,
                children: [
                  new TableCell({
                    children: [
                      new Paragraph({
                        children: [new TextRun({ text: "Period", bold: true })],
                        alignment: AlignmentType.CENTER,
                      }),
                    ],
                    width: { size: 15, type: WidthType.PERCENTAGE },
                    margins: { top: 100, bottom: 100, left: 100, right: 100 },
                  }),
                  new TableCell({
                    children: [
                      new Paragraph({
                        children: [
                          new TextRun({
                            text: "Employing\norganization",
                            bold: true,
                          }),
                        ],
                        alignment: AlignmentType.CENTER,
                      }),
                    ],
                    width: { size: 20, type: WidthType.PERCENTAGE },
                    margins: { top: 100, bottom: 100, left: 100, right: 100 },
                  }),
                  new TableCell({
                    children: [
                      new Paragraph({
                        children: [
                          new TextRun({ text: "Title /position", bold: true }),
                        ],
                        alignment: AlignmentType.CENTER,
                      }),
                    ],
                    width: { size: 15, type: WidthType.PERCENTAGE },
                    margins: { top: 100, bottom: 100, left: 100, right: 100 },
                  }),
                  new TableCell({
                    children: [
                      new Paragraph({
                        children: [
                          new TextRun({
                            text: isGeneral ? "Project" : "Country",
                            bold: true,
                          }),
                        ],
                        alignment: AlignmentType.CENTER,
                      }),
                    ],
                    width: { size: 15, type: WidthType.PERCENTAGE },
                    margins: { top: 100, bottom: 100, left: 100, right: 100 },
                  }),
                  new TableCell({
                    children: [
                      new Paragraph({
                        children: [
                          new TextRun({
                            text: "Summary of activities performed relevant\nto the Assignment",
                            bold: true,
                          }),
                        ],
                        alignment: AlignmentType.CENTER,
                      }),
                    ],
                    width: { size: 35, type: WidthType.PERCENTAGE },
                    margins: { top: 100, bottom: 100, left: 100, right: 100 },
                  }),
                ],
              }),
              ...(expert.employment_history || []).map(
                (h: any) =>
                  new TableRow({
                    cantSplit: true,
                    children: [
                      new TableCell({
                        children: [
                          new Paragraph(
                            h.duration || `${h.start_date || ""} – \n${h.end_date || ""}`,
                          ),
                        ],
                        margins: {
                          top: 100,
                          bottom: 100,
                          left: 100,
                          right: 100,
                        },
                      }),
                      new TableCell({
                        children: [
                          new Paragraph(h.organization || h.client || ""),
                        ],
                        margins: {
                          top: 100,
                          bottom: 100,
                          left: 100,
                          right: 100,
                        },
                      }),
                      new TableCell({
                        children: [new Paragraph(h.role || "")],
                        margins: {
                          top: 100,
                          bottom: 100,
                          left: 100,
                          right: 100,
                        },
                      }),
                      new TableCell({
                        children: [
                          new Paragraph(
                            isGeneral
                              ? h.project || h.client || ""
                              : h.country || "",
                          ),
                        ],
                        margins: {
                          top: 100,
                          bottom: 100,
                          left: 100,
                          right: 100,
                        },
                      }),
                      new TableCell({
                        children: bulletParagraphs(h.description || ""),
                        margins: {
                          top: 100,
                          bottom: 100,
                          left: 100,
                          right: 100,
                        },
                      }),
                    ],
                  }),
              ),
            ],
          }),

          new Paragraph({
            children: [
              new TextRun({
                text: "ADEQUACY FOR THE ASSIGNMENT - KEY EXPERIENCE:",
                bold: true,
              }),
            ],
            spacing: { before: 400, after: 100 },
          }),
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            borders: {
              top: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
              bottom: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
              left: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
              right: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
              insideHorizontal: {
                style: BorderStyle.NONE,
                size: 0,
                color: "FFFFFF",
              },
              insideVertical: {
                style: BorderStyle.NONE,
                size: 0,
                color: "FFFFFF",
              },
            },
            rows: (expert.adequacy_experience || []).flatMap(
              (item: any, i: number) => {
                return [
                  new TableRow({
                    children: [
                      new TableCell({
                        children: [
                          new Paragraph({
                            children: [
                              new TextRun({ text: "Period", italics: true }),
                            ],
                          }),
                        ],
                        width: { size: 20, type: WidthType.PERCENTAGE },
                      }),
                      new TableCell({
                        children: [new Paragraph(item.period || "")],
                      }),
                    ],
                  }),
                  new TableRow({
                    children: [
                      new TableCell({
                        children: [
                          new Paragraph({
                            children: [
                              new TextRun({ text: "Country", italics: true }),
                            ],
                          }),
                        ],
                      }),
                      new TableCell({
                        children: [new Paragraph(item.country || "")],
                      }),
                    ],
                  }),
                  new TableRow({
                    children: [
                      new TableCell({
                        children: [
                          new Paragraph({
                            children: [
                              new TextRun({ text: "Client", italics: true }),
                            ],
                          }),
                        ],
                      }),
                      new TableCell({
                        children: [new Paragraph(item.client || "")],
                      }),
                    ],
                  }),
                  new TableRow({
                    children: [
                      new TableCell({
                        children: [
                          new Paragraph({
                            children: [
                              new TextRun({ text: "Position", italics: true }),
                            ],
                          }),
                        ],
                      }),
                      new TableCell({
                        children: [
                          new Paragraph({
                            children: [
                              new TextRun({
                                text: item.position || "",
                                bold: true,
                              }),
                            ],
                          }),
                        ],
                      }),
                    ],
                  }),
                  new TableRow({
                    children: [
                      new TableCell({
                        children: [
                          new Paragraph({
                            children: [
                              new TextRun({
                                text: "Assignment",
                                italics: true,
                              }),
                            ],
                          }),
                        ],
                      }),
                      new TableCell({
                        children: bulletParagraphs(item.assignment || "", true),
                      }),
                    ],
                  }),
                ];
              },
            ),
          }),

          new Paragraph({
            children: [new TextRun({ text: "LANGUAGE SKILLS:", bold: true })],
            spacing: { before: 400, after: 100 },
          }),
          ...(expert.languages || []).map(
            (lang: string) =>
              new Paragraph({
                text: `• ${lang}`,
                spacing: { after: 100 },
              }),
          ),

        ],
      },
    ],
  });

  const blob = await Packer.toBlob(doc);
  const expertName = expert.name || "Expert";
  saveAs(blob, `${template || "CV"} - ${expertName}.docx`);
}
