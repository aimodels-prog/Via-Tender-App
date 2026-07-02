export interface SourceEvidence {
  field: string;
  value: string;
  section?: string;
  lineNumber: number;
  line: string;
}

export interface TextLine {
  number: number;
  text: string;
}

export interface TextSection {
  heading: string;
  startLine: number;
  endLine: number;
  lines: TextLine[];
}

export interface UniversalCVFacts {
  contacts: {
    emails: string[];
    phones: string[];
  };
  languages: Array<{ name: string; level: string }>;
  education: Array<{ degree: string; field?: string; institution?: string; year?: string; location?: string; notes?: string }>;
  software: string[];
  skills: string[];
  sourceEvidence: SourceEvidence[];
}

export interface UniversalTenderFacts {
  positions: any[];
  sourceEvidence: SourceEvidence[];
}

const SECTION_ALIASES: Record<string, string[]> = {
  contacts: ["contacts", "contact", "personal details", "personal information"],
  profile: ["profile", "summary", "professional profile", "personal profile", "career profile"],
  software: ["software", "tools", "computer skills", "it skills", "digital skills"],
  languages: ["languages", "language", "language known", "language proficiency"],
  skills: ["skills", "soft skills", "technical skills", "core competencies", "competencies"],
  education: ["education", "education & training", "academic qualifications", "qualification", "qualifications", "training"],
  employment: ["work experience", "professional experience", "employment", "employment history", "career history", "experience"],
  tenderStaff: [
    "key experts",
    "staff",
    "personnel",
    "team composition",
    "professional staff",
    "experts required",
    "positions",
    "required experts",
    "manpower",
    "schedule of staff",
    "tor",
    "terms of reference",
  ],
};

const LANGUAGE_NAMES = [
  "English",
  "French",
  "Portuguese",
  "Italian",
  "Spanish",
  "Arabic",
  "Urdu",
  "Hindi",
  "Punjabi",
  "Panjabi",
  "German",
  "Russian",
  "Chinese",
  "Mandarin",
  "Turkish",
];

const SOFTWARE_NAMES = [
  "AutoCAD",
  "Civil 3D",
  "Primavera",
  "MS Project",
  "Excel",
  "Word",
  "PowerPoint",
  "Revit",
  "BIM",
  "GIS",
  "ArcGIS",
  "QGIS",
  "Photoshop",
  "Rhinoceros",
  "Keyshot",
  "Dialux",
  "ChatGPT",
  "Chat GPT",
  "Copilot",
  "Midjourney",
];

function clean(value: any) {
  return String(value || "").replace(/\u00A0/g, " ").replace(/[ \t]+/g, " ").trim();
}

