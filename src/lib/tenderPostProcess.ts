function cleanText(value: any) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function toArray(value: any): string[] {
  if (Array.isArray(value)) {
    return value
      .flatMap((item) => (Array.isArray(item) ? item : [item]))
      .map((item) => cleanTenderRequirementText(item))
      .filter(Boolean);
  }
  const text = cleanTenderRequirementText(value);
  if (!text) return [];
  return text
    .split(/\s*(?:,|;|\n|\u2022|- )\s*/)
    .map(cleanTenderRequirementText)
    .filter(Boolean);
}

export function cleanTenderRequirementText(value: any) {
  let text = cleanText(value)
    .replace(/â€™/g, "'")
    .replace(/â€œ|â€/g, '"')
    .replace(/â€“|â€”/g, "-")
    .replace(/â€¦/g, "...");

  const reasoningStart = text.search(
    /\b(?:Wait,|I will list|I will use|I will extract|I will include|Let me|I should|The table lists .*? but|However, the \d+\s+years requirement)/i,
  );
  if (reasoningStart > 0) {
    text = text.slice(0, reasoningStart).trim();
  }

  text = text
    .replace(/\bWait,\s+[^.]+(?:\.\s*)?/gi, "")
    .replace(/\bI will\s+[^.]+(?:\.\s*)?/gi, "")
    .replace(/\s+/g, " ")
    .trim();

  const sentences = text.split(/(?<=[.!?])\s+/).filter(Boolean);
  const deduped: string[] = [];
  const seen = new Set<string>();
  sentences.forEach((sentence) => {
    const key = sentence.toLowerCase().replace(/\W+/g, " ").trim();
    if (!key || seen.has(key)) return;
    seen.add(key);
    deduped.push(sentence);
  });

  return deduped.join(" ").slice(0, 1800).trim();
}

export function normalizeTenderPosition(position: any, index = 0) {
  const title = cleanTenderRequirementText(
    position?.position_title || position?.title || position?.role || position?.name || "",
  );
  const id = position?.id || (title ? `pos_${title.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "")}` : `pos_${index}`);

  return {
    ...position,
    id,
    position_title: title || `Position ${index + 1}`,
    quantity: Number(position?.quantity || position?.qty || 1) || 1,
    minimum_education: cleanTenderRequirementText(position?.minimum_education || position?.education || ""),
    minimum_years_experience:
      Number(position?.minimum_years_experience || position?.min_years_experience || 0) || undefined,
    general_experience: cleanTenderRequirementText(position?.general_experience || ""),
    specific_experience: cleanTenderRequirementText(position?.specific_experience || ""),
    role_description: cleanTenderRequirementText(
      position?.role_description || position?.description || position?.responsibilities || "",
    ),
    required_sector_experience: toArray(position?.required_sector_experience),
    mandatory_skills: toArray(position?.mandatory_skills),
    required_keywords: Array.from(new Set(toArray(position?.required_keywords))),
    met_team_constraints: toArray(position?.met_team_constraints),
    nationality_preference: cleanTenderRequirementText(position?.nationality_preference || ""),
  };
}

function isInvalidTenderPositionTitle(value: string) {
  const title = cleanText(value);
  if (!title) return true;
  if (/\bTECH-\d+[A-Z]?\b/i.test(title)) return true;
  if (/^(?:A|B|C|D|E|F)\s*-\s*Consultant$/i.test(title)) return true;
  if (/^(?:The Consultant|For the Consultant|Sub-consultant|Consultant\.?\s*The Consultant)$/i.test(title)) return true;
  if (/^(?:Name of Expert|For Expert|Description of Key Expert|Replacement of Key Expert|Removal of Expert)$/i.test(title)) return true;
  if (/^(?:Instructions to Consultant|Assignments Consultant|Services while the Consultant|Facilities to be provided by the Consultant)$/i.test(title)) return true;
  if (/^(?:Appendix|Appendix\s+[A-Z]|Performance Declaration|Code of Conduct|Countersignature|Payments to the Consultant)/i.test(title)) return true;
  if (/\b(?:mutual rights and obligations|authority of in case|consultant instructing|commencement the consultant|conflict of the consultant|bank\. the consultant|reporting the consultant|forced labor|child labor|taxes and duties|access to project|opportunity requirements|training of the consultant)\b/i.test(title)) return true;
  if (/\b(?:consultant'?s\s+(organization|experience|methodology|work plan|comments?|suggestions?)|technical proposal|financial proposal|proposal form|evaluation criteria|data sheet|instruction to consultant)\b/i.test(title)) return true;
  if (/^List only those assignments/i.test(title)) return true;
  if (/^Relationships \(?including its Expert/i.test(title)) return true;
  if (/^Representative of the Consultant$/i.test(title)) return true;
  if (/^FIDIC International Federation of Consulting Engineer/i.test(title)) return true;
  if (/^Institution of Quantity Surveyor$/i.test(title)) return true;
  if (/^Engineer Engineer$/i.test(title)) return true;
  if (/^(?:F\.\s*)?Payments to the Consultant$/i.test(title)) return true;
  if (/^Removal of If the Client finds/i.test(title)) return true;
  if (/^(?:Preliminary Design\/FEED\/Basic Engineer|Design\/FEED\/Basic Engineer|Chartered\/Registered Engineer|Registered Quantity surveyor)$/i.test(title)) return true;
  return false;
}

function hasPositionRequirementDetail(position: any) {
  return Boolean(
    cleanText(position.minimum_education) ||
    cleanText(position.general_experience) ||
    cleanText(position.specific_experience) ||
    cleanText(position.role_description) ||
    (Array.isArray(position.required_keywords) && position.required_keywords.length) ||
    (Array.isArray(position.mandatory_skills) && position.mandatory_skills.length)
  );
}

function isInvalidTenderPosition(position: any) {
  const title = cleanText(position?.position_title);
  if (isInvalidTenderPositionTitle(title)) return true;
  if (/^(?:General Manager|Managing Director|General Manager[-\s].+)$/i.test(title) && !hasPositionRequirementDetail(position)) return true;
  return false;
}

export function normalizeTenderRecord(tender: any) {
  const positions = Array.isArray(tender?.positions) ? tender.positions : [];
  const normalizedPositions = positions
    .map((position, index) => normalizeTenderPosition(position, index))
    .filter((position) => position.position_title && !isInvalidTenderPosition(position));

  return {
    ...tender,
    scope_summary: cleanTenderRequirementText(tender?.scope_summary || ""),
    special_requirements: toArray(tender?.special_requirements),
    global_team_constraints: toArray(tender?.global_team_constraints),
    project_sector: toArray(tender?.project_sector),
    positions: normalizedPositions,
  };
}
