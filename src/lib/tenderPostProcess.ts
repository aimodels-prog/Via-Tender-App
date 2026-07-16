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

function looksLikeAcademicEducation(value: any) {
  return /\b(?:master'?s?|bachelor'?s?|ph\.?\s*d|doctorate|degree|diploma|b\.?\s*sc|m\.?\s*sc|university|college|academic)\b/i.test(cleanTenderRequirementText(value));
}

function looksLikeProfessionalRegistration(value: any) {
  return /\b(?:registered\/chartered|registered|chartered|practi[cs]ing\s+(?:certificate|licen[cs]e)|professional\s+(?:registration|membership|body|institution|association)|membership|licen[cs]e|certificate)\b/i.test(cleanTenderRequirementText(value));
}

function cleanTenderEducationRequirement(value: any) {
  const text = cleanTenderRequirementText(value)
    .replace(/^Education\s*:?\s*/i, "")
    .trim();
  if (/^\d{1,2}$/.test(text)) return "";
  if (!text) return "";

  if (looksLikeAcademicEducation(text)) {
    const academicOnly = text
      .replace(/\s*(?:;|,|\band\b)?\s*(?:must\s+be\s+|should\s+be\s+|shall\s+be\s+)?(?:a\s+)?(?:qualified\s+and\s+competent\s+)?(?:professionally\s+)?(?:registered|chartered|registered\s*\/\s*chartered)\b[\s\S]*$/i, "")
      .replace(/\s+(?:with|and)\s+(?:a\s+)?minimum\s+of\s+\d{1,2}\s*years?['â€™]?(?:\s+of)?\s+experience[\s\S]*$/i, "")
      .replace(/\s+(?:with|and)\s+\d{1,2}\s*years?['â€™]?(?:\s+of)?\s+experience[\s\S]*$/i, "")
      .replace(/[;,\s]+$/, "")
      .trim();
    return academicOnly || text;
  }
  // Also keep text that mentions professional qualifications as education context
  // (e.g. "Professionally qualified in Civil Engineering" or "Higher National Certificate")
  if (/\b(?:qualified|qualification|certificate|certif|hnd|hnc|nvq|ond|postgraduate|post graduate|higher national|national higher|professionally)\b/i.test(text)) return text;
  // If the text has experience-like content but no education markers, it's not education
  if (/\b(?:years?|experience|similar\s+(?:projects?|assignments?))\b/i.test(text) && !looksLikeAcademicEducation(text)) return "";
  // Preserve any remaining non-trivial text — the AI deemed it education
  if (text.length > 10) return text;
  return "";
}

function cleanTenderLocation(value: any) {
  const text = cleanTenderRequirementText(value);
  if (/\b(?:implied by|not explicitly|keep (?:this field )?empty|default-free|no (?:direct|exact) deployment location|therefore,? keep|verbatim mentioned)\b/i.test(text)) {
    return "";
  }
  return text;
}

function extractTenderSourcePositionNumber(value: any) {
  const match = cleanTenderRequirementText(value).match(/^\s*K\s*[-.]?\s*(\d+)\s*[:.)-]?\s*/i);
  return match ? Number(match[1]) : undefined;
}

function cleanTenderPositionTitle(value: any) {
  return cleanTenderRequirementText(value)
    .replace(/^\s*K\s*[-.]?\s*\d+\s*[:.)-]?\s*/i, "")
    .replace(/\s+\d{1,2}\s*$/i, "")
    .replace(/\s*\/\s*/g, "/")
    .replace(/\s+/g, " ")
    .trim();
}

function mergeUniqueValues(current: any, next: any) {
  const values = [...(Array.isArray(current) ? current : []), ...(Array.isArray(next) ? next : [])].filter(Boolean);
  const seen = new Set<string>();
  return values.filter((value) => {
    const key = typeof value === "object" ? JSON.stringify(value) : cleanText(value).toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function cleanRoleDutiesStatus(value: any, roleDescription = "") {
  const status = cleanText(value).toLowerCase().replace(/[^a-z_]+/g, "_").replace(/^_|_$/g, "");
  if (["explicit", "tor_scope", "not_stated", "needs_review"].includes(status)) return status;
  if (/^not separately stated for this role/i.test(cleanText(roleDescription))) return "tor_scope";
  if (cleanText(roleDescription)) return "explicit";
  return "needs_review";
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

function looksLikeExperienceRequirement(value: any) {
  const text = cleanTenderRequirementText(value);
  return /\b(?:years?|experience|post[-\s]?graduate|similar\s+(?:projects?|assignments?)|minimum|at least|not less than)\b/i.test(text);
}

function deriveGeneralExperience(position: any) {
  const existing = cleanTenderRequirementText(position?.general_experience || "");
  if (existing) return existing;
  const candidates = [
    position?.specific_experience,
    position?.minimum_education,
    position?.role_description,
    ...(Array.isArray(position?.source_quotes) ? position.source_quotes : []),
  ].map(cleanTenderRequirementText).filter(Boolean);

  for (const candidate of candidates) {
    const match = candidate.match(/(?:^|[.;]\s*)((?:should\s+have\s+|shall\s+have\s+|must\s+have\s+|with\s+)?(?:a\s+)?(?:minimum\s+of\s+|at\s+least\s+|not\s+less\s+than\s+)?(?:\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten|twelve|fifteen)\s*(?:\(\d{1,2}\)\s*)?years?['’]?(?:\s*\([^)]*\))?(?:\s+post[-\s]?graduate)?(?:\s+|\s*-\s*)?(?:relevant\s+|general\s+|professional\s+|overall\s+)?experience[^.;]*)/i);
    if (match?.[1]) return cleanTenderRequirementText(match[1]);
    const broadSentence = candidate
      .split(/(?<=[.;])\s+/)
      .map(cleanTenderRequirementText)
      .find((sentence) =>
        /\b(?:minimum|at least|not less than|should have|shall have|must have)?\s*\d{1,2}\s*years?['’]?/i.test(sentence) &&
        !/^\s*experience\s+as\b/i.test(sentence),
      );
    if (broadSentence) return broadSentence;
  }
  return "";
}

function deriveMandatorySkills(position: any) {
  const existing = toArray(position?.mandatory_skills);
  const text = [
    position?.minimum_education,
    position?.general_experience,
    position?.specific_experience,
    position?.role_description,
    ...(Array.isArray(position?.required_certifications) ? position.required_certifications : []),
    ...(Array.isArray(position?.professional_memberships) ? position.professional_memberships : []),
  ].map(cleanTenderRequirementText).filter(Boolean).join(" ");
  const derived: string[] = [];
  if (/\bchartered\b/i.test(text)) derived.push("Professionally Chartered");
  if (/\bregistered\b/i.test(text)) derived.push("Professionally Registered");
  if (/\bvalid\s+practi[cs]ing\s+(?:certificate|licen[cs]e)\b/i.test(text)) derived.push("Valid practicing certificate");
  if (/\bprofessional\s+(?:body|institution|association|registration)\b/i.test(text)) derived.push("Professional body registration");
  if (/\binternational(?:ly)?\s+recogni[sz]ed\s+registration\b/i.test(text)) derived.push("Internationally recognized registration");
  return mergeUniqueValues(existing, derived);
}

function deriveRequiredCertifications(position: any) {
  const existing = toArray(position?.required_certifications);
  const text = [
    position?.minimum_education,
    position?.general_experience,
    position?.specific_experience,
    position?.role_description,
    ...existing,
    ...(Array.isArray(position?.professional_memberships) ? position.professional_memberships : []),
  ].map(cleanTenderRequirementText).filter(Boolean).join(" ");

  const derived: string[] = [];
  const registrationPhrase = text.match(/\bRegistered\s*\/\s*Cha(?:rtered|ttered)\s+Engineer\s+with\s+(?:a\s+)?Valid\s+practi[cs]ing\s+(?:certificate|licen[cs]e)\b/i)?.[0];
  if (registrationPhrase) derived.push(registrationPhrase);
  else {
    if (/\bregistered\s*\/\s*cha(?:rtered|ttered)\s+engineer\b/i.test(text)) derived.push("Registered/Chartered Engineer");
    if (/\bvalid\s+practi[cs]ing\s+(?:certificate|licen[cs]e)\b/i.test(text)) derived.push("Valid practicing certificate/licence");
  }
  return mergeUniqueValues(existing, derived);
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
  const rawTitle = cleanTenderRequirementText(
    position?.position_title || position?.title || position?.role || position?.name || "",
  );
  const title = cleanTenderPositionTitle(rawTitle);
  const id = position?.id || (title ? `pos_${title.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "")}` : `pos_${index}`);

  const rawQuantity = Number(position?.quantity ?? position?.qty);
  const rawMinimumYears = Number(position?.minimum_years_experience ?? position?.min_years_experience);
  const normalizedEvidence = (Array.isArray(position?.field_evidence) ? position.field_evidence : [])
    .map((evidence: any) => ({
      field: cleanTenderRequirementText(evidence?.field || ""),
      page_number: Number(evidence?.page_number || 0),
      quote: cleanTenderRequirementText(evidence?.quote || ""),
    }))
    .filter((evidence: any) => evidence.field && Number.isInteger(evidence.page_number) && evidence.page_number > 0 && evidence.quote);
  const sourceQuotes = toArray(position?.source_quotes);
  const sourcePageNumbers = Array.from(
    new Set(
      [...(Array.isArray(position?.source_page_numbers) ? position.source_page_numbers : []), ...normalizedEvidence.map((item: any) => item.page_number)]
        .map((page: any) => Number(page))
        .filter((page: number) => Number.isInteger(page) && page > 0),
    ),
  );
  const education = position?.minimum_education || position?.education || "";
  const generalExperience = deriveGeneralExperience(position);
  const specificExperience = position?.specific_experience || "";
  const roleDescription = position?.role_description || position?.description || position?.responsibilities || "";
  const cleanedRoleDescription = cleanTenderRoleDescription(roleDescription);
  const mandatorySkills = deriveMandatorySkills({
    ...position,
    minimum_education: education,
    general_experience: generalExperience,
    specific_experience: specificExperience,
    role_description: roleDescription,
  });
  const requiredCertifications = deriveRequiredCertifications({
    ...position,
    minimum_education: education,
    general_experience: generalExperience,
    specific_experience: specificExperience,
    role_description: roleDescription,
  });

  return {
    ...position,
    id,
    position_title: title || `Position ${index + 1}`,
    quantity: Number.isFinite(rawQuantity) && rawQuantity > 0 ? rawQuantity : undefined,
    source_position_number: Number.isInteger(Number(position?.source_position_number)) && Number(position.source_position_number) > 0 ? Number(position.source_position_number) : extractTenderSourcePositionNumber(rawTitle),
    source_document: cleanTenderRequirementText(position?.source_document || ""),
    lot_reference: cleanTenderRequirementText(position?.lot_reference || ""),
    expert_category: cleanTenderRequirementText(position?.expert_category || ""),
    input_months: Number.isFinite(Number(position?.input_months)) && Number(position.input_months) >= 0 ? Number(position.input_months) : undefined,
    work_location: cleanTenderLocation(position?.work_location || ""),
    minimum_education: cleanTenderEducationRequirement(education),
    minimum_years_experience:
      Number.isFinite(rawMinimumYears) && rawMinimumYears >= 0 ? rawMinimumYears : undefined,
    general_experience: cleanTenderRequirementText(generalExperience),
    specific_experience: cleanTenderSpecificExperience(specificExperience),
    role_description: cleanedRoleDescription,
    role_duties_status: cleanRoleDutiesStatus(position?.role_duties_status, cleanedRoleDescription),
    required_sector_experience: toArray(position?.required_sector_experience),
    mandatory_skills: mandatorySkills,
    required_software: toArray(position?.required_software),
    required_certifications: requiredCertifications,
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
    source_quotes: sourceQuotes,
    field_evidence: normalizedEvidence,
    extraction_warnings: toArray(position?.extraction_warnings),
  };
}

export function isInvalidTenderPositionTitle(value: string) {
  const title = cleanText(value);
  if (!title) return true;
  const wordCount = title.split(/\s+/).filter(Boolean).length;
  if (/^(?:authorised|authorized)\s+signatory(?:\s+name\s+of\s+consultant)?$/i.test(title)) return true;
  if (/^name\s+of\s+(?:associated\s+)?consultants?$/i.test(title)) return true;
  if (/^(?:detailed\s+)?tasks?\s+assigned\s+(?:on|to)\s+consultants?$/i.test(title)) return true;
  if (/^team\s+of\s+experts?$/i.test(title)) return true;
  if (/^outline\s+of\s+(?:the\s+)?key\s+experts?$/i.test(title)) return true;
  if (/^qualifications?\s+for\s+key\s+experts?$/i.test(title)) return true;
  if (/^technical\/?manager$/i.test(title)) return true;
  if (/^prepare\s+engineer$/i.test(title)) return true;
  if (/^(?:position\s+title\s+and\s+no|position\s+title|name\s+of\s+staff|name\s+of\s+senior\s+staff|curriculum\s+vitae|certification|expert'?s\s+contact\s+information)$/i.test(title)) return true;
  if (/\b(?:authorised signatory|authorized signatory|signature|curriculum vitae|contact information|assigned on consultant|associated consultant|format of curriculum vitae|confirmation of availability)\b/i.test(title)) return true;
  const hasCoreOccupation = /\b(?:managers?|engineers?|experts?|specialists?|leaders?|coordinators?|surveyors?|inspectors?|architects?|designers?|planners?|schedulers?|advisors?|trainers?|analysts?|officers?|assistants?|supervisors?|controllers?|technicians?|draftsmen|economists?|sociologists?|environmentalists?|hydrologists?|geologists?|adjudicators?)\b/i.test(title);
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
  if (/^(?:The\s+)?(?:Key\s+)?Expert$/i.test(title)) return true;
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
  const dutiesStatus = cleanRoleDutiesStatus(position?.role_duties_status, position?.role_description);
  if (isInvalidTenderPositionTitle(title)) warnings.push("This does not look like a real personnel position.");
  if (!Number.isFinite(Number(position?.quantity)) || Number(position.quantity) <= 0) warnings.push("Quantity was not found in the source.");
  if (!cleanText(position?.minimum_education)) warnings.push("Education requirement was not extracted.");
  if (!cleanText(position?.general_experience) && !cleanText(position?.specific_experience)) warnings.push("Experience requirements were not extracted.");
  if (dutiesStatus === "needs_review") warnings.push("Responsibilities need review because duties may have been missed or could not be mapped.");
  if (!cleanText(position?.role_description) && dutiesStatus !== "not_stated") warnings.push("Responsibilities were not extracted.");
  return warnings;
}

function hasPositionRequirementDetail(position: any) {
  return Boolean(
    cleanText(position.minimum_education) ||
    looksLikeExperienceRequirement(position.general_experience) ||
    looksLikeExperienceRequirement(position.specific_experience) ||
    cleanText(position.role_description) ||
    cleanRoleDutiesStatus(position.role_duties_status, position.role_description) === "not_stated" ||
    (Array.isArray(position.required_keywords) && position.required_keywords.length) ||
    (Array.isArray(position.mandatory_skills) && position.mandatory_skills.length)
  );
}

function hasPlaceholderRequirementDetail(position: any) {
  const details = [
    position?.minimum_education,
    position?.general_experience,
    position?.specific_experience,
    position?.role_description,
  ].map(cleanText).filter(Boolean).join(" ");
  return /\b(?:using the format below|list all deliverables|expert'?s contact information|certification:\s*i,\s*the undersigned|available to undertake the assignment|misstatement or misrepresentation|proposed additional support staff|qualifications and experience of the proposed|assigned on consultant'?s)\b/i.test(details);
}

function isInvalidTenderPosition(position: any) {
  const title = cleanText(position?.position_title);
  if (isInvalidTenderPositionTitle(title)) return true;
  if (/^the\s+/i.test(title) && !position?.source_position_number && !position?.quantity) return true;
  if (hasPlaceholderRequirementDetail(position)) return true;
  if (/^(?:General Manager|Managing Director|General Manager[-\s].+)$/i.test(title) && !hasPositionRequirementDetail(position)) return true;
  if (/^(?:Laboratory Technician|Material Technician|Surveyor Assistant|CAD Technician)$/i.test(title) && !looksLikeExperienceRequirement(position?.general_experience) && !looksLikeExperienceRequirement(position?.specific_experience) && !cleanText(position?.minimum_education)) return true;
  return false;
}

export function normalizeTenderRecord(tender: any) {
  const positions = Array.isArray(tender?.positions) ? tender.positions : [];
  const normalizedPositions = positions.map((position: any, index: number) => normalizeTenderPosition(position, index))
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
  const retainedWarnings = toArray(tender?.extraction_warnings).filter((warning) => !/(?:Quantity was not found in the source|Education requirement was not extracted|Experience requirements were not extracted|Responsibilities were not extracted|No source page evidence is attached|Missing field-level evidence for:)/i.test(warning));
  const explicitClientEvidence = tenderFieldEvidence
    .filter((item: any) => item.field.toLowerCase() === "client")
    .map((item: any) => item.quote.match(/\bProcuring and Disposing Entity is\s*:\s*(.+)$/i)?.[1]?.trim())
    .find(Boolean);
  const roleCount = normalizedPositions.length;
  const sourceBackedCount = normalizedPositions.filter((position) => position.source_page_numbers.length > 0).length;
  const completeCoreCount = normalizedPositions.filter((position) =>
    cleanText(position.minimum_education) &&
    (cleanText(position.general_experience) || cleanText(position.specific_experience)) &&
    (cleanText(position.role_description) || cleanRoleDutiesStatus(position.role_duties_status, position.role_description) === "not_stated"),
  ).length;
  const incompleteCorePositions = normalizedPositions
    .map((position) => ({
      title: cleanText(position.position_title),
      missing: [
        !cleanText(position.minimum_education) ? "education" : "",
        !cleanText(position.general_experience) && !cleanText(position.specific_experience) ? "experience" : "",
        !cleanText(position.role_description) && cleanRoleDutiesStatus(position.role_duties_status, position.role_description) !== "not_stated" ? "responsibilities" : "",
        cleanRoleDutiesStatus(position.role_duties_status, position.role_description) === "needs_review" ? "responsibilities review" : "",
      ].filter(Boolean),
    }))
    .filter((item) => item.missing.length > 0);
  const qualityIssues: string[] = [];
  if (!roleCount) qualityIssues.push("No real tender personnel positions were extracted.");
  if (incompleteCorePositions.length) {
    qualityIssues.push(`Some positions are missing core requirements: ${incompleteCorePositions.slice(0, 10).map((item) => `${item.title || "Untitled"} missing ${item.missing.join(", ")}`).join("; ")}${incompleteCorePositions.length > 10 ? "..." : ""}.`);
  }

  return {
    ...tender,
    tender_title: cleanTenderTitle(tender?.tender_title || tender?.name || ""),
    name: cleanTenderTitle(tender?.name || tender?.tender_title || ""),
    client: cleanTenderRequirementText(tender?.client || explicitClientEvidence || ""),
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
    extraction_warnings: Array.from(new Set([...retainedWarnings, ...extractionWarnings, ...qualityIssues.map((issue) => `Review required: ${issue}`)])),
    extraction_blocking_issues: [],
    extraction_quality: {
      raw_position_count: positions.length,
      merged_position_count: roleCount,
      duplicate_fragments_merged: Math.max(0, positions.length - roleCount),
      source_backed_positions: sourceBackedCount,
      complete_core_positions: completeCoreCount,
      incomplete_core_positions: incompleteCorePositions.length,
      missing_core_evidence_positions: 0,
    },
    review_required: retainedWarnings.length > 0 || extractionWarnings.length > 0 || qualityIssues.length > 0,
  };
}
