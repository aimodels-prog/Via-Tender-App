import { GoogleGenAI, Type, Schema } from '@google/genai';
import { ALL_PRIMARY_POSITIONS } from '../lib/constants.ts';
import { extractUniversalTenderFacts, mergeSourceEvidence } from '../lib/universalExtraction.ts';
import { normalizeTenderRecord } from '../lib/tenderPostProcess.ts';

function getAI() {
  const rawKey = process.env.GEMINI_API_KEY || "";
  const apiKey = rawKey.trim();
  console.log("getAI called. apiKey length:", apiKey.length, "Starts with:", apiKey.substring(0, 5));
  if (!apiKey) {
    console.warn("Valid API KEY is not set.");
  }
  return new GoogleGenAI(apiKey ? { apiKey } : {});
}

function parseGenAIJSON(responseText: string): any {
  let cleanedText = responseText.trim();
  cleanedText = cleanedText.replace(/^```[a-zA-Z]*\n?/, '').replace(/\n?```$/, '');
  cleanedText = cleanedText.replace(/,\s*([\]}])/g, '$1'); // Fix numeric/trailing commas
  try {
    return JSON.parse(cleanedText);
  } catch (err) {
    // Attempt missing bracket/quote recovery for truncated JSON
    const recoverEndings = [
      '"}',
      '"]}',
      '"}]}',
      '"]}]}',
      '}',
      ']}',
      '}]}',
      ']}]}'
    ];
    for (let ending of recoverEndings) {
      try {
        return JSON.parse(cleanedText + ending);
      } catch (e) {}
    }
    throw err;
  }
}

const matchSchema: Schema = {
  type: Type.OBJECT,
  properties: {
    matches: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          expertId: { type: Type.STRING },
          expertName: { type: Type.STRING },
          primaryPosition: { type: Type.STRING },
          score: { type: Type.NUMBER },
          match_summary: { type: Type.STRING },
          strong_points: { type: Type.ARRAY, items: { type: Type.STRING } },
          missing_requirements: { type: Type.ARRAY, items: { type: Type.STRING } },
          scoring_rationale: { type: Type.STRING, description: "Explanation of relative scoring compared to other evaluated candidates (e.g., why a candidate is 95% instead of 100% when both meet all criteria but one has 15 yrs vs 11 yrs of experience)." },
          met_team_constraints: { type: Type.ARRAY, items: { type: Type.STRING }, description: "List of global team-level constraints from the tender that this specific candidate satisfies (if any)." },
          recommended_projects_to_highlight: { type: Type.ARRAY, items: { type: Type.STRING } },
          risk_level: { type: Type.STRING, enum: ["LOW", "MEDIUM", "HIGH"] }
        }
      }
    }
  }
};

const cvSchema: Schema = {
  type: Type.OBJECT,
  properties: {
    experts: {
      type: Type.ARRAY,
      description: "List of experts found in the text",
      items: {
        type: Type.OBJECT,
        required: [
          "fullName", "primary_position", "role", "location", "countries", 
          "educationLevel", "experienceYears", "skills", "software", 
          "dateOfBirth", "countryOfCitizenship", "profileSummary", "experiences", "adequacy_experience"
        ],
        properties: {
          fullName: { type: Type.STRING, description: "CRITICAL: The full legal name of the expert. You must find this in the CV. Do NOT output 'null' or 'unknown' if a name exists." },
          role: { type: Type.STRING, description: "The category from the official taxonomy that best describes the expert's career (e.g., Civil Engineer). Keep it short." },
          primary_position: { type: Type.STRING, description: "The specific, most recent job title held by the expert as stated in the CV (e.g., Senior Infrastructure Manager)." },
          location: { type: Type.STRING, description: "The current residential or professional location/country. If not listed explicitly, infer from the most recent work experience location." },
          countries: { type: Type.ARRAY, items: { type: Type.STRING }, description: "All countries where the expert has proven professional reach or residency." },
          educationLevel: { type: Type.STRING, description: "CRITICAL: The highest education level only, not the full education detail. Use values like 'PhD', 'Master Degree', 'Bachelor Degree', 'Degree', 'Diploma', or 'Certificate'. Put field, institution, dates, and location in metadata.educations, not here." },
          experienceYears: { type: Type.INTEGER, description: "The total number of years of professional experience calculated from employment history." },
          type: { type: Type.STRING, enum: ["Internal", "External"], description: "Whether the expert is a permanent staff member (Internal) or an independent consultant/external candidate (External). If not mentioned, leave null." },
          skills: { type: Type.ARRAY, items: { type: Type.STRING }, description: "Specific technical or soft skills (e.g., AutoCAD, Project Management)." },
          software: { type: Type.ARRAY, items: { type: Type.STRING }, description: "Proficiency in specific software or digital tools." },
          training_courses: { type: Type.ARRAY, items: { type: Type.STRING }, description: "Certifications, non-degree training, or short courses." },
          dateOfBirth: { type: Type.STRING, description: "Format: YYYY-MM-DD or as found. Output empty string if not present in CV." },
          countryOfCitizenship: { type: Type.STRING, description: "The nationality or citizenship of the expert. Output empty string if not present in CV." },
          email: { type: Type.STRING, description: "The expert's email address if present. Output empty string if not present in CV." },
          phone: { type: Type.STRING, description: "The expert's phone number if present. Output empty string if not present in CV." },
          profileSummary: { type: Type.STRING, description: "CRITICAL: The ENTIRE professional bio or summary found in the CV (at least 7-10 lines, no bullet points)." },
          availability: { type: Type.STRING, description: "Availability status or notice period if stated." },
          professionalMembership: { type: Type.ARRAY, items: { type: Type.STRING }, description: "Professional bodies or associations the expert is a member of." },
          adequacy_experience: {
            type: Type.ARRAY,
            description: "CRITICAL: 'Adequacy for the Assignment'. Extract all past projects and work that justify the expert's fit. Be exceedingly verbose. Include the period, country, position, client, project names, and the exact responsibilities/actions the expert performed on those assignments. MUST BE HIGHLY DETAILED. Do not miss any assignment related to a particular job.",
            items: {
              type: Type.OBJECT,
              required: ["period", "country", "position", "client", "assignment", "category"],
              properties: {
                period: { type: Type.STRING, description: "CRITICAL: Start Date and End date/Duration (e.g. 'Jan 2018 - Present' or '3 years'). Make sure you capture this if present." },
                country: { type: Type.STRING, description: "CRITICAL: Country where the assignment took place." },
                position: { type: Type.STRING },
                client: { type: Type.STRING },
                assignment: { type: Type.STRING, description: "CRITICAL: Deep description of the assignment AND what the expert actually did. Do NOT output only project names. Include multiple assignment/project lines when the role contains multiple assignments, plus bullet-like responsibility statements such as design review, structural analysis, BOQ preparation, coordination, supervision, checking drawings, resolving site issues, approvals, etc., when present in the CV." },
                category: { type: Type.STRING }
              }
            }
          },
          experiences: {
            type: Type.ARRAY,
            description: "ALL work experiences and employment history. Do not skip any jobs or roles. Extract chronological work history with exact dates, country, and fully detailed job descriptions.",
            items: {
              type: Type.OBJECT,
              required: ["organization", "country", "role", "start_date", "end_date", "duration", "description"],
              properties: {
                project_name: { type: Type.STRING, description: "Name of the project or initiative if applicable." },
                organization: { type: Type.STRING, description: "Employer or organization name." },
                country: { type: Type.STRING, description: "CRITICAL: Location/Country of employment. You MUST extract this!" },
                client: { type: Type.STRING, description: "Client name if the work was consulting or contracting." },
                role: { type: Type.STRING, description: "Exact job title or role held." },
                duration: { type: Type.STRING, description: "CRITICAL: The full duration of the employment (e.g. 'Jan 2018 - Present'). You MUST extract this!" },
                start_date: { type: Type.STRING, description: "CRITICAL: Start date (e.g., 'Jan 2018' or '2018'). MUST BE SHORT, maximum 20 chars. DO NOT write paragraphs here. But YOU MUST EXTRACT THIS DATE." },
                end_date: { type: Type.STRING, description: "CRITICAL: End date (e.g., 'Present' or 'Dec 2021'). MUST BE SHORT, maximum 20 chars. YOU MUST EXTRACT THIS DATE." },
                description: { type: Type.STRING, description: "CRITICAL: The ENTIRE exhaustive description of responsibilities, tasks, achievements, and technologies used. Capture every single paragraph, bullet point, and detail 100% exactly as written in the CV. VERBATIM. DO NOT SUMMARIZE OR TRUNCATE. BE EXTREMELY DETAILED." }
              }
            }
          },
          projects: {
            type: Type.ARRAY,
            description: "ALL specific projects worked on. Extract in maximum detail.",
            items: {
              type: Type.OBJECT,
              properties: {
                name: { type: Type.STRING, description: "Name of the project." },
                role: { type: Type.STRING, description: "Role the expert played on the project." },
                location: { type: Type.STRING, description: "Location of the project." },
                description: { type: Type.STRING, description: "CRITICAL: Exhaustive description of the project, including scope, metrics, exact responsibilities, budgets, and technologies used." }
              }
            }
          },
          metadata: {
            type: Type.OBJECT,
            properties: {
              educations: { type: Type.ARRAY, description: "CRITICAL: Extract only FORMAL education credentials: PhD/Doctorate, Master, Bachelor, Degree, Diploma, DAE, or equivalent academic qualifications. Do NOT put training courses, workshops, Erasmus/exchange, licenses, 'qualification to practice', or short courses here. Those belong in training/certifications, not education details. Include full degree name, field of study, institution, location/country, and year whenever present.", items: { type: Type.OBJECT, properties: { degree: { type: Type.STRING, description: "The full formal academic credential title only, e.g. PhD, Master Degree, Bachelor of Science, Diploma." }, field: { type: Type.STRING, description: "CRITICAL: The specific major or field of study, e.g. Civil Engineering, Architecture, Product Design." }, institution: { type: Type.STRING }, year: { type: Type.STRING }, location: { type: Type.STRING, description: "Institution city/state/country exactly as stated, e.g. 'Hamirpur, India' or 'India'. Do not omit country if the CV states it." }, grade: { type: Type.STRING }, notes: { type: Type.STRING } } } },
              certifications: { type: Type.ARRAY, description: "Extract all professional certifications or licenses.", items: { type: Type.OBJECT, properties: { title: { type: Type.STRING }, issuer: { type: Type.STRING }, country: { type: Type.STRING }, year: { type: Type.STRING }, description: { type: Type.STRING, description: "Any extra details provided." } } } },
              languages: { type: Type.ARRAY, description: "Extract all languages and their proficiency levels.", items: { type: Type.OBJECT, properties: { name: { type: Type.STRING }, level: { type: Type.STRING, description: "E.g., Native, Fluent, Good, Basic." }, notes: { type: Type.STRING } } } },
              awards: { type: Type.ARRAY, description: "Extract all awards and honors.", items: { type: Type.OBJECT, properties: { title: { type: Type.STRING }, issuer: { type: Type.STRING }, country: { type: Type.STRING }, year: { type: Type.STRING }, description: { type: Type.STRING } } } },
              publications: { type: Type.ARRAY, items: { type: Type.OBJECT, properties: { title: { type: Type.STRING }, journal: { type: Type.STRING }, year: { type: Type.STRING }, description: { type: Type.STRING } } } },
              unmapped_data: {
                type: Type.ARRAY,
                description: "Absolutely ANY other professional, technical, or academic information found in the CV that does not fit perfectly into the schema fields. EXCLUDE hobbies, personal references, and irrelevant personal trivia.",
                items: { type: Type.OBJECT, properties: { key: { type: Type.STRING }, value: { type: Type.STRING } } }
              }
            }
          }
        }
      }
    }
  }
};

