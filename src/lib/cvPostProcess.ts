import { extractUniversalCVFacts, mergeSourceEvidence } from "./universalExtraction";

function clean(value: any) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function wordCount(value: any) {
  return clean(value).split(/\s+/).filter(Boolean).length;
}

function pointCount(value: any) {
  const text = clean(value);
  if (!text) return 0;
  const bulletParts = text
    .split(/\n+|(?:^|\s)[\-\u2022]\s+/)
    .map((part) => part.trim())
    .filter((part) => wordCount(part) >= 4);
  if (bulletParts.length > 1) return bulletParts.length;
  return text.split(/[.;]\s+/).map((part) => part.trim()).filter((part) => wordCount(part) >= 5).length;
}

function hasMeaningfulEducation(value: any) {
  const items = Array.isArray(value) ? value : value ? [value] : [];
  return items.some((item) => {
    const text = clean(typeof item === "string" ? item : [item.degree, item.field, item.institution, item.location, item.year].filter(Boolean).join(" "));
    return wordCount(text) >= 3 && /civil|engineer|engineering|survey|quantity|construction|architecture|bachelor|master|diploma|associate|ph\.?d|dae/i.test(text);
  });
}

function formatLanguage(value: any) {
  if (typeof value === "string") return clean(value);
  const name = clean(value?.name || value?.language);
  const level = clean(value?.level || value?.proficiency || value?.fluency);
  return name ? (level ? `${name} - ${level}` : name) : "";
}

function normalizeLanguageObjects(value: any) {
  const items = Array.isArray(value) ? value : value ? [value] : [];
  const byName = new Map<string, any>();
  items.forEach((item) => {
    const text = typeof item === "string" ? item : formatLanguage(item);
    const [rawName, ...levelParts] = text.split(/\s+[-\u2013\u2014:]\s+/);
    const name = clean(typeof item === "string" ? rawName : item?.name || item?.language || rawName);
    const level = clean(typeof item === "string" ? levelParts.join(" - ") : item?.level || item?.proficiency || item?.fluency || levelParts.join(" - "));
    if (!name) return;
    const key = name.toLowerCase();
    const existing = byName.get(key);
    byName.set(key, { name, level: existing?.level || level });
  });
  return Array.from(byName.values());
}

function formatEducation(value: any) {
  if (typeof value === "string") return clean(value);
  return clean([
    value?.degree && value?.field && !String(value.degree).toLowerCase().includes(String(value.field).toLowerCase())
      ? `${value.degree} in ${value.field}`
      : value?.degree || value?.field,
    value?.institution,
    value?.location,
    value?.year,
    value?.grade,
    value?.notes && !clean(value?.degree).includes(clean(value?.notes)) ? value.notes : "",
  ].filter(Boolean).join(", "));
}

