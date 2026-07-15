import { GoogleGenAI, Type, Schema, createPartFromUri, PartMediaResolutionLevel, FileState } from '@google/genai';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PDFDocument } from 'pdf-lib';
import { PDFParse } from 'pdf-parse';
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
    deadline: { type: Type.STRING, description: "Exact submission deadline including date, time, and timezone when stated" },
    submission_type: { type: Type.STRING },
    project_sector: { type: Type.ARRAY, items: { type: Type.STRING } },
    scope_summary: { type: Type.STRING },
    objectives: { type: Type.ARRAY, items: { type: Type.STRING } },
    deliverables: { type: Type.ARRAY, items: { type: Type.STRING } },
    eligibility_requirements: { type: Type.ARRAY, items: { type: Type.STRING } },
    evaluation_criteria: { type: Type.ARRAY, items: { type: Type.STRING } },
    duration: { type: Type.STRING },
    special_requirements: { type: Type.ARRAY, items: { type: Type.STRING } },
    global_team_constraints: { type: Type.ARRAY, items: { type: Type.STRING }, description: "Global constraints applying to the entire team (e.g. 'Requires at least 1 resident citizen', 'Requires 1 certified safety officer')" },
    tender_field_evidence: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          field: { type: Type.STRING },
          page_number: { type: Type.INTEGER },
          quote: { type: Type.STRING },
        },
      },
    },
    page_classifications: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          page_number: { type: Type.INTEGER },
          categories: { type: Type.ARRAY, items: { type: Type.STRING } },
          summary: { type: Type.STRING },
          readability: { type: Type.STRING, enum: ["CLEAR", "PARTIAL", "UNREADABLE"] },
          has_staff_requirements: { type: Type.BOOLEAN },
          confidence: { type: Type.NUMBER },
          warnings: { type: Type.ARRAY, items: { type: Type.STRING } },
        },
      },
    },
    positions: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          position_title: { type: Type.STRING, description: "Clean occupational role name only, such as Resident Engineer. Exclude K-1, row numbers, quantities, lot codes, and section labels." },
          quantity: { type: Type.INTEGER },
          source_position_number: { type: Type.INTEGER, description: "Hidden numeric row/reference code from labels such as K-1 or Position 1; never include this code in position_title." },
          source_document: { type: Type.STRING },
          lot_reference: { type: Type.STRING },
          expert_category: { type: Type.STRING, description: "Key expert, non-key expert, support staff, or other explicit category" },
          is_key_expert: { type: Type.BOOLEAN },
          input_months: { type: Type.NUMBER },
          work_location: { type: Type.STRING },
          minimum_education: { type: Type.STRING, description: "Extract entire education requirement verbatim" },
          minimum_years_experience: { type: Type.INTEGER },
          minimum_specific_years: { type: Type.INTEGER },
          minimum_similar_projects: { type: Type.INTEGER },
          general_experience: { type: Type.STRING, description: "Extract the exact verbatim general experience requirement for the position" },
          specific_experience: { type: Type.STRING, description: "Extract the exact verbatim specific experience requirement for the position" },
          role_description: { type: Type.STRING, description: "Extract the exact verbatim role or tasks or responsibilities description" },
          role_duties_status: { type: Type.STRING, description: "One of: explicit, tor_scope, not_stated, needs_review. explicit = duties stated under the role; tor_scope = duties only derive from general TOR scope; not_stated = searched but no duties found; needs_review = possible duties exist but extractor could not confidently map them." },
          required_sector_experience: { type: Type.ARRAY, description: "Explicit sector/domain experience required for this role, e.g. railway, roads, bridges, urban transport, water, power, buildings. Do not include generic duties or software.", items: { type: Type.STRING } },
          mandatory_skills: { type: Type.ARRAY, description: "Explicit non-software competencies or technical capabilities required for this role, e.g. project management, contract administration, safeguards, modelling, supervision, stakeholder engagement. Do not include degrees, years, languages, or software names.", items: { type: Type.STRING } },
          required_software: { type: Type.ARRAY, description: "Explicit software/tools/platforms required for this role only, e.g. AutoCAD, Civil 3D, Primavera, MS Project, GIS, BIM tools. Do not include general technical skills.", items: { type: Type.STRING } },
          required_certifications: { type: Type.ARRAY, description: "Explicit certifications, licences, permits, chartership requirements, or regulatory registrations required for this role. Do not include academic degrees unless the tender presents them as professional certification.", items: { type: Type.STRING } },
          professional_memberships: { type: Type.ARRAY, description: "Explicit membership in professional bodies or institutions required or preferred for this role, e.g. Institution of Engineers, professional board membership. Do not duplicate certifications unless stated as membership.", items: { type: Type.STRING } },
          required_languages: { type: Type.ARRAY, description: "Explicit language requirements for this role, including proficiency if stated. Do not infer language from country or tender language.", items: { type: Type.STRING } },
          regional_experience: { type: Type.STRING, description: "Explicit requirement for experience in a region/multi-country area, e.g. East Africa, Sub-Saharan Africa, GCC, EU. Do not put single-country requirements here." },
          country_experience: { type: Type.STRING, description: "Explicit requirement for experience in a named country, e.g. Kenya experience, Uganda experience. Do not infer from project location unless stated as a requirement." },
          required_keywords: { type: Type.ARRAY, description: "Short search/matching keywords explicitly present in the role requirements. Use only source-grounded terms; do not create broad synonyms or generic filler.", items: { type: Type.STRING } },
          nationality_preference: { type: Type.STRING, description: "Explicit nationality or citizenship requirement/preference only. Leave empty for open eligibility or 'all countries'; never default to Any." },
          residency_requirement: { type: Type.STRING, description: "Explicit residence, local presence, local registration, or local availability requirement. Do not use for nationality." },
          position_deliverables: { type: Type.ARRAY, description: "Deliverables/outputs explicitly assigned to this role. General project deliverables belong in tender-level deliverables unless clearly tied to this position.", items: { type: Type.STRING } },
          evaluation_points: { type: Type.NUMBER, description: "Numeric technical evaluation points assigned to this role or requirement. Do not confuse with quantity, years, input months, or page numbers." },
          source_page_numbers: { type: Type.ARRAY, items: { type: Type.INTEGER }, description: "Every PDF page supporting this position or its requirements" },
          source_quotes: { type: Type.ARRAY, items: { type: Type.STRING }, description: "Short exact source excerpts proving the title and requirements" },
          field_evidence: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                field: { type: Type.STRING },
                page_number: { type: Type.INTEGER },
                quote: { type: Type.STRING },
              },
            },
          }
        }
      }
    }
  }
};

