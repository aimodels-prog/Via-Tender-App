const OCR_SPACED_WORDS = [
  "other",
  "relevant",
  "bidding",
  "pavement",
  "million",
  "telecommunications",
  "communications",
  "anthropology",
  "sociology",
  "postgraduate",
  "graduate",
  "engineering",
  "internationally",
  "recognized",
  "recognised",
  "professional",
  "registered",
  "chartered",
  "transportation",
  "feasibility",
  "construction",
  "maintenance",
  "rehabilitation",
  "procurement",
  "operations",
  "experience",
  "environmental",
  "management",
  "authority",
  "equivalent",
  "mechatronics",
  "geospatial",
  "geomatics",
  "architectural",
  "computer",
  "system",
];

function repairOcrSpacing(value: any) {
  let text = String(value || "")
    .replace(/[●▪▫◦■□◆◇✓✔]/g, " • ")
    .replace(/\bpost-\s*graduate\b/gi, "postgraduate")
    .replace(/\bb\s+idding\b/gi, "bidding")
    .replace(/\bpave\s+ment\b/gi, "pavement")
    .replace(/\bmil\s+lion\b/gi, "million")
    .replace(/\btelecommun\s+ications\b/gi, "telecommunications")
    .replace(/\banthro\s+pology\b/gi, "anthropology")
    .replace(/\btrans\s+portation\b/gi, "transportation");

  for (const word of OCR_SPACED_WORDS) {
    const pattern = new RegExp(`\\b${word.split("").join("\\s+")}\\b`, "gi");
    text = text.replace(pattern, word);
  }

  return text
    .split(/\n/)
    .map((line) =>
      line.replace(/\b(?:[A-Za-z]\s+){2,}[A-Za-z]\b/g, (match) => {
        const collapsed = match.replace(/\s+/g, "");
        return collapsed.length <= 12 ? collapsed : match;
      }),
    )
    .join("\n");
}

function cleanText(value: any) {
  return repairOcrSpacing(value).replace(/\s+/g, " ").trim();
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
  value = String(value || "")
    .split(/\s*---\s*NEXT MATCH CONTEXT\s*---\s*/i)[0]
    .split(/\s*---\s*PAGE\s+\d+\s*---\s*/i)[0]
    .split(/\bOfficial Use Only\b/i)[0]
    .split(/\bS\/No\.\s+Evaluation Criteria\b/i)[0]
    .trim();
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
    .replace(/\s*[•\u2022]\s*/g, ". ")
    .replace(/\bWait,\s+[^.]+(?:\.\s*)?/gi, "")
    .replace(/\bI will\s+[^.]+(?:\.\s*)?/gi, "")
    .replace(/\.{2,}/g, ".")
    .replace(/\.\s+\./g, ".")
    .replace(/^(?:\.\s*)+/, "")
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

  return deduped.join(" ").trim();
}

function cleanTenderEducationRequirement(value: any) {
  const text = cleanTenderRequirementText(value)
    .replace(/^Education\s*:?\s*/i, "")
    .trim();
  if (/^\d{1,2}$/.test(text)) return "";
  return text;
}

function cleanTenderRoleDescription(value: any) {
  const text = cleanTenderRequirementText(value)
    .split(/\bEducation\s*:?\s*\d{0,2}\b/i)[0]
    .trim();
  if (
    /\b(?:client will provide introductory letters|consultant shall be responsible for arranging all necessary office|arranging all necessary office and living accommodation|the number of points to be assigned|sub-criteria and relevant percentage weights)\b/i.test(text)
  ) {
    return "";
  }
  return text;
}

function cleanTenderSpecificExperience(value: any) {
  const text = cleanTenderRequirementText(value);
  if (
    /\b(?:standard form of agreement|conditions of engagement|letter of tender|submission of tender|technical and financial tender checklist|tenderers shall follow|e-tendering portal|data requested in this section shall be used|same order as outlined|shall constitute the technical and financial tender|deemed to be in possession|arabic version of the standard document)\b/i.test(text)
  ) {
    return "";
  }
  return text;
}