export function normalizeRawText(value: string) {
  return String(value || "")
    .replace(/\r/g, "\n")
    .replace(/\u00A0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\b--\s*\d+\s+of\s+\d+\s*--\b/gi, "\n")
    .replace(/\bPage\s+\d+\s+of\s+\d+\b/gi, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function toTextLines(rawText: string): TextLine[] {
  return normalizeRawText(rawText)
    .split(/\n+/)
    .map((line, index) => ({ number: index + 1, text: clean(line) }))
    .filter((line) => line.text);
}

function normalizeHeading(value: string) {
  return clean(value).replace(/[:：]\s*$/, "").toLowerCase();
}

function canonicalHeading(value: string) {
  const heading = normalizeHeading(value);
  for (const [canonical, aliases] of Object.entries(SECTION_ALIASES)) {
    if (aliases.some((alias) => heading === alias || heading.startsWith(`${alias}:`))) return canonical;
  }
  return "";
}

function looksLikeHeading(line: string) {
  const text = normalizeHeading(line);
  if (canonicalHeading(text)) return true;
  if (text.length > 45) return false;
  if (/^\d+[.)]\s+/.test(text)) return false;
  return /^[a-z&/ ]{3,45}$/i.test(text) && text === text.toUpperCase().toLowerCase() ? false : false;
}

export function sectionizeText(rawText: string): TextSection[] {
  const lines = toTextLines(rawText);
  const sections: TextSection[] = [];
  let current: TextSection = { heading: "body", startLine: lines[0]?.number || 1, endLine: lines[0]?.number || 1, lines: [] };

  for (const line of lines) {
    const heading = canonicalHeading(line.text);
    if (heading || looksLikeHeading(line.text)) {
      if (current.lines.length) sections.push({ ...current, endLine: current.lines[current.lines.length - 1].number });
      current = { heading: heading || normalizeHeading(line.text), startLine: line.number, endLine: line.number, lines: [] };
      const afterColon = line.text.includes(":") ? clean(line.text.split(/[:：]/).slice(1).join(":")) : "";
      if (heading && afterColon) current.lines.push({ number: line.number, text: afterColon });
      continue;
    }
    current.lines.push(line);
  }

  if (current.lines.length) sections.push({ ...current, endLine: current.lines[current.lines.length - 1].number });
  return sections;
}

function sectionsFor(sections: TextSection[], heading: string) {
  return sections.filter((section) => section.heading === heading);
}

function evidence(field: string, value: string, line: TextLine, section?: string): SourceEvidence {
  return { field, value, lineNumber: line.number, line: line.text, section };
}

function uniqueBy<T>(items: T[], keyFn: (item: T) => string) {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = keyFn(item).toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function normalizeLanguageName(value: string) {
  return clean(value).replace(/^[^A-Za-z]+|[^A-Za-z]+$/g, "");
}

function parseLanguages(sections: TextSection[], allLines: TextLine[]) {
  const sourceSections = sectionsFor(sections, "languages");
  const lines = sourceSections.length ? sourceSections.flatMap((section) => section.lines.map((line) => ({ ...line, section: section.heading }))) : allLines.map((line) => ({ ...line, section: undefined }));
  const languages: Array<{ name: string; level: string }> = [];
  const sourceEvidence: SourceEvidence[] = [];
  const languagePattern = new RegExp(`\\b(${LANGUAGE_NAMES.join("|")})\\b(?:\\s*[-\\u2013\\u2014:]\\s*(Native|Fluent|Excellent|Good|Basic|Intermediate|Advanced|Professional|Working))?`, "gi");

  for (const line of lines) {
    for (const match of line.text.matchAll(languagePattern)) {
      const item = { name: normalizeLanguageName(match[1]), level: clean(match[2] || "") };
      languages.push(item);
      sourceEvidence.push(evidence("languages", item.level ? `${item.name} - ${item.level}` : item.name, line, line.section));
    }
  }

  return {
    languages: uniqueBy(languages, (item) => item.name),
    sourceEvidence,
  };
}

function parseEducation(sections: TextSection[], allLines: TextLine[]) {
  const sourceSections = sectionsFor(sections, "education");
  const lines = sourceSections.length ? sourceSections.flatMap((section) => section.lines.map((line) => ({ ...line, section: section.heading }))) : allLines.map((line) => ({ ...line, section: undefined }));
  const education: UniversalCVFacts["education"] = [];
  const sourceEvidence: SourceEvidence[] = [];
  const eduPattern = /\b(Ph\.?D\.?|Doctor(?:ate)?|DAE|Diploma|Bachelor'?s?|B\.?Sc\.?|Master'?s?|M\.?Sc\.?|M\.?Eng|MEng|Degree)\b(?:\s+(?:of|in)\s+|\s+)?([^,\n;]{0,120})?/i;
  const stopPattern = /\b(work experience|professional experience|employment|languages?|skills?|software|signature|certifications?|publications?)\b/i;

  for (const line of lines) {
    if (stopPattern.test(line.text) && !eduPattern.test(line.text)) continue;
    const text = line.text.replace(/^(qualification|education|education & training)\s*:?\s*/i, "");
    const match = text.match(eduPattern);
    if (!match) continue;
    const full = clean(text);
    if (/^to practice as\b/i.test(full)) continue;
    const parentheticalField = full.match(/\(([^)]+)\)/)?.[1] || "";
    const degreeText = clean(match[1]);
    const rest = clean(match[2] || "");
    const inferredField = parentheticalField || rest.match(/\b(Civil Engineering|Civil|Architecture|Product Design|Artificial Intelligence|Engineering|Construction Management|Quantity Surveying)\b/i)?.[0] || "";
    const institution = clean(full.match(/\b(?:at|from)\s+([^,;]+?)(?:,|\b(?:19|20)\d{2}\b|$)/i)?.[1] || "");
    const year = clean(full.match(/\b(?:19|20)\d{2}\b|\b\d{2}\/(?:19|20)\d{2}\b(?:\s*[-\u2013\u2014]\s*(?:\d{2}\/(?:19|20)\d{2}|Present))?/i)?.[0] || "");
    education.push({
      degree: full.length <= 160 ? full : degreeText,
      field: inferredField,
      institution,
      year,
      notes: full,
    });
    sourceEvidence.push(evidence("education", full, line, line.section));
  }

  return {
    education: uniqueBy(education, (item) => item.degree),
    sourceEvidence,
  };
}

function parseSoftware(sections: TextSection[], allLines: TextLine[]) {
  const sourceSections = sectionsFor(sections, "software");
  const lines = sourceSections.length ? sourceSections.flatMap((section) => section.lines.map((line) => ({ ...line, section: section.heading }))) : allLines.map((line) => ({ ...line, section: undefined }));
  const software: string[] = [];
  const sourceEvidence: SourceEvidence[] = [];
  const softwarePattern = new RegExp(`\\b(${SOFTWARE_NAMES.map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})\\b`, "gi");

  for (const line of lines) {
    for (const match of line.text.matchAll(softwarePattern)) {
      const value = match[1] === "Chat GPT" ? "ChatGPT" : match[1];
      software.push(value);
      sourceEvidence.push(evidence("software", value, line, line.section));
    }
  }

  return { software: Array.from(new Set(software)), sourceEvidence };
}

function parseContacts(lines: TextLine[]) {
  const emails: string[] = [];
  const phones: string[] = [];
  const sourceEvidence: SourceEvidence[] = [];
  for (const line of lines) {
    for (const match of line.text.matchAll(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi)) {
      emails.push(match[0]);
      sourceEvidence.push(evidence("email", match[0], line));
    }
    for (const match of line.text.matchAll(/(?:\+\d{1,3}[\s-]?)?(?:\(?\d{2,4}\)?[\s-]?){2,5}\d{2,4}/g)) {
      const value = clean(match[0]);
      if (value.replace(/\D/g, "").length >= 7) {
        phones.push(value);
        sourceEvidence.push(evidence("phone", value, line));
      }
    }
  }
  return {
    contacts: {
      emails: Array.from(new Set(emails)),
      phones: Array.from(new Set(phones)),
    },
    sourceEvidence,
  };
}

export function extractUniversalCVFacts(rawText: string): UniversalCVFacts {
  const lines = toTextLines(rawText);
  const sections = sectionizeText(rawText);
  const contacts = parseContacts(lines);
  const languages = parseLanguages(sections, lines);
  const education = parseEducation(sections, lines);
  const software = parseSoftware(sections, lines);

  return {
    contacts: contacts.contacts,
    languages: languages.languages,
    education: education.education,
    software: software.software,
    skills: [],
    sourceEvidence: [
      ...contacts.sourceEvidence,
      ...languages.sourceEvidence,
      ...education.sourceEvidence,
      ...software.sourceEvidence,
    ],
  };
}

function normalizePositionTitle(value: string) {
  return clean(value)
    .replace(/^[\d.)\-\s]+/, "")
    .replace(/\b(no\.?|number|qty|quantity|personnel|staff|expert|key expert|position|role)\b\s*:?\s*/gi, "")
    .replace(/\s*\(\s*\d+\s*(?:nos?\.?|persons?|staff)?\s*\)\s*$/i, "")
    .replace(/\s*[-–—:]\s*\d+\s*(?:nos?\.?|persons?|staff)?\s*$/i, "")
    .replace(/\s+(?:qty|quantity|no\.?|number)\s*[:\-]?\s*\d{1,2}\s*$/i, "")
    .replace(/\s+\d{1,2}\s*$/i, "")
    .replace(/[.;:,]\s*$/, "")
    .trim();
}

