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

function reconstructTenderLineBreaks(rawText: string) {
  return normalizeRawText(rawText)
    .replace(/\s+(JOB\s+TITLE\s+)/gi, "\n$1")
    .replace(/\s+(LIST OF\s+(?:CONCULTANCY|CONSULTANCY)\s+PERSONNEL)\b/gi, "\n$1")
    .replace(/\s+(\d{1,2}\s+[A-Z][A-Za-z /&().-]*?(?:Engineer|Surveyor|Inspector|Controller|Manager|Specialist|Coordinator|Supervisor|Architect|Planner|Advisor|Officer|Technician)\s+\d{1,2}(?:\s+\d{1,2}){0,2})(?=\s+\d{1,2}\s+[A-Z]|(?:\s+\*)|$)/g, "\n$1")
    .replace(/\s+(Role\s*&\s*Responsibilities)\b/gi, "\n$1")
    .replace(/\s+(Qualification)\b/gi, "\n$1")
    .replace(/\s+(Experience)\b/gi, "\n$1");
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

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
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
    const nextLine = clean(lines[index + 1]?.text || "");
    const nextLooksLikeInstitution =
      nextLine &&
      !eduPattern.test(nextLine) &&
      !stopPattern.test(nextLine) &&
      /\b(university|college|faculty|institute|school|academy|politecnico|quasar|sapienza)\b/i.test(nextLine);
    const institutionLine = nextLooksLikeInstitution ? nextLine.replace(/\s+[-\u2013\u2014]\s+.+$/, "") : "";
    const locationLine = nextLooksLikeInstitution ? clean(nextLine.match(/\s+[-\u2013\u2014]\s+(.+)$/)?.[1] || "") : "";
    const institution = clean(full.match(/\b(?:at|from)\s+([^,;]+?)(?:,|\b(?:19|20)\d{2}\b|$)/i)?.[1] || institutionLine);
    const year = clean(full.match(/\b(?:19|20)\d{2}\b|\b\d{2}\/(?:19|20)\d{2}\b(?:\s*[-\u2013\u2014]\s*(?:\d{2}\/(?:19|20)\d{2}|Present))?/i)?.[0] || "");
    education.push({
      degree: full.length <= 160 ? full : degreeText,
      field: inferredField,
      institution,
      location: locationLine,
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
    .replace(/[✓✔]/g, " ")
    .replace(/^[\d.)\-\s]+/, "")
    .replace(/^job\s+title\s*/i, "")
    .replace(/^requirements in construction phase\s+/i, "")
    .replace(/\s*\(\s*omani only\s*\)\s*$/i, "")
    .replace(/^(?:no\.?|number|qty|personnel|staff|key expert|expert|position|role|designation)\s*:?\s*/i, "")
    .replace(/\s*\(\s*\d+\s*(?:nos?\.?|persons?|staff)?\s*\)\s*$/i, "")
    .replace(/\s*[-–—:]\s*\d+\s*(?:nos?\.?|persons?|staff)?\s*$/i, "")
    .replace(/\s+(?:qty|quantity|no\.?|number)\s*[:\-]?\s*\d{1,2}\s*$/i, "")
    .replace(/\s+\d{1,2}\s*$/i, "")
    .replace(/[.;:,]\s*$/, "")
    .trim();
}

function isTenderFormOrEvaluationText(value: string) {
  const text = clean(value);
  return (
    /\bTECH-\d+[A-Z]?\b/i.test(text) ||
    /\bconsultant'?s\s+(organization|experience|comments?|suggestions?|methodology|work plan|team composition)\b/i.test(text) ||
    /\b(?:form|schedule)\s+tech[-\s]?\d/i.test(text) ||
    /\b(?:technical|financial)\s+proposal\b/i.test(text) ||
    /\bexperience\.\s*[✓✔]/i.test(text) ||
    /^[A-Z]\.\s+Consultant'?s\b/i.test(text)
  );
}

function positionKey(value: string) {
  return normalizePositionTitle(value)
    .toLowerCase()
    .replace(/\bomani only\b/g, "")
    .replace(/\bmaterials engineer\b/g, "material engineer")
    .replace(/\bsignaling\b/g, "signalling")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isLikelyTenderPosition(value: string) {
  const title = normalizePositionTitle(value);
  if (!title || title.length < 4 || title.length > 90) return false;
  if (isTenderFormOrEvaluationText(value) || isTenderFormOrEvaluationText(title)) return false;
  if (!/^[A-Z]/.test(title)) return false;
  if (/^(scope|background|objective|deliverables|submission|evaluation|financial|technical|appendix|annex|table|minimum|general|specific|description|experience|organization|methodology|work plan)$/i.test(title)) return false;
  if (/\b(experience|organization|methodology|approach|comments?|suggestions?|data sheet|instruction|proposal|evaluation|criterion|criteria)\b/i.test(title) && !/\b(engineer|expert|specialist|manager|surveyor|inspector|planner|architect|advisor|coordinator|controller|officer|team leader|resident engineer)\b/i.test(title)) return false;
  if (/^(consultant engineer|consulting engineer)$/i.test(title)) return false;
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

function stripRequirementNoise(line: string) {
  return clean(line)
    .replace(/\bOfficial Use Only\b/gi, "")
    .replace(/^---\s*PAGE\s+\d+\s*---$/i, "")
    .replace(/^Section\s+\d+\s*:\s*.+$/i, "")
    .replace(/^\d{1,3}$/i, "")
    .replace(/^(?:N|d|Staff|Qualifications|Estimate|Man|months)$/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function titleWordsFor(title: string) {
  return positionKey(title)
    .split(/\s+/)
    .map((word) => word.replace(/[^a-z0-9]+/g, ""))
    .filter((word) => word.length > 2);
}

function cleanRequirementContentLine(line: string, titleWords: string[]) {
  let text = stripRequirementNoise(line)
    .replace(/^[-•\u2022]\s*/, "• ")
    .replace(/^\d{1,2}\.\s*/, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return "";

  const hasRequirementSignal = /\b(master|bachelor|degree|diploma|engineering|economics|finance|architecture|planning|experience|years?|projects?|feasibility|design|construction|registration|registered|chartered|licensed|licenced|environmental|social|safeguards|surveying|geomatics|geospatial|transportation|railway|operations)\b/i.test(text);
  const degreeStart = text.search(/\b(?:master'?s?|bachelor'?s?|postgraduate|post graduate|professionally qualified|diploma|degree)\b/i);
  if (degreeStart > 0) text = text.slice(degreeStart).trim();
  const tokens = text.toLowerCase().split(/\s+/).map((word) => word.replace(/[^a-z0-9]+/g, "")).filter(Boolean);
  if (tokens.length && tokens.every((word) => titleWords.includes(word))) return "";

  while (tokens.length && titleWords.includes(tokens[0]) && hasRequirementSignal) {
    text = text.replace(/^\S+\s*/, "").trim();
    tokens.shift();
  }

  return text;
}

function requirementPoints(lines: string[], titleWords: string[]) {
  const points: string[] = [];
  for (const line of lines) {
    const cleaned = cleanRequirementContentLine(line, titleWords);
    if (!cleaned || /^education\s*:?\s*\d*$/i.test(cleaned)) continue;
    if (/^experience\s*:?\s*$/i.test(cleaned) && !points.length) continue;
    const startsBullet = /^[•\u2022]/.test(cleaned);
    const text = cleaned.replace(/^[•\u2022]\s*/, "").trim();
    if (!text || /^\d{1,2}$/.test(text)) continue;
    if (startsBullet || !points.length) {
      points.push(text);
    } else {
      points[points.length - 1] = `${points[points.length - 1]} ${text}`.trim();
    }
  }
  return points
    .map((point) => point.replace(/\s+/g, " ").trim())
    .filter((point) => point.length > 2);
}

function parseYearsFromRequirement(text: string) {
  const values: number[] = [];
  const source = String(text || "");
  for (const match of source.matchAll(/\((\d{1,2})\)\s+years?/gi)) values.push(Number(match[1]));
  for (const match of source.matchAll(/\b(\d{1,2})\s*(?:\+|or more)?\s+years?/gi)) values.push(Number(match[1]));
  for (const match of source.matchAll(/\b(\d{1,2})\s*-\s*(\d{1,2})\s+years?/gi)) values.push(Number(match[2]));
  return values.length ? Math.max(...values.filter(Boolean)) : undefined;
}

function parseRequirementSections(title: string, nearby: string) {
  const titleWords = titleWordsFor(title);
  const lines = String(nearby || "")
    .replace(/\r/g, "\n")
    .split(/\n+/)
    .map(stripRequirementNoise)
    .filter(Boolean);

  const educationIndex = lines.findIndex((line) => /^Education\s*:?\s*\d*$/i.test(line));
  const experienceIndex = lines.findIndex((line, index) => index > educationIndex && /^[•\u2022]?\s*Experience\s*:?\s*$/i.test(line));
  const registrationIndex = lines.findIndex((line, index) => index > Math.max(educationIndex, experienceIndex) && /^Professional Registration\b/i.test(line));
  const safeSlice = (start: number, end: number) => (start >= 0 ? lines.slice(start, end >= 0 ? end : lines.length) : []);

  const educationLines = safeSlice(educationIndex + 1, experienceIndex >= 0 ? experienceIndex : registrationIndex);
  const experienceLines = safeSlice(experienceIndex + 1, registrationIndex);
  const registrationLines = registrationIndex >= 0 ? safeSlice(registrationIndex + 1, -1) : [];
  const educationPoints = requirementPoints(educationLines, titleWords);
  const experiencePoints = requirementPoints(experienceLines, titleWords);
  const registrationPoints = requirementPoints(registrationLines, titleWords);
  const generalPoints = experiencePoints.slice(0, 1);
  const specificPoints = experiencePoints.length > 1
    ? experiencePoints.slice(1)
    : experiencePoints.filter((point) => /\bspecific experience\b/i.test(point));

  return {
    minimum_education: educationPoints.join(" "),
    minimum_years_experience: parseYearsFromRequirement(experiencePoints.join(" ")),
    general_experience: (generalPoints.length ? generalPoints : experiencePoints.slice(0, 1)).join(" "),
    specific_experience: specificPoints.filter((point) => !generalPoints.includes(point) || /specific|project|feasibility|study|design/i.test(point)).join(" "),
    role_description: registrationPoints.length ? `Professional Registration: ${registrationPoints.join(" ")}` : "",
  };
}

function buildTenderPositionFromBlock(title: string, line: string, nearby: string, source: string) {
  const rawReqText = String(nearby || "");
  const reqText = clean(rawReqText);
  const parsedSections = parseRequirementSections(title, rawReqText);
  const stripRoleTitleNoise = (value: string) =>
    clean(value)
      .replace(new RegExp(`\\b\\d{1,2}\\.\\s+${title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i"), " ")
      .replace(/\b\d{1,2}\.\s+[A-Z][A-Za-z /&().-]{0,80}(?=\s+(?:Bachelor|Master|Postgraduate|Engineering|Experience|Professional|Degree|Diploma|Qualification|\u2022|))/g, " ")
      .replace(/\bEstimate\s+Man\s+months\b/gi, " ")
      .replace(/\bOfficial Use Only\b/gi, " ")
      .replace(/\s+/g, " ")
      .trim();
  const educationSection = stripRoleTitleNoise(
    reqText.match(/\bEducation\s*:?\s*(?:\d{1,2}\s*)?(.+?)(?=\bExperience\s*:?\b|\bProfessional Registration\b|\b\d{1,2}\.\s+[A-Z]|$)/i)?.[1] || "",
  );
  const experienceSection = stripRoleTitleNoise(
    reqText.match(/\bExperience\s*:?\s*(.+?)(?=\bProfessional Registration\b|\bEducation\s*:?\s*\d{0,2}\s*\d{1,2}\.\s+[A-Z]|\b\d{1,2}\.\s+[A-Z]|$)/i)?.[1] || "",
  );
  const registrationSection = stripRoleTitleNoise(
    reqText.match(/\bProfessional Registration\s*:?\s*(.+?)(?=\bEducation\s*:?\s*\d{0,2}\s*\d{1,2}\.\s+[A-Z]|\b\d{1,2}\.\s+[A-Z]|$)/i)?.[1] || "",
  );
  const firstExperienceSentence = clean(reqText.match(/\b(?:shall have|must have|minimum|min\.?|at least|required)\s+[^.]{0,220}?\bexperience\b[^.]{0,260}(?:\.|$)/i)?.[0] || "");
  const firstResponsibilitySentence = clean(reqText.match(/\b(?:shall|will|must|responsible for|responsibilities include|duties include|tasks include|to\s+(?:manage|lead|prepare|review|supervise|coordinate|undertake|conduct|ensure|assist))\b[^.]{20,500}(?:\.|$)/i)?.[0] || "");
  const qualificationSentence = clean(reqText.match(/\b(?:qualification|minimum education|academic qualification|education)\s*[:\-]?\s*(.+?)(?=\b(?:general experience|specific experience|experience|role|responsibil|duties|tasks|skills?|location|position|job title)\b|$)/i)?.[1] || "");
  const combinedRequirements = stripRoleTitleNoise([experienceSection, registrationSection].filter(Boolean).join(" "));
  return {
    position_title: title,
    quantity: extractQuantity(line),
    minimum_education: parsedSections.minimum_education || educationSection || qualificationSentence || clean(reqText.match(/\b(?:bachelor|master|phd|degree|diploma|qualification)[^.]{0,220}(?:\.|$)/i)?.[0] || ""),
    minimum_years_experience: parsedSections.minimum_years_experience || Number(reqText.match(/\b(?:minimum|min\.?|at least)\s+(\d{1,2})\+?\s+years?\b/i)?.[1] || reqText.match(/\b(\d{1,2})\+?\s+years?\s+(?:of\s+)?(?:relevant|professional|general|specific)?\s*experience\b/i)?.[1] || 0) || undefined,
    general_experience: parsedSections.general_experience || clean(reqText.match(/\bgeneral experience\s*[:\-]?\s*(.+?)(?=\bspecific experience\b|\b(?:role\s*&\s*responsibilities|role description|responsibilities|duties|tasks|minimum education|qualification|skills?|location|position|job title)\b|$)/i)?.[1] || "") || experienceSection || firstExperienceSentence,
    specific_experience: parsedSections.specific_experience || clean(reqText.match(/\bspecific experience\s*[:\-]?\s*(.+?)(?=\b(?:role\s*&\s*responsibilities|role description|responsibilities|duties|tasks|minimum education|qualification|skills?|location|position|job title)\b|$)/i)?.[1] || ""),
    role_description: clean(reqText.match(/\b(?:role\s*&\s*responsibilities|role description|responsibilities|tasks|duties|scope of work)\s*[:\-]?\s*(.+?)(?=\b(?:general experience|specific experience|minimum education|qualification|skills?|location|position|job title)\b|$)/i)?.[1] || "") || firstResponsibilitySentence || parsedSections.role_description || combinedRequirements,
    required_sector_experience: [],
    mandatory_skills: Array.from(new Set((nearby.match(/\b(?:FIDIC|AutoCAD|Primavera|BIM|GIS|QA\/QC|HSE|PMP|laboratory|asphalt|earthworks?|survey|quantity|document control|contract management|site supervision)\b/gi) || []).map((item) => item.trim()))),
    required_keywords: Array.from(new Set((nearby.match(/\b(?:roads?|bridges?|water|wastewater|buildings?|infrastructure|construction|supervision|design|drainage|pavement|utilities|geotechnical|materials?|laboratory|asphalt|earthworks?|survey|quantity|document control)\b/gi) || []).map((item) => item.trim()))),
    nationality_preference: /\bomani only\b|\bnational only\b/i.test(`${line} ${nearby}`) ? "Omani only" : "",
    recovered_from_text: true,
    recovery_source: source,
  };
}

function enrichPositionsFromBlocks(basePositions: any[], lines: TextLine[]) {
  return basePositions.map((position) => {
    const title = normalizePositionTitle(position.position_title || "");
    if (!title) return position;
    const titleKey = positionKey(title);
    const titleWords = titleKey.split(/\s+/).filter((word) => word.length > 2);
    const positionNumber = Number(position.source_position_number || 0);
    const explicitNumberedIndexes = positionNumber
      ? lines
          .map((line, index) => ({ line, index }))
          .filter(({ line, index }) => {
            if (!new RegExp(`^\\s*${positionNumber}\\.\\s+`, "i").test(line.text)) return false;
            const lineKey = positionKey(line.text);
            const rawWindow = lines.slice(index, Math.min(lines.length, index + 12)).map((item) => item.text).join(" ");
            const window = positionKey(rawWindow);
            const hasRequirementMarkers = /\b(?:bachelor|master|postgraduate|degree|experience|professional registration|chartered|registered)\b/i.test(rawWindow);
            const lineHasTitleWord = titleWords.some((word) => lineKey.includes(word));
            const windowHasAllTitleWords = titleWords.every((word) => window.includes(word));
            return windowHasAllTitleWords || (lineHasTitleWord && hasRequirementMarkers);
          })
          .map(({ index }) => index)
      : [];
    const candidateIndexes = lines
      .map((line, index) => ({ line, index }))
      .filter(({ line }) => {
      const lineKey = positionKey(line.text);
      return lineKey === titleKey || new RegExp(`\\b${title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(line.text);
      })
      .map(({ index }) => index);
    const index = [...explicitNumberedIndexes, ...candidateIndexes]
      .filter((value, index, array) => value >= 0 && array.indexOf(value) === index)
      .sort((a, b) => {
        const score = (idx: number) => {
          const window = lines.slice(Math.max(0, idx - 3), Math.min(lines.length, idx + 70)).map((item) => item.text).join(" ");
          return (
            (/\bEducation\s*:?\b/i.test(window) ? 8 : 0) +
            (/\bExperience\s*:?\b/i.test(window) ? 8 : 0) +
            (/\bProfessional Registration\b/i.test(window) ? 4 : 0) +
            (/Table\s+\d+:\s+Required qualifications/i.test(window) ? 3 : 0) -
            (/\bPosition\s+K[-\s]?\d+/i.test(window) ? 5 : 0)
          );
        };
        return score(b) - score(a) || a - b;
      })[0] ?? -1;
    if (index < 0) return position;
    const blockLines: string[] = [];
    const start = Math.max(0, index - 2);
    const nextNumberPattern = positionNumber ? new RegExp(`^\\s*${positionNumber + 1}\\.\\s+`, "i") : null;
    for (let i = start; i < Math.min(lines.length, index + 90); i++) {
      const text = lines[i].text;
      if (i > index && nextNumberPattern?.test(text)) break;
      if (i > index && /^Table\s+\d+\s*:/i.test(text)) break;
      if (i > index && /\b(?:Non\s*[–-]\s*Key Experts|Table\s+3|Required qualifications of Non-Key Staff)\b/i.test(text)) break;
      if (i > index && /\bRequired qualifications of Non-Key Staff\b/i.test(text)) break;
      if (i > index && /\bJOB\s+TITLE\b/i.test(text)) break;
      if (i > index + 4 && isLikelyTenderPosition(text) && /\b(?:qualification|experience|responsibil|duties|tasks)\b/i.test(blockLines.join(" "))) break;
      blockLines.push(text);
    }
    const enriched = buildTenderPositionFromBlock(title, lines[index].text, blockLines.join("\n"), "requirement_block_enrichment");
    return {
      ...position,
      minimum_education: position.minimum_education || enriched.minimum_education,
      minimum_years_experience: position.minimum_years_experience || enriched.minimum_years_experience,
      general_experience: position.general_experience || enriched.general_experience,
      specific_experience: position.specific_experience || enriched.specific_experience,
      role_description: position.role_description || enriched.role_description,
      mandatory_skills: Array.from(new Set([...(position.mandatory_skills || []), ...(enriched.mandatory_skills || [])])),
      required_keywords: Array.from(new Set([...(position.required_keywords || []), ...(enriched.required_keywords || [])])),
    };
  });
}

function extractJobTitlePositions(lines: TextLine[]) {
  const positions: any[] = [];
  const seen = new Set<string>();
  const titlePattern = /\bJOB\s+TITLE\s+(.+?)(?=\s+(?:Location|Qualification|Experience|Role\s*&\s*Responsibilities)\b|$)/i;
  const stopPattern = /\bJOB\s+TITLE\b|^\d{1,2}\.\d+\.|^--\s*\d+\s+of\s+\d+\s*--|^LIST OF\b|^Item\b/i;

  lines.forEach((line, index) => {
    const titleMatch = line.text.match(titlePattern);
    if (!titleMatch) return;
    const title = normalizePositionTitle(titleMatch[1]);
    if (!isLikelyTenderPosition(title)) return;
    const key = positionKey(title);
    if (!key || seen.has(key)) return;
    seen.add(key);

    const blockLines: string[] = [line.text.slice((titleMatch.index || 0) + titleMatch[0].length)];
    for (let i = index + 1; i < Math.min(lines.length, index + 45); i++) {
      const text = lines[i].text;
      if (stopPattern.test(text)) break;
      blockLines.push(text);
    }
    const block = blockLines.join(" ");
    positions.push({
      ...buildTenderPositionFromBlock(title, line.text, block, "job_title_section"),
      quantity: 1,
      nationality_preference: /\bomani only\b/i.test(titleMatch[1]) ? "Omani only" : "",
    });
  });
  return positions;
}

function extractPersonnelTablePositions(lines: TextLine[]) {
  const positions: any[] = [];
  const seen = new Set<string>();
  const startIndex = lines.findIndex((line) => /LIST OF\s+CONCULTANCY\s+PERSONNEL|LIST OF\s+CONSULTANCY\s+PERSONNEL/i.test(line.text));
  if (startIndex < 0) return positions;

  const tableLines = lines.slice(startIndex, Math.min(lines.length, startIndex + 45));
  const rowPattern = /^(?:\d{1,2}\s+)?([A-Za-z][A-Za-z /&().-]*?(?:Engineer|Surveyor|Inspector|Controller|Manager|Specialist|Coordinator|Supervisor|Architect|Planner|Advisor|Officer|Technician))(?:\s+(\d{1,2}))?(?:\s+\d{1,2})?(?:\s+\d{1,2})?$/i;
  tableLines.forEach((line) => {
    const text = clean(line.text);
    if (/^(Item|No\.|Total|Required|Personnel|Omani|National|Expatriate|Requirements|phase|\*)\b/i.test(text)) return;
    const match = text.match(rowPattern);
    if (!match) return;
    const title = normalizePositionTitle(match[1]);
    if (!isLikelyTenderPosition(title)) return;
    const key = positionKey(title);
    if (!key || seen.has(key)) return;
    seen.add(key);
    positions.push({
      position_title: title,
      quantity: Number(match[2] || 1),
      minimum_education: "",
      minimum_years_experience: undefined,
      general_experience: "",
      specific_experience: "",
      role_description: "",
      required_sector_experience: [],
      mandatory_skills: [],
      required_keywords: [],
      nationality_preference: "",
      recovered_from_text: true,
      recovery_source: "personnel_table",
    });
  });
  return positions;
}

function extractKeyExpertPositionRows(lines: TextLine[]) {
  const positions: any[] = [];
  const seen = new Set<string>();
  const positionRowPattern = /^\s*(\d{1,2})\)?\s+Position\s+K[-\s]?\d+[A-Z]?\s*:?\s*(.+)$/i;
  const nextPositionPattern = /^\s*\d{1,2}\)?\s+Position\s+K[-\s]?\d+[A-Z]?\s*:?/i;
  const scorePattern = /\s+\d+(?:\.\d+)?\s*points?.*$/i;
  const stopPattern = /^(?:total|official use only|the number of points|sub-criteria|general qualifications|adequacy for|relevant experience|transfer of knowledge|participation by nationals)\b/i;

  lines.forEach((line, index) => {
    const match = line.text.match(positionRowPattern);
    if (!match) return;

    let titleText = clean(match[2]).replace(scorePattern, "").trim();
    for (let offset = 1; offset <= 3; offset++) {
      const next = clean(lines[index + offset]?.text || "");
      if (!next || nextPositionPattern.test(next) || stopPattern.test(next)) break;

      const currentTitle = normalizePositionTitle(titleText);
      const needsContinuation = /(?:&|\/|-)$/.test(titleText) || !isLikelyTenderPosition(currentTitle);
      const usefulContinuation =
        /^[a-z]/.test(next) ||
        /\b(?:engineer|expert|specialist|surveyor|planner|architect|economist|analyst|leader|manager)\b/i.test(next);
      if (!needsContinuation || !usefulContinuation || next.length > 90) break;
      titleText = `${titleText} ${next.replace(scorePattern, "").trim()}`.trim();
    }

    const title = normalizePositionTitle(titleText);
    if (!isLikelyTenderPosition(title)) return;
    const key = positionKey(title);
    if (!key || seen.has(key)) return;
    seen.add(key);
    positions.push({
      position_title: title,
      quantity: 1,
      minimum_education: "",
      minimum_years_experience: undefined,
      general_experience: "",
      specific_experience: "",
      role_description: "",
      required_sector_experience: [],
      mandatory_skills: [],
      required_keywords: [],
      nationality_preference: "",
      recovered_from_text: true,
      recovery_source: "key_expert_position_table",
      source_line_number: line.number,
      source_position_number: Number(match[1]),
    });
  });

  return positions;
}

function extractLooseRoleListPositions(lines: TextLine[]) {
  const positions: any[] = [];
  const seen = new Set<string>();
  const sectionHeadingPattern = /\b(key experts?|staff|personnel|team composition|professional staff|experts required|required positions?|required experts?|manpower|schedule of staff|resource persons?|project team|consultant'?s team)\b/i;
  const explicitRolePattern =
    /\b(?:position|role|staff|expert|key expert|job title|designation)\s*[:\-]\s*(.+)$/i;
  const listRolePattern =
    /^(?:\d{1,2}[.)]\s*|[-\u2022]\s*)?([A-Za-z][A-Za-z /&().-]{3,90}?(?:Manager|Engineer|Expert|Specialist|Consultant|Leader|Director|Coordinator|Surveyor|Inspector|Architect|Designer|Planner|Scheduler|Advisor|Trainer|Analyst|Officer|Supervisor|Controller|Technician|Draftsman|Economist|Sociologist|Environmentalist|Hydrologist|Geologist))(?:\s*(?:-|–|—|:|\()\s*(?:qty|quantity|no\.?|number|nos?\.?|persons?|staff)?\s*\d{1,2}|\s+\d{1,2}\s*(?:nos?\.?|persons?|staff)?)?/i;
  let inRoleSectionUntil = -1;

  lines.forEach((line, index) => {
    if (sectionHeadingPattern.test(line.text)) {
      inRoleSectionUntil = Math.max(inRoleSectionUntil, index + 80);
    }
    const inRoleSection = index <= inRoleSectionUntil;
    const compact = line.text;
    if (isTenderFormOrEvaluationText(compact)) return;
    const explicit = compact.match(explicitRolePattern)?.[1] || "";
    const wordCount = compact.split(/\s+/).length;
    const listLike = /^(?:\d{1,2}[.)]\s*|[-\u2022]\s*)/.test(compact) || /\b(?:qty|no\.?|number|nos?\.?|persons?|staff)\b/i.test(compact) || wordCount <= 7;
    const listMatch = inRoleSection && listLike && compact.length <= 140 ? compact.match(listRolePattern)?.[1] || "" : "";
    const title = normalizePositionTitle(explicit || listMatch);
    if (!isLikelyTenderPosition(title)) return;
    const key = positionKey(title);
    if (!key || seen.has(key)) return;
    seen.add(key);

    const blockLines = [compact];
    for (let i = index + 1; i < Math.min(lines.length, index + 30); i++) {
      const next = lines[i].text;
      if (sectionHeadingPattern.test(next) && i > index + 2) break;
      if (next.match(explicitRolePattern) || (inRoleSection && next.match(listRolePattern) && /\b(?:qualification|experience|responsibil|duties|tasks)\b/i.test(blockLines.join(" ")))) break;
      blockLines.push(next);
    }

    positions.push(buildTenderPositionFromBlock(title, compact, blockLines.join(" "), "loose_role_section"));
  });
  return positions;
}

export function extractUniversalTenderFacts(rawText: string): UniversalTenderFacts {
  const lines = toTextLines(reconstructTenderLineBreaks(rawText));
  const positions: any[] = [];
  const sourceEvidence: SourceEvidence[] = [];
  const seen = new Set<string>();
  const keyExpertRows = extractKeyExpertPositionRows(lines);

  if (keyExpertRows.length >= 3) {
    const recovered = enrichPositionsFromBlocks(keyExpertRows, lines);
    return {
      positions: recovered,
      sourceEvidence: recovered.map((position) => ({
        field: "tender.positions",
        value: position.position_title,
        lineNumber: position.source_line_number || 0,
        line: position.position_title,
      })),
    };
  }

  const structuredPositions = [
    ...extractPersonnelTablePositions(lines),
    ...extractJobTitlePositions(lines),
    ...extractLooseRoleListPositions(lines),
  ];
  if (structuredPositions.length) {
    const byTitle = new Map<string, any>();
    structuredPositions.forEach((position) => {
      const key = positionKey(position.position_title);
      const current = byTitle.get(key) || {};
      byTitle.set(key, {
        ...current,
        ...position,
        position_title: current.position_title || position.position_title,
        quantity: current.quantity || position.quantity || 1,
        minimum_education: current.minimum_education || position.minimum_education || "",
        minimum_years_experience: current.minimum_years_experience || position.minimum_years_experience,
        general_experience: current.general_experience || position.general_experience || "",
        specific_experience: current.specific_experience || position.specific_experience || "",
        role_description: current.role_description || position.role_description || "",
        required_sector_experience: Array.from(new Set([...(current.required_sector_experience || []), ...(position.required_sector_experience || [])])),
        mandatory_skills: Array.from(new Set([...(current.mandatory_skills || []), ...(position.mandatory_skills || [])])),
        required_keywords: Array.from(new Set([...(current.required_keywords || []), ...(position.required_keywords || [])])),
        nationality_preference: current.nationality_preference || position.nationality_preference || "",
        recovery_source: Array.from(new Set([current.recovery_source, position.recovery_source].filter(Boolean))).join(","),
      });
    });
    const recovered = enrichPositionsFromBlocks(Array.from(byTitle.values()), lines);
    return {
      positions: recovered,
      sourceEvidence: recovered.map((position, index) => ({
        field: "tender.positions",
        value: position.position_title,
        lineNumber: index + 1,
        line: position.position_title,
      })),
    };
  }

  lines.forEach((line, index) => {
    const compact = line.text;
    if (isTenderFormOrEvaluationText(compact)) return;
    const titleFromDelimited =
      compact.match(/\b(?:position|role|staff|expert|key expert)\s*[:\-]\s*(.+)$/i)?.[1] ||
      compact.match(/^\s*\d{1,2}\s*[-.)]\s*(.+)$/)?.[1] ||
      compact.match(/^(.+?)\s+(?:qty|quantity|no\.?|number)\s*[:\-]?\s*\d{1,2}\b/i)?.[1] ||
      compact.match(/^(.+?)\s*[-–—:]\s*\d{1,2}\s*(?:nos?\.?|persons?|staff)\b/i)?.[1] ||
      compact;
    const title = normalizePositionTitle(titleFromDelimited);
    if (!isLikelyTenderPosition(title)) return;
    const key = positionKey(title);
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