function cleanTenderTitle(value: any) {
  let title = cleanTenderRequirementText(value)
    .replace(/\bNote:\s*.+$/i, "")
    .replace(/\bThe tender title is\s*:?\s*/i, "")
    .replace(/\bThe project sector is\s+.+$/i, "")
    .replace(/\bThe client is\s+.+$/i, "")
    .replace(/\bThe positions are as follows\s*:?\s*.+$/i, "")
    .replace(/\[\s*\{.+$/s, "")
    .trim();
  if (title.length > 260) {
    title = title
      .split(/\s+-\s+|\.pdf\b|\. Note\b|\. The\b/i)[0]
      .replace(/\.pdf$/i, "")
      .trim();
  }
  return title.slice(0, 320).trim();
}

export function normalizeTenderPosition(position: any, index = 0) {
  const title = cleanTenderRequirementText(
    position?.position_title || position?.title || position?.role || position?.name || "",
  );
  const id = position?.id || (title ? `pos_${title.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "")}` : `pos_${index}`);

  const rawQuantity = Number(position?.quantity ?? position?.qty);
  const rawMinimumYears = Number(position?.minimum_years_experience ?? position?.min_years_experience);
  const sourcePageNumbers = Array.from(
    new Set(
      (Array.isArray(position?.source_page_numbers) ? position.source_page_numbers : [])
        .map((page: any) => Number(page))
        .filter((page: number) => Number.isInteger(page) && page > 0),
    ),
  );

  return {
    ...position,
    id,
    position_title: title || `Position ${index + 1}`,
    quantity: Number.isFinite(rawQuantity) && rawQuantity > 0 ? rawQuantity : undefined,
    source_position_number: Number.isInteger(Number(position?.source_position_number)) && Number(position.source_position_number) > 0 ? Number(position.source_position_number) : undefined,
    source_document: cleanTenderRequirementText(position?.source_document || ""),
    lot_reference: cleanTenderRequirementText(position?.lot_reference || ""),
    expert_category: cleanTenderRequirementText(position?.expert_category || ""),
    input_months: Number.isFinite(Number(position?.input_months)) && Number(position.input_months) >= 0 ? Number(position.input_months) : undefined,
    work_location: cleanTenderRequirementText(position?.work_location || ""),
    minimum_education: cleanTenderEducationRequirement(position?.minimum_education || position?.education || ""),
    minimum_years_experience:
      Number.isFinite(rawMinimumYears) && rawMinimumYears >= 0 ? rawMinimumYears : undefined,
    general_experience: cleanTenderRequirementText(position?.general_experience || ""),
    specific_experience: cleanTenderSpecificExperience(position?.specific_experience || ""),
    role_description: cleanTenderRoleDescription(
      position?.role_description || position?.description || position?.responsibilities || "",
    ),
    required_sector_experience: toArray(position?.required_sector_experience),
    mandatory_skills: toArray(position?.mandatory_skills),
    required_software: toArray(position?.required_software),
    required_certifications: toArray(position?.required_certifications),
    professional_memberships: toArray(position?.professional_memberships),
    required_languages: toArray(position?.required_languages),
    position_deliverables: toArray(position?.position_deliverables),
    required_keywords: Array.from(new Set(toArray(position?.required_keywords))),
    met_team_constraints: toArray(position?.met_team_constraints),
    nationality_preference: cleanTenderRequirementText(position?.nationality_preference || ""),
    residency_requirement: cleanTenderRequirementText(position?.residency_requirement || ""),
    regional_experience: cleanTenderRequirementText(position?.regional_experience || ""),
    country_experience: cleanTenderRequirementText(position?.country_experience || ""),
    source_page_numbers: sourcePageNumbers,
    source_quotes: toArray(position?.source_quotes),
    field_evidence: (Array.isArray(position?.field_evidence) ? position.field_evidence : [])
      .map((evidence: any) => ({
        field: cleanTenderRequirementText(evidence?.field || ""),
        page_number: Number(evidence?.page_number || 0),
        quote: cleanTenderRequirementText(evidence?.quote || ""),
      }))
      .filter((evidence: any) => evidence.field && Number.isInteger(evidence.page_number) && evidence.page_number > 0 && evidence.quote),
    extraction_warnings: toArray(position?.extraction_warnings),
  };
}

export function isInvalidTenderPositionTitle(value: string) {
  const title = cleanText(value);
  if (!title) return true;
  const wordCount = title.split(/\s+/).filter(Boolean).length;
  const hasCoreOccupation = /\b(?:manager|engineer|expert|specialist|leader|coordinator|surveyor|inspector|architect|designer|planner|scheduler|advisor|trainer|analyst|officer|supervisor|controller|technician|draftsman|economist|sociologist|environmentalist|hydrologist|geologist|adjudicator)\b/i.test(title);
  const isCredibleConsultantTitle = /\bconsultant\b/i.test(title) && wordCount <= 7 && !/\b(?:the|of the|obligations?|eligibility|qualifications?|documents?|proposal|services?|organization|assumptions?|risks?|institution)\b/i.test(title);
  if (!hasCoreOccupation && !isCredibleConsultantTitle) return true;
  if (wordCount > 14 || /[.!?;]/.test(title)) return true;
  if (/^(?:documents? establishing|associated with|institution of|obligations? of|eligibility of|qualifications? of|requirements? of|services? of|scope of|responsibilities? of)\b/i.test(title)) return true;
  if (/\b(?:period of validity|securing declaration|request for proposals?|expression of interest|procurement and disposing entity|technical proposal submission|evaluation methodology|conflicts? of interest|government policy requires|number of risks)\b/i.test(title)) return true;
  if (/\bTECH-\d+[A-Z]?\b/i.test(title)) return true;
  if (/^(?:A|B|C|D|E|F)\s*-\s*Consultant$/i.test(title)) return true;
  if (/^(?:The Consultant|For the Consultant|Sub-consultant|Consultant\.?\s*The Consultant)$/i.test(title)) return true;
  if (/\b(?:obligations?|eligibility|qualifications?|documents?|proposal forms?|submission sheet|contract clauses?|conditions of contract)\b.*\bconsultant\b/i.test(title)) return true;
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

export function getTenderPositionWarnings(position: any) {
  const warnings: string[] = [];
  const title = cleanText(position?.position_title);
  if (isInvalidTenderPositionTitle(title)) warnings.push("This does not look like a real personnel position.");
  if (!Number.isFinite(Number(position?.quantity)) || Number(position.quantity) <= 0) warnings.push("Quantity was not found in the source.");
  if (!cleanText(position?.minimum_education)) warnings.push("Education requirement was not extracted.");
  if (!cleanText(position?.general_experience) && !cleanText(position?.specific_experience)) warnings.push("Experience requirements were not extracted.");
  if (!cleanText(position?.role_description)) warnings.push("Responsibilities were not extracted.");
  if (!Array.isArray(position?.source_page_numbers) || position.source_page_numbers.length === 0) warnings.push("No source page evidence is attached.");
  const evidenceFields = new Set((Array.isArray(position?.field_evidence) ? position.field_evidence : []).map((item: any) => cleanText(item?.field).toLowerCase()));
  const evidenceRequiredFor = [
    ["position_title", position?.position_title],
    ["quantity", position?.quantity],
    ["minimum_education", position?.minimum_education],
    ["general_experience", position?.general_experience],
    ["specific_experience", position?.specific_experience],
    ["role_description", position?.role_description],
  ] as Array<[string, any]>;
  const missingEvidence = evidenceRequiredFor
    .filter(([, value]) => value !== undefined && value !== null && String(value).trim())
    .map(([field]) => field)
    .filter((field) => !evidenceFields.has(field));
  if (missingEvidence.length) warnings.push(`Missing field-level evidence for: ${missingEvidence.join(", ")}.`);
  return warnings;
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

  const extractionWarnings = normalizedPositions.flatMap((position) =>
    getTenderPositionWarnings(position).map((warning) => `${position.position_title}: ${warning}`),
  );
  const pageClassifications = (Array.isArray(tender?.page_classifications) ? tender.page_classifications : [])
    .map((item: any) => ({
      page_number: Number(item?.page_number || 0),
      categories: toArray(item?.categories),
      summary: cleanTenderRequirementText(item?.summary || ""),
      readability: ["CLEAR", "PARTIAL", "UNREADABLE"].includes(String(item?.readability || "").toUpperCase()) ? String(item.readability).toUpperCase() : "PARTIAL",
      has_staff_requirements: Boolean(item?.has_staff_requirements),
      confidence: Math.max(0, Math.min(1, Number(item?.confidence || 0))),
      warnings: toArray(item?.warnings),
    }))
    .filter((item: any) => Number.isInteger(item.page_number) && item.page_number > 0);
  const tenderFieldEvidence = (Array.isArray(tender?.tender_field_evidence) ? tender.tender_field_evidence : [])
    .map((evidence: any) => ({
      field: cleanTenderRequirementText(evidence?.field || ""),
      page_number: Number(evidence?.page_number || 0),
      quote: cleanTenderRequirementText(evidence?.quote || ""),
    }))
    .filter((evidence: any) => evidence.field && Number.isInteger(evidence.page_number) && evidence.page_number > 0 && evidence.quote);
  const tenderEvidenceFields = new Set(tenderFieldEvidence.map((item: any) => item.field.toLowerCase()));
  const missingTenderEvidence = [
    ["tender_title", tender?.tender_title || tender?.name],
    ["client", tender?.client],
    ["deadline", tender?.deadline],
    ["scope_summary", tender?.scope_summary],
    ["duration", tender?.duration],
  ] as Array<[string, any]>;
  missingTenderEvidence
    .filter(([, value]) => String(value || "").trim())
    .map(([field]) => field)
    .filter((field) => !tenderEvidenceFields.has(field))
    .forEach((field) => extractionWarnings.push(`Tender: Missing field-level evidence for ${field}.`));

  return {
    ...tender,
    tender_title: cleanTenderTitle(tender?.tender_title || tender?.name || ""),
    name: cleanTenderTitle(tender?.name || tender?.tender_title || ""),
    client: cleanTenderRequirementText(tender?.client || ""),
    country: cleanTenderRequirementText(tender?.country || ""),
    tender_number: cleanTenderRequirementText(tender?.tender_number || ""),
    duration: cleanTenderRequirementText(tender?.duration || ""),
    submission_type: cleanTenderRequirementText(tender?.submission_type || ""),
    tender_format: cleanTenderRequirementText(tender?.tender_format || ""),
    scope_summary: cleanTenderRequirementText(tender?.scope_summary || ""),
    deadline: cleanTenderRequirementText(tender?.deadline || ""),
    objectives: toArray(tender?.objectives),
    deliverables: toArray(tender?.deliverables),
    eligibility_requirements: toArray(tender?.eligibility_requirements),
    evaluation_criteria: toArray(tender?.evaluation_criteria),
    special_requirements: toArray(tender?.special_requirements),
    global_team_constraints: toArray(tender?.global_team_constraints),
    project_sector: toArray(tender?.project_sector),
    positions: normalizedPositions,
    page_classifications: pageClassifications,
    tender_field_evidence: tenderFieldEvidence,
    extraction_warnings: Array.from(new Set([...toArray(tender?.extraction_warnings), ...extractionWarnings])),
    review_required: extractionWarnings.length > 0,
  };
}