const expertResponseSchema = (cvSchema.properties!.experts as any).items as Schema;

const tenderSchema: Schema = {
  type: Type.OBJECT,
  properties: {
    tender_format: { type: Type.STRING },
    tender_title: { type: Type.STRING },
    client: { type: Type.STRING },
    country: { type: Type.STRING },
    tender_number: { type: Type.STRING },
    submission_type: { type: Type.STRING },
    project_sector: { type: Type.ARRAY, items: { type: Type.STRING } },
    scope_summary: { type: Type.STRING },
    duration: { type: Type.STRING },
    special_requirements: { type: Type.ARRAY, items: { type: Type.STRING } },
    global_team_constraints: { type: Type.ARRAY, items: { type: Type.STRING }, description: "Global constraints applying to the entire team (e.g. 'Requires at least 1 resident citizen', 'Requires 1 certified safety officer')" },
    positions: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          position_title: { type: Type.STRING },
          quantity: { type: Type.INTEGER },
          minimum_education: { type: Type.STRING, description: "Extract entire education requirement verbatim" },
          minimum_years_experience: { type: Type.INTEGER },
          general_experience: { type: Type.STRING, description: "Extract the exact verbatim general experience requirement for the position" },
          specific_experience: { type: Type.STRING, description: "Extract the exact verbatim specific experience requirement for the position" },
          role_description: { type: Type.STRING, description: "Extract the exact verbatim role or tasks or responsibilities description" },
          required_sector_experience: { type: Type.ARRAY, items: { type: Type.STRING } },
          mandatory_skills: { type: Type.ARRAY, items: { type: Type.STRING }, description: "Specific mandatory technical skills or software needs" },
          required_keywords: { type: Type.ARRAY, items: { type: Type.STRING } },
          nationality_preference: { type: Type.STRING }
        }
      }
    }
  }
};