function isLikelyTenderPosition(value: string) {
  const title = normalizePositionTitle(value);
  if (!title || title.length < 4 || title.length > 90) return false;
  if (/^(scope|background|objective|deliverables|submission|evaluation|financial|technical|appendix|annex|table|minimum|general|specific|description)$/i.test(title)) return false;
  return /\b(manager|engineer|expert|specialist|consultant|leader|director|coordinator|surveyor|inspector|architect|designer|planner|scheduler|advisor|trainer|analyst|officer|supervisor|controller|technician|draftsman|economist|sociologist|environmentalist|hydrologist|geologist|qa\/qc|hse|team leader|project manager|resident engineer)\b/i.test(title);
}

function extractQuantity(line: string) {
  const match =
    line.match(/\b(?:qty|quantity|no\.?|number)\s*[:\-]?\s*(\d{1,2})\b/i) ||
    line.match(/\((\d{1,2})\s*(?:nos?\.?|persons?|staff)?\)/i) ||
    line.match(/\b(\d{1,2})\s*(?:nos?\.?|persons?|staff)\b/i) ||
    line.match(/^\s*(\d{1,2})\s+[-.)]?\s+[A-Za-z]/);
  return match ? Number(match[1]) : 1;
}

export function extractUniversalTenderFacts(rawText: string): UniversalTenderFacts {
  const lines = toTextLines(rawText);
  const positions: any[] = [];
  const sourceEvidence: SourceEvidence[] = [];
  const seen = new Set<string>();

  lines.forEach((line, index) => {
    const compact = line.text;
    const titleFromDelimited =
      compact.match(/\b(?:position|role|staff|expert|key expert)\s*[:\-]\s*(.+)$/i)?.[1] ||
      compact.match(/^\s*\d{1,2}\s*[-.)]\s*(.+)$/)?.[1] ||
      compact.match(/^(.+?)\s+(?:qty|quantity|no\.?|number)\s*[:\-]?\s*\d{1,2}\b/i)?.[1] ||
      compact.match(/^(.+?)\s*[-–—:]\s*\d{1,2}\s*(?:nos?\.?|persons?|staff)\b/i)?.[1] ||
      compact;
    const title = normalizePositionTitle(titleFromDelimited);
    if (!isLikelyTenderPosition(title)) return;
    const key = title.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);

    const nearby = lines.slice(index, Math.min(lines.length, index + 10)).map((item) => item.text).join(" ");
    const position = {
      position_title: title,
      quantity: extractQuantity(compact),
      minimum_education: clean(nearby.match(/\b(?:minimum\s+)?(?:education|qualification)\s*[:\-]\s*(.+?)(?=\b(?:experience|role|responsibil|requirement|skills?)\b|$)/i)?.[1] || ""),
      minimum_years_experience: Number(nearby.match(/\b(\d{1,2})\+?\s+years?\b/i)?.[1] || 0) || undefined,
      general_experience: clean(nearby.match(/\bgeneral experience\s*[:\-]\s*(.+?)(?=\bspecific experience\b|$)/i)?.[1] || ""),
      specific_experience: clean(nearby.match(/\bspecific experience\s*[:\-]\s*(.+?)(?=\b(?:role|responsibil|skills?|minimum)\b|$)/i)?.[1] || ""),
      role_description: clean(nearby.match(/\b(?:role description|responsibilities|tasks|duties)\s*[:\-]\s*(.+)$/i)?.[1] || ""),
      required_sector_experience: [],
      mandatory_skills: [],
      required_keywords: Array.from(new Set((nearby.match(/\b(?:FIDIC|AutoCAD|Primavera|BIM|GIS|QA\/QC|HSE|PMP|roads?|bridges?|water|wastewater|building|architecture|AI|Copilot)\b/gi) || []).map((item) => item.trim()))),
      nationality_preference: "",
      recovered_from_text: true,
    };
    positions.push(position);
    sourceEvidence.push(evidence("tender.positions", title, line));
  });

  return { positions, sourceEvidence };
}

export function mergeSourceEvidence(existing: any, additions: SourceEvidence[]) {
  const current = Array.isArray(existing) ? existing : [];
  return uniqueBy([...current, ...additions], (item: any) => `${item.field}|${item.value}|${item.lineNumber}`);
}