function normalizeEducationObjects(value: any) {
  const items = Array.isArray(value) ? value : value ? [value] : [];
  const normalized = items
    .map((item) => {
      if (typeof item !== "string") {
        return {
          degree: clean(item?.degree || item?.qualification || item?.title),
          field: clean(item?.field || item?.fieldOfStudy || item?.major),
          institution: clean(item?.institution || item?.school || item?.university),
          year: clean(item?.year || item?.date || item?.period),
          location: clean(item?.location || item?.country),
          grade: clean(item?.grade || item?.gpa),
          notes: clean(item?.notes),
        };
      }
      const text = clean(item);
      return { degree: text, field: "", institution: "", year: clean(text.match(/\b(?:19|20)\d{2}\b|\b\d{2}\/(?:19|20)\d{2}\b/)?.[0] || ""), location: "", grade: "", notes: "" };
    })
    .filter((item) => {
      const text = formatEducation(item);
      if (wordCount(text) < 2) return false;
      if (/^to practice as\b/i.test(text)) return false;
      if (/to practice as/i.test(item.degree) && !/\b(architect|engineer|engineering|architecture|bachelor|master|diploma|ph\.?d|degree)\b/i.test(item.degree)) return false;
      return true;
    });

  const seen = new Set<string>();
  return normalized.filter((item) => {
    const key = formatEducation(item).toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function normalizeExpertCollections(expert: any) {
  const languageObjects = normalizeLanguageObjects([
    ...(Array.isArray(expert?.metadata?.languages) ? expert.metadata.languages : []),
    ...(Array.isArray(expert?.languages) ? expert.languages : expert?.languages ? [expert.languages] : []),
  ]);
  const educationObjects = normalizeEducationObjects([
    ...(Array.isArray(expert?.metadata?.educations) ? expert.metadata.educations : []),
    ...(Array.isArray(expert?.education) ? expert.education : expert?.education ? [expert.education] : []),
  ]);

  return {
    ...expert,
    languages: languageObjects.map(formatLanguage).filter(Boolean),
    education: educationObjects.map(formatEducation).filter(Boolean),
    educationLevel: expert?.educationLevel || formatEducation(educationObjects[0]),
    metadata: {
      ...(expert?.metadata || {}),
      languages: languageObjects,
      educations: educationObjects,
    },
  };
}

function normalizeSourceText(value: string) {
  return String(value || "")
    .replace(/\r/g, "\n")
    .replace(/\u00A0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{2,}/g, "\n")
    .replace(/\b--\s*\d+\s+of\s+\d+\s*--\b/gi, "\n")
    .replace(/\bPage\s+\d+\s+of\s+\d+\b/gi, "\n")
    .trim();
}

function uniqueCleanLines(lines: string[]) {
  const seen = new Set<string>();
  return lines
    .map((line) => clean(line).replace(/^[-\u2022]\s*/, "").replace(/[.;]\s*$/, ""))
    .filter(Boolean)
    .filter((line) => {
      const key = line.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function unwrapNarrativeLines(value: string) {
  const lines = normalizeSourceText(value).split(/\n+/).map(clean).filter(Boolean);
  const joined: string[] = [];
  lines.forEach((line) => {
    const startsNewPoint = /^[-\u2022]/.test(line) ||
      /^(Name|Date of Birth|Nationality|Proposed Position|Language Known|Qualification|E-Mail|Mobile|Professional Experience|From\b|[A-Z][a-z]{2,8}\.?\s+\d{4}\b|Client|Project Name|Nature of Work|Cost of|Design Consultant|Consultant|Contractor|Responsibility|Work Supervised|Declaration|Place & Date)\b/i.test(line);
    if (!joined.length || startsNewPoint) {
      joined.push(line);
      return;
    }
    joined[joined.length - 1] = `${joined[joined.length - 1]} ${line}`;
  });
  return joined.join("\n");
}

function normalizedIncludes(haystack: string, needle: string) {
  const value = clean(needle).toLowerCase();
  return value.length >= 4 && haystack.toLowerCase().includes(value);
}

function dateRangePattern() {
  const month = "(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t)?|Sept(?:ember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\\.?"
  return `(?:(?:${month})\\s*\\d{4}|\\d{1,2}\\/\\d{4}|\\d{4})\\s*(?:to|-|\\u2013|\\u2014|\\?)\\s*(?:till\\s+date|present|date|(?:${month})\\s*\\d{4}|\\d{1,2}\\/\\d{4}|\\d{4})`;
}

function isLikelyEmploymentBoundary(line: string) {
  const text = clean(line);
  if (!new RegExp(dateRangePattern(), "i").test(text)) return false;
  if (/training|course|degree|master|bachelor|erasmus|qualification|signature/i.test(text)) return false;
  return true;
}

function getBoundedSourceBlock(rawText: string, item: any) {
  const lines = normalizeSourceText(rawText).split(/\n+/).map(clean).filter(Boolean);
  if (!lines.length) return "";
  const period = clean(item.duration || item.period || `${item.start_date || ""} ${item.end_date || ""}`);
  const anchors = [
    item.role,
    item.organization,
    item.client,
    period,
    item.start_date,
  ].map(clean).filter((anchor) => anchor.length >= 4);

  let startLine = -1;
  let bestScore = 0;
  lines.forEach((line, index) => {
    const windowText = lines.slice(index, Math.min(lines.length, index + 3)).join(" ").toLowerCase();
    const score = anchors.filter((anchor) => windowText.includes(anchor.toLowerCase())).length;
    if (score > bestScore && (score >= 2 || (score >= 1 && isLikelyEmploymentBoundary(line)))) {
      bestScore = score;
      startLine = index;
    }
  });

  if (startLine < 0) return "";
  let endLine = lines.length;
  for (let i = startLine + 1; i < lines.length; i++) {
    if (isLikelyEmploymentBoundary(lines[i])) {
      endLine = i;
      break;
    }
    if (/^(Education|Education & Training|Training|Signature|I authorize)\b/i.test(lines[i])) {
      endLine = i;
      break;
    }
  }
  return lines.slice(startLine, endLine).join("\n");
}

function getRelevantSourceWindow(rawText: string, item: any) {
  const bounded = getBoundedSourceBlock(rawText, item);
  if (bounded) return bounded;
  const text = clean(rawText);
  if (!text) return "";
  const period = clean(item.duration || item.period || `${item.start_date || ""} ${item.end_date || ""}`);
  const anchors = [
    item.organization,
    item.client,
    item.role,
    item.country,
    period,
    ...(period.match(/\b(19|20)\d{2}\b/g) || []),
  ].map(clean).filter((anchor) => anchor.length >= 4);

  let bestIndex = -1;
  let bestScore = 0;
  anchors.forEach((anchor) => {
    const index = text.toLowerCase().indexOf(anchor.toLowerCase());
    if (index < 0) return;
    const window = text.slice(Math.max(0, index - 180), index + 1100);
    const score = anchors.filter((candidate) => normalizedIncludes(window, candidate)).length;
    if (score > bestScore) {
      bestScore = score;
      bestIndex = index;
    }
  });

  if (bestIndex < 0 || bestScore < 2) return "";
  return text.slice(Math.max(0, bestIndex - 220), bestIndex + 1300);
}

function splitActivityPoints(value: string) {
  return unwrapNarrativeLines(value)
    .replace(/\s*[\u2022\u25AA\u25E6]\s*/g, "\n")
    .replace(/\s+-\s+/g, "\n")
    .split(/\n+|;\s+|(?<=[.])\s+(?=(?:Prepared|Reviewed|Designed|Supervised|Managed|Coordinated|Checked|Monitored|Inspected|Handled|Assisted|Conducted|Developed|Evaluated|Ensured|Provided|Responsible|Responsibility|Duties|Responsibilities|The work involved|In addition|Asphalt|Concrete|Soil)\b)/i)
    .map((line) => clean(line).replace(/^[-\u2022]\s*/, ""))
    .filter((line) => !new RegExp(dateRangePattern(), "i").test(line))
    .filter((line) => wordCount(line) >= 5)
    .filter((line) => /responsib|duties|prepared|preparation|designed|reviewed|supervised|supervision|managed|coordinated|checked|checking|analysis|inspection|progress|quality|safety|construction|claims|variation|monitor|estimate|report|site|contract|quantity|survey|boq|invoice|measurement|laboratory|asphalt|concrete|soil|subgrade|subbase|embankment|calibration|compaction|gradation|testing|test|rfi|ncr|hse|marshal|marshall|field density|aashto|astm/i.test(line));
}

function mergeActivityDetails(currentDescription: string, sourceWindow: string) {
  const current = clean(currentDescription);
  const currentLower = current.toLowerCase();
  const sourcePoints = splitActivityPoints(sourceWindow);
  const missingPoints = sourcePoints.filter((point) => {
    const keywords = (point.toLowerCase().match(/\b[a-z]{5,}\b/g) || []).slice(0, 8);
    const overlap = keywords.filter((keyword) => currentLower.includes(keyword)).length;
    return overlap < Math.min(3, keywords.length);
  });

  if (!missingPoints.length) return currentDescription;

  const existingLines = current
    ? current
        .split(/\n+/)
        .map((line) => clean(line).replace(/^[-\u2022]\s*/, ""))
        .filter(Boolean)
    : [];

  const merged = [...existingLines, ...missingPoints]
    .map((line) => `- ${line.replace(/[.;]\s*$/, "")}`)
    .join("\n");

  return merged || currentDescription;
}

export function recoverEmploymentActivitiesFromText(expert: any, rawText: string) {
  const experiences = expert.experiences || expert.employment_history || [];
  if (!experiences.length || !rawText) return expert;

  const recoveredIndexes: number[] = [];
  const nextExperiences = experiences.map((item: any, index: number) => {
    const description = clean(item.description);
    if (item._sourceRecovered || pointCount(description) >= 2) return item;
    const sourceWindow = getRelevantSourceWindow(rawText, item);
    if (!sourceWindow) return item;

    const sourceHasMoreDetail =
      /responsib|duties|prepared|preparation|designed|reviewed|supervised|supervision|managed|coordinated|checked|checking|analysis|inspection|progress|quality|safety|construction|claims|variation|monitor|estimate|report|site|contract|quantity|survey|boq|invoice|measurement/i.test(sourceWindow) &&
      wordCount(sourceWindow) >= Math.max(45, wordCount(description) + 20) &&
      pointCount(sourceWindow) >= Math.max(2, pointCount(description) + 1);

    if (!sourceHasMoreDetail) return item;

    const mergedDescription = mergeActivityDetails(description, sourceWindow);
    if (clean(mergedDescription) === description) return item;

    recoveredIndexes.push(index + 1);
    return {
      ...item,
      description: mergedDescription,
    };
  });

  if (!recoveredIndexes.length) return expert;

  return {
    ...expert,
    experiences: nextExperiences,
    employment_history: nextExperiences,
    extraction_recovery: {
      ...(expert.extraction_recovery || {}),
      employmentActivitiesRecoveredFromRawText: recoveredIndexes,
    },
    metadata: {
      ...(expert.metadata || {}),
      extraction_audit_notes: [
        ...(expert.metadata?.extraction_audit_notes || []),
        `Recovered additional employment activity details from source CV for employment record(s): ${recoveredIndexes.join(", ")}.`,
      ],
    },
  };
}

function parseEducationItem(text: string) {
  const value = clean(text)
    .replace(/^(qualification|qualifications|education|academic qualifications|academic)\s*:?\s*/i, "")
    .replace(/[\u2022\uF0D8]/g, "")
    .trim();
  if (!value) return null;

  const parentheticalField = value.match(/\(([^)]+)\)\s*$/);
  const field = parentheticalField?.[1] || (value.match(/\b(Civil|Structural|Mechanical|Electrical|Quantity Surveying|Construction Management|Architecture|Surveying)\b(?:\s+Engineering)?/i)?.[0] || "");
  const degree = parentheticalField ? value.replace(/\s*\([^)]+\)\s*$/, "") : value;

  return {
    degree,
    field,
    notes: value,
  };
}

export function recoverEducationFromText(text: string) {
  const normalized = normalizeSourceText(text);
  const start = normalized.search(/\b(qualification|qualifications|education|academic qualifications|academic)\b/i);
  if (start < 0) return [];

  const endMatch = normalized
    .slice(start)
    .search(/\b(additional qualification|computer|professional experience|employment|experience|skills|personal profile|references)\b/i);
  const section = normalized
    .slice(start, endMatch > 0 ? start + endMatch : start + 900)
    .replace(/[\u2022\uF0D8]/g, " ");
  const patterns = [
    /\bQualification\s*:?\s*([^\n.;]{3,180})/gi,
    /\b(?:Ph\.?D\.?|Doctor(?:ate)?|DAE|Diploma|Bachelor|Bachelors|Bachelor's|BSc|B\.?Sc\.?|Master|Masters|MSc|M\.?Sc\.?|MEng|M\.?Eng|Degree|Intermediate|Matriculation)\s+(?:of\s+|in\s+)?[A-Za-z&/.,() -]{3,160}(?=\s+(?:Ph\.?D|Doctor|DAE|Diploma|Bachelor|BSc|B\.?Sc|Master|MSc|MEng|M\.?Eng|Intermediate|Matriculation|Memberships|Skills|Personal Profile|References)|$)/gi,
    /\b(?:Civil Engineering|Structural Engineering|Civil Engineer|Quantity Surveying|Pre-Engineering|Matriculation Science|Architecture|Surveying|Construction Management)\b(?:\s*\([^)]+\))?/gi,
  ];

  const found = patterns
    .flatMap((pattern) => Array.from(section.matchAll(pattern)).map((match) => match[1] || match[0]))
    .map((item) => item.replace(/^(qualification|education)\s*:?/i, "").trim())
    .map((item) => item.replace(/[\u2022\uF0D8]/g, "").replace(/\s+/g, " ").trim())
    .filter((item) => wordCount(item) >= 2);

  return Array.from(new Set(found)).map(parseEducationItem).filter(Boolean);
}

function periodSignature(value: string) {
  return clean(value)
    .toLowerCase()
    .replace(/\b(sept|sep)\.?\b/g, "sep")
    .replace(/\bdec\.\b/g, "dec")
    .replace(/\boct\.\b/g, "oct")
    .replace(/\s+/g, " ");
}

function dateKey(value: any) {
  return clean(value)
    .toLowerCase()
    .replace(/[^\d/a-z]+/g, " ")
    .replace(/\b(january|jan)\b/g, "jan")
    .replace(/\b(february|feb)\b/g, "feb")
    .replace(/\b(march|mar)\b/g, "mar")
    .replace(/\b(april|apr)\b/g, "apr")
    .replace(/\b(june|jun)\b/g, "jun")
    .replace(/\b(july|jul)\b/g, "jul")
    .replace(/\b(august|aug)\b/g, "aug")
    .replace(/\b(september|sept|sep)\b/g, "sep")
    .replace(/\b(october|oct)\b/g, "oct")
    .replace(/\b(november|nov)\b/g, "nov")
    .replace(/\b(december|dec)\b/g, "dec")
    .replace(/\s+/g, " ")
    .trim();
}

function isEducationLikeRole(value: any) {
  return /\b(training|course|degree|master|bachelor|erasmus|qualification|education|faculty|institute|school|university)\b/i.test(clean(value));
}

function extractFirst(pattern: RegExp, text: string) {
  return clean(text.match(pattern)?.[1] || "");
}

function inferCountryFromBlock(block: string) {
  const countries = ["Oman", "Pakistan", "Saudi Arabia", "UAE", "United Arab Emirates", "Qatar", "Bahrain", "Kuwait", "India"];
  return countries
    .map((country) => ({
      country,
      index: block.search(new RegExp(`\\b${country.replace(/\s+/g, "\\s+")}\\b`, "i")),
    }))
    .filter((item) => item.index >= 0)
    .sort((a, b) => a.index - b.index)[0]?.country || "";
}

function inferRoleAndOrganization(block: string) {
  const text = unwrapNarrativeLines(block);
  const stop = "(?:\\s+for\\b|\\s+For\\b|\\n|\\s+Project\\s+Name\\b|\\s+Client\\b|\\s+Nature\\s+of\\s+Work\\b)";
  const patterns = [
    new RegExp(`\\bWorking\\s+with\\s+(.+?)\\s+as\\s+(?:a\\s+|an\\s+)?(.+?)${stop}`, "i"),
    new RegExp(`\\bWorking\\s+as\\s+(?:a\\s+|an\\s+)?(.+?)\\s+with\\s+(.+?)${stop}`, "i"),
    new RegExp(`\\bWorked\\s+with\\s+(.+?)\\s+as\\s+(?:a\\s+|an\\s+)?(.+?)${stop}`, "i"),
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match) continue;
    const first = clean(match[1]).replace(/[.,]\s*$/, "");
    const second = clean(match[2]).replace(/[.,]\s*$/, "");
    if (/working\s+as/i.test(match[0])) {
      return { role: first, organization: second };
    }
    return { organization: first, role: second };
  }

  return {
    organization: extractFirst(/\bwith\s+(.+?)(?:\n|Project\s+Name|Client|Nature\s+of\s+Work)/i, text),
    role: extractFirst(/\bas\s+(?:a\s+|an\s+)?(.+?)(?:\n|Project\s+Name|Client|Nature\s+of\s+Work)/i, text),
  };
}

function extractProjectName(block: string) {
  const text = unwrapNarrativeLines(block);
  return (
    extractFirst(/\bNature\s+of\s+Work\s*:?\s*(.+?)(?:\n|Client\s*:)/i, text) ||
    extractFirst(/\bProject\s+Name\s*:?\s*(.+?)(?:\n|Length\s*:|Cost\s+of\s+Project\s*:|Client\s*:)/i, text)
  );
}

function extractClient(block: string) {
  return extractFirst(/\bClient\s*:?\s*(.+?)(?:\n|Cost\s+of\s+Project\s*:|Project\s+Name\s*:|Consultant\s*:)/i, unwrapNarrativeLines(block));
}

function extractDescriptionFromBlock(block: string) {
  const points = uniqueCleanLines(splitActivityPoints(block));
  if (points.length) return points.map((line) => `- ${line}`).join("\n");

  const fallback = uniqueCleanLines(
    unwrapNarrativeLines(block)
      .split(/(?<=[.])\s+|\n+/)
      .filter((line) => /work involved|project consists|checking|testing|quality|laboratory|asphalt|concrete|soil|supervision|inspection|maintaining/i.test(line)),
  );
  return fallback.map((line) => `- ${line}`).join("\n");
}

function extractLineBasedEmploymentBlocksFromText(rawText: string) {
  const lines = normalizeSourceText(rawText).split(/\n+/).map(clean).filter(Boolean);
  const boundary = /(?:\d{1,2}\/\d{4}|(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z.]*\s+\d{4})\s*(?:to|-|\u2013|\u2014|\?)\s*(?:Present|present|till date|date|\d{1,2}\/\d{4}|(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z.]*\s+\d{4})/i;
  const records: any[] = [];
  let inEmployment = false;

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    if (/^(work experience|professional experience|employment|career history)\b/i.test(line)) {
      inEmployment = true;
      continue;
    }
    if (inEmployment && /^(education|education & training|training|signature|i authorize)\b/i.test(line)) break;
    if (!inEmployment) continue;

    const match = line.match(boundary);
    if (!match) continue;
    const roleTitle = clean(line.slice(0, match.index).replace(/[-\u2013\u2014:]\s*$/, ""));
    if (!roleTitle || isEducationLikeRole(roleTitle)) continue;

    let end = lines.length;
    for (let next = index + 1; next < lines.length; next++) {
      if (/^(education|education & training|training|signature|i authorize)\b/i.test(lines[next]) || boundary.test(lines[next])) {
        end = next;
        break;
      }
    }

    const body = lines.slice(index + 1, end);
    const organization = body[0] && !/;|\.$/.test(body[0]) ? body[0] : "";
    const descriptionLines = body.slice(organization ? 1 : 0);
    const description = uniqueCleanLines(descriptionLines)
      .filter((item) => wordCount(item) >= 4)
      .map((item) => `- ${item}`)
      .join("\n");
    const periodMatch = match[0].match(/^(.+?)\s*(?:to|-|\u2013|\u2014|\?)\s*(.+)$/i);

    records.push({
      duration: `${clean(periodMatch?.[1] || "")} to ${clean(periodMatch?.[2] || "")}`.trim(),
      start_date: clean(periodMatch?.[1] || ""),
      end_date: clean(periodMatch?.[2] || ""),
      organization,
      client: "",
      role: roleTitle,
      country: "",
      project_name: "",
      description,
      _sourceRecovered: true,
    });
  }

  return records.filter((item) => item.duration && item.role);
}

function extractEmploymentBlocksFromText(rawText: string) {
  const lineBased = extractLineBasedEmploymentBlocksFromText(rawText);
  if (lineBased.length) return lineBased;

  const text = normalizeSourceText(rawText);
  const month = "(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t)?|Sept(?:ember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\\.?";
  const date = `(?:(?:${month})\\s*\\d{4}|\\d{1,2}\\/\\d{4})`;
  const periodPattern = new RegExp(`(?:^|\\n)\\s*(?:From\\s+)?(?:([^\\n]{0,90}?)\\s+)?(${date})\\s*(?:to|-|\\u2013|\\u2014|\\?)\\s*((?:till\\s+date|present|date)|${date})\\s*:?`, "gi");
  const matches = Array.from(text.matchAll(periodPattern));

  return matches.map((match, index) => {
    const start = match.index || 0;
    const end = matches[index + 1]?.index || text.length;
    const block = text.slice(start, end).trim();
    const titleBeforeDate = clean(match[1] || "").replace(/^(From\s+)?/i, "");
    const period = `${clean(match[2])} to ${clean(match[3])}`;
    const { role, organization } = inferRoleAndOrganization(block);
    const projectName = extractProjectName(block);
    const client = extractClient(block);
    const description = extractDescriptionFromBlock(block);

    return {
      duration: period,
      start_date: clean(match[2]),
      end_date: clean(match[3]),
      organization,
      client,
      role: role || titleBeforeDate,
      country: inferCountryFromBlock(block),
      project_name: projectName,
      description,
      _sourceRecovered: true,
    };
  }).filter((item) => item.duration && !isEducationLikeRole(item.role) && (item.organization || item.role || item.project_name || item.description));
}

export function recoverEmploymentRecordsFromText(expert: any, rawText: string) {
  const recovered = extractEmploymentBlocksFromText(rawText);
  if (!recovered.length) return expert;

  const existing = expert.experiences || expert.employment_history || [];
  const next = [...existing];
  const addedPeriods: string[] = [];
  const enrichedPeriods: string[] = [];

  recovered.forEach((item) => {
    const signature = periodSignature(item.duration);
    const recoveredStart = dateKey(item.start_date || item.duration);
    const existingIndex = next.findIndex((current: any) => {
      const currentPeriod = periodSignature(current.duration || current.period || `${current.start_date || ""} to ${current.end_date || ""}`);
      const years: string[] = Array.from(new Set<string>(item.duration.match(/\b(19|20)\d{2}\b/g) || []));
      const sameYears = years.length >= 2 && years.every((year) => currentPeriod.includes(year));
      const currentStart = dateKey(current.start_date || current.duration || current.period);
      const sameStart = recoveredStart && currentStart && (currentStart.includes(recoveredStart) || recoveredStart.includes(currentStart));
      const sameRole = clean(current.role).toLowerCase() === clean(item.role).toLowerCase();
      return currentPeriod === signature || sameYears || sameStart || (sameStart && sameRole);
    });

    if (existingIndex >= 0) {
      const current = next[existingIndex];
      const mergedDescription = mergeActivityDetails(current.description || "", item.description || "");
      next[existingIndex] = {
        ...item,
        ...current,
        duration: current.duration || item.duration,
        start_date: current.start_date || item.start_date,
        end_date: current.end_date || item.end_date,
        organization: current.organization || item.organization,
        client: current.client || item.client,
        role: current.role || item.role,
        country: current.country || item.country,
        project_name: current.project_name || item.project_name,
        description: clean(mergedDescription) || current.description || item.description,
      };
      if (clean(next[existingIndex].description) !== clean(current.description)) enrichedPeriods.push(item.duration);
      return;
    }

    next.push(item);
    addedPeriods.push(item.duration);
  });

  if (!addedPeriods.length && !enrichedPeriods.length) return expert;

  return {
    ...expert,
    experiences: next,
    employment_history: next,
    extraction_recovery: {
      ...(expert.extraction_recovery || {}),
      employmentRecordsRecoveredFromRawText: addedPeriods,
      employmentRecordsEnrichedFromRawText: enrichedPeriods,
    },
    metadata: {
      ...(expert.metadata || {}),
      extraction_audit_notes: [
        ...(expert.metadata?.extraction_audit_notes || []),
        addedPeriods.length ? `Recovered missing employment record(s) from date-led CV text: ${addedPeriods.join(", ")}.` : "",
        enrichedPeriods.length ? `Recovered narrative duties from source CV for employment period(s): ${enrichedPeriods.join(", ")}.` : "",
      ].filter(Boolean),
    },
  };
}

function normalizeLanguageName(value: string) {
  return clean(value).replace(/^[^A-Za-z]+|[^A-Za-z]+$/g, "");
}

export function recoverLanguagesFromText(expert: any, rawText: string) {
  const existing = [
    ...(Array.isArray(expert.languages) ? expert.languages : []),
    ...(Array.isArray(expert.metadata?.languages) ? expert.metadata.languages : []),
  ];
  const normalizedExisting = existing
    .map((item: any) => {
      if (typeof item === "string") {
        const [name, level] = item.split(/\s+[-\u2013\u2014]\s+/);
        return { name: normalizeLanguageName(name), level: clean(level || "") };
      }
      return {
        name: normalizeLanguageName(item.name || item.language || item.title || ""),
        level: clean(item.level || item.proficiency || item.notes || ""),
      };
    })
    .filter((item) => item.name);

  const text = normalizeSourceText(rawText);
  const start = text.search(/\b(languages?|language known|language proficiency)\b/i);
  let recovered: Array<{ name: string; level: string }> = [];

  if (start >= 0) {
    const sectionEnd = text
      .slice(start + 1)
      .search(/\b(soft skills?|skills?|software|work experience|professional experience|education|training|employment|profile|contacts?)\b/i);
    const section = text.slice(start, sectionEnd > 0 ? start + 1 + sectionEnd : start + 700);
    recovered = section
      .split(/\n+|,\s*|;\s*/)
      .map((line) => clean(line).replace(/^(languages?|language known|language proficiency)\s*:?\s*/i, ""))
      .filter(Boolean)
      .flatMap((line) => {
        const inline = Array.from(line.matchAll(/\b(English|French|Portuguese|Italian|Spanish|Arabic|Urdu|Hindi|Punjabi|Panjabi|German|Russian|Chinese|Mandarin|Turkish)\b(?:\s*[-\u2013\u2014:]\s*(Native|Fluent|Excellent|Good|Basic|Intermediate|Advanced|Professional|Working))?/gi));
        if (inline.length) {
          return inline.map((match) => ({ name: normalizeLanguageName(match[1]), level: clean(match[2] || "") }));
        }
        const [name, level] = line.split(/\s+[-\u2013\u2014:]\s+/);
        const languageName = normalizeLanguageName(name);
        return /^(English|French|Portuguese|Italian|Spanish|Arabic|Urdu|Hindi|Punjabi|Panjabi|German|Russian|Chinese|Mandarin|Turkish)$/i.test(languageName)
          ? [{ name: languageName, level: clean(level || "") }]
          : [];
      });
  }

  const byName = new Map<string, { name: string; level: string }>();
  [...normalizedExisting, ...recovered].forEach((item) => {
    const key = item.name.toLowerCase();
    const current = byName.get(key);
    if (!current || (!current.level && item.level)) byName.set(key, item);
  });

  const languages = Array.from(byName.values());
  if (!languages.length) return expert;

  return {
    ...expert,
    languages: languages.map((item) => item.level ? `${item.name} - ${item.level}` : item.name),
    metadata: {
      ...(expert.metadata || {}),
      languages,
      extraction_audit_notes: [
        ...(expert.metadata?.extraction_audit_notes || []),
        recovered.length ? `Recovered language(s) from source CV: ${recovered.map((item) => item.level ? `${item.name} - ${item.level}` : item.name).join(", ")}.` : "",
      ].filter(Boolean),
    },
    extraction_recovery: {
      ...(expert.extraction_recovery || {}),
      languagesRecoveredFromRawText: recovered,
    },
  };
}

export function strengthenAdequacyFromEmployment(expert: any) {
  const experiences = expert.experiences || expert.employment_history || [];
  const existingAdequacy = expert.adequacy_experience || expert.metadata?.adequacy || [];
  if (!experiences.length) return expert;
  const adequacy = existingAdequacy.length
    ? existingAdequacy
    : experiences
        .filter((exp: any) => clean(exp.project_name || exp.description).length > 20)
        .map((exp: any) => ({
          period: exp.duration || exp.period || "",
          country: exp.country || "",
          client: exp.client || exp.organization || "",
          position: exp.role || "",
          assignment: [exp.project_name, exp.description].filter(Boolean).join("\n"),
        }));
  if (!adequacy.length) return expert;

  const strongerAdequacy = adequacy.map((item: any, index: number) => {
    const assignment = clean(item.assignment);
    const matchingExperience = experiences.find((exp: any) => {
      const expPeriod = clean(exp.duration || exp.period).toLowerCase();
      const itemPeriod = clean(item.period).toLowerCase();
      const expRole = clean(exp.role).toLowerCase();
      const itemRole = clean(item.position).toLowerCase();
      const expClient = clean(exp.client || exp.organization || exp.employer).toLowerCase();
      const itemClient = clean(item.client).toLowerCase();
      const samePeriod = expPeriod && itemPeriod && (expPeriod === itemPeriod || expPeriod.includes(itemPeriod) || itemPeriod.includes(expPeriod));
      const sameRole = expRole && itemRole && (expRole === itemRole || expRole.includes(itemRole) || itemRole.includes(expRole));
      const sameClient = expClient && itemClient && (expClient === itemClient || expClient.includes(itemClient) || itemClient.includes(expClient));
      return samePeriod || (sameRole && sameClient);
    }) || (!existingAdequacy.length ? experiences[index] : null);

    const description = clean(matchingExperience?.description);
    const projectName = clean(matchingExperience?.project_name);
    const client = clean(item.client || matchingExperience?.client || matchingExperience?.organization || matchingExperience?.employer);

    if (wordCount(assignment) >= 25 && /responsib|duties|interim|checking|variation|analysis|progress|schedule|claims|supervis|prepared|managed|coordinated/i.test(assignment)) {
      return { ...item, client };
    }

    const shouldAppendDescription =
      description &&
      !assignment.toLowerCase().includes(description.toLowerCase().slice(0, 80)) &&
      wordCount(assignment) < Math.max(18, wordCount(description) - 3);
    const lines = [
      assignment || projectName || client,
      shouldAppendDescription ? description.replace(/^performed here my duty as [^.]+\.?\s*/i, "") : "",
    ].filter(Boolean);

    return {
      ...item,
      client,
      assignment: lines
        .join("\n")
        .split(/\n+|;\s+/)
        .map((line) => clean(line).replace(/^[-\u2022]\s*/, ""))
        .filter(Boolean)
        .map((line) => `- ${line}`)
        .join("\n"),
    };
  });

  return {
    ...expert,
    adequacy_experience: strongerAdequacy,
    metadata: {
      ...(expert.metadata || {}),
      adequacy: strongerAdequacy,
      extraction_audit_notes: [
        ...(expert.metadata?.extraction_audit_notes || []),
        !existingAdequacy.length ? "Built adequacy/key experience blocks from employment project narratives because the source CV did not provide a separate adequacy table." : "",
      ].filter(Boolean),
    },
  };
}

export function postProcessExtractedExpert(expert: any, rawText: string) {
  let next = normalizeExpertCollections({ ...expert });
  const universalFacts = extractUniversalCVFacts(rawText);

  if (!next.email && universalFacts.contacts.emails[0]) {
    next.email = universalFacts.contacts.emails[0];
  }
  if (!next.phone && universalFacts.contacts.phones[0]) {
    next.phone = universalFacts.contacts.phones[0];
  }
  if ((!next.software || !next.software.length) && universalFacts.software.length) {
    next.software = universalFacts.software;
  }

  const existingEducation = next.education || next.metadata?.educations || [];
  if (!hasMeaningfulEducation(existingEducation)) {
    const recoveredEducation = universalFacts.education.length ? universalFacts.education : recoverEducationFromText(rawText);
    if (recoveredEducation.length) {
      next = {
        ...next,
        education: recoveredEducation,
        educationLevel: next.educationLevel || clean([recoveredEducation[0]?.degree, recoveredEducation[0]?.field].filter(Boolean).join(" ")),
        metadata: {
          ...(next.metadata || {}),
          educations: recoveredEducation,
        },
        extraction_recovery: {
          ...(next.extraction_recovery || {}),
          educationRecoveredFromRawText: recoveredEducation,
        },
      };
    }
  }

  next = recoverEmploymentRecordsFromText(next, rawText);
  next = recoverEmploymentActivitiesFromText(next, rawText);
  next = recoverLanguagesFromText(next, rawText);
  if (universalFacts.languages.length) {
    next = recoverLanguagesFromText(
      {
        ...next,
        metadata: {
          ...(next.metadata || {}),
          languages: next.metadata?.languages?.length ? next.metadata.languages : universalFacts.languages,
        },
      },
      rawText,
    );
  }
  next = {
    ...next,
    metadata: {
      ...(next.metadata || {}),
      source_evidence: mergeSourceEvidence(next.metadata?.source_evidence, universalFacts.sourceEvidence),
      universal_extraction_summary: {
        emails: universalFacts.contacts.emails.length,
        phones: universalFacts.contacts.phones.length,
        languages: universalFacts.languages.length,
        education: universalFacts.education.length,
        software: universalFacts.software.length,
      },
    },
  };

  return normalizeExpertCollections(strengthenAdequacyFromEmployment(next));
}