async function callGenAIWithRetry(
  callFn: (modelName: string) => Promise<any>, 
  models = ["gemini-3.5-flash", "gemini-3.1-flash-lite", "gemini-3.1-pro-preview"],
  maxRetriesPerModel = 2, 
  baseDelayMs = 2000
): Promise<any> {
  let lastError: any;

  for (let mIndex = 0; mIndex < models.length; mIndex++) {
    const model = models[mIndex];
    let attempt = 0;
    
    while (attempt < maxRetriesPerModel) {
      try {
        return await callFn(model);
      } catch (error: any) {
        lastError = error;
        attempt++;
        const is503 = error?.status === 503 || error?.message?.includes('503') || error?.message?.includes('high demand') || (error as any)?.response?.status === 503;
        const isQuotaExceeded = error?.message?.includes('exceeded your current quota') || error?.message?.includes('Quota exceeded');
        const isTransient429 = (error?.status === 429 || error?.message?.includes('429') || (error as any)?.response?.status === 429) && !isQuotaExceeded;
        
        if (!(is503 || isTransient429) || attempt >= maxRetriesPerModel || isQuotaExceeded) {
          if (mIndex < models.length - 1) {
            console.warn(`[GenAI] Model ${model} failed, failing over to next model: ${models[mIndex + 1]}. Error was: ${error?.message}`);
          } else {
             console.error(`[GenAI] Error with model ${model} (Final Attempt):`, error?.message);
          }
          break; // move to next model
        }
        
        console.warn(`[GenAI] Transient error with model ${model} (Attempt ${attempt}/${maxRetriesPerModel}):`, error?.message);
        const delay = baseDelayMs * Math.pow(2, attempt - 1);
        console.log(`[GenAI] Retrying model ${model} in ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }
  
  throw lastError;
}

function sanitizeExtractedValues(obj: any): any {
  if (typeof obj === "string") {
    const trimmed = obj.trim();
    if (/^(n\/?a|not\s*(stated|available|mentioned|provided|applicable|specified|found)|unknown|null|none|undefined|-)$/i.test(trimmed)) {
      return "";
    }
    return trimmed
      .replace(/^(Wait,?\s*|I will\s+|Let me\s+|I need to\s+|Looking at\s+|Based on\s+(?:my\s+)?(?:analysis|review)\s*,?\s*)/i, "")
      .replace(/\b(?:Wait,\s+|I will\s+|Let me\s+|I need to\s+)[^.]+(?:\.\s*)?/gi, "")
      .replace(/\s+/g, " ")
      .trim();
  }
  if (Array.isArray(obj)) {
    return obj.map(sanitizeExtractedValues).filter((value: any) => value !== "" && value !== null && value !== undefined);
  }
  if (obj && typeof obj === "object") {
    const cleaned: any = {};
    for (const [key, value] of Object.entries(obj)) {
      cleaned[key] = sanitizeExtractedValues(value);
    }
    return cleaned;
  }
  return obj;
}

function validateExtractedExpert(expert: any): { valid: boolean; issues: string[] } {
  const issues: string[] = [];
  if (!String(expert?.fullName || expert?.name || "").trim()) issues.push("fullName is empty");
  if (!Array.isArray(expert?.experiences) || expert.experiences.length === 0) issues.push("Zero experiences extracted");
  if (!String(expert?.profileSummary || expert?.profile_summary || "").trim() || String(expert?.profileSummary || expert?.profile_summary || "").trim().length < 50) {
    issues.push("profileSummary is missing or too short");
  }
  if ((!Array.isArray(expert?.metadata?.educations) || expert.metadata.educations.length === 0) && !String(expert?.educationLevel || "").trim()) {
    issues.push("No education data found");
  }
  if (!Array.isArray(expert?.adequacy_experience) || expert.adequacy_experience.length === 0) issues.push("Zero adequacy entries");
  if (!Array.isArray(expert?.metadata?.languages) && (!Array.isArray(expert?.languages) || expert.languages.length === 0)) issues.push("No languages found");
  return { valid: issues.length === 0, issues };
}

function validateExtractedTender(tender: any): { valid: boolean; issues: string[] } {
  const issues: string[] = [];
  if (!String(tender?.tender_title || tender?.name || "").trim()) issues.push("tender_title is empty");
  if (!String(tender?.client || "").trim()) issues.push("client is empty");
  if (!Array.isArray(tender?.positions) || tender.positions.length === 0) issues.push("Zero positions extracted");
  tender?.positions?.forEach((position: any, index: number) => {
    if (!String(position?.position_title || "").trim()) issues.push(`Position ${index + 1}: missing title`);
    if (!String(position?.general_experience || "").trim() && !String(position?.specific_experience || "").trim()) {
      issues.push(`Position ${index + 1} "${position?.position_title || "Untitled"}": no experience requirements`);
    }
    if (!String(position?.role_description || "").trim()) {
      issues.push(`Position ${index + 1} "${position?.position_title || "Untitled"}": no role_description`);
    }
  });
  return { valid: issues.length === 0, issues };
}

function logExtractionValidation(kind: "CV" | "TENDER", label: string, validation: { valid: boolean; issues: string[] }) {
  if (validation.valid) {
    console.log(`[${kind} EXTRACTION] ${label} — Validation: PASS`);
  } else {
    console.warn(`[${kind} EXTRACTION] ${label} — Validation: WARN: ${validation.issues.join("; ")}`);
  }
}

function safeAuditMerge(original: any, audited: any): any {
  const cleanString = (value: any) => String(value || "").trim();
  const merged = { ...original };
  const scalarFields = ["fullName", "name", "dateOfBirth", "birth_date", "countryOfCitizenship", "nationality", "email", "phone", "profileSummary", "profile_summary", "location", "educationLevel", "primary_position", "role"];
  for (const key of scalarFields) {
    const origVal = cleanString(original?.[key]);
    const audVal = cleanString(audited?.[key]);
    if (audVal && (!origVal || audVal.length > origVal.length)) merged[key] = audited[key];
  }

  const arrayFields = ["experiences", "employment_history", "adequacy_experience", "skills", "software", "training_courses", "training", "professionalMembership", "languages", "education"];
  for (const key of arrayFields) {
    const origArr = Array.isArray(original?.[key]) ? original[key] : [];
    const audArr = Array.isArray(audited?.[key]) ? audited[key] : [];
    merged[key] = audArr.length >= origArr.length ? audArr : origArr;
  }

  merged.metadata = { ...(original?.metadata || {}), ...(audited?.metadata || {}) };
  const metaArrays = ["educations", "certifications", "languages", "awards", "publications", "unmapped_data", "adequacy"];
  for (const key of metaArrays) {
    const origArr = Array.isArray(original?.metadata?.[key]) ? original.metadata[key] : [];
    const audArr = Array.isArray(audited?.metadata?.[key]) ? audited.metadata[key] : [];
    merged.metadata[key] = audArr.length >= origArr.length ? audArr : origArr;
  }
  if (audited?.metadata?.extraction_audit_notes) {
    merged.metadata.extraction_audit_notes = audited.metadata.extraction_audit_notes;
  }
  return sanitizeExtractedValues(merged);
}

export async function runParseCVText(text: string, tax: string[]): Promise<any[]> {
  const taxonomy = (tax && tax.length > 0) ? tax : ALL_PRIMARY_POSITIONS;
  const prompt = `You are a meticulous expert profile extraction AI for international tender CVs.

  SECTION 1: READING PROTOCOL
  1. Before filling JSON, reconstruct the CV structure: header/contact, profile, education, software/tools, training/courses, employment chronology, projects/key assignments, languages, certifications, memberships, publications, and OCR-broken tables.
  2. Read line by line and section by section. Extract every professional, academic, technical, project, and contact fact available in the source.
  3. If the CV is not in English, output professional English while preserving all facts exactly.

  SECTION 2: IDENTITY, CONTACT, AND MISSING DATA
  4. Extract the exact fullName from the top/header/signature. primary_position must be the actual specific job title from the CV.
  5. Assign role from exactly this taxonomy: [${taxonomy.join(", ")}].
  6. Missing data handling: if a field cannot be found anywhere in the CV, output "" for string fields or [] for array fields. Do NOT output "N/A", "Not stated", "Unknown", "null", "None", or similar placeholder text.
  7. Do NOT guess, infer, or fabricate DOB, citizenship, nationality, employers, dates, countries, degrees, clients, project names, certifications, memberships, or years of experience. Only exception: location may use the country from the most recent work experience if no current location is explicitly stated.

  SECTION 3: EXTRACTION FIDELITY
  8. Preserve original meaning and detail. You may ONLY fix obvious OCR/PDF damage: broken words, garbled symbols, duplicated whitespace, malformed bullets, and table line breaks.
  9. Do NOT rephrase, summarize, add content, improve grammar beyond OCR repair, or change meaning. When in doubt, keep original wording.
  10. Do not combine distinct jobs. Do not split one continuous job into multiple entries.
  11. Never include internal reasoning in any field. No "Wait", "I will", "Let me", "Based on my analysis", or similar text.

  SECTION 4: EMPLOYMENT, ADEQUACY, AND EDUCATION
  12. experiences is the chronological employment record. Extract every job with organization, country, role, exact dates, duration, client/project when available, and the full responsibilities/achievements text.
  13. adequacy_experience is project/key-assignment proof. Extract every project/assignment from Key Experience, Relevant Assignments, Projects, or equivalent sections. Each assignment must include project names and what the expert did, not only project names.
  14. If no explicit adequacy section exists, derive adequacy_experience from major projects and responsibilities already present in employment history, without adding facts.
  15. Keep experiences and adequacy_experience in reverse chronological order where dates allow.
  16. educationLevel is only the highest formal level: "PhD", "Master Degree", "Bachelor Degree", "Degree", "Diploma", or "Certificate". metadata.educations must contain only formal academic credentials. Training, licenses, workshops, and short courses belong in training_courses or certifications.

  SECTION 5: OUTPUT FORMAT
  17. Return exactly one expert object per person found in the CV.
  18. Ensure valid JSON matching the schema. Dates must be concise. Do not place paragraphs in date fields.
  19. profileSummary should capture the expert's professional narrative in paragraph form when enough source material exists; do not use bullets for the profile.
  20. Put any professional information that does not fit other fields into metadata.unmapped_data.
  
  CV Text:
  ${text}`;

  const parseWithPrompt = async (promptText: string, models: string[]) => {
    const response = await callGenAIWithRetry((modelName) => getAI().models.generateContent({
    model: modelName,
    contents: [{ role: 'user', parts: [{ text: promptText }]}],
    config: {
      responseMimeType: "application/json",
      responseSchema: cvSchema,
      temperature: 0.2,
    }
    }), models);

    const responseText = response.text || '{}';
    console.log("Raw CV Response:", responseText);
    try {
      return sanitizeExtractedValues(parseGenAIJSON(responseText)) as { experts: any[] };
    } catch (e: any) {
      console.error("Failed to parse AI JSON:", e.message);
      throw new Error("Failed to parse AI response as JSON: " + e.message + ". First 200 chars: " + responseText.substring(0, 200));
    }
  };

  const normalizeExperts = (experts: any[]) => experts.map((e: any) => {
    const cleanOptional = (value: any) => {
      const str = String(value || "").trim();
      return str && !str.toLowerCase().includes("not stated") ? str : "";
    };
    const normalizeRole = (value: any, fallbackText: any = "") => {
      const text = `${cleanOptional(value)} ${cleanOptional(fallbackText)}`.toLowerCase();
      const exact = taxonomy.find((item) => item.toLowerCase() === cleanOptional(value).toLowerCase());
      if (exact) return exact;
      const fuzzy = taxonomy.find((item) => {
        const lower = item.toLowerCase();
        return text.includes(lower) || lower.split(/[^a-z0-9]+/).filter((part) => part.length > 2).every((part) => text.includes(part));
      });
      return fuzzy || "Others";
    };

    const education =
      e.metadata?.educations?.map((ed: any) => {
        const parts = [
          cleanOptional(
            ed.degree && ed.field
              ? `${ed.degree} in ${ed.field}`
              : ed.degree || ed.field,
          ),
          cleanOptional(ed.institution),
          cleanOptional(ed.location),
          cleanOptional(ed.year),
        ].filter(Boolean);
        return parts.join(", ");
      }) ||
      e.education ||
      [];

    const dateOfBirth = e.dateOfBirth || e.birth_date || e.date_of_birth || "";
    const citizenship =
      e.countryOfCitizenship || e.nationality || e.citizenship || "";
    const firstExperienceRole = cleanOptional(e.experiences?.[0]?.role || e.employment_history?.[0]?.role);
    const rawPrimaryPosition = cleanOptional(e.primary_position);
    const primaryPosition =
      !rawPrimaryPosition ||
      rawPrimaryPosition.length > 80 ||
      rawPrimaryPosition.includes("|")
        ? firstExperienceRole || rawPrimaryPosition || cleanOptional(e.role) || "Unknown"
        : rawPrimaryPosition;
    const formatAdequacyAssignment = (value: any) => {
      const marker = "<<<POINT>>>";
      const text = String(value || "")
        .replace(/\r|\t|\u00A0/g, " ")
        .replace(/[\u2022\u25cf\u25aa\u25ab\u25e6]/g, ` ${marker} `)
        .replace(/(^|\s)-\s+(?=(Design|Consultancy|Responsibilities?|Urban|Dualization|Review|Preparation|Coordination|Supervision|Analysis|Checking)\b)/gi, ` ${marker} `)
        .replace(/\s+/g, " ")
        .trim();
      if (!text) return "";

      const responsibilitySplit = text.split(
        /\s+(?=Responsibilities?\s+(?:include|included)\b)/i,
      );
      const projectPart = responsibilitySplit[0] || "";
      const responsibilityPart = responsibilitySplit.slice(1).join(" ").trim();
      const projectBullets = projectPart
        .split(marker)
        .flatMap((part) => part.split(/;\s+/))
        .map((part) => part.trim().replace(/[.;]\s*$/, ""))
        .filter(Boolean);
      const responsibilityBullets = responsibilityPart
        ? [responsibilityPart.replace(/[.;]\s*$/, ".")]
        : [];
      const bullets =
        projectBullets.length > 1
          ? [...projectBullets, ...responsibilityBullets]
          : [projectPart.replace(new RegExp(marker, "g"), "").trim(), ...responsibilityBullets].filter(Boolean);

      return bullets
        .map((part) => part.trim())
        .filter(Boolean)
        .map((part) => `- ${part}`)
        .join("\n");
    };
    const adequacyExperience = (
      e.metadata?.adequacy ||
      e.adequacy_experience ||
      []
    ).map((item: any) => ({
      ...item,
      assignment: formatAdequacyAssignment(item.assignment),
    }));

    return {
      ...e,
      name: e.fullName || e.name || "",
      email: e.email || "",
      phone: e.phone || "",
      primary_position: primaryPosition,
      role: normalizeRole(e.role, `${primaryPosition} ${e.profileSummary || ""} ${(e.skills || []).join(" ")}`),
      dateOfBirth,
      birth_date: dateOfBirth,
      countryOfCitizenship: citizenship,
      nationality: citizenship,
      profile_summary: e.profileSummary || e.profile_summary || e.summary || "",
      adequacy_experience: adequacyExperience,
      education,
      metadata: {
        ...(e.metadata || {}),
        adequacy: adequacyExperience,
      },
      languages:
        e.metadata?.languages?.map(
          (l: any) =>
            cleanOptional(l.name) +
            (cleanOptional(l.level) ? ` - ${cleanOptional(l.level)}` : ""),
        ) ||
        e.languages?.map((l: any) => (typeof l === "string" ? l : l.name || l.language)) ||
        e.languages ||
        [],
      highlights: e.highlights_of_activities || [],
      training: e.training_courses || [],
      employment_history: e.experiences || [],
      experiences: e.experiences || [],
    };
  });

  let result = await parseWithPrompt(prompt, ["gemini-3.1-flash-lite", "gemini-3.1-pro-preview", "gemini-3.5-flash"]);
  let normalizedExperts = normalizeExperts(result.experts || []);
  const validationIssues = normalizedExperts.flatMap((expert: any) => {
    const validation = validateExtractedExpert(expert);
    logExtractionValidation("CV", expert.fullName || expert.name || "Unnamed expert", validation);
    return validation.issues;
  });

  if (validationIssues.length > 0) {
    const retryPrompt = `${prompt}

  EXTRACTION REPAIR PASS:
  The first extraction had these issues: ${validationIssues.join("; ")}.
  Re-read the CV text line by line and repair ONLY missing or weak extracted fields that are explicitly present in the source. Do not invent data. Missing source data must remain empty string or empty array.`;
    try {
      const retryResult = await parseWithPrompt(retryPrompt, ["gemini-3.1-pro-preview"]);
      const retryExperts = normalizeExperts(retryResult.experts || []);
      const retryIssueCount = retryExperts.reduce((count: number, expert: any) => count + validateExtractedExpert(expert).issues.length, 0);
      const originalIssueCount = normalizedExperts.reduce((count: number, expert: any) => count + validateExtractedExpert(expert).issues.length, 0);
      if (retryExperts.length && retryIssueCount <= originalIssueCount) {
        normalizedExperts = retryExperts;
      }
    } catch (error: any) {
      console.warn("[CV EXTRACTION] Repair retry failed; keeping first extraction.", error?.message || error);
    }
  }

  normalizedExperts.forEach((expert: any) => {
    logExtractionValidation("CV", expert.fullName || expert.name || "Unnamed expert", validateExtractedExpert(expert));
  });
  return normalizedExperts;
}

export async function runAuditExtractedCV(rawText: string, expert: any): Promise<any> {
  const prompt = `You are an expert CV extraction auditor.

Your job is to compare the RAW CV TEXT against the EXTRACTED EXPERT JSON and fix missing or weak extraction before the user reviews it.

CRITICAL RULES:
1. Read the raw CV text as evidence. Do not rely only on the extracted JSON.
2. Correct missing education, certifications, employment dates, employers, countries, project names, clients, duties, software, languages, DOB, nationality, email and phone when they are present in the raw text.
3. If the raw CV uses headings such as EDUCATION, ACADEMIC QUALIFICATIONS, QUALIFICATION, PROFESSIONAL EXPERIENCE, CAREER HISTORY, PROJECT EXPERIENCE, MEMBERSHIPS, TRAINING, SKILLS, understand them intelligently.
4. For education, preserve full degree + field + institution + country/location + dates/year whenever present. Examples like "Ph.D. Civil Engineering, Saitama University Japan, 10/2015 - 09/2018" are strong education and must not be treated as thin.
5. For adequacy_experience, every assignment must explain what the expert did. If it only lists a project/client, enrich it using matching employment duties from the raw CV or extracted employment record.
6. For EACH item in experiences/employment_history, locate its matching raw CV section using period, employer/client, role, and country. Confirm the description captures all duties, responsibilities, activities, deliverables, and project tasks stated in that source section.
7. If the raw CV has bullet points or duty sentences for an employment record, preserve them in experiences[].description as readable bullet-like lines. Do not collapse multiple duty points into one vague sentence.
8. If the source CV itself only provides one brief duty line for an employment record, keep it brief and note that it was confirmed as brief in metadata.extraction_audit_notes. Do not invent more duties.
9. Preserve facts from the raw text. Do not invent new employers, degrees, dates, countries, or projects.
10. Return a complete corrected expert JSON object, preserving the same top-level shape where possible.
11. Add metadata.extraction_audit_notes as a short array of what you corrected or confirmed, including employment duty recovery/confirmation.

RAW CV TEXT:
${rawText}

EXTRACTED EXPERT JSON:
${JSON.stringify(expert)}
`;

  try {
    const response = await callGenAIWithRetry((modelName) => getAI().models.generateContent({
      model: modelName,
      contents: [{ role: 'user', parts: [{ text: prompt }]}],
      config: {
        responseMimeType: "application/json",
        responseSchema: expertResponseSchema,
        temperature: 0.1,
      }
    }), ["gemini-3.1-flash-lite", "gemini-3.1-pro-preview", "gemini-3.5-flash"], 1);

    const output = response.text || "{}";
    let parsed = expert;
    try {
      parsed = sanitizeExtractedValues(parseGenAIJSON(output));
    } catch (e) {
      console.error("Parse JSON error in CV audit", e);
      return expert;
    }

    const merged = safeAuditMerge(expert, parsed);
    logExtractionValidation("CV", merged.fullName || merged.name || "Audited expert", validateExtractedExpert(merged));
    return merged;
  } catch (error) {
    console.error("Audit CV Error:", error);
    return expert;
  }
}

export async function translateExpertProfile(expertData: any, targetLanguage: string): Promise<any> {
  const prompt = `You are an elite bilingual technical translator and recruitment expert specializing in international development, engineering, and enterprise consulting. 
Your goal is to translate the following parsed CV/Expert Profile into ${targetLanguage} with extreme professional fluency.

CRITICAL INSTRUCTIONS:
1. EXTREME PROFESSIONAL FLUENCY: Do not just translate literally. Localize the tone to sound like a native, highly polished professional in the target language. Use industry-standard terminology for engineering, procurement, management, and technical fields.
2. PRESERVE STRUCTURE: Retain the EXACT JSON structure, keys, and array types, but translate all textual content (skills, summary, education degrees, job titles, awards, project descriptions).
3. SMART HANDLING OF TERMINOLOGY: If a specific technical standard (e.g., FIDIC, ISO) or software is globally known by its English name, keep it in English. 
4. Do NOT translate the "role" taxonomy field unless it's descriptive.

Profile Data:
${JSON.stringify(expertData)}
`;

  const response = await callGenAIWithRetry((modelName) => getAI().models.generateContent({
    model: modelName,
    contents: [{ role: 'user', parts: [{ text: prompt }]}],
    config: {
      responseMimeType: "application/json",
      temperature: 0.2,
    }
  }), ["gemini-3.1-flash-lite", "gemini-3.5-flash"]);

  const responseText = response.text || '{}';
  console.log("Raw Translation Response:", responseText);
  let parsed = {};
  try {
    parsed = parseGenAIJSON(responseText);
    return parsed;
  } catch (err) {
    console.error("Translation JSON Parse Error", err);
    return expertData;
  }
}
function cleanTenderLine(value: any) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function normalizePositionTitle(value: string) {
  return cleanTenderLine(value)
    .replace(/[✓✔]/g, " ")
    .replace(/^[\d.)\-\s]+/, "")
    .replace(/^(?:no\.?|number|qty|personnel|staff|key expert|expert|position|role|designation)\s*:?\s*/i, "")
    .replace(/\s*\(\s*\d+\s*(?:nos?\.?|persons?|staff)?\s*\)\s*$/i, "")
    .replace(/\s*[-–—:]\s*\d+\s*(?:nos?\.?|persons?|staff)?\s*$/i, "")
    .replace(/\s+(?:qty|quantity|no\.?|number)\s*[:\-]?\s*\d{1,2}\s*$/i, "")
    .replace(/\s+\d{1,2}\s*$/i, "")
    .replace(/[.;:,]\s*$/, "")
    .trim();
}

function isTenderFormOrEvaluationPosition(value: string) {
  const text = cleanTenderLine(value);
  return (
    /\bTECH-\d+[A-Z]?\b/i.test(text) ||
    /\bconsultant'?s\s+(organization|experience|comments?|suggestions?|methodology|work plan|team composition)\b/i.test(text) ||
    /\b(?:form|schedule)\s+tech[-\s]?\d/i.test(text) ||
    /\b(?:technical|financial)\s+proposal\b/i.test(text) ||
    /\bexperience\.\s*[✓✔]/i.test(text) ||
    /^[A-Z]\.\s+Consultant'?s\b/i.test(text)
  );
}

function isLikelyStaffRoleTitle(value: string) {
  const title = normalizePositionTitle(value);
  if (!title || title.length < 4 || title.length > 90) return false;
  if (isTenderFormOrEvaluationPosition(value) || isTenderFormOrEvaluationPosition(title)) return false;
  if (!/^[A-Z]/.test(title)) return false;
  if (/^(scope|background|objective|deliverables|submission|evaluation|financial|technical|appendix|annex|table|minimum|general|specific|description|experience|organization|methodology|work plan)$/i.test(title)) return false;
  if (/\b(experience|organization|methodology|approach|comments?|suggestions?|data sheet|instruction|proposal|evaluation|criterion|criteria)\b/i.test(title) && !/\b(engineer|expert|specialist|manager|surveyor|inspector|planner|architect|advisor|coordinator|controller|officer|team leader|resident engineer)\b/i.test(title)) return false;
  if (/^(consultant engineer|consulting engineer)$/i.test(title)) return false;
  return /\b(manager|engineer|expert|specialist|consultant|leader|director|coordinator|surveyor|inspector|architect|designer|planner|scheduler|advisor|trainer|analyst|officer|supervisor|controller|technician|draftsman|economist|sociologist|environmentalist|hydrologist|geologist|qa\/qc|hse|team leader|project manager|resident engineer)\b/i.test(title);
}

function extractQuantityFromPositionLine(line: string) {
  const match =
    line.match(/\b(?:qty|quantity|no\.?|number)\s*[:\-]?\s*(\d{1,2})\b/i) ||
    line.match(/\((\d{1,2})\s*(?:nos?\.?|persons?|staff)?\)/i) ||
    line.match(/\b(\d{1,2})\s*(?:nos?\.?|persons?|staff)\b/i) ||
    line.match(/^\s*(\d{1,2})\s+[-.)]?\s+[A-Za-z]/);
  return match ? Number(match[1]) : 1;
}

function recoverTenderPositionsFromText(text: string) {
  const lines = String(text || "")
    .replace(/\r/g, "\n")
    .split(/\n+/)
    .map(cleanTenderLine)
    .filter(Boolean);
  const positions: any[] = [];
  const seen = new Set<string>();

  lines.forEach((line, index) => {
    const compact = line.replace(/\s+/g, " ");
    const titleFromDelimited =
      compact.match(/\b(?:position|role|staff|expert|key expert)\s*[:\-]\s*(.+)$/i)?.[1] ||
      compact.match(/^\s*\d{1,2}\s*[-.)]\s*(.+)$/)?.[1] ||
      compact.match(/^(.+?)\s+(?:qty|quantity|no\.?|number)\s*[:\-]?\s*\d{1,2}\b/i)?.[1] ||
      compact.match(/^(.+?)\s*[-–—:]\s*\d{1,2}\s*(?:nos?\.?|persons?|staff)\b/i)?.[1] ||
      compact;
    const title = normalizePositionTitle(titleFromDelimited);
    if (!isLikelyStaffRoleTitle(title)) return;

    const nearby = lines.slice(index, Math.min(lines.length, index + 8)).join(" ");
    const key = title.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    positions.push({
      position_title: title,
      quantity: extractQuantityFromPositionLine(compact),
      minimum_education: cleanTenderLine(nearby.match(/\b(?:minimum\s+)?(?:education|qualification)\s*[:\-]\s*(.+?)(?=\b(?:experience|role|responsibil|requirement|skills?)\b|$)/i)?.[1] || ""),
      minimum_years_experience: Number(nearby.match(/\b(\d{1,2})\+?\s+years?\b/i)?.[1] || 0) || undefined,
      general_experience: cleanTenderLine(nearby.match(/\bgeneral experience\s*[:\-]\s*(.+?)(?=\bspecific experience\b|$)/i)?.[1] || ""),
      specific_experience: cleanTenderLine(nearby.match(/\bspecific experience\s*[:\-]\s*(.+?)(?=\b(?:role|responsibil|skills?|minimum)\b|$)/i)?.[1] || ""),
      role_description: cleanTenderLine(nearby.match(/\b(?:role description|responsibilities|tasks|duties)\s*[:\-]\s*(.+)$/i)?.[1] || ""),
      required_sector_experience: [],
      mandatory_skills: [],
      required_keywords: Array.from(new Set((nearby.match(/\b(?:FIDIC|AutoCAD|Primavera|BIM|GIS|QA\/QC|HSE|PMP|roads?|bridges?|water|wastewater|building|architecture|AI|Copilot)\b/gi) || []).map((item) => item.trim()))),
      nationality_preference: "",
      recovered_from_text: true,
    });
  });

  return positions;
}

function postProcessTenderExtraction(parsed: any, rawText: string) {
  const tender = { ...(parsed || {}) };
  const existing = Array.isArray(tender.positions) ? tender.positions : [];
  const universalFacts = extractUniversalTenderFacts(rawText);
  const recovered = universalFacts.positions.length ? universalFacts.positions : recoverTenderPositionsFromText(rawText);
  const hasAuthoritativeRoleTable =
    recovered.filter((position: any) => String(position.recovery_source || "").includes("key_expert_position_table")).length >= 3;
  const byTitle = new Map<string, any>();
  const bestText = (current: any, next: any) => {
    const currentText = cleanTenderLine(current);
    const nextText = cleanTenderLine(next);
    if (!currentText) return nextText;
    if (!nextText) return currentText;
    return nextText.length > currentText.length * 1.25 ? nextText : currentText;
  };
  const bestArray = (current: any, next: any) =>
    Array.from(new Set([...(Array.isArray(current) ? current : []), ...(Array.isArray(next) ? next : [])].filter(Boolean)));

  const sourcePositions = hasAuthoritativeRoleTable ? [...recovered, ...existing] : [...existing, ...recovered];
  sourcePositions.forEach((position) => {
    const title = normalizePositionTitle(position.position_title || position.title || position.role || "");
    if (!title) return;
    const key = title.toLowerCase();
    if (hasAuthoritativeRoleTable && !recovered.some((item: any) => normalizePositionTitle(item.position_title || "").toLowerCase() === key)) return;
    const current = byTitle.get(key) || {};
    const preferCurrentSource = hasAuthoritativeRoleTable && Boolean(current.recovered_from_text);
    byTitle.set(key, {
      ...position,
      ...current,
      position_title: current.position_title || title,
      quantity: current.quantity || position.quantity || 1,
      minimum_education: preferCurrentSource ? current.minimum_education || position.minimum_education : bestText(current.minimum_education, position.minimum_education),
      minimum_years_experience: current.minimum_years_experience || position.minimum_years_experience,
      general_experience: preferCurrentSource ? current.general_experience || position.general_experience : bestText(current.general_experience, position.general_experience),
      specific_experience: preferCurrentSource ? current.specific_experience || position.specific_experience : bestText(current.specific_experience, position.specific_experience),
      role_description: preferCurrentSource ? current.role_description || position.role_description || position.description : bestText(current.role_description, position.role_description || position.description),
      required_sector_experience: bestArray(current.required_sector_experience, position.required_sector_experience),
      mandatory_skills: bestArray(current.mandatory_skills, position.mandatory_skills),
      required_keywords: bestArray(current.required_keywords, position.required_keywords),
      nationality_preference: bestText(current.nationality_preference, position.nationality_preference),
      recovered_from_text: Boolean(current.recovered_from_text || position.recovered_from_text),
    });
  });

  const positions = Array.from(byTitle.values());
  return normalizeTenderRecord({
    ...tender,
    positions,
    extraction_recovery: {
      ...(tender.extraction_recovery || {}),
      tenderPositionsRecoveredFromText: recovered.map((position) => position.position_title),
    },
    source_evidence: mergeSourceEvidence(tender.source_evidence, universalFacts.sourceEvidence),
  });
}

function prepareTenderPromptText(rawText: string) {
  const text = String(rawText || "");
  const maxChars = 90000;
  if (text.length <= maxChars) return text;

  const pageBlocks = text
    .split(/(?=---\s*PAGE\s+\d+\s*---)/i)
    .map((block) => block.trim())
    .filter(Boolean);

  const scoreBlock = (block: string) => {
    const lower = block.toLowerCase();
    const signals: Array<[RegExp, number]> = [
      [/\b(key experts?|professional staff|experts required|required experts|staffing|personnel|team composition|consultant'?s team)\b/i, 22],
      [/\b(terms of reference|tor|scope of services|job description|role description)\b/i, 18],
      [/\b(job title|position|qualification|minimum education|experience|responsibilit(?:y|ies)|duties)\b/i, 12],
      [/\b(man[-\s]?month|person[-\s]?month|schedule of staff|staff schedule|input schedule)\b/i, 10],
      [/\b(evaluation criteria|technical proposal|special requirements?|eligibility|mandatory)\b/i, 7],
      [/\b(feasibility study|consultancy services|request for proposal|rfp|client|employer)\b/i, 3],
    ];
    return signals.reduce((score, [pattern, weight]) => score + (pattern.test(lower) ? weight : 0), 0);
  };

  const blocks = (pageBlocks.length ? pageBlocks : text.split(/\n{2,}/))
    .map((block, index) => ({ block, index, score: scoreBlock(block) }))
    .filter((item) => item.block.length > 40);
  const sorted = [...blocks].sort((a, b) => b.score - a.score || a.index - b.index);
  const selected = new Map<number, string>();

  for (const item of sorted) {
    if (item.score < 3 && selected.size > 20) continue;
    selected.set(item.index, item.block);
    if (Array.from(selected.values()).join("\n\n").length >= maxChars * 0.72) break;
  }

  const opening = text.slice(0, Math.min(18000, text.length));
  const priority = Array.from(selected.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([, block]) => block)
    .join("\n\n");
  const ending = text.slice(Math.max(0, text.length - 10000));

  return [
    "--- DOCUMENT OPENING / CLIENT / TITLE / SUBMISSION CONTEXT ---",
    opening,
    "--- PRIORITY STAFFING / TOR / REQUIREMENTS SECTIONS FROM LONG TENDER ---",
    priority,
    "--- DOCUMENT ENDING / ANNEX CONTEXT ---",
    ending,
  ].join("\n\n").slice(0, maxChars);
}

function prepareTenderPromptChunks(rawText: string) {
  const text = String(rawText || "");
  if (text.length <= 90000) return [text];

  const pageBlocks = text
    .split(/(?=---\s*PAGE\s+\d+\s*---)/i)
    .map((block) => block.trim())
    .filter((block) => block.length > 80);

  const scoreBlock = (block: string) => {
    const lower = block.toLowerCase();
    const signals: Array<[RegExp, number]> = [
      [/\b(key experts?|professional staff|experts required|required experts|staffing|personnel|team composition|consultant'?s team)\b/i, 28],
      [/\b(terms of reference|tor|scope of services|job description|role description)\b/i, 24],
      [/\b(job title|position|qualification|minimum education|experience|responsibilit(?:y|ies)|duties)\b/i, 16],
      [/\b(man[-\s]?month|person[-\s]?month|schedule of staff|staff schedule|input schedule)\b/i, 12],
      [/\b(evaluation criteria|technical proposal|special requirements?|eligibility|mandatory)\b/i, 8],
      [/\b(feasibility study|consultancy services|request for proposal|rfp|client|employer)\b/i, 4],
    ];
    return signals.reduce((score, [pattern, weight]) => score + (pattern.test(lower) ? weight : 0), 0);
  };

  const scored = (pageBlocks.length ? pageBlocks : text.split(/\n{2,}/))
    .map((block, index) => ({ block, index, score: scoreBlock(block) }))
    .filter((item) => item.block.length > 80);
  const priority = scored
    .filter((item) => item.score >= 12)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, 24)
    .sort((a, b) => a.index - b.index);

  const chunks: string[] = [];
  const opening = text.slice(0, Math.min(18000, text.length));
  if (opening.trim()) chunks.push(`--- DOCUMENT OPENING / CLIENT / TITLE / SUBMISSION CONTEXT ---\n${opening}`);

  let current = "";
  for (const item of priority) {
    const next = `${current}\n\n${item.block}`.trim();
    if (next.length > 45000 && current) {
      chunks.push(`--- PRIORITY STAFFING / TOR / REQUIREMENTS CHUNK ---\n${current}`);
      current = item.block;
    } else {
      current = next;
    }
  }
  if (current.trim()) chunks.push(`--- PRIORITY STAFFING / TOR / REQUIREMENTS CHUNK ---\n${current}`);

  const ending = text.slice(Math.max(0, text.length - 10000));
  if (ending.trim()) chunks.push(`--- DOCUMENT ENDING / ANNEX CONTEXT ---\n${ending}`);
  return chunks.slice(0, 6);
}

function mergeTenderExtractions(items: any[]) {
  const merged: any = {};
  const scalarFields = ["tender_format", "tender_title", "name", "client", "country", "tender_number", "deadline", "duration", "submission_type", "scope_summary"];
  const arrayFields = ["special_requirements", "global_team_constraints", "project_sector", "source_evidence"];
  const bestText = (current: any, next: any) => {
    const currentText = String(current || "").trim();
    const nextText = String(next || "").trim();
    if (!currentText) return nextText;
    if (!nextText) return currentText;
    return nextText.length > currentText.length ? nextText : currentText;
  };
  const mergeArray = (current: any, next: any) =>
    Array.from(new Set([...(Array.isArray(current) ? current : []), ...(Array.isArray(next) ? next : [])].filter(Boolean)));
  const positionsByTitle = new Map<string, any>();

  for (const item of items.filter(Boolean)) {
    for (const field of scalarFields) merged[field] = bestText(merged[field], item[field]);
    for (const field of arrayFields) merged[field] = mergeArray(merged[field], item[field]);
    for (const position of Array.isArray(item.positions) ? item.positions : []) {
      const title = String(position.position_title || position.title || "").trim();
      if (!title) continue;
      const key = title.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
      const current = positionsByTitle.get(key) || {};
      positionsByTitle.set(key, {
        ...current,
        ...position,
        position_title: current.position_title || title,
        quantity: current.quantity || position.quantity || 1,
        minimum_education: bestText(current.minimum_education, position.minimum_education),
        minimum_years_experience: current.minimum_years_experience || position.minimum_years_experience,
        general_experience: bestText(current.general_experience, position.general_experience),
        specific_experience: bestText(current.specific_experience, position.specific_experience),
        role_description: bestText(current.role_description, position.role_description || position.description),
        required_sector_experience: mergeArray(current.required_sector_experience, position.required_sector_experience),
        mandatory_skills: mergeArray(current.mandatory_skills, position.mandatory_skills),
        required_keywords: mergeArray(current.required_keywords, position.required_keywords),
        nationality_preference: bestText(current.nationality_preference, position.nationality_preference),
      });
    }
  }

  merged.positions = Array.from(positionsByTitle.values());
  return normalizeTenderRecord(sanitizeExtractedValues(merged));
}

function missingTenderRoleDetailCount(position: any) {
  const empty = (value: any) => !String(value || "").trim();
  return [
    empty(position.minimum_education),
    empty(position.role_description),
    empty(position.general_experience),
    empty(position.specific_experience),
  ].filter(Boolean).length;
}

function extractTenderRoleContext(rawText: string, title: string, positionNumber?: number) {
  const lines = String(rawText || "")
    .replace(/\r/g, "\n")
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
  const normalizedTitle = title.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const titleWords = normalizedTitle.split(/\s+/).filter((word) => word.length > 2);
  const numberedWindows: string[] = [];
  if (positionNumber) {
    const numberedIndexes = lines
      .map((line, index) => ({ line, index, normalized: line.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim() }))
      .filter(({ line, index }) => {
        if (!new RegExp(`^\\s*${positionNumber}\\.\\s+`, "i").test(line)) return false;
        const lineKey = line.toLowerCase().replace(/\bsignaling\b/g, "signalling").replace(/[^a-z0-9]+/g, " ");
        const rawWindow = lines.slice(index, Math.min(lines.length, index + 12)).join(" ");
        const window = rawWindow.toLowerCase().replace(/\bsignaling\b/g, "signalling").replace(/[^a-z0-9]+/g, " ");
        const hasRequirementMarkers = /\b(?:bachelor|master|postgraduate|degree|experience|professional registration|chartered|registered)\b/i.test(rawWindow);
        const lineHasTitleWord = titleWords.some((word) => lineKey.includes(word));
        const windowHasAllTitleWords = titleWords.every((word) => window.includes(word));
        return windowHasAllTitleWords || (lineHasTitleWord && hasRequirementMarkers);
      })
      .map(({ index }) => index);

    for (const index of numberedIndexes.slice(0, 3)) {
      const nextNumberPattern = new RegExp(`^\\s*${positionNumber + 1}\\.\\s+`, "i");
      const start = Math.max(0, index - 3);
      let end = Math.min(lines.length, index + 95);
      for (let i = index + 1; i < end; i++) {
        if (nextNumberPattern.test(lines[i])) {
          end = i;
          break;
        }
      }
      numberedWindows.push(lines.slice(start, end).join("\n"));
    }
  }

  const hitIndexes = lines
    .map((line, index) => ({ line, index, normalized: line.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim() }))
    .filter(({ normalized }) => normalized.includes(normalizedTitle) || titleWords.every((word) => normalized.includes(word)))
    .map(({ index }) => index);

  const windows: string[] = [];
  windows.push(...numberedWindows);
  for (const index of hitIndexes.slice(0, 5)) {
    const start = Math.max(0, index - 35);
    const end = Math.min(lines.length, index + 80);
    windows.push(lines.slice(start, end).join("\n"));
  }
  if (!windows.length) return "";
  return Array.from(new Set(windows)).join("\n\n--- NEXT MATCH CONTEXT ---\n\n").slice(0, 14000);
}

export async function runParseTenderText(text: string): Promise<any> {
  const promptTenderText = prepareTenderPromptText(text);
  const buildTenderPrompt = (tenderText: string, chunkNote = "") => `You are a 100% aggressive senior tender analyst and procurement extraction specialist.
  Your job is to READ, UNDERSTAND, CROSS-CHECK, and EXTRACT every tender requirement needed by this application. Do not behave like a keyword matcher. Treat the document as a real tender that may use any format, wording, table layout, annex style, or role naming convention.
  The user may provide multiple documents concatenated together for one tender. Read the provided text line by line, understand how the document is organized, and consolidate all extracted information into one complete tender object.
  ${chunkNote}

  ABSOLUTE EXTRACTION CONTRACT
  1. You must be aggressive about completeness: no real staff role, quantity, qualification, experience requirement, responsibility, special requirement, team constraint, client detail, scope detail, deadline, tender number, or project sector that appears in the source may be missed. EXTRACTION MUST BE EXHAUSTIVE AND HIGHLY DETAILED.
  2. READ INTELLIGENTLY LINE BY LINE: Tenders can be 200+ pages long with many irrelevant words. You must be smart enough to know what is necessary (roles, skills, deadlines, constraints) and what is not (boilerplates, standard contract clauses, filler text). Focus entirely on the concrete requirements.
  3. You must be conservative about facts: aggressive extraction means find and preserve every written fact; it never means inventing, assuming, or adding outside requirements. Do NOT summarize too much, retain the specific details, keywords, values, and nuanced conditions exactly as written.
  4. If a role field is empty, it must be because that exact type of information is genuinely absent from the provided text after checking the whole chunk/document context.
  4. Before final JSON, perform a silent completeness audit: re-check all text around every role title, table row, paragraph, annex, and requirement list to ensure each role has all available education, experience, role/duty, quantity, keyword, nationality, and sector requirements attached.
  5. If the same requirement is written in several places, merge the richest wording into the role or tender-level field. Do not duplicate the same role.

  WORKING METHOD
  6. First understand the tender as a whole: who is procuring, what service is required, what scope is being requested, what deliverables are expected, what team/personnel is required, and what requirements apply to each role or to the whole team.
  7. Identify real required staff/personnel roles by meaning, not by exact heading names. A real role is a person the bidder/consultant must provide, such as an engineer, expert, specialist, manager, advisor, coordinator, surveyor, inspector, economist, planner, or team leader.
  8. Do not treat proposal forms, evaluation criteria, submission forms, methodology sections, company experience sections, or consultant organization sections as roles. They may contain useful context, but they are not staff positions.
  9. When one part of the tender lists role names and another part gives details, merge them into one complete position. Never leave a role incomplete if its education, experience, responsibility, quantity, or nationality details appear elsewhere in the tender. Be extremely thorough to hunt down the missing details.
  10. For every real role, extract every available role requirement into: position_title, quantity, minimum_education, minimum_years_experience, general_experience, specific_experience, role_description, required_sector_experience, mandatory_skills, required_keywords, and nationality_preference. Include all conditions and specific nuances.
  11. Understand requirement language even when labels differ. Education may be called qualification, academic qualification, degree, credentials, or minimum requirements. Role description may be called duties, tasks, responsibilities, scope, functions, assignment, activities, expected services, or job description. Experience may be described in prose instead of labelled "general" or "specific".
  12. If the tender has experience text but does not explicitly divide it into general and specific experience, place broad career/years/professional requirements in general_experience and sector/project/task-specific requirements in specific_experience.
  13. Copy the tender's requirement wording as closely as possible after OCR cleanup. Do not rewrite, summarize, or invent requirements.
  14. Extract tender-level facts too: tender_title, tender_format, client, country, tender_number, deadline, duration, submission_type, scope_summary, project_sector, special_requirements, and global_team_constraints.
  15. Team-level requirements belong in global_team_constraints. Role-specific requirements belong inside that role.
  16. Missing data handling: if a value is genuinely not present anywhere in the tender text, output "" for string fields or [] for array fields. Do not output "N/A", "Not stated", "Unknown", "null", "None", or placeholders.
  17. Source-only rule: extract only what is written in the tender. Do not infer requirements from donor, country, sector, or your outside knowledge.
  18. Output only valid JSON matching the schema. Never include internal reasoning, commentary, "Wait", "I will", "Let me", or explanation text inside any field.
  
  EXTRACT ABSOLUTELY EVERYTHING. IF YOU THINK A DETAIL IS NOT IMPORTANT, EXTRACT IT ANYWAY. CAPTURE ALL REQUIREMENTS.

  Tender Text(s):
  ${tenderText}`;
  const prompt = buildTenderPrompt(promptTenderText);
  
  const parseTenderWithPrompt = async (promptText: string, models: string[]) => {
    const response = await callGenAIWithRetry((modelName) => getAI().models.generateContent({
    model: modelName,
    contents: [{ role: 'user', parts: [{ text: promptText }]}],
    config: {
      responseMimeType: "application/json",
      responseSchema: tenderSchema,
      temperature: 0.1,
    }
    }), models);

    const responseText = response.text || '{}';
    console.log("Raw Tender Response:", responseText);
    try {
      return sanitizeExtractedValues(parseGenAIJSON(responseText));
    } catch (e) {
      console.error("Failed to parse AI JSON for Tender:", e);
      return {};
    }
  };

  const buildRolesOnlyPrompt = (tenderText: string, chunkNote = "") => `You are Stage 1 of a tender extraction pipeline: REAL STAFF ROLE IDENTIFICATION ONLY.
  Read and understand the tender text. Extract ONLY actual personnel/staff/key expert roles that the bidder or consultant must provide.
  ${chunkNote}

  Rules:
  1. Include every real required role/personnel/staff/key expert title visible in the text.
  2. Reject proposal forms, instructions, contract clauses, appendices, evaluation criteria, company experience sections, consultant organization sections, signature blocks, code of conduct clauses, payment clauses, and generic references to "the Consultant" or "Expert".
  3. If quantity is visible, extract it. If not visible, use 1.
  4. Do not extract role details in this stage unless they are on the same line. Details are extracted in Stage 2.
  5. Return valid JSON matching the tender schema. positions[] should contain the real roles only.

  Tender Text:
  ${tenderText}`;

  const repairTenderRoleDetails = async (currentTender: any) => {
    const normalized = normalizeTenderRecord(currentTender || {});
    const incomplete = (normalized.positions || [])
      .filter((position: any) => missingTenderRoleDetailCount(position) > 0)
      .map((position: any) => ({
        position,
        missingCount: missingTenderRoleDetailCount(position),
        context: extractTenderRoleContext(text, position.position_title, Number(position.source_position_number || 0) || undefined),
      }))
      .filter((item: any) => item.context)
      .sort((a: any, b: any) => b.missingCount - a.missingCount);

    if (!incomplete.length) return normalized;

    const batchSize = 8;
    const repairPrompts: string[] = [];
    for (let start = 0; start < incomplete.length; start += batchSize) {
      const batch = incomplete.slice(start, start + batchSize);
      const repairPrompt = `You are repairing tender role details before the tender is shown to the user.
      Use ONLY the source context provided below. Do not invent anything, but BE EXTREMELY AGGRESSIVE AND EXHAUSTIVE in finding details in the text.
      For each listed position, extract and fill every available:
      - minimum_education
      - minimum_years_experience
      - general_experience
      - specific_experience
      - role_description
      - required_sector_experience
      - mandatory_skills
      - required_keywords
      - nationality_preference

      If the context contains broad years/professional experience, put it in general_experience.
      If the context contains sector/project/task-specific experience, put it in specific_experience.
      If the context contains duties/tasks/responsibilities/scope/functions, put it in role_description. Do not summarize, extract all the duties.
      If the context contains qualification/degree/education, put it in minimum_education. Include the full sentence describing the requirement.
      Preserve the tender wording as much as possible after OCR cleanup. Do not leave any field empty if there is even a remote mention of it in the text.
      Return valid JSON matching the tender schema with positions[] containing ONLY repaired versions of these listed positions.

      POSITIONS TO REPAIR:
      ${JSON.stringify(batch.map((item: any) => ({
        position_title: item.position.position_title,
        current: {
          minimum_education: item.position.minimum_education || "",
          minimum_years_experience: item.position.minimum_years_experience || "",
          general_experience: item.position.general_experience || "",
          specific_experience: item.position.specific_experience || "",
          role_description: item.position.role_description || "",
        },
      })), null, 2)}

      SOURCE CONTEXT BY POSITION:
      ${batch.map((item: any) => `--- POSITION: ${item.position.position_title} ---\n${item.context}`).join("\n\n")}`;
      repairPrompts.push(repairPrompt);
    }

    const repairedTenderPieces: any[] = [normalized];
    const repairResults = await Promise.allSettled(
      repairPrompts.map((repairPrompt) => parseTenderWithPrompt(repairPrompt, ["gemini-3.1-pro-preview", "gemini-3.5-flash"])),
    );
    repairResults.forEach((result) => {
      if (result.status === "fulfilled") repairedTenderPieces.push(result.value);
      else console.warn("[TENDER EXTRACTION] Role detail repair batch failed; continuing.", result.reason?.message || result.reason);
    });

    return postProcessTenderExtraction(mergeTenderExtractions(repairedTenderPieces), text);
  };

  const chunks = prepareTenderPromptChunks(text);
  let parsed: any;
  if (chunks.length > 1) {
    const longTenderModels = ["gemini-3.1-flash-lite", "gemini-3.1-pro-preview", "gemini-3.5-flash"];
    const roleOnlyResults = await Promise.allSettled(
      chunks.map((chunk, index) =>
        parseTenderWithPrompt(
          buildRolesOnlyPrompt(
            chunk,
            `This is role-identification chunk ${index + 1} of ${chunks.length}. Extract only real staff/personnel roles visible in this chunk.`,
          ),
          longTenderModels,
        ),
      ),
    );
    const chunkResults = await Promise.allSettled(
      chunks.map((chunk, index) =>
        parseTenderWithPrompt(
          buildTenderPrompt(
            chunk,
            `This is extraction chunk ${index + 1} of ${chunks.length}. Extract every tender fact visible in this chunk. Another pass will merge all chunks, so do not omit positions just because surrounding pages may exist elsewhere.`,
          ),
          longTenderModels,
        ),
      ),
    );
    const fulfilled = [...roleOnlyResults, ...chunkResults]
      .filter((result): result is PromiseFulfilledResult<any> => result.status === "fulfilled")
      .map((result) => result.value);
    parsed = fulfilled.length ? mergeTenderExtractions(fulfilled) : await parseTenderWithPrompt(prompt, longTenderModels);
  } else {
    const models = ["gemini-3.1-pro-preview", "gemini-3.1-flash-lite", "gemini-3.5-flash"];
    const [rolesOnly, fullExtraction] = await Promise.allSettled([
      parseTenderWithPrompt(buildRolesOnlyPrompt(promptTenderText), models),
      parseTenderWithPrompt(prompt, models),
    ]);
    const fulfilled = [rolesOnly, fullExtraction]
      .filter((result): result is PromiseFulfilledResult<any> => result.status === "fulfilled")
      .map((result) => result.value);
    parsed = fulfilled.length ? mergeTenderExtractions(fulfilled) : {};
  }
  let tender = postProcessTenderExtraction(parsed, text);
  let validation = validateExtractedTender(tender);
  logExtractionValidation("TENDER", tender.tender_title || tender.name || "Untitled tender", validation);

  if (!validation.valid) {
    const retryPrompt = `${prompt}

  TENDER EXTRACTION REPAIR PASS:
  The first extraction had these issues: ${validation.issues.join("; ")}.
  Re-read every tender line as a 100% aggressive tender analyst. For every empty or weak role field, search the whole provided text and nearby context for wording that belongs to that role: education/qualification, professional years, sector/project-specific experience, duties/tasks/responsibilities, quantity, nationality, required skills, and keywords. Repair missing positions, role descriptions, education requirements, general experience, specific experience, scope, and explicit constraints that are present in the source. Use meaning and document context, not heading names only. Do not invent anything. Missing source data must remain empty string or empty array.
  
  BE EXTREMELY AGGRESSIVE. EXTRACT EVERY DETAIL POSSIBLE, EVEN IF IT FEELS OVERWHELMING. DO NOT SUMMARIZE. DO NOT LEAVE ANY VALID REQUIREMENT UNEXTRACTED.`;
    try {
      const retryParsed = await parseTenderWithPrompt(retryPrompt, ["gemini-3.1-pro-preview"]);
      const retryTender = postProcessTenderExtraction(retryParsed, text);
      const retryValidation = validateExtractedTender(retryTender);
      logExtractionValidation("TENDER", retryTender.tender_title || retryTender.name || "Retried tender", retryValidation);
      if (retryValidation.issues.length <= validation.issues.length) {
        tender = retryTender;
        validation = retryValidation;
      }
    } catch (error: any) {
      console.warn("[TENDER EXTRACTION] Repair retry failed; keeping first extraction.", error?.message || error);
    }
  }

  tender = await repairTenderRoleDetails(tender);
  validation = validateExtractedTender(tender);
  logExtractionValidation("TENDER", tender.tender_title || tender.name || "Role-detail repaired tender", validation);
  tender.extraction_audit = {
    ...(tender.extraction_audit || {}),
    pipeline: "roles-only + full extraction + role-detail repair + cleanup",
    stage1RolesOnly: true,
    stage2RoleDetailRepair: true,
    stage3Validation: true,
    stage4FinalCleanup: true,
    finalPositionCount: Array.isArray(tender.positions) ? tender.positions.length : 0,
    finalValidationIssues: validation.issues,
  };

  return sanitizeExtractedValues(tender);
}

// Calculate cosine similarity between two vectors
function cosineSimilarity(A: number[], B: number[]) {
  let dotproduct = 0;
  let mA = 0;
  let mB = 0;
  for(let i = 0; i < A.length; i++){
      dotproduct += (A[i] * B[i]);
      mA += (A[i]*A[i]);
      mB += (B[i]*B[i]);
  }
  mA = Math.sqrt(mA);
  mB = Math.sqrt(mB);
  if (mA === 0 || mB === 0) return 0;
  return (dotproduct)/((mA)*(mB));
}

// Generate vector embedding
export async function generateEmbedding(text: string): Promise<number[]> {
  try {
    const ai = getAI();
    const result = await callGenAIWithRetry((modelName) => ai.models.embedContent({
      model: modelName,
      contents: text
    }), ['gemini-embedding-2-preview']);
    return result.embeddings?.[0]?.values || [];
  } catch (err) {
    console.error("Embedding Error", err);
    return new Array(768).fill(0); // fallback
  }
}

export async function runVectorMatchEngine(tender: any, positionId: string, experts: any[]): Promise<any[]> {
  tender = normalizeTenderRecord(tender || {});
  // Step 1: Find target position
  const position = tender.positions.find((p:any) => p.id?.toString() === positionId || p.position_title === positionId);
  if (!position) throw new Error("Position not found");

  // Provide a naive text overlap score for initial ranking since we don't have a real vector DB populated
  // We will score based on matching keywords from the position title and requirements against the expert's text.
  const reqLower = [
    position.position_title,
    position.minimum_education,
    position.general_experience,
    position.specific_experience,
    position.role_description,
    ...(position.required_sector_experience || []),
    ...(position.mandatory_skills || []),
    ...(position.required_keywords || []),
  ].join(" ").toLowerCase();
  const reqWords = Array.from(new Set(reqLower.match(/\b\w{4,}\b/g) || []));

  const scoredExperts = experts.map((e: any) => {
    const expertText = JSON.stringify({
      p: e.primary_position,
      s: e.skills,
      r: e.experiences,
      a: e.adequacy_experience || e.metadata?.adequacy,
      c: e.metadata?.certifications,
      sw: e.software,
      t: e.training_courses || e.training,
      m: e.professionalMembership,
      h: e.profileSummary,
    }).toLowerCase();
    
    let matchCount = 0;
    for (const w of reqWords) {
      if (expertText.includes(w)) matchCount++;
    }
    
    // Add heavy weight if primary position aligns
    const posLower = (e.primary_position || "").toLowerCase();
    const targetPosLower = (position.position_title || "").toLowerCase();
    let posMatchBonus = 0;
    if (posLower.includes(targetPosLower) || targetPosLower.includes(posLower)) {
      posMatchBonus = reqWords.length; // acts as a huge boost
    }

    return { expert: e, score: matchCount + posMatchBonus };
  });

  scoredExperts.sort((a,b) => b.score - a.score);
  
  // Since we have a massive context window with Gemini, we send up to 40 candidates directly to the MM for deep reasoning.
  const candidatesToEvaluate = scoredExperts.slice(0, 40).map(s => s.expert);

  // Step 2: Call Gemini
  const prompt = `Score these candidates for the position: ${position.position_title}.
  CRITICAL: The Phase 1 primary position filter has already run. You are Stage 2.
  Use these exact weights and criteria to rank candidates correctly:
  1. Similar project experience (30%): Deep evaluation of projects that are similar to the tendered one. If the candidate's list of projects is not similar to the tendered one, they must attract a very limited score.
  2. Location compatibility (25%): Location preferences or experience in similar locations.
  3. Years of experience (20%): Including overall experience and experience in specific domains.
  4. Language proficiencies (15%): Matching required languages perfectly.
  5. Education level (10%): MANDATORY THRESHOLD: If the education title does not match the requirement, the candidate MUST NOT be considered (score 0 or heavily penalize).
  
  ADDITIONAL QUALITATIVE FACTORS:
  - In-house Preference: In-house employees/managers strongly preferred over third parties, especially for high-level roles (team leaders, project managers) to show connection to the company.
  - Certificates: If specific certificates, skills, or attestations are required, it is a MUST to propose candidates meeting them.
  
  RISK LEVEL ASSIGNMENT:
  - LOW: Score >= 80%. Candidate meets or exceeds almost all core requirements. No mandatory threshold failures.
  - MEDIUM: Score between 60% and 79%. Candidate meets basic requirements but has notable gaps (e.g., slightly lower experience years, missing non-critical certs).
  - HIGH: Score < 60%. Candidate misses critical mandatory requirements (e.g., completely lacks required language, insufficient baseline experience years, major mismatch in project relevance).

  If the candidate explicitly meets any of the "Global Team Constraints", list those exact constraint strings in the "met_team_constraints" array.

  RELATIVE COMPARISON & DIFFERENTIATION (CRITICAL):
  - Do NOT give multiple candidates identical top scores (e.g., multiple 100%) if one is objectively better.
  - If multiple candidates meet ALL minimum criteria, you MUST differentiate them using factors like extra years of experience (e.g., 15 vs 11 years), prestige/relevance of employers, or number of highly relevant projects.
  - The absolute best candidate should receive highest score (e.g., 100%), and others should be deducted (e.g., 95%, 90%).
  - You MUST explicitly explain these comparative deductions in the \`scoring_rationale\` field (e.g., "Meets all criteria, but scored 95% because candidate X has 15 years experience compared to this candidate's 11 years").

  Tender: ${tender.tender_title}
  Global Team Constraints: ${JSON.stringify(tender.global_team_constraints || [])}
  Requirements: ${JSON.stringify(position)}
  Candidates to Evaluate: ${JSON.stringify(candidatesToEvaluate.map(e => ({ 
    id: e.id, 
    name: e.name || e.fullName, 
    primary_position: e.primary_position, 
    experience: e.experienceYears || e.experience, 
    location: e.location, 
    nationality: e.countryOfCitizenship || e.nationality,
    education: e.educationLevel || e.education,
    languages: e.languages,
    skills: e.skills, 
    projects: e.experiences || e.projects,
    certifications: e.metadata?.certifications || [],
    adequacy_experience: e.adequacy_experience || e.metadata?.adequacy || [],
    software: e.software || [],
    training: e.training_courses || e.training || [],
    professionalMembership: e.professionalMembership || [],
    awards: e.metadata?.awards || [],
    publications: e.metadata?.publications || [],
  }))) }

  For each candidate in the "Candidates to Evaluate" list, you MUST output an evaluation and a score out of 100. Do NOT omit any candidate, even if their score is 0.
  Return a JSON object containing a "matches" array mapping each candidate to their scores and details.`;

  try {
    const response = await callGenAIWithRetry((modelName) => getAI().models.generateContent({
      model: modelName,
      contents: [
        { role: 'user', parts: [{ text: prompt }]}
      ],
      config: {
        responseMimeType: "application/json",
        responseSchema: matchSchema,
        temperature: 0.1,
      }
    }));

    let parsed = { matches: [] };
    const responseText = response.text || '{}';
    try {
      parsed = parseGenAIJSON(responseText);
      if (parsed.matches && Array.isArray(parsed.matches)) {
        parsed.matches.forEach((m: any) => {
          if (m.score >= 85) {
            m.risk_level = "LOW";
          } else if (m.score >= 50) {
            m.risk_level = "MEDIUM";
          } else {
            m.risk_level = "HIGH";
          }
        });
      }
    } catch (e) {
      console.error("Failed to parse AI JSON for matches:", e);
    }
    return (parsed.matches || []).sort((a: any, b: any) => b.score - a.score);
  } catch (error) {
    console.error("Gemini Match Error:", error);
    throw error;
  }
}

export async function runRenderCV(expert: any, tender: any, positionTitle: string): Promise<any> {
  const position = tender.positions?.find((p: any) => p.id?.toString() === positionTitle || p.position_title === positionTitle) || {};
  
  const prompt = `You are a strict CV Rendering engine for international tenders.
  Your task is to analyze the Tender and the Expert's CV, then fully render/rewrite the CV so it becomes a 100% fit for the tender role. This is the aggressive tender-fit mode and is used rarely.
  
  CRITICAL RULES:
  1. You MAY increase years of experience or experience duration to satisfy the tender minimum if needed, by expanding/adjusting existing career periods intelligently.
  2. You MAY strengthen education wording to match the tender, including changing Diploma wording to Degree wording where the tender requires it.
  3. You MAY add one, two, or more responsibility/job-description lines into existing relevant roles to satisfy the tender's role requirements.
  4. You MAY inject missing technical requirements, software, sector language, methods, deliverables, and duties into existing matching roles where plausible.
  5. You MUST NOT invent a completely new employer, completely new job, false nationality, false origin, false identity, or unrelated career path.
  6. You MUST preserve the person's identity and career skeleton: same expert, same general employer sequence, same broad profession.
  7. DIFFERENTIATION BETWEEN EMPLOYMENT RECORD AND ADEQUACY: Preserve the exact separation between 'experiences' (chronological jobs) and 'adequacy_experience' (specific key project assignments). Do NOT mix them. Adequacy is strictly for key specific projects.
  8. Keep the EXACT identical JSON structure as the input Expert data. Return ONLY valid JSON representing the fully rendered 100% matching expert profile.

  Expert Data: ${JSON.stringify(expert)}
  Tender Name: ${tender.name || tender.tender_title}
  Tender Target Position: ${positionTitle}
  Position Requirements: ${JSON.stringify(position)}
  `;

  try {
    const ai = getAI();
    const response = await ai.models.generateContent({
      model: "gemini-3.1-pro-preview",
      contents: prompt,
      config: {
        responseMimeType: "application/json"
      }
    });

    const output = response.text || "{}";
    let parsed = { ...expert };
    try {
      parsed = JSON.parse(output);
    } catch (e) {
      console.error("Parse JSON error in render", e);
    }
    return { ...expert, ...parsed }; // Merge to preserve base fields like id, name if AI omits
  } catch (error) {
    console.error("Render CV Error:", error);
    throw error;
  }
}

export async function runAdaptCV(expert: any, tender: any, positionTitle: string): Promise<any> {
  const position = tender.positions?.find((p: any) => p.id?.toString() === positionTitle || p.position_title === positionTitle) || {};
  
  const prompt = `You are an elite CV Adaptation engine.
  Your task is to adapt the existing Expert's CV to the specific Tender. 
  The candidate is already highly qualified for this role, so DO NOT hallucinate, invent out of thin air, or fake any years of experience, past jobs, or degrees. Adapt CV is tender-wording improvement mode, not fact-changing mode.
  
  CRITICAL RULES:
  1. TERMINOLOGY ALIGNMENT: Rewrite, rephrase, and align the terminologies, keywords, and phrasing in the CV to exactly match the specific vocabulary and terminologies requested in the Tender. 
  2. METICULOUS REPHRASING: If the tender asks for "Capacity Building" and the CV says "Training", change it to "Capacity Building".
  3. NO FACTUAL HALLUCINATIONS: Do not alter actual years of experience, duration of jobs, job dates, employers, clients, countries, degrees, institutions, certifications, nationality, date of birth, or contact details.
  4. You MAY improve grammar, typography, sentence structure, profile summary, employment descriptions, adequacy descriptions, bullets, and relevance ordering.
  5. You MAY make wording 100% suitable for the tender only where the underlying fact already exists or is reasonably supported by the CV.
  6. DIFFERENTIATION BETWEEN EMPLOYMENT RECORD AND ADEQUACY: Preserve the exact separation between 'experiences' (chronological jobs) and 'adequacy_experience' (specific key project assignments). Do NOT mix them. Adequacy is strictly for key specific projects.
  7. Keep the EXACT identical JSON structure as the input Expert data. Return ONLY valid JSON representing the adapted expert profile.

  Expert Data: ${JSON.stringify(expert)}
  Tender Name: ${tender.name || tender.tender_title}
  Tender Target Position: ${positionTitle}
  Position Requirements: ${JSON.stringify(position)}
  `;

  try {
    const ai = getAI();
    const response = await ai.models.generateContent({
      model: "gemini-3.1-pro-preview",
      contents: prompt,
      config: {
        responseMimeType: "application/json"
      }
    });

    const output = response.text || "{}";
    let parsed = { ...expert };
    try {
      parsed = JSON.parse(output);
    } catch (e) {
      console.error("Parse JSON error in adapt", e);
    }
    return { ...expert, ...parsed }; // Merge to preserve base fields like id, name if AI omits
  } catch (error) {
    console.error("Adapt CV Error:", error);
    throw error;
  }
}

export async function runOptimizeCV(expert: any, tender: any, positionTitle: string, isAccepted: boolean = false): Promise<any> {
  const position = tender.positions?.find((p: any) => p.position_title === positionTitle) || {};
  
  const prompt = isAccepted ? `You are the world's most elite and aggressive CV tailoring master for high-stakes international tenders (World Bank, EU, ADB, FIDIC). 
  Your singular objective is to optimize the Expert's profile to look like the unquestionable, 100% perfect match for the specific Tender Position. Since this applicant has been SELECTED for the role, you must make their CV extremely compelling, exceptionally structured, aggressively targeted, and unmistakably aligned with the tender specification. NO DETAILS IGNORED.

  Expert Original Data: ${JSON.stringify(expert)}
  Tender Name: ${tender.tender_title}
  Tender Scope: ${tender.scope_summary}
  Target Position: ${positionTitle}
  Position Requirements: ${JSON.stringify(position)}

  CRITICAL INSTRUCTIONS (HYPER-AGGRESSIVE OPTIMIZATION):
  1. IRRESISTIBLE PROFESSIONAL SUMMARY (8-12 LINES): Rewrite the "profileSummary" using powerful psychological framing. It must bridge every single aspect of the expert's experience directly to the tender's exact objectives. Explicitly mention specific sectors, required skills, and the exact minimum years of experience to prove undeniable compliance. Do NOT output bullet points here.
  2. SURGICAL AUGMENTATION & MIRRORING: 
     - Mirror the Tender's exact vocabulary. If the tender demands "FIDIC Yellow Book", "Urban Mobility", or specific keywords, surgically weave these exact terms into the expert's "skills", "projects", and "employment_history".
     - Overwrite "primary_position" to be identical to the tender's requested title.
     - Refine and rewrite every single project and experience description to heavily spotlight tasks, metrics, and outcomes that replicate the current tender's scope.
  3. 100% ALIGNMENT & DEEP SMART EXPANSION: Intelligently deep-expand the experience descriptions based on elite industry standards. Fill in any implicit gaps with highly plausible, professional methodologies to make them the incontestable best fit for the job.
  4. EXHAUSTIVE ADEQUACY MAPPING: You MUST map their absolute best past projects into the "adequacy" or "adequacy_experience" array. For each mapped project, describe exactly and aggressively how it proves they will execute the current Tender's specific deliverables flawlessly.
  5. NO FACTUAL HALLUCINATION (BUT MAXIMAL IMPACT): Do not invent fake degrees or fake companies. However, you MUST forcefully expand their tasks, responsibilities, and phrasing to sound incredibly authoritative, highly senior, and perfectly aligned with the target position.
  6. REVERSE CHRONOLOGICAL ORDER & EXACT JOB INTEGRITY: You MUST arrange all 'experiences' and 'adequacy' arrays in STANDARD REVERSE CHRONOLOGICAL ORDER (most recent first). DO NOT aggressively break or "split" table entries or jobs.

  Return the complete, significantly expanded, meticulously tailored, and updated expert JSON object following the standard schema.` 
  : `You are an elite, highly intelligent CV formatter and editor.
  Your goal is to format and improve the Expert's CV to make it professional, standard, and highly readable, while maintaining their exact original experience. Since they are NOT YET selected for a specific role, you are just improving the presentation.

  Expert Original Data: ${JSON.stringify(expert)}
  
  CRITICAL INSTRUCTIONS (UNSELECTED CV):
  1. PROFESSIONAL POLISH: Rewrite the "profileSummary" to be intensely clear, professional, well-structured, 7-10 lines long. No bullet points.
  2. STRICT ADHERENCE: Do NOT make up experience or tailor the CV heavily to a specific tender. Formulate their existing projects and skills to precisely follow our standard high-quality schema without leaving out any facts. Ensure all dates, skills, and descriptions are completely preserved and highlighted.
  3. FIX GRAMMAR & CLARITY: Correct typos, expand acronyms where obvious, and ensure bullet points in their experiences are highly action-oriented and impactful.
  4. REVERSE CHRONOLOGICAL ORDER & EXACT JOB INTEGRITY: You MUST arrange all 'experiences' and 'adequacy' arrays in STANDARD REVERSE CHRONOLOGICAL ORDER (most recent first). DO NOT aggressively break or "split" table entries or jobs.
  
  Return the complete, impeccably formatted expert JSON object following the standard schema.`;

  try {
    const response = await callGenAIWithRetry((modelName) => getAI().models.generateContent({
      model: modelName,
      contents: [{ role: 'user', parts: [{ text: prompt }]}],
      config: {
        responseMimeType: "application/json",
        responseSchema: cvSchema.properties!.experts.items,
        temperature: 0.3,
      }
    }));

    const responseText = response.text || '{}';
    const optimizedExpert = parseGenAIJSON(responseText);

    // Maintain stable ID
    return { ...optimizedExpert, id: expert.id };
  } catch (error) {
    console.error("CV Optimization Error:", error);
    return expert; // Fallback to original
  }
}