const tenderTableContextSchema: Schema = {
  type: Type.OBJECT,
  properties: {
    tables: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          table_title: { type: Type.STRING },
          header_page: { type: Type.INTEGER },
          first_data_page: { type: Type.INTEGER },
          last_data_page: { type: Type.INTEGER },
          columns: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                header: { type: Type.STRING },
                meaning: { type: Type.STRING },
              },
            },
          },
          continues_after_chunk: { type: Type.BOOLEAN },
        },
      },
    },
  },
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
  if (!String(tender?.deadline || "").trim()) issues.push("deadline is empty or not found");
  if (!String(tender?.scope_summary || "").trim()) issues.push("scope_summary is empty");
  if (!Array.isArray(tender?.deliverables) || tender.deliverables.length === 0) issues.push("No deliverables extracted");
  const tenderEvidenceFields = new Set((Array.isArray(tender?.tender_field_evidence) ? tender.tender_field_evidence : []).map((item: any) => String(item?.field || "").trim().toLowerCase()));
  ["tender_title", "client", "deadline", "scope_summary", "duration"].forEach((field) => {
    const value = field === "tender_title" ? tender?.tender_title || tender?.name : tender?.[field];
    if (String(value || "").trim() && !tenderEvidenceFields.has(field)) issues.push(`No tender field evidence for ${field}`);
  });
  if (!Array.isArray(tender?.positions) || tender.positions.length === 0) issues.push("Zero positions extracted");
  tender?.positions?.forEach((position: any, index: number) => {
    if (!String(position?.position_title || "").trim()) issues.push(`Position ${index + 1}: missing title`);
    if (!String(position?.general_experience || "").trim() && !String(position?.specific_experience || "").trim()) {
      issues.push(`Position ${index + 1} "${position?.position_title || "Untitled"}": no experience requirements`);
    }
    if (!String(position?.role_description || "").trim()) {
      issues.push(`Position ${index + 1} "${position?.position_title || "Untitled"}": no role_description`);
    }
    if (!String(position?.minimum_education || "").trim()) {
      issues.push(`Position ${index + 1} "${position?.position_title || "Untitled"}": no education requirement`);
    }
    if (!Array.isArray(position?.source_page_numbers) || position.source_page_numbers.length === 0) {
      issues.push(`Position ${index + 1} "${position?.position_title || "Untitled"}": no source page evidence`);
    }
    const evidenceFields = new Set((Array.isArray(position?.field_evidence) ? position.field_evidence : []).map((item: any) => String(item?.field || "").trim().toLowerCase()));
    const populatedFields = ["position_title", "quantity", "minimum_education", "general_experience", "specific_experience", "role_description"]
      .filter((field) => position?.[field] !== undefined && position?.[field] !== null && String(position[field]).trim());
    populatedFields.forEach((field) => {
      if (!evidenceFields.has(field)) issues.push(`Position ${index + 1} "${position?.position_title || "Untitled"}": no field evidence for ${field}`);
    });
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
  return match ? Number(match[1]) : undefined;
}

function tenderPositionIdentityKey(position: any, normalizedTitle?: string) {
  const title = (normalizedTitle || normalizePositionTitle(position?.position_title || position?.title || position?.role || ""))
    .toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const lot = String(position?.lot_reference || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const document = String(position?.source_document || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const sourceNumber = Number(position?.source_position_number || 0) || "";
  const category = String(position?.expert_category || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const location = String(position?.work_location || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  return sourceNumber ? `${document}|${lot}|number:${sourceNumber}|${title}` : `${document}|${lot}|title:${title}|${category}|${location}`;
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
  const strictestText = (current: any, next: any) => {
    const currentText = cleanTenderLine(current);
    const nextText = cleanTenderLine(next);
    if (!currentText) return nextText;
    if (!nextText) return currentText;
    const maxYears = (value: string) => Math.max(0, ...(value.match(/\b\d{1,2}\s*years?\b/gi) || []).map((match) => Number(match.match(/\d+/)?.[0] || 0)));
    const currentYears = maxYears(currentText);
    const nextYears = maxYears(nextText);
    if (currentYears !== nextYears && currentYears > 0 && nextYears > 0) return nextYears > currentYears ? nextText : currentText;
    return bestText(currentText, nextText);
  };
  const bestArray = (current: any, next: any) =>
    Array.from(new Set([...(Array.isArray(current) ? current : []), ...(Array.isArray(next) ? next : [])].filter(Boolean)));

  const sourcePositions = hasAuthoritativeRoleTable ? [...recovered, ...existing] : [...existing, ...recovered];
  sourcePositions.forEach((position) => {
    const title = normalizePositionTitle(position.position_title || position.title || position.role || "");
    if (!title) return;
    const key = tenderPositionIdentityKey(position, title);
    if (hasAuthoritativeRoleTable && !recovered.some((item: any) => normalizePositionTitle(item.position_title || "").toLowerCase() === title.toLowerCase())) {
      if (!isLikelyStaffRoleTitle(title)) return;
    }
    const current = byTitle.get(key) || {};
    byTitle.set(key, {
      ...position,
      ...current,
      position_title: current.position_title || title,
      quantity: current.quantity || position.quantity || undefined,
      source_position_number: current.source_position_number || position.source_position_number,
      source_document: bestText(current.source_document, position.source_document),
      lot_reference: bestText(current.lot_reference, position.lot_reference),
      expert_category: bestText(current.expert_category, position.expert_category),
      work_location: bestText(current.work_location, position.work_location),
      minimum_education: bestText(current.minimum_education, position.minimum_education),
      minimum_years_experience: Math.max(Number(current.minimum_years_experience || 0), Number(position.minimum_years_experience || 0)) || undefined,
      general_experience: strictestText(current.general_experience, position.general_experience),
      specific_experience: strictestText(current.specific_experience, position.specific_experience),
      role_description: bestText(current.role_description, position.role_description || position.description),
      required_sector_experience: bestArray(current.required_sector_experience, position.required_sector_experience),
      mandatory_skills: bestArray(current.mandatory_skills, position.mandatory_skills),
      required_keywords: bestArray(current.required_keywords, position.required_keywords),
      nationality_preference: bestText(current.nationality_preference, position.nationality_preference),
      source_page_numbers: bestArray(current.source_page_numbers, position.source_page_numbers),
      source_quotes: bestArray(current.source_quotes, position.source_quotes),
      field_evidence: bestArray(current.field_evidence, position.field_evidence),
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
  return [
    "--- LONG TENDER OVERVIEW SAMPLE; THE COMPLETE DOCUMENT IS PROCESSED IN PAGE CHUNKS ---",
    text.slice(0, 55000),
    "--- DOCUMENT ENDING ---",
    text.slice(-30000),
  ].join("\n\n");
}

function prepareTenderPromptChunks(rawText: string) {
  const text = String(rawText || "");
  if (text.length <= 60000) return [text];

  let pageBlocks = text
    .split(/(?=---\s*PAGE\s+\d+\s*---)/i)
    .map((block) => block.trim())
    .filter(Boolean);
  if (pageBlocks.length < 2) pageBlocks = text.match(/[\s\S]{1,50000}/g) || [text];

  const chunks: string[] = [];
  let current = "";
  let previousPage = "";
  for (const pageBlock of pageBlocks) {
    const pieces = pageBlock.length > 56000 ? pageBlock.match(/[\s\S]{1,52000}/g) || [pageBlock] : [pageBlock];
    for (const piece of pieces) {
      const next = `${current}\n\n${piece}`.trim();
      if (next.length > 58000 && current) {
        chunks.push(`--- COMPLETE TENDER PAGE CHUNK ---\n${current}`);
        current = previousPage ? `${previousPage}\n\n${piece}` : piece;
      } else {
        current = next;
      }
      previousPage = piece.slice(-8000);
    }
  }
  if (current.trim()) chunks.push(`--- COMPLETE TENDER PAGE CHUNK ---\n${current}`);
  return chunks;
}

async function mapWithConcurrency<T, R>(items: T[], concurrency: number, mapper: (item: T, index: number) => Promise<R>) {
  const results: PromiseSettledResult<R>[] = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(Math.max(1, concurrency), items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      try {
        results[index] = { status: "fulfilled", value: await mapper(items[index], index) };
      } catch (reason) {
        results[index] = { status: "rejected", reason };
      }
    }
  });
  await Promise.all(workers);
  return results;
}

export function mergeTenderExtractions(items: any[]) {
  const merged: any = {};
  const scalarFields = ["tender_format", "tender_title", "name", "client", "country", "tender_number", "deadline", "duration", "submission_type", "scope_summary"];
  const arrayFields = ["special_requirements", "global_team_constraints", "project_sector", "objectives", "deliverables", "eligibility_requirements", "evaluation_criteria", "source_evidence", "tender_field_evidence"];
  const bestText = (current: any, next: any) => {
    const currentText = String(current || "").trim();
    const nextText = String(next || "").trim();
    if (!currentText) return nextText;
    if (!nextText) return currentText;
    return nextText.length > currentText.length ? nextText : currentText;
  };
  const strictestExperienceText = (current: any, next: any) => {
    const currentText = String(current || "").trim();
    const nextText = String(next || "").trim();
    if (!currentText) return nextText;
    if (!nextText) return currentText;
    const maxYears = (text: string) => Math.max(0, ...(text.match(/\b\d{1,2}\s*years?\b/gi) || []).map((value) => Number(value.match(/\d+/)?.[0] || 0)));
    const currentYears = maxYears(currentText);
    const nextYears = maxYears(nextText);
    if (currentYears !== nextYears && currentYears > 0 && nextYears > 0) return nextYears > currentYears ? nextText : currentText;
    return bestText(currentText, nextText);
  };
  const mergeArray = (current: any, next: any) => {
    const values = [...(Array.isArray(current) ? current : []), ...(Array.isArray(next) ? next : [])].filter(Boolean);
    const seen = new Set<string>();
    return values.filter((value) => {
      const key = typeof value === "object" ? JSON.stringify(value) : String(value).toLowerCase().trim();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  };
  const positionsByTitle = new Map<string, any>();
  const pageClassifications = new Map<number, any>();

  for (const item of items.filter(Boolean)) {
    // Segment results are ordered by source page. Keep the earliest evidenced
    // tender metadata instead of allowing longer text from later contract pages
    // to overwrite cover-page and data-sheet facts.
    for (const field of scalarFields) {
      if (!String(merged[field] || "").trim() && String(item[field] || "").trim()) merged[field] = item[field];
    }
    for (const field of arrayFields) merged[field] = mergeArray(merged[field], item[field]);
    for (const classification of Array.isArray(item.page_classifications) ? item.page_classifications : []) {
      const pageNumber = Number(classification.page_number || 0);
      if (!Number.isInteger(pageNumber) || pageNumber <= 0) continue;
      const current = pageClassifications.get(pageNumber);
      if (!current || Number(classification.confidence || 0) >= Number(current.confidence || 0)) {
        pageClassifications.set(pageNumber, classification);
      }
    }
    for (const position of Array.isArray(item.positions) ? item.positions : []) {
      const title = String(position.position_title || position.title || "").trim();
      if (!title) continue;
      const sourceNumber = Number(position.source_position_number || 0) || "";
      const titleKey = title.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
      const lotKey = String(position.lot_reference || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
      const documentKey = String(position.source_document || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
      const categoryKey = String(position.expert_category || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
      const locationKey = String(position.work_location || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
      const key = sourceNumber ? `${documentKey}|${lotKey}|number:${sourceNumber}|${titleKey}` : `${documentKey}|${lotKey}|title:${titleKey}|${categoryKey}|${locationKey}`;
      const current = positionsByTitle.get(key) || {};
      positionsByTitle.set(key, {
        ...current,
        ...position,
        position_title: current.position_title || title,
        quantity: current.quantity || position.quantity || undefined,
        source_position_number: current.source_position_number || position.source_position_number,
        source_document: bestText(current.source_document, position.source_document),
        lot_reference: bestText(current.lot_reference, position.lot_reference),
        expert_category: bestText(current.expert_category, position.expert_category),
        is_key_expert: current.is_key_expert ?? position.is_key_expert,
        input_months: current.input_months || position.input_months,
        work_location: bestText(current.work_location, position.work_location),
        minimum_education: bestText(current.minimum_education, position.minimum_education),
        minimum_years_experience: Math.max(Number(current.minimum_years_experience || 0), Number(position.minimum_years_experience || 0)) || undefined,
        general_experience: strictestExperienceText(current.general_experience, position.general_experience),
        specific_experience: strictestExperienceText(current.specific_experience, position.specific_experience),
        role_description: bestText(current.role_description, position.role_description || position.description),
        role_duties_status: current.role_duties_status || position.role_duties_status,
        required_sector_experience: mergeArray(current.required_sector_experience, position.required_sector_experience),
        mandatory_skills: mergeArray(current.mandatory_skills, position.mandatory_skills),
        required_software: mergeArray(current.required_software, position.required_software),
        required_certifications: mergeArray(current.required_certifications, position.required_certifications),
        professional_memberships: mergeArray(current.professional_memberships, position.professional_memberships),
        required_languages: mergeArray(current.required_languages, position.required_languages),
        position_deliverables: mergeArray(current.position_deliverables, position.position_deliverables),
        required_keywords: mergeArray(current.required_keywords, position.required_keywords),
        minimum_specific_years: Math.max(Number(current.minimum_specific_years || 0), Number(position.minimum_specific_years || 0)) || undefined,
        minimum_similar_projects: current.minimum_similar_projects || position.minimum_similar_projects,
        regional_experience: bestText(current.regional_experience, position.regional_experience),
        country_experience: bestText(current.country_experience, position.country_experience),
        nationality_preference: bestText(current.nationality_preference, position.nationality_preference),
        residency_requirement: bestText(current.residency_requirement, position.residency_requirement),
        evaluation_points: current.evaluation_points || position.evaluation_points,
        source_page_numbers: mergeArray(current.source_page_numbers, position.source_page_numbers),
        source_quotes: mergeArray(current.source_quotes, position.source_quotes),
        field_evidence: mergeArray(current.field_evidence, position.field_evidence),
      });
    }
  }

  merged.positions = Array.from(positionsByTitle.values());
  merged.page_classifications = Array.from(pageClassifications.values()).sort((a, b) => Number(a.page_number) - Number(b.page_number));
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

export function extractTenderRoleContext(rawText: string, title: string, positionNumber?: number) {
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
  for (const index of hitIndexes.slice(0, 30)) {
    const start = Math.max(0, index - 35);
    const end = Math.min(lines.length, index + 80);
    windows.push(lines.slice(start, end).join("\n"));
  }
  if (!windows.length) return "";
  return Array.from(new Set(windows)).join("\n\n--- NEXT MATCH CONTEXT ---\n\n").slice(0, 120000);
}

export function inferTenderTableContextsFromText(pageTexts: Array<{ page_number: number; text: string }>): TenderTableContext[] {
  const contexts: TenderTableContext[] = [];
  let active: TenderTableContext | null = null;
  const hasPersonnelHeader = (text: string) =>
    /\b(?:key experts?|non[-\s]?key|professional staff|staff position|team composition|personnel|experts?)\b/i.test(text) &&
    /\b(?:qualification|education|experience|input|months?|staff|position|role|responsibilit|duties)\b/i.test(text);
  const hasContinuationSignal = (text: string) =>
    /\b(?:engineer|expert|specialist|leader|surveyor|analyst|planner|economist|architect|advisor|inspector|technician|coordinator|qualification|education|experience|registered|chartered|bachelor|master|degree|diploma)\b/i.test(text);
  const inferColumns = (text: string) => {
    const columns = [
      /\b(?:s\/?no|no\.|#)\b/i.test(text) ? { header: "No.", meaning: "source_position_number" } : null,
      /\b(?:staff position|position|role|expert)\b/i.test(text) ? { header: "Position", meaning: "position_title" } : null,
      /\b(?:qualification|education)\b/i.test(text) ? { header: "Qualification", meaning: "minimum_education" } : null,
      /\bexperience\b/i.test(text) ? { header: "Experience", meaning: "general_experience and specific_experience" } : null,
      /\b(?:input|months?|person[-\s]?months?)\b/i.test(text) ? { header: "Input", meaning: "input_months" } : null,
      /\b(?:responsibilit|duties|tasks)\b/i.test(text) ? { header: "Duties", meaning: "role_description" } : null,
    ].filter(Boolean) as Array<{ header: string; meaning: string }>;
    return columns.length ? columns : [{ header: "Detected personnel table", meaning: "position_title and requirements" }];
  };

  for (const page of Array.isArray(pageTexts) ? pageTexts : []) {
    const pageNumber = Number(page.page_number || 0);
    const text = String(page.text || "");
    if (!Number.isInteger(pageNumber) || pageNumber <= 0) continue;
    if (hasPersonnelHeader(text)) {
      if (active) contexts.push(active);
      active = {
        table_title: "Detected personnel requirements table",
        header_page: pageNumber,
        first_data_page: pageNumber,
        last_data_page: pageNumber,
        columns: inferColumns(text),
        continues_after_chunk: false,
      };
      continue;
    }
    if (active && hasContinuationSignal(text)) {
      active.last_data_page = pageNumber;
      continue;
    }
    if (active) {
      contexts.push(active);
      active = null;
    }
  }
  if (active) contexts.push(active);

  return contexts.filter((context, index, values) =>
    values.findIndex((other) => other.header_page === context.header_page && other.first_data_page === context.first_data_page && other.last_data_page === context.last_data_page) === index,
  );
}

function sourcePageTextsToTenderText(pageTexts: Array<{ page_number: number; text: string }>) {
  return (Array.isArray(pageTexts) ? pageTexts : [])
    .map((page) => `--- PAGE ${page.page_number} ---\n${String(page.text || "").trim()}`)
    .filter((block) => block.trim())
    .join("\n\n");
}

function selectEconomyTenderPageTexts(pageTexts: Array<{ page_number: number; text: string }>) {
  const pages = (Array.isArray(pageTexts) ? pageTexts : [])
    .filter((page) => Number.isInteger(Number(page.page_number)) && String(page.text || "").trim())
    .sort((a, b) => Number(a.page_number) - Number(b.page_number));
  if (pages.length <= 40) {
    return {
      selectedPages: pages,
      skippedPages: [] as number[],
      pageScores: pages.map((page) => ({ page_number: page.page_number, score: 0, reasons: ["small_document_keep_all"] })),
    };
  }

  const relevantSignals: Array<[RegExp, number, string]> = [
    [/\b(?:key\s*experts?|professional\s*staff|staff(?:ing)?\s*(?:schedule|requirements?|inputs?)|personnel|consultant'?s\s*team|team\s*composition)\b/i, 8, "staffing"],
    [/\b(?:team\s*leader|resident\s*engineer|project\s*manager|specialist|expert|engineer|surveyor|inspector|economist|planner|advisor|coordinator|technician)\b/i, 5, "role_title"],
    [/\b(?:qualification|minimum\s*education|academic|degree|bachelor|master|phd|chartered|registered|licen[cs]e|practi[cs]ing\s*certificate|professional\s*registration|membership)\b/i, 6, "qualification"],
    [/\b(?:experience|years?|similar\s*(?:assignments?|projects?)|post[-\s]?graduate|international\s*experience|local\s*experience|regional\s*experience|country\s*experience)\b/i, 6, "experience"],
    [/\b(?:terms\s*of\s*reference|tor|scope\s*of\s*(?:services|work)|duties|responsibilities|tasks|activities|deliverables|outputs|objectives)\b/i, 7, "tor_scope"],
    [/\b(?:input\s*months?|person[-\s]?months?|staff[-\s]?months?|man[-\s]?months?|level\s*of\s*effort)\b/i, 7, "input_months"],
    [/\b(?:evaluation\s*criteria|technical\s*score|points?|marks?|weighted|scoring|criteria)\b/i, 5, "evaluation"],
    [/\b(?:deadline|submission\s*(?:date|deadline)|closing\s*date|proposal\s*submission|bid\s*submission)\b/i, 5, "deadline"],
    [/\b(?:data\s*sheet|request\s*for\s*proposals?|rfp|invitation|procurement|client|employer|contracting\s*authority|tender\s*number|reference\s*number)\b/i, 4, "tender_facts"],
    [/\b(?:language|fluency|software|autocad|primavera|ms\s*project|gis|bim|fidic|safeguards?|esmp|esia)\b/i, 4, "skills_tools"],
  ];
  const boilerplateSignals: Array<[RegExp, number, string]> = [
    [/\b(?:general\s*conditions\s*of\s*contract|conditions\s*of\s*contract|contract\s*agreement|special\s*conditions\s*of\s*contract)\b/i, -7, "contract_conditions"],
    [/\b(?:payment\s*terms|tax(?:es)?|bank\s*guarantee|performance\s*security|advance\s*payment|liquidated\s*damages)\b/i, -6, "commercial_boilerplate"],
    [/\b(?:fraud\s*and\s*corruption|eligible\s*countries|conflict\s*of\s*interest|code\s*of\s*conduct|sanctions)\b/i, -5, "standard_policy"],
    [/\b(?:power\s*of\s*attorney|signature|form\s*of\s*bid|bid\s*security|proposal\s*securing\s*declaration|letter\s*of\s*submission)\b/i, -5, "forms"],
    [/\b(?:appendix|annex)\b/i, -1, "appendix_possible_boilerplate"],
  ];

  const scored = pages.map((page) => {
    const text = String(page.text || "");
    const reasons: string[] = [];
    let score = 0;
    for (const [pattern, weight, reason] of relevantSignals) {
      if (pattern.test(text)) {
        score += weight;
        reasons.push(reason);
      }
    }
    for (const [pattern, weight, reason] of boilerplateSignals) {
      if (pattern.test(text)) {
        score += weight;
        reasons.push(reason);
      }
    }
    if (/\bK[-\s]?\d+\b|\bposition\s+\d+\b|\bno\.\s*of\s*(?:staff|persons?)\b/i.test(text)) {
      score += 5;
      reasons.push("position_number_or_quantity");
    }
    if (text.length < 120) {
      score -= 3;
      reasons.push("very_short_text");
    }
    return { page_number: Number(page.page_number), score, reasons };
  });

  const pageByNumber = new Map(pages.map((page) => [Number(page.page_number), page]));
  const selected = new Set<number>();
  const addPage = (pageNumber: number) => {
    if (pageByNumber.has(pageNumber)) selected.add(pageNumber);
  };
  const total = pages.length;
  pages.slice(0, Math.min(6, total)).forEach((page) => addPage(Number(page.page_number)));
  pages.slice(Math.max(0, total - 2)).forEach((page) => addPage(Number(page.page_number)));

  for (const item of scored) {
    if (item.score >= 6) {
      addPage(item.page_number);
      addPage(item.page_number - 1);
      addPage(item.page_number + 1);
    } else if (item.score >= 3) {
      addPage(item.page_number);
    }
  }

  const minimumSelected = Math.min(total, 35);
  if (selected.size < minimumSelected) {
    scored
      .slice()
      .sort((a, b) => b.score - a.score)
      .slice(0, minimumSelected)
      .forEach((item) => addPage(item.page_number));
  }

  const selectedPages = Array.from(selected)
    .sort((a, b) => a - b)
    .map((pageNumber) => pageByNumber.get(pageNumber)!)
    .filter(Boolean);
  const selectedSet = new Set(selectedPages.map((page) => Number(page.page_number)));
  return {
    selectedPages,
    skippedPages: pages.map((page) => Number(page.page_number)).filter((pageNumber) => !selectedSet.has(pageNumber)),
    pageScores: scored,
  };
}

function getTenderExtractionMode() {
  const mode = String(process.env.TENDER_EXTRACTION_MODE || "economy").trim().toLowerCase();
  return mode === "deep" ? "deep" : "economy";
}

function getTenderEconomyModels() {
  const models = [
    process.env.TENDER_EXTRACTION_MODEL || "gemini-3.5-flash",
  ];
  if (process.env.TENDER_USE_PRO_FALLBACK === "true") {
    models.push(process.env.TENDER_DEEP_EXTRACTION_MODEL || "gemini-3.1-pro-preview");
  }
  models.push("gemini-3.1-pro-preview");
  return Array.from(new Set(models.filter(Boolean)));
}

function getTenderDeepModels() {
  return Array.from(new Set([
    process.env.TENDER_DEEP_EXTRACTION_MODEL || process.env.TENDER_EXTRACTION_MODEL || "gemini-3.1-pro-preview",
    process.env.TENDER_EXTRACTION_MODEL || "gemini-3.5-flash",
    "gemini-3.5-flash",
  ].filter(Boolean)));
}

function buildEconomyTenderPrompt(tenderText: string, chunkNote = "") {
  return `You are an ultra-aggressive, highly analytical, and extremely detail-oriented ultimate tender document extraction AI.
The user may have provided MULTIPLE documents for a single tender concatenated together (for example: Primary Tender + Scope/TOR + Addenda, and sometimes previous CV response examples).
READ INTELLIGENTLY LINE BY LINE: Tenders can be 200+ pages long with many irrelevant words. You must be smart enough to know what is necessary (roles, skills, deadlines, constraints) and what is not (boilerplates, standard contract clauses, filler text). Focus entirely on the concrete requirements.
Your goal is to parse the provided tender document(s) line-by-line, leaving no word unread.
You MUST consolidate the extracted roles, staffing positions, requirements, metrics, scores, and project details from ALL uploaded documents into a single cohesive tender object with 100% accuracy. Do not summarize or ignore details.
${chunkNote}

MANDATORY FIELD RECONNAISSANCE BEFORE EXTRACTION:
Before producing JSON, silently identify where each tender field is likely located. Look for these sections and tables across the whole supplied text:
- cover page, request/proposal letter, data sheet, procurement data sheet, invitation, RFP reference, submission deadline, client, country, project title, project duration
- evaluation criteria, technical score tables, key expert points, pass/fail requirements, staff scoring tables
- terms of reference, scope of services, objectives, activities, tasks, deliverables, outputs, reporting requirements
- team composition, key experts, non-key experts, professional staff, proposed senior personnel, personnel schedule, staff input, man-month/person-month/input tables
- qualification and experience tables, minimum qualifications, education, registrations, chartership, practising certificates, licences, memberships
- role descriptions, duties, responsibilities, functions, assignment activities, similar project requirements, local/international/regional/country experience
- language, software, methodology, safeguard, standards, tools, certifications, nationality, residency, and location requirements
- if CV response/example documents are present, recognise them as response material; use them only to understand which tender role they were responding to, and never copy candidate education, candidate years, candidate employers, candidate projects, or adequacy text as tender requirements

COMMON TENDER STRUCTURES YOU MUST UNDERSTAND:
- PPDA/RFP documents can contain long instruction/contract boilerplate before the real expert details. The real role data may be in Evaluation Criteria, Technical Proposal forms, Outline of Key Experts, Professional Staff, or TOR pages.
- World Bank-style RFPs can define "Key Experts" early as boilerplate, but real positions are usually in the Data Sheet, Evaluation Criteria, Team Composition, Terms of Reference, or Appendix B Key Experts.
- TOR-only documents often put role requirements in prose, for example "Hydraulic engineer/Modeler: The expert should have..." rather than in a table.
- Oman-style documents may use compact staff tables listing role name, unit, and months, with separate evaluation or TOR pages giving qualifications and duties.
- A table may continue on later pages without repeating headers. Carry the last staff-table header meanings forward until the table clearly ends.
- CV response documents often contain headings like "CURRICULUM VITAE", "POSITION TITLE", "EDUCATION", "EMPLOYMENT RECORD", and "ADEQUACY FOR THE ASSIGNMENT". These are not tender requirements unless the same requirement is supported by the tender/TOR/evaluation text.
- Non-key/support staff and technician roles are real positions when the tender requires them. Extract Senior Laboratory Technician, Laboratory Technician, Assistant Laboratory Technician, Materials Technician, CAD Specialist/Technician, inspectors, survey assistants, and similar staff when they appear in a staff schedule, qualification table, evaluation table, or requirement paragraph.

CRITICAL INSTRUCTIONS (AGGRESSIVE EXTRACTION):
1. EXHAUSTIVE COMPREHENSIVE EXTRACTION: Do not skim. Read every single line across all documents. Capture every specific certification, language proficiency, local or international experience requirement, duration, input month, score, deadline, licence, registration, membership, methodology, safeguard, standard, software, and location mentioned.
2. DEEP POSITION ANALYSIS & CONSOLIDATION: For each staffing position, rigorously map out role_description, general_experience, specific_experience, minimum_education, minimum_years_experience, required_sector_experience, required_keywords, mandatory_skills, required_software, required_certifications, professional_memberships, required_languages, nationality_preference, work_location, input_months, minimum_similar_projects, and evaluation_points. You MUST extract the verbatim text for the experience and education requirements. Do not leave general_experience, specific_experience, or role_description blank when relevant wording exists anywhere in the supplied tender text.
3. CAPTURE IMPLICIT & HIDDEN REQUIREMENTS FROM THE DOCUMENT: Read between the lines of the tender text. Identify exact technologies, methodologies, safeguards, standards, certifications, licences, software, frameworks, and project-sector requirements when they appear in the document or are clearly tied to the written scope/TOR. Do not add facts from outside the supplied tender documents.
4. NO DATA LEFT BEHIND: Think about how this data will be used to perfectly match and tailor CVs. Ensure scope_summary and special_requirements are extremely detailed and rich in context.
5. TEAM-LEVEL CONSTRAINTS: Look for any rules that affect the whole team rather than a single position (for example: "The team must have at least one local citizen", "One member must be a certified auditor", "All personnel must be fluent in English", "registered in Uganda"). Extract these into global_team_constraints unless they clearly apply to only one role.
6. EXHAUSTIVE TENDER TYPE EXTRACTION: In project_sector, pick EVERYTHING the job is related to (for example: Infrastructure, Roads, Bridges, Construction, Railway, Water, Sanitation, Flood Protection, Feasibility Study, Design Review, Construction Supervision). Be generous and comprehensive.
7. MULTI-DOCUMENT CONSOLIDATION: If roles appear in one document and details appear in another, merge them. If evaluation criteria names a role and TOR gives duties, combine them into one complete position.
8. ROLE TITLE CLEANING: A label such as "K-1 Team Leader", "Position K2 Railway Engineer", "1 Resident Engineer", or "Assistant Resident Engineer (2No)" must produce a clean position_title such as "Team Leader", "Railway Engineer", "Resident Engineer", or "Assistant Resident Engineer"; put K numbers, quantities, and notes into the correct fields.
9. REAL ROLES ONLY: A real role is a required person/expert/staff position. Do not create positions from generic clause headings such as eligibility documents, obligations of consultant, institution of professional engineer, consultant risks, proposal forms, fraud clauses, signatures, or contract boilerplate.
9A. SUPPORT STAFF ARE STILL REAL ROLES: Do not drop technician, inspector, CAD, laboratory, survey assistant, or other non-key/support positions when they have education, experience, quantity, input months, or staff schedule evidence.
10. VERBATIM REQUIREMENT PRESERVATION: Keep tender wording as much as possible after OCR cleanup. Fix split words, broken line wraps, repeated headers/footers, and noisy symbols, but preserve meaning and strictness.
11. EVIDENCE: For each extracted role and populated role field, include source_page_numbers, source_quotes, and field_evidence when page markers or source wording are available.

FIELD DEFINITIONS:
- position_title: clean occupational role only, such as Resident Engineer, Team Leader, Materials Engineer, Environmental Specialist.
- quantity: number of people required for that role only.
- input_months: staff effort/months/person-months for that role only.
- work_location: place of assignment for that role only.
- nationality_preference: explicit nationality/citizenship requirement only.
- minimum_education: degrees, disciplines, and academic qualifications only. Do NOT include professional registration, licences, chartership, or memberships here.
- minimum_years_experience: the broad overall years requirement for the role.
- general_experience: broad overall professional experience wording, including total years and seniority requirements.
- specific_experience: role, project, sector, country, task, or similar-assignment experience wording.
- role_description: duties, tasks, responsibilities, functions, activities, services, outputs, or scope assigned to the role. If duties are only in the general TOR scope and clearly apply to the team, start with "Not separately stated for this role; responsibilities derive from TOR scope:".
- role_duties_status: explicit when duties are directly stated for the role, tor_scope when duties only come from general TOR scope, not_stated when searched and not present, needs_review when uncertain.
- required_sector_experience: named sector/domain experience such as roads, bridges, railway, water, buildings, transport planning, geotechnical, hydrology.
- mandatory_skills: explicit non-software abilities or competencies only.
- required_software: named software/tools only, such as AutoCAD, Primavera, MS Project, GIS, BIM.
- required_certifications: licences, professional registration, chartership, permits, certificates.
- professional_memberships: memberships in professional bodies or institutions.
- required_languages: explicit language and proficiency requirements only.
- regional_experience: regional or multi-country experience requirements.
- country_experience: named-country experience requirements.
- minimum_similar_projects: stated number of similar projects/assignments.
- evaluation_points: scoring points only, not quantity, years, months, or page numbers.
- tender-level fields: tender_title, client, country, tender_number, deadline, duration, submission_type, tender_format, scope_summary, project_sector, objectives, deliverables, eligibility_requirements, evaluation_criteria, special_requirements, global_team_constraints.

TABLE READING RULES:
1. Tables may continue on the next page without repeating headers. Carry the last staff-table header meanings forward until the table clearly ends.
2. Map row cells by the column meaning, not by position in the text dump. For example, a column headed "Qualifications" belongs to minimum_education; "Experience" belongs to general_experience/specific_experience; "Inputs", "Time Input", "Man-months", or "Person-months" belongs to input_months.
3. If role names are listed in one table and detailed requirements appear later, merge them into one complete position.
4. If a row says "Project Manager/Team Leader 1.0 ... 55.0", role is Project Manager/Team Leader and input_months is 55.0. Do not put numeric month values into title or experience.
5. If a row says "Resident Engineer: One" or "Assistant Resident Engineer (2No)", quantity is 1 or 2.

Return only valid JSON matching the schema.

Tender Text:
${tenderText}`;
}

async function runParseTenderTextEconomy(
  text: string,
  sourcePageTexts: Array<{ page_number: number; text: string }> = [],
): Promise<any> {
  const models = getTenderEconomyModels();
  const parseTenderWithPrompt = async (promptText: string) => {
    const response = await callGenAIWithRetry((modelName) => getAI().models.generateContent({
      model: modelName,
      contents: [{ role: "user", parts: [{ text: promptText }] }],
      config: {
        responseMimeType: "application/json",
        responseSchema: tenderSchema,
        temperature: 0.1,
      },
    }), models);
    return sanitizeExtractedValues(parseGenAIJSON(response.text || "{}"));
  };

  const chunks = prepareTenderPromptChunks(text);
  const concurrency = Math.max(1, Number(process.env.TENDER_EXTRACTION_CONCURRENCY || 1));
  const results = await mapWithConcurrency(
    chunks,
    concurrency,
    (chunk, index) => parseTenderWithPrompt(buildEconomyTenderPrompt(
      chunk,
      chunks.length > 1
        ? `This is chunk ${index + 1} of ${chunks.length}. Extract all facts visible in this selected tender text chunk; another step will merge chunks.`
        : "",
    )),
  );
  const fulfilled = results
    .filter((result): result is PromiseFulfilledResult<any> => result.status === "fulfilled")
    .map((result) => result.value);
  if (!fulfilled.length) {
    const failedReason = results.find((result) => result.status === "rejected") as PromiseRejectedResult | undefined;
    throw new Error(`Tender extraction failed: ${failedReason?.reason?.message || "No AI extraction result returned."}`);
  }

  let tender = postProcessTenderExtraction(mergeTenderExtractions(fulfilled), text);
  if (sourcePageTexts.length) tender = reconcileTenderEvidencePages(tender, sourcePageTexts);
  tender = normalizeTenderRecord(tender);
  const validation = validateExtractedTender(tender);
  logExtractionValidation("TENDER", tender.tender_title || tender.name || "Economy tender extraction", validation);
  const failedChunks = results.filter((result) => result.status === "rejected").length;
  tender.extraction_warnings = Array.from(new Set([
    ...(tender.extraction_warnings || []),
    ...validation.issues,
    ...(failedChunks ? [`${failedChunks} tender text chunk(s) failed and should be reviewed.`] : []),
  ]));
  tender.review_required = tender.review_required || tender.extraction_warnings.length > 0;
  tender.extraction_audit = {
    ...(tender.extraction_audit || {}),
    pipeline: "economy-text-layer + flash-line-by-line-extraction + merge + deterministic-post-process + validation",
    mode: "economy",
    model: models[0],
    chunkCount: chunks.length,
    failedChunks,
    validationIssues: validation.issues,
    proFallbackEnabled: process.env.TENDER_USE_PRO_FALLBACK === "true",
    extractedAt: new Date().toISOString(),
  };
  return sanitizeExtractedValues(tender);
}

async function repairTenderRolesFromFullDocumentContext(
  currentTender: any,
  rawTenderText: string,
  models: string[],
) {
  const normalized = normalizeTenderRecord(currentTender || {});
  const positions = Array.isArray(normalized.positions) ? normalized.positions : [];
  if (!positions.length || !String(rawTenderText || "").trim()) return normalized;

  const candidates = positions
    .map((position: any) => ({
      position,
      missingCount: missingTenderRoleDetailCount(position),
      context: extractTenderRoleContext(
        rawTenderText,
        position.position_title,
        Number(position.source_position_number || 0) || undefined,
      ),
    }))
    .filter((item: any) => item.context)
    .sort((a: any, b: any) => b.missingCount - a.missingCount);

  if (!candidates.length) return normalized;

  const parseRepairPrompt = async (promptText: string) => {
    const response = await callGenAIWithRetry((modelName) => getAI().models.generateContent({
      model: modelName,
      contents: [{ role: "user", parts: [{ text: promptText }] }],
      config: { responseMimeType: "application/json", responseSchema: tenderSchema, temperature: 0 },
    }), models);
    return sanitizeExtractedValues(parseGenAIJSON(response.text || "{}"));
  };

  const batchSize = 6;
  const repairPrompts: string[] = [];
  for (let start = 0; start < candidates.length; start += batchSize) {
    const batch = candidates.slice(start, start + batchSize);
    repairPrompts.push(`You are the POSITION-FIRST full-document repair stage for a tender extraction pipeline.
The app has already identified the real required positions. Your job is to search every provided occurrence/context for those exact roles and complete missing or weak fields.

Rules:
- Use ONLY the source context below.
- Keep position_title as clean occupational role only. K1/K-2/Position K3 belongs only in source_position_number.
- Extract every available education, general experience, specific experience, professional registration, certifications, skills, languages, nationality/residency, input months, evaluation points, duties, and deliverables for each listed role.
- Do not transfer requirements between roles.
- If duties are not separately stated under a role but general TOR tasks clearly apply to the expert team, role_description must begin with "Not separately stated for this role; responsibilities derive from TOR scope:" followed by source-grounded TOR task wording.
- Set role_duties_status to "explicit" when duties are directly stated under the role, "tor_scope" when duties derive only from general TOR scope, "not_stated" only when this context was searched and no duties are present, or "needs_review" when possible duties exist but cannot be confidently mapped.
- Attach field_evidence for every populated field with exact field name, page number, and verbatim quote.
- Return valid JSON matching the tender schema with positions[] containing ONLY repaired versions of these listed positions.

POSITIONS TO REPAIR:
${JSON.stringify(batch.map((item: any) => ({
  position_title: item.position.position_title,
  source_position_number: item.position.source_position_number,
  lot_reference: item.position.lot_reference,
  expert_category: item.position.expert_category,
  current: {
    quantity: item.position.quantity || "",
    input_months: item.position.input_months || "",
    minimum_education: item.position.minimum_education || "",
    minimum_years_experience: item.position.minimum_years_experience || "",
    general_experience: item.position.general_experience || "",
    specific_experience: item.position.specific_experience || "",
    role_description: item.position.role_description || "",
  },
})), null, 2)}

SOURCE CONTEXT BY POSITION:
${batch.map((item: any) => `--- POSITION: ${item.position.position_title} ---\n${item.context}`).join("\n\n")}`);
  }

  const repairResults = await mapWithConcurrency(
    repairPrompts,
    Number(process.env.TENDER_EXTRACTION_CONCURRENCY || 2),
    (prompt) => parseRepairPrompt(prompt),
  );

  const repairedPieces: any[] = [normalized];
  repairResults.forEach((result) => {
    if (result.status === "fulfilled") repairedPieces.push(result.value);
    else console.warn("[Tender extraction] Position-first full-document repair failed; continuing.", result.reason?.message || result.reason);
  });

  return normalizeTenderRecord(mergeTenderExtractions(repairedPieces));
}

async function auditTenderExtractionWithAI(
  currentTender: any,
  rawTenderText: string,
  models: string[],
) {
  const normalized = normalizeTenderRecord(currentTender || {});
  const positions = Array.isArray(normalized.positions) ? normalized.positions : [];
  if (!positions.length || !String(rawTenderText || "").trim()) return normalized;

  const roleContexts = positions.slice(0, 80).map((position: any) => ({
    position_title: position.position_title,
    source_position_number: position.source_position_number,
    lot_reference: position.lot_reference,
    context: extractTenderRoleContext(rawTenderText, position.position_title, Number(position.source_position_number || 0) || undefined).slice(0, 8000),
  }));
  const tenderPreview = String(rawTenderText || "").slice(0, 45000);
  const tenderEnding = String(rawTenderText || "").slice(-25000);
  const prompt = `You are the SECOND AI AUDITOR for a tender extraction pipeline.
Another AI already extracted the tender JSON. Your job is to audit it against source context and return only corrections/additions that are proven by source quotes.

Audit questions:
1. Did the extractor miss any real personnel position visible in the source context?
2. Did it place K1/K-2/Position K3 codes inside position_title instead of source_position_number?
3. Did it miss education, experience, registration, input months, duties, deliverables, nationality, location, or evaluation points that are present?
4. Did it put a value in the wrong field?
5. Are role duties explicit, derived from general TOR scope, genuinely not stated, or needing review?

Rules:
- Return schema-valid JSON with only corrected tender fields and corrected/added positions.
- Every populated field must have field_evidence or tender_field_evidence.
- Do not invent. Do not weaken stricter requirements.
- For role_duties_status use explicit, tor_scope, not_stated, or needs_review.
- If duties are only in general TOR scope, role_description must start with "Not separately stated for this role; responsibilities derive from TOR scope:".

CURRENT EXTRACTION JSON:
${JSON.stringify(normalized)}

SOURCE PREVIEW:
${tenderPreview}

SOURCE ENDING:
${tenderEnding}

ROLE-SPECIFIC SOURCE CONTEXTS:
${JSON.stringify(roleContexts, null, 2)}`;

  try {
    const response = await callGenAIWithRetry((modelName) => getAI().models.generateContent({
      model: modelName,
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      config: { responseMimeType: "application/json", responseSchema: tenderSchema, temperature: 0 },
    }), models);
    const audited = sanitizeExtractedValues(parseGenAIJSON(response.text || "{}"));
    return normalizeTenderRecord(mergeTenderExtractions([normalized, audited]));
  } catch (error: any) {
    console.warn("[Tender extraction] Second AI audit failed; continuing with pre-audit extraction.", error?.message || error);
    return normalized;
  }
}

export async function runParseTenderText(text: string): Promise<any> {
  if (getTenderExtractionMode() !== "deep") {
    return runParseTenderTextEconomy(text);
  }

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
  8. Do not treat proposal forms, evaluation criteria, submission forms, methodology sections, company experience sections, consultant organization sections, contract clauses, eligibility documents, obligations of the consulting firm, institutions, adjudicator appointment authorities, risk paragraphs, or sentence fragments as roles. They may contain useful context, but they are not staff positions.
  9. When one part of the tender lists role names and another part gives details, merge them into one complete position. Never leave a role incomplete if its education, experience, responsibility, quantity, or nationality details appear elsewhere in the tender. Be extremely thorough to hunt down the missing details.
  10. For every real role, extract every available role requirement into all position fields, including source_page_numbers and short exact source_quotes. Include all conditions and specific nuances. A position without source evidence must not be invented.
  11. Understand requirement language even when labels differ. Education may be called qualification, academic qualification, degree, credentials, or minimum requirements. Role description may be called duties, tasks, responsibilities, scope, functions, assignment, activities, expected services, or job description. Experience may be described in prose instead of labelled "general" or "specific".
  12. If the tender has experience text but does not explicitly divide it into general and specific experience, place broad career/years/professional requirements in general_experience and sector/project/task-specific requirements in specific_experience.
  13. Copy the tender's requirement wording as closely as possible after OCR cleanup. Fix OCR artifacts such as letter-spaced words ("o t h e r" -> "other"), split words ("mil lion" -> "million"), garbled bullet/icon symbols, and broken table line wraps. Do not rewrite, summarize, or invent requirements.
  14. Extract tender-level facts too: tender_title, tender_format, client, country, tender_number, deadline, duration, submission_type, scope_summary, project_sector, special_requirements, and global_team_constraints.
  15. Team-level requirements belong in global_team_constraints. Role-specific requirements belong inside that role.
  16. Missing data handling: if a value is genuinely not present anywhere in the tender text, omit numeric fields, output "" for string fields, or [] for array fields. Never default missing quantity to 1, missing years to 0, or missing nationality to Any.
  17. Source-only rule: extract only what is written in the tender. Do not infer requirements from donor, country, sector, or your outside knowledge.
  18. Output only valid JSON matching the schema. Never include internal reasoning, commentary, "Wait", "I will", "Let me", page markers, "Official Use Only", icon bullets, or explanation text inside any field.
  
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
  3. If quantity is visible, extract it. If not visible, omit it. Never assume 1.
  4. Do not extract role details in this stage unless they are on the same line. Details are extracted in Stage 2.
  5. Contract headings and clauses are never roles. Reject examples such as "Documents Establishing the Eligibility of the Consultant", "Obligations of the Consultant", "Institution of Professional Engineer", and sentence fragments mentioning risks or assumptions.
  6. Every role must include source_page_numbers and source_quotes proving it is required personnel.
  7. Return valid JSON matching the tender schema. positions[] should contain the real roles only.

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
    const repairResults = await mapWithConcurrency(
      repairPrompts,
      Number(process.env.TENDER_EXTRACTION_CONCURRENCY || 3),
      (repairPrompt) => parseTenderWithPrompt(repairPrompt, getTenderDeepModels()),
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
    const longTenderModels = getTenderDeepModels();
    const concurrency = Number(process.env.TENDER_EXTRACTION_CONCURRENCY || 3);
    const roleOnlyResults = await mapWithConcurrency(
      chunks,
      concurrency,
      (chunk, index) => parseTenderWithPrompt(
          buildRolesOnlyPrompt(
            chunk,
            `This is role-identification chunk ${index + 1} of ${chunks.length}. Extract only real staff/personnel roles visible in this chunk.`,
          ),
          longTenderModels,
        ),
    );
    const chunkResults = await mapWithConcurrency(
      chunks,
      concurrency,
      (chunk, index) => parseTenderWithPrompt(
          buildTenderPrompt(
            chunk,
            `This is extraction chunk ${index + 1} of ${chunks.length}. Extract every tender fact visible in this chunk. Another pass will merge all chunks, so do not omit positions just because surrounding pages may exist elsewhere.`,
          ),
          longTenderModels,
        ),
    );
    const fulfilled = [...roleOnlyResults, ...chunkResults]
      .filter((result): result is PromiseFulfilledResult<any> => result.status === "fulfilled")
      .map((result) => result.value);
    parsed = fulfilled.length ? mergeTenderExtractions(fulfilled) : await parseTenderWithPrompt(prompt, longTenderModels);
  } else {
    const models = getTenderDeepModels();
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
      const retryParsed = await parseTenderWithPrompt(retryPrompt, getTenderDeepModels());
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
  tender = await auditTenderExtractionWithAI(
    tender,
    text,
    getTenderDeepModels(),
  );
  const finalizedTextExtraction = await finalizeTenderExtraction(
    [tender],
    getTenderDeepModels(),
  );
  const finalTender = normalizeTenderRecord(finalizedTextExtraction);
  if (finalTender.positions.length !== finalizedTextExtraction.positions.length) {
    finalTender.extraction_warnings = Array.from(new Set([
      ...(finalTender.extraction_warnings || []),
      `Final synthesis returned ${finalizedTextExtraction.positions.length} position records; validation kept ${finalTender.positions.length} distinct valid role(s). Review the cleaned position list.`,
    ]));
    finalTender.review_required = true;
  }
  if (Array.isArray(finalTender.extraction_blocking_issues) && finalTender.extraction_blocking_issues.length > 0) {
    finalTender.extraction_warnings = Array.from(new Set([
      ...(finalTender.extraction_warnings || []),
      ...finalTender.extraction_blocking_issues.map((issue: string) => `Review required: ${issue}`),
    ]));
    finalTender.extraction_blocking_issues = [];
    finalTender.review_required = true;
  }
  tender = finalTender;
  validation = validateExtractedTender(tender);
  logExtractionValidation("TENDER", tender.tender_title || tender.name || "Finalized tender", validation);
  tender.extraction_audit = {
    ...(tender.extraction_audit || {}),
      pipeline: "roles-only + full extraction + role-detail extraction + second-ai-audit + mandatory-final-ai-synthesis + validation",
    stage1RolesOnly: true,
    stage2RoleDetailRepair: true,
    stage3Validation: true,
    stage4FinalAiSynthesis: true,
    finalPositionCount: Array.isArray(tender.positions) ? tender.positions.length : 0,
    finalValidationIssues: validation.issues,
  };

  return sanitizeExtractedValues(tender);
}

type TenderPdfInput = { path: string; originalname: string; mimetype?: string };

const PRO_HIGH_PRIORITY_PAGE_CATEGORIES = new Set([
  "overview", "deadline", "staff_schedule", "role_requirements", "evaluation", "eligibility",
]);
const PRO_CONTEXT_PAGE_CATEGORIES = new Set(["scope", "deliverables"]);
const BOILERPLATE_PAGE_CATEGORIES = new Set(["contract_clause", "forms", "financial", "irrelevant", "other"]);

export function selectTenderPagesForPro(
  classifications: any[],
  firstPage: number,
  lastPage: number,
  options: { confidenceThreshold?: number; contextRadius?: number; tableContexts?: TenderTableContext[]; forcedPages?: number[] } = {},
) {
  const confidenceThreshold = options.confidenceThreshold ?? 0.85;
  const contextRadius = options.contextRadius ?? 2;
  const byPage = new Map<number, any>();
  for (const item of Array.isArray(classifications) ? classifications : []) {
    const page = Number(item?.page_number || 0);
    if (Number.isInteger(page) && page >= firstPage && page <= lastPage) byPage.set(page, item);
  }

  const anchors = new Set<number>();
  const reasons = new Map<number, string[]>();
  const addAnchor = (page: number, reason: string) => {
    anchors.add(page);
    reasons.set(page, [...(reasons.get(page) || []), reason]);
  };

  for (let page = firstPage; page <= lastPage; page++) {
    const classification = byPage.get(page);
    if (!classification) {
      addAnchor(page, "missing-classification");
      continue;
    }
    const categories = (Array.isArray(classification.categories) ? classification.categories : [])
      .map((category: any) => String(category || "").trim().toLowerCase());
    const summary = String(classification.summary || "");
    const isBoilerplate = categories.some((category: string) => BOILERPLATE_PAGE_CATEGORIES.has(category));
    const isHighPriority = categories.some((category: string) => PRO_HIGH_PRIORITY_PAGE_CATEGORIES.has(category));
    const isContextPage = categories.some((category: string) => PRO_CONTEXT_PAGE_CATEGORIES.has(category));
    if (page <= 8) addAnchor(page, "opening-context");
    if (classification.has_staff_requirements) addAnchor(page, "staff-requirements");
    if (isHighPriority || (isContextPage && !isBoilerplate)) addAnchor(page, "relevant-category");
    if (classification.readability !== "CLEAR") addAnchor(page, "ocr-or-layout-review");
    if (Number(classification.confidence || 0) < confidenceThreshold) addAnchor(page, "low-confidence");
    if ((!isBoilerplate || isHighPriority) && /\b(?:key experts?|personnel|staff schedule|terms of reference|scope of services|deliverables?|deadline|submission date|evaluation criteria|qualification|experience requirements?)\b/i.test(summary)) {
      addAnchor(page, "summary-signal");
    }
  }

  for (const tableContext of Array.isArray(options.tableContexts) ? options.tableContexts : []) {
    const tableFirstPage = Math.max(firstPage, Number(tableContext.first_data_page || 0));
    const tableLastPage = Math.min(lastPage, Number(tableContext.last_data_page || 0));
    if (!Number.isInteger(tableFirstPage) || !Number.isInteger(tableLastPage) || tableLastPage < tableFirstPage) continue;
    for (let page = tableFirstPage; page <= tableLastPage; page++) {
      addAnchor(page, "continued-personnel-table");
    }
  }

  for (const page of Array.isArray(options.forcedPages) ? options.forcedPages : []) {
    const pageNumber = Number(page);
    if (Number.isInteger(pageNumber) && pageNumber >= firstPage && pageNumber <= lastPage) {
      addAnchor(pageNumber, "forced-visual-layout-review");
    }
  }

  const selected = new Set<number>(anchors);
  for (const anchor of anchors) {
    for (let offset = -contextRadius; offset <= contextRadius; offset++) {
      const page = anchor + offset;
      if (page >= firstPage && page <= lastPage) selected.add(page);
    }
  }

  const selectedPages = Array.from(selected).sort((a, b) => a - b);
  const skippedPages = Array.from({ length: lastPage - firstPage + 1 }, (_, index) => firstPage + index)
    .filter((page) => !selected.has(page));
  return { selectedPages, skippedPages, anchors: Array.from(anchors).sort((a, b) => a - b), reasons };
}

function searchableTenderText(value: any) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

export function reconcileTenderEvidencePages(tender: any, pageTexts: Array<{ page_number: number; text: string }>) {
  if (!pageTexts.length) return tender;
  const searchablePages = pageTexts.map((page) => ({ ...page, searchable: searchableTenderText(page.text) }));
  const findPages = (value: any) => {
    const searchable = searchableTenderText(value);
    if (searchable.length < 12) return [];
    const probes = [searchable, searchable.slice(0, 180), searchable.slice(0, 100)].filter((probe, index, values) => probe.length >= 12 && values.indexOf(probe) === index);
    const probe = probes.find((candidate) => searchablePages.some((page) => page.searchable.includes(candidate)));
    return probe ? searchablePages.filter((page) => page.searchable.includes(probe)).map((page) => page.page_number) : [];
  };
  const reconcileEvidence = (items: any[]) => (Array.isArray(items) ? items : []).map((item: any) => {
    const pages = findPages(item?.quote);
    return pages.length ? { ...item, page_number: pages[0] } : item;
  });

  return {
    ...tender,
    tender_field_evidence: reconcileEvidence(tender?.tender_field_evidence),
    positions: (Array.isArray(tender?.positions) ? tender.positions : []).map((position: any) => {
      const titleWithoutCode = String(position?.position_title || position?.title || position?.role || "").replace(/^\s*K\s*[-.]?\s*\d+\s*[:.)-]?\s*/i, "");
      const matchedPages = new Set<number>();
      [titleWithoutCode, ...(Array.isArray(position?.source_quotes) ? position.source_quotes : [])].forEach((value) => {
        findPages(value).forEach((page) => matchedPages.add(page));
      });
      const fieldEvidence = reconcileEvidence(position?.field_evidence);
      fieldEvidence.forEach((item: any) => {
        if (Number.isInteger(Number(item?.page_number)) && Number(item.page_number) > 0) matchedPages.add(Number(item.page_number));
      });
      return {
        ...position,
        source_page_numbers: matchedPages.size
          ? Array.from(matchedPages).sort((a, b) => a - b)
          : position.source_page_numbers,
        field_evidence: fieldEvidence,
      };
    }),
  };
}

export function validateTenderFieldSemantics(tender: any) {
  const issues: string[] = [];
  const text = (value: any) => String(value || "").trim();
  const lowered = (value: any) => text(value).toLowerCase();
  const numberWord = (value: any) => ({
    1: "one", 2: "two", 3: "three", 4: "four", 5: "five", 6: "six", 7: "seven", 8: "eight", 9: "nine", 10: "ten",
    11: "eleven", 12: "twelve", 13: "thirteen", 14: "fourteen", 15: "fifteen", 16: "sixteen", 17: "seventeen", 18: "eighteen", 19: "nineteen", 20: "twenty",
    21: "twenty one", 22: "twenty two", 23: "twenty three", 24: "twenty four", 25: "twenty five", 26: "twenty six", 27: "twenty seven", 28: "twenty eight", 29: "twenty nine", 30: "thirty",
  } as Record<number, string>)[Number(value)] || "";
  const significantTokens = (value: any) => lowered(value)
    .replace(/^not separately stated for this role responsibilities derive from tor scope\s*/i, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/)
    .filter((token) => token.length >= 4 && !/^(?:shall|with|from|that|this|will|have|must|required|minimum|experience|years?|separately|stated|role|responsibilities|derive|derived|scope)$/.test(token));
  const fieldEvidence = (position: any, field: string) => (Array.isArray(position?.field_evidence) ? position.field_evidence : [])
    .filter((item: any) => lowered(item?.field) === field.toLowerCase() && text(item?.quote));
  const hasFieldEvidence = (position: any, field: string, value: any) => {
    const rawValue = text(value);
    if (!rawValue) return true;
    const evidences = fieldEvidence(position, field);
    const fallbackEvidence = (Array.isArray(position?.source_quotes) ? position.source_quotes : [])
      .map((quote: any) => ({ field, quote: text(quote) }))
      .filter((item: any) => item.quote);
    const evidencePool = evidences.length ? evidences : fallbackEvidence;
    if (!evidencePool.length) return false;
    if (typeof value === "number" || /^\d+(?:\.\d+)?$/.test(rawValue)) {
      const escapedValue = rawValue.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const word = numberWord(rawValue);
      return evidencePool.some((item: any) => {
        const quote = String(item.quote || "");
        return new RegExp(`\\b${escapedValue}\\b`).test(quote) || (word ? new RegExp(`\\b${word.replace(/\s+/g, "\\s+")}\\b`, "i").test(quote) : false);
      });
    }
    const tokens = significantTokens(rawValue);
    if (!tokens.length) return true;
    return evidencePool.some((item: any) => {
      const quoteTokens = new Set(significantTokens(item?.quote));
      const hits = tokens.filter((token) => quoteTokens.has(token)).length;
      return hits >= Math.min(3, tokens.length) || hits / tokens.length >= 0.35;
    });
  };
  const populatedEvidenceFields = [
    "position_title",
    "quantity",
    "minimum_education",
    "minimum_years_experience",
    "minimum_specific_years",
    "general_experience",
    "specific_experience",
    "role_description",
    "input_months",
    "work_location",
    "nationality_preference",
  ];

  (Array.isArray(tender?.positions) ? tender.positions : []).forEach((position: any, index: number) => {
    const title = String(position?.position_title || "").trim();
    const label = `Position ${index + 1}${title ? ` (${title})` : ""}`;
    const titleLooksLikeRole = /\b(?:manager|engineer|expert|specialist|leader|coordinator|surveyor|inspector|architect|designer|planner|scheduler|advisor|trainer|analyst|officer|supervisor|controller|technician|draftsman|economist|sociologist|environmentalist|hydrologist|geologist)\b/i.test(title);
    if (!title) issues.push(`${label}: position_title is empty.`);
    if (/^\s*(?:K\s*[-.]?\s*\d+|\d+\s*[.):/-]|position\s*(?:no\.?|number)?\s*(?:K\s*[-.]?\s*)?\d+)\b/i.test(title)) {
      issues.push(`${label}: position_title contains a row/reference code instead of only the occupational role.`);
    }
    if (/\b(?:qty|quantity|\d+\s*(?:nos?\.?|persons?|staff))\b/i.test(title)) {
      issues.push(`${label}: position_title contains quantity information.`);
    }
    if (/\b(?:minimum\s+(?:degree|qualification|experience)|years?\s+of\s+experience|shall\s+have|responsibilities?\s+include)\b/i.test(title)) {
      issues.push(`${label}: position_title contains requirement text that belongs in another field.`);
    }
    if (title.length > 100) issues.push(`${label}: position_title is too long to be a clean occupational role.`);
    if (!titleLooksLikeRole && /\b(?:documents?|proposal|consultant|contract|terms?|conditions?|eligibility|qualification of|obligations?|assumptions?|risks?|institution|authority|declaration|submission|appendix|section)\b/i.test(title)) {
      issues.push(`${label}: position_title looks like a tender clause or heading, not a personnel role.`);
    }

    const quantity = position?.quantity;
    if (quantity !== undefined && quantity !== null && quantity !== "") {
      const numericQuantity = Number(quantity);
      if (!Number.isInteger(numericQuantity) || numericQuantity <= 0 || numericQuantity > 500) {
        issues.push(`${label}: quantity must be a positive whole-number staff count.`);
      }
    }
    const inputMonths = position?.input_months;
    if (inputMonths !== undefined && inputMonths !== null && inputMonths !== "") {
      const numericInputMonths = Number(inputMonths);
      if (!Number.isFinite(numericInputMonths) || numericInputMonths <= 0 || numericInputMonths > 1000) {
        issues.push(`${label}: input_months must be a positive staff-effort value, not a role count or experience year.`);
      }
    }
    ["minimum_years_experience", "minimum_specific_years"].forEach((field) => {
      const value = position?.[field];
      if (value !== undefined && value !== null && value !== "") {
        const numericValue = Number(value);
        if (!Number.isInteger(numericValue) || numericValue < 0 || numericValue > 80) {
          issues.push(`${label}: ${field} must be a realistic whole-number year requirement.`);
        }
      }
    });

    const education = String(position?.minimum_education || "").trim();
    if (education && !/\b(?:degree|diploma|bachelor|master|bsc|msc|phd|qualification|engineer|surveying|economics|science|university|college|registered|chartered|licen[cs]e|membership)\b/i.test(education)) {
      issues.push(`${label}: minimum_education does not read like an education or professional qualification requirement.`);
    }
    if (education && /\b(?:responsibilit|duties|tasks|manage|supervis|prepare|review|months?|personnel|no\.|nos\.|quantity|input)\b/i.test(education)) {
      issues.push(`${label}: minimum_education contains duties, quantity, or input-month text that belongs in another field.`);
    }

    const generalExperience = text(position?.general_experience);
    if (generalExperience && !/\b(?:experience|years?|professional|postgraduate|sector|construction|supervision|design|projects?)\b/i.test(generalExperience)) {
      issues.push(`${label}: general_experience does not read like an experience requirement.`);
    }
    if (generalExperience && /\b(?:responsibilit|duties|tasks|shall be responsible|prepare|review|supervise|coordinate|manage|administer)\b/i.test(generalExperience) && !/\b(?:experience|years?)\b/i.test(generalExperience)) {
      issues.push(`${label}: general_experience appears to contain duties instead of broad experience requirements.`);
    }

    const specificExperience = text(position?.specific_experience);
    if (specificExperience && !/\b(?:experience|years?|similar|specific|project|sector|road|bridge|construction|supervision|design|assignment|contract|country|region|urban|rural)\b/i.test(specificExperience)) {
      issues.push(`${label}: specific_experience does not read like role-, project-, or sector-specific experience.`);
    }

    const roleDescription = String(position?.role_description || "").trim();
    const roleDutiesStatus = text(position?.role_duties_status);
    if (roleDescription && roleDescription.toLowerCase() === title.toLowerCase()) {
      issues.push(`${label}: role_description repeats the title instead of containing duties.`);
    }
    if (roleDescription && !/^(?:not_stated|needs_review)$/i.test(roleDutiesStatus) && /\b(?:degree|diploma|bachelor|master|bsc|msc|phd|minimum\s+\d+\s+years?|qualification|registered|chartered)\b/i.test(roleDescription) && !/\b(?:responsibilit|duties|tasks|prepare|review|supervis|manage|coordinate|administer|inspect|ensure|monitor|evaluate|report)\b/i.test(roleDescription)) {
      issues.push(`${label}: role_description appears to contain qualifications or years instead of duties.`);
    }
    if (roleDescription && !/^(?:not_stated|needs_review)$/i.test(roleDutiesStatus) && !/\b(?:responsibilit|duties|tasks|prepare|review|supervis|manage|coordinate|administer|inspect|ensure|monitor|evaluate|report|design|conduct|assist|advise|implement|control|verify)\b/i.test(roleDescription)) {
      issues.push(`${label}: role_description does not contain clear duty or activity wording.`);
    }

    const workLocation = text(position?.work_location);
    if (workLocation && /\b(?:degree|diploma|experience|years?|responsibilit|duties|tasks|quantity|months?)\b/i.test(workLocation)) {
      issues.push(`${label}: work_location contains non-location requirement text.`);
    }
    const nationality = text(position?.nationality_preference);
    if (nationality && /^(?:any|n\/a|na|none|not applicable)$/i.test(nationality)) {
      issues.push(`${label}: nationality_preference must stay empty unless the tender explicitly states a nationality requirement.`);
    }
    if (nationality && /\b(?:degree|diploma|experience|years?|responsibilit|duties|tasks|months?)\b/i.test(nationality)) {
      issues.push(`${label}: nationality_preference contains non-nationality text.`);
    }

    const sectorExperience = (Array.isArray(position?.required_sector_experience) ? position.required_sector_experience : []).map(text).filter(Boolean);
    if (sectorExperience.some((item) => /\b(?:degree|bachelor|master|diploma|license|licence|registered|chartered|AutoCAD|Civil\s*3D|Primavera|MS Project|GIS|BIM|English|French|Arabic|Swahili)\b/i.test(item))) {
      issues.push(`${label}: required_sector_experience contains education, certification, software, or language text.`);
    }
    const skills = (Array.isArray(position?.mandatory_skills) ? position.mandatory_skills : []).map(text).filter(Boolean);
    if (skills.some((item) => /\b(?:degree|bachelor|master|diploma|\d+\s+years?|AutoCAD|Civil\s*3D|Primavera|MS Project|GIS|BIM|English|French|Arabic|Swahili)\b/i.test(item))) {
      issues.push(`${label}: mandatory_skills contains degree, years, software, or language text that belongs in another field.`);
    }
    const software = (Array.isArray(position?.required_software) ? position.required_software : []).map(text).filter(Boolean);
    if (software.some((item) => /\b(?:degree|bachelor|master|experience|years?|registered|chartered|English|French|Arabic|Swahili)\b/i.test(item))) {
      issues.push(`${label}: required_software contains non-software requirement text.`);
    }
    const certifications = (Array.isArray(position?.required_certifications) ? position.required_certifications : []).map(text).filter(Boolean);
    if (certifications.some((item) => /\b(?:years?|experience|duties|responsibilit|tasks|AutoCAD|Civil\s*3D|Primavera|MS Project|English|French|Arabic|Swahili)\b/i.test(item))) {
      issues.push(`${label}: required_certifications contains experience, duty, software, or language text.`);
    }
    const memberships = (Array.isArray(position?.professional_memberships) ? position.professional_memberships : []).map(text).filter(Boolean);
    if (memberships.some((item) => /\b(?:years?|experience|duties|responsibilit|tasks|AutoCAD|Civil\s*3D|Primavera|MS Project)\b/i.test(item))) {
      issues.push(`${label}: professional_memberships contains non-membership text.`);
    }
    const languages = (Array.isArray(position?.required_languages) ? position.required_languages : []).map(text).filter(Boolean);
    if (languages.some((item) => /\b(?:degree|bachelor|master|experience|years?|AutoCAD|Civil\s*3D|Primavera|registered|chartered)\b/i.test(item))) {
      issues.push(`${label}: required_languages contains non-language requirement text.`);
    }
    const regionalExperience = text(position?.regional_experience);
    if (regionalExperience && /\b(?:degree|bachelor|master|duties|responsibilit|AutoCAD|Primavera|English|French|Arabic|Swahili)\b/i.test(regionalExperience)) {
      issues.push(`${label}: regional_experience contains non-region requirement text.`);
    }
    const countryExperience = text(position?.country_experience);
    if (countryExperience && /\b(?:degree|bachelor|master|duties|responsibilit|AutoCAD|Primavera|English|French|Arabic|Swahili)\b/i.test(countryExperience)) {
      issues.push(`${label}: country_experience contains non-country requirement text.`);
    }
    const deliverables = (Array.isArray(position?.position_deliverables) ? position.position_deliverables : []).map(text).filter(Boolean);
    if (deliverables.some((item) => /\b(?:degree|bachelor|master|\d+\s+years?|registered|chartered|English|French|Arabic|Swahili)\b/i.test(item))) {
      issues.push(`${label}: position_deliverables contains qualifications, years, registration, or language text.`);
    }
    const keywords = (Array.isArray(position?.required_keywords) ? position.required_keywords : []).map(text).filter(Boolean);
    if (keywords.some((item) => item.length > 80 || /\b(?:shall|must|required|minimum|responsibilities include)\b/i.test(item))) {
      issues.push(`${label}: required_keywords should contain short source terms, not full requirement sentences.`);
    }

    for (const field of populatedEvidenceFields) {
      const value = position?.[field];
      if (value !== undefined && value !== null && String(value).trim() && !hasFieldEvidence(position, field, value)) {
        issues.push(`${label}: ${field} is populated without matching field_evidence from the tender source.`);
      }
    }
  });
  return issues;
}

type TenderTableContext = {
  table_title: string;
  header_page: number;
  first_data_page: number;
  last_data_page: number;
  columns: Array<{ header: string; meaning: string }>;
  continues_after_chunk: boolean;
};

function cleanTenderTableContext(value: any): TenderTableContext | null {
  const columns = (Array.isArray(value?.columns) ? value.columns : [])
    .map((column: any) => ({
      header: String(column?.header || "").trim(),
      meaning: String(column?.meaning || "").trim(),
    }))
    .filter((column: any) => column.header && column.meaning);
  const headerPage = Number(value?.header_page || 0);
  const firstDataPage = Number(value?.first_data_page || headerPage || 0);
  const lastDataPage = Number(value?.last_data_page || firstDataPage || 0);
  if (!columns.length || !Number.isInteger(firstDataPage) || firstDataPage <= 0 || !Number.isInteger(lastDataPage) || lastDataPage < firstDataPage) return null;
  return {
    table_title: String(value?.table_title || "Untitled continued table").trim(),
    header_page: Number.isInteger(headerPage) && headerPage > 0 ? headerPage : firstDataPage,
    first_data_page: firstDataPage,
    last_data_page: lastDataPage,
    columns,
    continues_after_chunk: Boolean(value?.continues_after_chunk),
  };
}

export function getTenderTableContextsForRange(contexts: TenderTableContext[], firstPage: number, lastPage: number) {
  return (Array.isArray(contexts) ? contexts : []).filter((context) =>
    context.first_data_page <= lastPage && context.last_data_page >= firstPage,
  );
}

async function extractTenderTableContexts(
  pageTexts: Array<{ page_number: number; text: string }>,
  models: string[],
) {
  const usablePages = pageTexts.filter((page) => String(page.text || "").trim());
  if (!usablePages.length) return [];
  const chunkSize = Math.max(20, Math.min(120, Number(process.env.TENDER_TABLE_CONTEXT_PAGES || 80)));
  const contexts: TenderTableContext[] = [];
  let activeTables: TenderTableContext[] = [];

  for (let start = 0; start < usablePages.length; start += chunkSize) {
    const chunk = usablePages.slice(start, start + chunkSize);
    const pageText = chunk.map((page) => {
      const text = String(page.text || "").trim();
      const bounded = text.length > 6000 ? `${text.slice(0, 5000)}\n[PAGE MIDDLE OMITTED]\n${text.slice(-1000)}` : text;
      return `--- PHYSICAL PDF PAGE ${page.page_number} ---\n${bounded}`;
    }).join("\n\n");
    const prompt = `You are the persistent table-structure stage of a tender extraction pipeline.
Identify personnel, staffing, qualification, evaluation, deliverable, and requirement tables in these consecutive physical PDF pages.

CRITICAL CONTINUATION RULE:
A table header may appear only on its first page. Rows on later pages still inherit exactly the same columns until the table ends or a new table/header replaces it. Use the ACTIVE TABLES FROM THE PREVIOUS CHUNK to interpret headerless continuation rows. Do not treat the first headerless row as a new header.

For every relevant table, return:
- table_title
- physical page containing the header
- first and last physical data page observed for that table
- every column header and its semantic meaning, such as row reference, position title, quantity, education, general experience, specific experience, duties, input months, location, nationality, or evaluation points
- continues_after_chunk=true only when the table is still active at the end of the supplied pages

ACTIVE TABLES FROM PREVIOUS CHUNK:
${JSON.stringify(activeTables)}

PAGES:
${pageText}`;
    const response = await callGenAIWithRetry((modelName) => getAI().models.generateContent({
      model: modelName,
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      config: { responseMimeType: "application/json", responseSchema: tenderTableContextSchema, temperature: 0 },
    }), models);
    const parsed = parseGenAIJSON(response.text || "{}");
    const chunkContexts = (Array.isArray(parsed?.tables) ? parsed.tables : [])
      .map(cleanTenderTableContext)
      .filter((context: TenderTableContext | null): context is TenderTableContext => Boolean(context));
    contexts.push(...chunkContexts);
    activeTables = chunkContexts.filter((context) => context.continues_after_chunk);
  }

  const merged = new Map<string, TenderTableContext>();
  contexts.forEach((context) => {
    const columnKey = context.columns.map((column) => `${column.header}:${column.meaning}`).join("|").toLowerCase().replace(/\s+/g, " ");
    const key = `${context.table_title.toLowerCase().replace(/\s+/g, " ")}|${columnKey}`;
    const current = merged.get(key);
    merged.set(key, current ? {
      ...current,
      header_page: Math.min(current.header_page, context.header_page),
      first_data_page: Math.min(current.first_data_page, context.first_data_page),
      last_data_page: Math.max(current.last_data_page, context.last_data_page),
      continues_after_chunk: context.continues_after_chunk,
    } : context);
  });
  return Array.from(merged.values());
}

async function finalizeTenderExtraction(items: any[], models: string[]) {
  const candidate = mergeTenderExtractions(items);
  const positionFragments = items.flatMap((item) => Array.isArray(item?.positions) ? item.positions : []);
  const tenderCandidate = Object.fromEntries(Object.entries(candidate).filter(([key]) => ![
    "positions", "page_classifications", "extraction_warnings", "extraction_audit", "extraction_quality", "extraction_blocking_issues",
  ].includes(key)));
  const payload = JSON.stringify({ tender_candidate: tenderCandidate, position_fragments: positionFragments });
  const maxPayloadChars = Math.max(100000, Number(process.env.TENDER_FINAL_SYNTHESIS_MAX_CHARS || 750000));
  if (payload.length > maxPayloadChars) {
    throw new Error(`Final tender synthesis input is ${payload.length.toLocaleString()} characters, above the configured safe limit of ${maxPayloadChars.toLocaleString()}. Increase TENDER_FINAL_SYNTHESIS_MAX_CHARS or reduce duplicate source documents.`);
  }

  const prompt = `You are the FINAL authoritative extraction stage for an international tender.
The JSON below contains tender-level candidates and position fragments extracted independently from document segments. These are candidate observations, not the final record.

Produce the complete final tender object now. The result will be shown directly to the user and stored without any later factual repair.

MANDATORY FINALIZATION RULES:
1. Return exactly one position record per real required role within the same lot/package. Merge numbered, prefixed, reordered, abbreviated, and detailed-title variants when they describe the same person. Keep genuinely separate lots or packages separate.
2. Combine each role's title, quantity, education, general experience, specific experience, duties, location, input months, skills, certifications, languages, and evaluation details from every matching fragment.
3. When the source states different minimum years for the same role, retain the stricter explicit requirement and preserve evidence for it. Never weaken a requirement.
4. Do not invent, infer from general industry practice, or transfer a requirement from one role to another. A fact must be supported by the supplied fragment evidence.
5. Reject headings, consultant/company obligations, forms, clauses, institutions, and sentence fragments. They are not personnel roles.
6. Tender title, client, number, deadline, scope, and duration must describe the procurement itself, not a later contract subsection or example project.
7. Keep source pages, quotes, and field evidence internally in the JSON for validation, but do not turn them into business requirements.
8. If a field is not stated, leave it empty. Do not output commentary or reasoning inside any field.
9. Perform a silent completeness check before responding. Return only schema-valid JSON.

SEMANTIC FIELD CONTRACT:
- position_title = occupational/job role only. Example: "K-1: Resident Engineer (1 No.)" becomes position_title "Resident Engineer", source_position_number 1, quantity 1.
- source_position_number = hidden row/reference number such as the 1 in K-1. Never repeat K-1 in position_title.
- quantity = number of people required, never part of position_title.
- minimum_education = degree, diploma, and academic discipline requirements only. Do NOT put registration, licences, chartership, practising certificates, or memberships here.
- minimum_years_experience = overall minimum years as a number.
- general_experience = broad professional or sector experience requirements.
- specific_experience = role-, project-, country-, assignment-, or task-specific experience requirements.
- role_description = duties, responsibilities, functions, tasks, and expected activities, not qualifications or years.
- role_duties_status = explicit, tor_scope, not_stated, or needs_review. Never leave duties ambiguous: use explicit for role-specific duties, tor_scope for general TOR-derived duties, not_stated when searched and absent, and needs_review when possible duties may have been missed.
- input_months = staff effort/man-months, not quantity or experience.
- work_location = actual assignment/project/work location only.
- required_sector_experience = source-stated sector/domain experience only.
- mandatory_skills = explicit non-software competencies only.
- required_software = named software/tools only.
- required_certifications = certifications, licences, permits, professional registration, or chartership only.
- professional_memberships = membership in professional bodies only.
- required_languages = explicit language/proficiency requirements only; never infer from tender language.
- regional_experience = explicit regional/multi-country experience only.
- country_experience = explicit named-country experience only.
- nationality_preference = explicit nationality/citizenship requirement only; never default to Any.
- residency_requirement = explicit residence/local presence/local registration requirement only.
- position_deliverables = outputs explicitly assigned to that role only.
- evaluation_points = numeric scoring points only; not quantity, years, months, or page numbers.
- required_keywords = short source-grounded matching terms only; do not invent synonyms.
- Understand the meaning of table columns and surrounding headings before assigning any value. Do not copy an entire row into one field.

REAL TENDER FIELD EXAMPLES:
- "K-1: Senior Highway Design Engineer /Team Leader for Design Update 10" means source_position_number=1, position_title="Senior Highway Design Engineer / Team Leader for Design Update", evaluation_points=10. The "K-1" and "10" must not be part of the title.
- "Registered/Chartered Engineer with Valid practising certificate" belongs in required_certifications or professional_memberships, not in required_languages or general_experience.
- "Should have a minimum of a Master's Degree in Civil Engineering, Highways, Geotechnical Engineering" belongs in minimum_education.
- "15 years post-graduate experience..." belongs in general_experience and minimum_years_experience=15. Role/project-specific parts such as "as Design Engineer" or "at least three projects of similar setting" belong in specific_experience / minimum_similar_projects.
- "Staff Position Qualification" tables mean the first column is position_title and the qualification cell maps into minimum_education / certifications / experience depending on wording.
- "Resident Engineer: One" means position_title="Resident Engineer" and quantity=1.
- "Senior Laboratory Technician Higher Diploma (HD) in Civil Engineering or related discipline with minimum of 10years' experience in similar position on civil and construction projects. Experience in similar geographical conditions, ideally in Uganda is added advantage" means position_title="Senior Laboratory Technician", minimum_education="Higher Diploma (HD) in Civil Engineering or related discipline", minimum_years_experience=10, general_experience includes the 10 years wording, and specific_experience includes similar civil/construction projects plus Uganda/geographical-condition experience.
- "Regional experience is mandatory" belongs in regional_experience.
- "Fluency in English" or "fluent in written and spoken English" belongs in required_languages.
- "AutoCAD", "Primavera", "MS Project", "GIS", and similar named tools belong in required_software, not mandatory_skills.
- General supervision scope such as "comprehensive supervision of project activities" can support role_description only with role_duties_status="tor_scope" when duties are not separately stated under the role.

CANDIDATE EXTRACTION JSON:
${payload}`;
  const generateFinal = async (promptText: string) => {
    const response = await callGenAIWithRetry((modelName) => getAI().models.generateContent({
      model: modelName,
      contents: [{ role: "user", parts: [{ text: promptText }] }],
      config: { responseMimeType: "application/json", responseSchema: tenderSchema, temperature: 0 },
    }), models);
    return sanitizeExtractedValues(parseGenAIJSON(response.text || "{}"));
  };
  const roleKey = (position: any) => String(position?.position_title || position?.title || "")
    .toLowerCase()
    .replace(/^\s*k\s*[-.]?\s*\d+\s*[:.)-]?\s*/i, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  const numberWord = (value: any) => ({
    1: "one", 2: "two", 3: "three", 4: "four", 5: "five", 6: "six", 7: "seven", 8: "eight", 9: "nine", 10: "ten",
    11: "eleven", 12: "twelve", 13: "thirteen", 14: "fourteen", 15: "fifteen", 16: "sixteen", 17: "seventeen", 18: "eighteen", 19: "nineteen", 20: "twenty",
    21: "twenty one", 22: "twenty two", 23: "twenty three", 24: "twenty four", 25: "twenty five", 26: "twenty six", 27: "twenty seven", 28: "twenty eight", 29: "twenty nine", 30: "thirty",
  } as Record<number, string>)[Number(value)] || "";
  const evidenceValueMatches = (quote: any, value: any) => {
    const quoteText = String(quote || "");
    const rawValue = String(value || "").trim();
    if (!quoteText || !rawValue) return false;
    if (/^\d+(?:\.\d+)?$/.test(rawValue)) {
      const word = numberWord(rawValue);
      const escaped = rawValue.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      return new RegExp(`\\b${escaped}\\b`).test(quoteText) || (word ? new RegExp(`\\b${word.replace(/\s+/g, "\\s+")}\\b`, "i").test(quoteText) : false);
    }
    const valueTokens = rawValue.toLowerCase().replace(/[^a-z0-9]+/g, " ").split(/\s+/).filter((token) => token.length >= 4);
    const quoteTokens = new Set(quoteText.toLowerCase().replace(/[^a-z0-9]+/g, " ").split(/\s+/).filter(Boolean));
    if (!valueTokens.length) return false;
    const hits = valueTokens.filter((token) => quoteTokens.has(token)).length;
    return hits >= Math.min(3, valueTokens.length) || hits / valueTokens.length >= 0.35;
  };
  const hydrateFieldEvidence = (position: any) => {
    const existingEvidence = Array.isArray(position?.field_evidence) ? position.field_evidence : [];
    const evidenceFields = new Set(existingEvidence.map((item: any) => String(item?.field || "").toLowerCase()));
    const sourceQuotes = Array.from(new Set([
      ...(Array.isArray(position?.source_quotes) ? position.source_quotes : []),
      ...existingEvidence.map((item: any) => item.quote),
    ].filter(Boolean)));
    const sourcePages = (Array.isArray(position?.source_page_numbers) ? position.source_page_numbers : [])
      .map(Number)
      .filter((page: number) => Number.isInteger(page) && page > 0);
    const pageNumber = sourcePages[0] || 1;
    const fields = [
      "position_title",
      "quantity",
      "minimum_education",
      "minimum_years_experience",
      "minimum_specific_years",
      "general_experience",
      "specific_experience",
      "role_description",
      "input_months",
      "work_location",
      "nationality_preference",
    ];
    const hydrated = [...existingEvidence];
    for (const field of fields) {
      const value = position?.[field];
      if (value === undefined || value === null || !String(value).trim() || evidenceFields.has(field)) continue;
      const quote = sourceQuotes.find((candidate) => evidenceValueMatches(candidate, value));
      if (quote) {
        hydrated.push({ field, page_number: pageNumber, quote });
        evidenceFields.add(field);
      }
    }
    return hydrated;
  };
  const mergeEvidenceIntoFinalPositions = (tender: any) => {
    const sourcePositions = [
      ...(Array.isArray(candidate?.positions) ? candidate.positions : []),
      ...positionFragments,
    ];
    return {
      ...tender,
      positions: (Array.isArray(tender?.positions) ? tender.positions : []).map((position: any) => {
        const finalKey = roleKey(position);
        const finalNumber = Number(position?.source_position_number || 0) || 0;
        const matches = sourcePositions.filter((source: any) => {
          const sourceKey = roleKey(source);
          const sourceNumber = Number(source?.source_position_number || 0) || 0;
          if (finalNumber && sourceNumber && finalNumber === sourceNumber) return true;
          if (!finalKey || !sourceKey) return false;
          return finalKey === sourceKey || finalKey.includes(sourceKey) || sourceKey.includes(finalKey);
        });
        const fieldEvidence = new Map<string, any>();
        [...matches, position].forEach((source: any) => {
          (Array.isArray(source?.field_evidence) ? source.field_evidence : []).forEach((evidence: any) => {
            const key = `${String(evidence?.field || "").toLowerCase()}|${Number(evidence?.page_number || 0)}|${String(evidence?.quote || "")}`;
            if (String(evidence?.field || "").trim() && Number(evidence?.page_number || 0) > 0 && String(evidence?.quote || "").trim()) {
              fieldEvidence.set(key, evidence);
            }
          });
        });
        const mergedPosition = {
          ...position,
          source_page_numbers: Array.from(new Set([
            ...(Array.isArray(position?.source_page_numbers) ? position.source_page_numbers : []),
            ...matches.flatMap((source: any) => Array.isArray(source?.source_page_numbers) ? source.source_page_numbers : []),
          ].map(Number).filter((page: number) => Number.isInteger(page) && page > 0))).sort((a, b) => a - b),
          source_quotes: Array.from(new Set([
            ...(Array.isArray(position?.source_quotes) ? position.source_quotes : []),
            ...matches.flatMap((source: any) => Array.isArray(source?.source_quotes) ? source.source_quotes : []),
          ].filter(Boolean))),
          field_evidence: Array.from(fieldEvidence.values()),
        };
        return {
          ...mergedPosition,
          field_evidence: hydrateFieldEvidence(mergedPosition),
        };
      }),
    };
  };
  let finalized = await generateFinal(prompt);
  finalized = mergeEvidenceIntoFinalPositions(finalized);
  if (!Array.isArray(finalized?.positions) || finalized.positions.length === 0) {
    throw new Error("Final tender synthesis did not return any valid personnel positions.");
  }
  let semanticIssues = validateTenderFieldSemantics(finalized);
  if (semanticIssues.length > 0) {
    finalized = mergeEvidenceIntoFinalPositions(await generateFinal(`${prompt}

SEMANTIC VALIDATION RETRY:
Your previous final result failed these field-meaning checks:
${semanticIssues.map((issue) => `- ${issue}`).join("\n")}

Previous result:
${JSON.stringify(finalized)}

Rebuild the final tender object from the candidate extraction. Correct every field-placement problem. Preserve field_evidence from the source fragments for every populated field. In particular, position_title must contain only the clean occupational role and never K-1, numbering, quantity, qualification, experience, or duties. Return only the corrected schema-valid JSON.`));
    semanticIssues = validateTenderFieldSemantics(finalized);
  }
  if (!Array.isArray(finalized?.positions) || finalized.positions.length === 0) {
    throw new Error("Final tender synthesis did not return any valid personnel positions.");
  }

  return {
    ...candidate,
    ...finalized,
    positions: finalized.positions,
    page_classifications: candidate.page_classifications,
    extraction_warnings: Array.from(new Set([
      ...(candidate.extraction_warnings || []),
      ...(finalized.extraction_warnings || []),
      ...semanticIssues.map((issue) => `Review required: ${issue}`),
    ])),
    review_required: Boolean(candidate.review_required || finalized.review_required || semanticIssues.length > 0),
    tender_field_evidence: Array.isArray(finalized.tender_field_evidence) && finalized.tender_field_evidence.length
      ? finalized.tender_field_evidence
      : candidate.tender_field_evidence,
  };
}

export async function runParseTenderPdfFiles(files: TenderPdfInput[]): Promise<any> {
  if (!files.length) throw new Error("At least one tender PDF is required.");
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "via-tender-"));
  const segmentSize = Math.max(10, Math.min(100, Number(process.env.TENDER_PDF_SEGMENT_PAGES || 25)));
  const maxPages = Math.max(1, Number(process.env.TENDER_MAX_PAGES || 2000));
  const segments: Array<{ path: string; fileName: string; firstPage: number; lastPage: number }> = [];
  const sourcePageTexts: Array<{ page_number: number; text: string }> = [];
  let totalPages = 0;

  try {
    for (const file of files) {
      const sourceBytes = await fs.readFile(file.path);
      const sourcePdf = await PDFDocument.load(sourceBytes, { ignoreEncryption: false });
      const filePages = sourcePdf.getPageCount();
      if (totalPages + filePages > maxPages) {
        throw new Error(`Tender contains ${totalPages + filePages} pages. The configured maximum is ${maxPages}.`);
      }
      const documentPageOffset = totalPages;
      totalPages += filePages;
      let parser: PDFParse | undefined;
      try {
        parser = new PDFParse({ data: sourceBytes });
        const textResult = await parser.getText();
        textResult.pages.forEach((page, pageIndex) => {
          sourcePageTexts.push({ page_number: documentPageOffset + pageIndex + 1, text: page.text || "" });
        });
      } catch (error) {
        console.warn(`[Tender extraction] Native text-layer page indexing failed for ${file.originalname}:`, error);
      } finally {
        await parser?.destroy().catch(() => undefined);
      }

      if (getTenderExtractionMode() === "deep") {
        const segmentStep = Math.max(1, segmentSize - 2);
        for (let start = 0; start < filePages; start += segmentStep) {
          const end = Math.min(filePages, start + segmentSize);
          const segmentPdf = await PDFDocument.create();
          const copiedPages = await segmentPdf.copyPages(sourcePdf, Array.from({ length: end - start }, (_, index) => start + index));
          copiedPages.forEach((page) => segmentPdf.addPage(page));
          const segmentPath = path.join(tempDir, `segment-${segments.length + 1}.pdf`);
          await fs.writeFile(segmentPath, await segmentPdf.save());
          segments.push({
            path: segmentPath,
            fileName: file.originalname,
            firstPage: documentPageOffset + start + 1,
            lastPage: documentPageOffset + end,
          });
        }
      }
    }

    if (getTenderExtractionMode() !== "deep") {
      const pageSelection = selectEconomyTenderPageTexts(sourcePageTexts);
      const tenderText = sourcePageTextsToTenderText(pageSelection.selectedPages);
      if (tenderText.replace(/--- PAGE \d+ ---/g, "").trim().length >= 1000) {
        const tender = await runParseTenderTextEconomy(tenderText, sourcePageTexts);
        tender.extraction_audit = {
          ...(tender.extraction_audit || {}),
          source: "pdf_text_layer_filtered",
          totalPages,
          pagesSentToAI: pageSelection.selectedPages.length,
          pagesSkippedBeforeAI: pageSelection.skippedPages.length,
          skippedPageNumbers: pageSelection.skippedPages.slice(0, 200),
          pageFilterReductionPercent: totalPages ? Math.round((pageSelection.skippedPages.length / totalPages) * 100) : 0,
          segmentSize: null,
          segmentCount: 0,
        };
        return tender;
      }
      console.warn("[Tender extraction] Economy mode could not find enough PDF text-layer content; falling back to deep PDF vision extraction.");
    }

    const modelNames = getTenderDeepModels();
    const classificationModels = [process.env.TENDER_CLASSIFICATION_MODEL || "gemini-3.5-flash", modelNames[0]];
    const deterministicTableContexts = inferTenderTableContextsFromText(sourcePageTexts);
    const aiTableContexts = await extractTenderTableContexts(sourcePageTexts, classificationModels);
    const tableContexts = [...deterministicTableContexts, ...aiTableContexts]
      .filter((context, index, values) =>
        values.findIndex((other) => other.first_data_page === context.first_data_page && other.last_data_page === context.last_data_page && other.header_page === context.header_page) === index,
      );
    const results = await mapWithConcurrency(
      segments,
      Number(process.env.TENDER_EXTRACTION_CONCURRENCY || 2),
      async (segment, index) => {
        const ai = getAI();
        const uploadedNames: string[] = [];
        const uploadReadyPdf = async (filePath: string, displayName: string) => {
          const uploaded = await ai.files.upload({ file: filePath, config: { mimeType: "application/pdf", displayName } });
          if (!uploaded.name) throw new Error("Gemini did not return an uploaded PDF file name.");
          uploadedNames.push(uploaded.name);
          let readyFile = uploaded;
          for (let attempt = 0; readyFile.state === FileState.PROCESSING && attempt < 60; attempt++) {
            await new Promise((resolve) => setTimeout(resolve, 2000));
            readyFile = await ai.files.get({ name: uploaded.name });
          }
          if (readyFile.state === FileState.FAILED) throw new Error(`Gemini failed to process PDF segment ${index + 1}.`);
          if (!readyFile.uri || !readyFile.mimeType) throw new Error("Gemini did not return a ready PDF URI.");
          return readyFile;
        };
        const classificationFile = await uploadReadyPdf(
          segment.path,
          `${segment.fileName} classification pages ${segment.firstPage}-${segment.lastPage}`,
        );

        try {
          const inheritedTableContexts = getTenderTableContextsForRange(tableContexts, segment.firstPage, segment.lastPage);
          const segmentContext = `This is segment ${index + 1} of ${segments.length}, covering GLOBAL tender pages ${segment.firstPage}-${segment.lastPage} from ${segment.fileName}. Local PDF page 1 is global page ${segment.firstPage}. Every returned page number must use global numbering.
PERSISTENT TABLE CONTEXT: ${inheritedTableContexts.length ? JSON.stringify(inheritedTableContexts) : "No inherited table header was identified for this page range."}
When a visible page contains table rows without a repeated header, apply the inherited column meanings above. Continue mapping each cell to the same semantic field until the table ends. Never reinterpret a continuation row as a new header.`;
          const callPdfPass = async (
            file: { uri?: string; mimeType?: string },
            prompt: string,
            models: string[],
            resolution = PartMediaResolutionLevel.MEDIA_RESOLUTION_HIGH,
          ) => {
            if (!file.uri || !file.mimeType) throw new Error("A ready Gemini PDF file is required.");
            const response = await callGenAIWithRetry(
              (modelName) => ai.models.generateContent({
                model: modelName,
                contents: [{
                  role: "user",
                  parts: [createPartFromUri(file.uri!, file.mimeType!, resolution), { text: prompt }],
                }],
                config: { responseMimeType: "application/json", responseSchema: tenderSchema },
              }),
              models,
            );
            return sanitizeExtractedValues(parseGenAIJSON(response.text || "{}"));
          };

          const roleRegisterPrompt = `You are STAGE 1 and STAGE 3 of a tender extraction pipeline: page classification plus authoritative personnel register.
${segmentContext}
STAGE 1 - PAGE CLASSIFICATION:
Return exactly one page_classifications entry for EVERY page ${segment.firstPage}-${segment.lastPage}, including blank, scanned, contractual, and irrelevant pages. Categories must use: overview, deadline, scope, deliverables, staff_schedule, role_requirements, evaluation, eligibility, contract_clause, forms, financial, or irrelevant. Mark readability CLEAR, PARTIAL, or UNREADABLE and report OCR/layout warnings.

STAGE 3 - POSITION REGISTER ONLY:
Extract positions ONLY when the page proves the bidder must provide that person. Preserve source position number, lot reference, category, location, quantity, input months, key/non-key status, and exact clean occupational title.
If the source says "K1 Team Leader", "K-2 Railway Engineer", or "Position K3 Environmental Specialist", store only "Team Leader", "Railway Engineer", or "Environmental Specialist" in position_title. Put the numeric K reference in source_position_number only.
Do not extract education, experience, responsibilities, certifications, languages, or skills in this stage unless they are needed as short source quotes proving the role exists.
Reject company obligations, eligibility documents, institutions, proposal instructions, headings, adjudicator authorities, risks, and sentence fragments.
For every populated position field, include field_evidence with exact field name, global page number, and short verbatim quote. Do not assume missing values. Return only schema-valid JSON.`;

          const tenderLevelFactsPrompt = `You are STAGE 2 of a tender extraction pipeline: tender-level procurement facts only.
${segmentContext}
Extract only tender-level facts:
- tender_title, client, country, tender_number, deadline, duration, submission_type, tender_format
- project_sector, scope_summary, objectives, deliverables, eligibility_requirements, evaluation_criteria, special_requirements, global_team_constraints
Do not extract positions in this stage. Do not copy proposal form placeholders as real facts. Tender title, client, number, deadline, scope, and duration must describe the procurement itself, not a later contract template or example section.
For every populated tender-level field, add tender_field_evidence with exact field name, global page number, and short verbatim quote. Return only schema-valid JSON.`;

          const positionRequirementsPrompt = (positionSeeds: any[]) => `You are STAGE 4 of a tender extraction pipeline: requirements per known position.
${segmentContext}
Known position register for this segment:
${JSON.stringify(positionSeeds.map((position: any) => ({
  position_title: position.position_title,
  source_position_number: position.source_position_number,
  lot_reference: position.lot_reference,
  expert_category: position.expert_category,
  work_location: position.work_location,
  quantity: position.quantity,
})), null, 2)}

Extract requirements ONLY for these known positions. Search the rendered PDF visually and textually, including table continuation rows that inherit headers from prior pages.
Position titles must remain clean occupational roles only. Never write K1, K-2, Position K3, row numbers, quantities, or lot codes into position_title.
For each known position found in this segment, extract education, general experience, specific experience, sector/project experience, professional registration, certifications, skills, software, memberships, languages, regional/country experience, nationality/residency, similar project requirements, evaluation points, and input months if stated.
Field placement rules:
- required_sector_experience = explicit domain/sector experience such as railway, road, bridge, urban transport, water, power, buildings.
- mandatory_skills = explicit non-software abilities/capabilities, not degrees, years, languages, or software.
- required_software = named software/tools only.
- required_certifications = licences, permits, chartership, professional registration, safety/environmental certifications.
- professional_memberships = membership in professional institutions/bodies only.
- required_languages = explicit language and proficiency requirements only.
- regional_experience = regional/multi-country area requirements only.
- country_experience = named-country experience requirements only.
- required_keywords = short source-grounded matching terms, never invented synonyms.
- nationality_preference = explicit nationality/citizenship only; never default to Any.
- residency_requirement = explicit residence/local presence/local registration only.
- position_deliverables = outputs assigned to this role only; general tender deliverables stay tender-level.
- evaluation_points = numeric scoring points only; not quantity, years, months, or page numbers.
Examples from the real tender formats:
- "K-1: Senior Highway Design Engineer /Team Leader for Design Update 10" means source_position_number=1, position_title="Senior Highway Design Engineer / Team Leader for Design Update", evaluation_points=10.
- "Registered/Chartered Engineer with Valid practising certificate" is a certification/registration requirement.
- "Master's Degree in Civil Engineering, Highways, Geotechnical Engineering" is minimum_education.
- "15 years post-graduate experience" is general_experience and minimum_years_experience=15.
- "at least three projects of similar setting" is specific_experience and minimum_similar_projects=3.
- "Resident Engineer: One" means quantity=1.
- "Senior Laboratory Technician Higher Diploma (HD) in Civil Engineering or related discipline with minimum of 10years' experience in similar position on civil and construction projects. Experience in similar geographical conditions, ideally in Uganda is added advantage" is a real staff role, not boilerplate. Extract the role, education, 10 years experience, civil/construction project experience, and Uganda/geographical-condition preference.
- "Regional experience is mandatory" is regional_experience.
- Named software/tools such as AutoCAD, Primavera, MS Project, GIS, or BIM belong in required_software, not mandatory_skills.
Do not extract duties/responsibilities in this stage unless they are inseparable from an explicit experience requirement. Do not transfer requirements from one role to another. If a requirement is not stated for a position, leave that field empty.
For every populated position field, add field_evidence with exact field name, global page number, and verbatim quote. Return only schema-valid JSON.`;

          const dutiesPrompt = (positionSeeds: any[]) => `You are STAGE 5 of a tender extraction pipeline: duties and TOR responsibilities.
${segmentContext}
Known position register for this segment:
${JSON.stringify(positionSeeds.map((position: any) => ({
  position_title: position.position_title,
  source_position_number: position.source_position_number,
  lot_reference: position.lot_reference,
  expert_category: position.expert_category,
  work_location: position.work_location,
})), null, 2)}

Extract role_description and position_deliverables ONLY for these known positions.
Position titles must remain clean occupational roles only. Never write K1, K-2, Position K3, row numbers, quantities, or lot codes into position_title.
First look for duties, tasks, responsibilities, functions, assignment activities, outputs, or deliverables stated under each role.
If the tender does not separately state duties for a role but gives general TOR tasks that clearly apply to the expert team, write a concise source-grounded role_description beginning with: "Not separately stated for this role; responsibilities derive from TOR scope:" and then include the relevant TOR task wording. Attach field_evidence quotes from the TOR scope pages.
Set role_duties_status to "explicit" when duties are directly stated under the role, "tor_scope" when duties derive only from general TOR scope, "not_stated" when this segment was searched and no duties are present, or "needs_review" when possible duties exist but cannot be confidently mapped.
If no role-specific or applicable TOR duty text is present in this segment, leave role_description empty and set role_duties_status to "not_stated". Never invent duties from job title alone.
Do not extract education, experience, quantity, or nationality in this stage. For every populated field, add field_evidence with exact field name, global page number, and verbatim quote. Return only schema-valid JSON.`;

          const expectedPages = Array.from({ length: segment.lastPage - segment.firstPage + 1 }, (_, offset) => segment.firstPage + offset);
          const weakTextLayerPages = sourcePageTexts
            .filter((page) => page.page_number >= segment.firstPage && page.page_number <= segment.lastPage && String(page.text || "").trim().length < 120)
            .map((page) => page.page_number);
          const registerResult = await callPdfPass(classificationFile, roleRegisterPrompt, classificationModels);
          const routing = selectTenderPagesForPro(
            registerResult.page_classifications || [],
            segment.firstPage,
            segment.lastPage,
            {
              confidenceThreshold: Number(process.env.TENDER_RELEVANCE_CONFIDENCE || 0.85),
              contextRadius: Number(process.env.TENDER_RELEVANCE_CONTEXT_PAGES || 2),
              tableContexts: inheritedTableContexts,
              forcedPages: weakTextLayerPages,
            },
          );

          let extractionFile = classificationFile;
          let extractionContext = segmentContext;
          if (routing.selectedPages.length > 0 && routing.selectedPages.length < expectedPages.length) {
            const sourceSegment = await PDFDocument.load(await fs.readFile(segment.path));
            const filteredPdf = await PDFDocument.create();
            const localIndexes = routing.selectedPages.map((page) => page - segment.firstPage);
            const copiedPages = await filteredPdf.copyPages(sourceSegment, localIndexes);
            copiedPages.forEach((page) => filteredPdf.addPage(page));
            const filteredPath = path.join(tempDir, `relevant-${index + 1}.pdf`);
            await fs.writeFile(filteredPath, await filteredPdf.save());
            extractionFile = await uploadReadyPdf(
              filteredPath,
              `${segment.fileName} relevant pages ${routing.selectedPages.join(",")}`,
            );
            extractionContext = `${segmentContext}\nFILTERED PDF LOCAL-TO-GLOBAL PAGE MAP: ${routing.selectedPages.map((page, localIndex) => `${localIndex + 1}=>${page}`).join(", ")}. Only these selected pages are present in this PDF.`;
          }

          const positionSeeds = Array.isArray(registerResult.positions) ? registerResult.positions : [];
          const stagedResults = routing.selectedPages.length
            ? await Promise.all([
              callPdfPass(extractionFile, tenderLevelFactsPrompt.replace(segmentContext, extractionContext), modelNames),
              positionSeeds.length
                ? callPdfPass(extractionFile, positionRequirementsPrompt(positionSeeds).replace(segmentContext, extractionContext), modelNames)
                : Promise.resolve({}),
              positionSeeds.length
                ? callPdfPass(extractionFile, dutiesPrompt(positionSeeds).replace(segmentContext, extractionContext), modelNames)
                : Promise.resolve({}),
            ])
            : [];
          let combined = mergeTenderExtractions([registerResult, ...stagedResults]);
          const classifiedPages = new Set((combined.page_classifications || []).map((item: any) => Number(item.page_number)));
          const missingPages = expectedPages.filter((page) => !classifiedPages.has(page));
          const lowReadabilityPages = (combined.page_classifications || [])
            .filter((item: any) => expectedPages.includes(Number(item.page_number)) && (item.readability !== "CLEAR" || Number(item.confidence || 0) < 0.75))
            .map((item: any) => Number(item.page_number));
          const incompletePositions = (combined.positions || []).filter((position: any) =>
            missingTenderRoleDetailCount(position) > 0 || !Array.isArray(position.field_evidence) || position.field_evidence.length === 0,
          );

          if (missingPages.length || lowReadabilityPages.length || incompletePositions.length) {
            const repairPrompt = `You are STAGE 6 repair and validation for this tender segment.
${segmentContext}
Missing page classifications: ${JSON.stringify(missingPages)}
Low-readability pages requiring OCR/layout recovery: ${JSON.stringify(lowReadabilityPages)}
Positions requiring repair: ${JSON.stringify(incompletePositions.map((position: any) => ({
  position_title: position.position_title,
  source_position_number: position.source_position_number,
  lot_reference: position.lot_reference,
  missing_fields: ["minimum_education", "general_experience", "specific_experience", "role_description"].filter((field) => !String(position[field] || "").trim()),
})), null, 2)}
Re-read the PDF visually. Return every missing page classification and complete listed role fields only where present.
For role_description, if no duties are separately stated under the position but general TOR scope clearly applies to the expert team, begin with "Not separately stated for this role; responsibilities derive from TOR scope:" and attach TOR source evidence.
Set role_duties_status to explicit, tor_scope, not_stated, or needs_review for every repaired role.
Attach field_evidence to every populated field. Keep roles separate by lot, position number, category, and location. Never invent absent facts.`;
            combined = mergeTenderExtractions([
              combined,
              await callPdfPass(
                extractionFile,
                repairPrompt.replace(segmentContext, extractionContext),
                modelNames,
                PartMediaResolutionLevel.MEDIA_RESOLUTION_ULTRA_HIGH,
              ),
            ]);
          }

          combined.positions = (combined.positions || []).map((position: any) => ({
            ...position,
            source_document: position.source_document || segment.fileName,
          }));
          combined.extraction_routing = {
            total_pages: expectedPages.length,
            pro_pages: routing.selectedPages,
            skipped_pages: routing.skippedPages,
            classifier_model: classificationModels[0],
            extraction_model: modelNames[0],
            weak_text_layer_pages: weakTextLayerPages,
            stages: [
              "page_classification",
              "tender_level_facts",
              "position_register",
              "position_requirements",
              "duties_and_tor_responsibilities",
              "repair_and_validation",
            ],
          };
          return combined;
        } finally {
          await Promise.all(uploadedNames.map((name) => ai.files.delete({ name }).catch(() => undefined)));
        }
      },
    );

    const extracted = results
      .filter((result): result is PromiseFulfilledResult<any> => result.status === "fulfilled")
      .map((result) => result.value);
    const failedSegments = results.filter((result) => result.status === "rejected").length;
    if (!extracted.length) throw new Error("All native PDF extraction segments failed.");

    const proPageSet = new Set<number>();
    const classifierPageSet = new Set<number>();
    const weakTextLayerPageSet = new Set<number>();
    extracted.forEach((item: any) => {
      (item.extraction_routing?.pro_pages || []).forEach((page: any) => proPageSet.add(Number(page)));
      (item.extraction_routing?.weak_text_layer_pages || []).forEach((page: any) => weakTextLayerPageSet.add(Number(page)));
      (item.page_classifications || []).forEach((classification: any) => classifierPageSet.add(Number(classification.page_number)));
    });
    const mergedSegmentExtraction = mergeTenderExtractions(extracted);
    const positionFirstExtraction = await repairTenderRolesFromFullDocumentContext(
      mergedSegmentExtraction,
      sourcePageTextsToTenderText(sourcePageTexts),
      modelNames,
    );
    const auditedExtraction = await auditTenderExtractionWithAI(
      positionFirstExtraction,
      sourcePageTextsToTenderText(sourcePageTexts),
      modelNames,
    );
    const finalizedExtraction = await finalizeTenderExtraction([auditedExtraction], modelNames);
    const tender = normalizeTenderRecord(reconcileTenderEvidencePages(finalizedExtraction, sourcePageTexts));
    if (tender.positions.length !== finalizedExtraction.positions.length) {
      tender.extraction_warnings = Array.from(new Set([
        ...(tender.extraction_warnings || []),
        `Final synthesis returned ${finalizedExtraction.positions.length} position records; validation kept ${tender.positions.length} distinct valid role(s). Review the cleaned position list.`,
      ]));
      tender.review_required = true;
    }
    if (Array.isArray(tender.extraction_blocking_issues) && tender.extraction_blocking_issues.length > 0) {
      tender.extraction_warnings = Array.from(new Set([
        ...(tender.extraction_warnings || []),
        ...tender.extraction_blocking_issues.map((issue: string) => `Review required: ${issue}`),
      ]));
      tender.extraction_blocking_issues = [];
      tender.review_required = true;
    }
    const classifiedPageNumbers = new Set((tender.page_classifications || []).map((item: any) => Number(item.page_number)));
    const missingPageClassifications = Array.from({ length: totalPages }, (_, index) => index + 1).filter((page) => !classifiedPageNumbers.has(page));
    const lowReadabilityPages = (tender.page_classifications || [])
      .filter((item: any) => item.readability !== "CLEAR" || Number(item.confidence || 0) < 0.75)
      .map((item: any) => Number(item.page_number));
    const coverageWarnings = [
      ...(missingPageClassifications.length ? [`Page classification missing for ${missingPageClassifications.length} page(s): ${missingPageClassifications.slice(0, 50).join(", ")}${missingPageClassifications.length > 50 ? "..." : ""}.`] : []),
      ...(lowReadabilityPages.length ? [`${lowReadabilityPages.length} page(s) require visual review because OCR/layout confidence is low: ${lowReadabilityPages.slice(0, 50).join(", ")}${lowReadabilityPages.length > 50 ? "..." : ""}.`] : []),
    ];
    tender.extraction_warnings = Array.from(new Set([...(tender.extraction_warnings || []), ...coverageWarnings]));
    tender.review_required = tender.extraction_warnings.length > 0;
    const validation = validateExtractedTender(tender);
    tender.extraction_audit = {
      pipeline: "native-pdf-vision + staged-page-classification + tender-level-facts + position-register + deterministic-table-context + per-position-requirements + duties-tor-responsibilities + visual-layout-recovery + segment-repair + position-first-full-document-role-search + second-ai-audit + mandatory-final-ai-synthesis + internal-evidence-validation",
      model: modelNames[0],
      totalPages,
      segmentSize,
      segmentCount: segments.length,
      failedSegments,
      allPagesProcessed: failedSegments === 0 && missingPageClassifications.length === 0,
      classifiedPageCount: classifiedPageNumbers.size,
      missingPageClassifications,
      lowReadabilityPages,
      tableContextsDetected: tableContexts.length,
      deterministicTableContextsDetected: deterministicTableContexts.length,
      aiTableContextsDetected: aiTableContexts.length,
      weakTextLayerPages: Array.from(weakTextLayerPageSet).sort((a, b) => a - b),
      pageRouting: {
        classifierModel: classificationModels[0],
        extractionModel: modelNames[0],
        pagesClassified: classifierPageSet.size,
        pagesSentToPro: proPageSet.size,
        pagesSkippedByPro: Math.max(0, totalPages - proPageSet.size),
        proReductionPercent: totalPages ? Math.round((1 - proPageSet.size / totalPages) * 100) : 0,
      },
      validationIssues: validation.issues,
      extractedAt: new Date().toISOString(),
    };
    if (failedSegments > 0) {
      tender.extraction_warnings = [
        ...(tender.extraction_warnings || []),
        `${failedSegments} of ${segments.length} PDF segments failed extraction and must be retried.`,
      ];
      tender.review_required = true;
    }
    return sanitizeExtractedValues(tender);
  } finally {
    await Promise.all(files.map((file) => fs.unlink(file.path).catch(() => undefined)));
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
  }
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
