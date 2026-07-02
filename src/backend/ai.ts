import { GoogleGenAI, Type, Schema } from '@google/genai';
import { ALL_PRIMARY_POSITIONS } from '../lib/constants.ts';
import { extractUniversalTenderFacts, mergeSourceEvidence } from '../lib/universalExtraction.ts';

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
          dateOfBirth: { type: Type.STRING, description: "Format: YYYY-MM-DD or as found." },
          countryOfCitizenship: { type: Type.STRING, description: "The nationality or citizenship of the expert." },
          email: { type: Type.STRING, description: "The expert's email address if present." },
          phone: { type: Type.STRING, description: "The expert's phone number if present." },
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
              educations: { type: Type.ARRAY, description: "CRITICAL: Extract ALL educational degrees, diplomas, and certificates in exhaustive detail. NEVER just say 'Diploma' or 'Degree'. You MUST include the full degree name AND the specific field of study (e.g., 'Diploma in Civil Engineering', 'BSc in Architecture'). Include institution, institution location/country, and year whenever present. DO NOT write 'Not stated' or 'Ongoing', just omit or leave blank.", items: { type: Type.OBJECT, properties: { degree: { type: Type.STRING, description: "The full formal title of the degree (e.g., Bachelor of Science, Diploma)." }, field: { type: Type.STRING, description: "CRITICAL: The specific major or field of study (e.g., Civil Engineering, Computer Science). Never leave this blank if mentioned." }, institution: { type: Type.STRING }, year: { type: Type.STRING }, location: { type: Type.STRING, description: "Institution city/state/country exactly as stated, e.g. 'Hamirpur, India' or 'India'. Do not omit country if the CV states it." }, grade: { type: Type.STRING }, notes: { type: Type.STRING } } } },
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

export async function runParseCVText(text: string, tax: string[]): Promise<any[]> {
  const taxonomy = (tax && tax.length > 0) ? tax : ALL_PRIMARY_POSITIONS;
  const prompt = `You are the world's most aggressive and meticulous expert profile extraction AI.
  Your absolute directive is to parse the provided CV text line-by-line and extract EVERY SINGLE scrap of useful information into the structured format. NO DETAILS IGNORED.
  
  CRITICAL INTELLIGENCE & INFERENCE RULES:
  0. STRUCTURAL AUDIT BEFORE EXTRACTION: Before filling JSON, mentally reconstruct the CV's structure. Identify header/contact details, profile, education, software/tools, training/courses, employment chronology, project/key assignment sections, languages, certifications, and any tables split by PDF/OCR extraction. Do not treat the text as a flat blob.
  1. ZERO TRUNCATION & VERBATIM EXTRACTION: Do not summarize or cut short any bullet points or paragraphs. For job descriptions and the profile summary, extract the text 100% EXACTLY as it is written in the CV. If a job has 3 paragraphs of description, you must copy all 3 paragraphs verbatim.
  2. DO NOT COMBINE JOBS: If the CV lists multiple distinct roles at different times or with different companies (e.g., Senior Land Surveyor at company A, then Chief Land Surveyor at company B), you MUST extract them as completely separate, distinct entries in the 'experiences' array. Never merge them together.
  3. SMART INFERENCE FOR MISSING FIELDS: If 'Location' is not explicitly stated in a header, intensely analyze the most recent 'Experience' or 'Education' entry to determine it. 
  4. DATA COMPLETENESS FOR PERFECT CV GENERATION: We rely on you for 100% accurate branded CV outputs. Cross-reference all sections. If a project is mentioned under a role, ensure it's captured in full detail.
  5. TAXONOMY STRICTNESS: Assign each expert a strict 'role' from EXACTLY this list: [${taxonomy.join(", ")}].
  6. SPECIFICITY: 'primary_position' must be the actual exact role TITLE from the CV (e.g., 'Chief Land Surveyor').
  7. CHRONOLOGY & GRANULAR DETAILS: Ensure experiences and projects are captured with specific dates, precise durations, organizations, locations, and extremely detailed descriptions. Extract exact budgets, engineering standards (e.g., FIDIC), and team sizes.
  8. DIFFERENTIATION BETWEEN EMPLOYMENT RECORD AND ADEQUACY: 
  - 'experiences' (Employment Record): This is the chronological list of jobs/roles the expert held. You MUST extract exact dates, countries, and provide extremely detailed descriptions of their tasks and activities. Do not miss any details!
  - 'adequacy_experience' (Adequacy for the Assignment - Key Experience): This MUST be a separate list of specific key *PROJECTS* or specific assignments. You MUST pick up ALL assignments related to the particular jobs they held. You cannot miss out on any assignment. Provide comprehensive descriptions pulling the rich text. CRITICAL: never output only a list of project names in assignment. For each adequacy item, include the project names AND what the expert did on those projects. If several assignments belong to the same period/position, write them as multiple bullet-like lines inside assignment, then add the duties/responsibilities performed during those assignments.
  9. MASTERFUL FORMAT ROBUSTNESS: CVs from OCR or PDF are messy. Utilize supreme intelligence to reconstruct broken tables, misaligned dates, and disjointed paragraphs to extract the true chronological timeline.
  10. NAME EXTRACTION: Extract the exact 'fullName' correctly. Look at the top of the CV, headers, signatures, etc. NEVER output "null" or "unknown" if a name exists.
  11. NO MISSING FIELDS: Every field in the schema MUST be aggressively populated. Search deeply and make reasonable inferences based on context.
  12. CRITICAL FIELDS FINDER: You MUST carefully read through the CV to find and extract EVERYTHING: FULL NAME, PRIMARY POSITION, ROLE, LOCATION, COUNTRIES, EDUCATION, EXPERIENCE, TYPE, SKILLS, AWARDS, LANGUAGES, CERTIFICATIONS, SOFTWARE, DATE OF BIRTH, CITIZENSHIP, PROFESSIONAL MEMBERSHIP.
  13. EXCLUDE IRRELEVANT DATA: Strictly EXCLUDE non-professional personal trivia (e.g., "married with kids", hobbies). You must completely capture every drop of professional, academic, technical, and project-related data.
  14. EDUCATION LEVEL VS EDUCATION DETAILS: educationLevel must be ONLY the highest level such as "PhD", "Master Degree", "Bachelor Degree", "Degree", "Diploma", or "Certificate". metadata.educations[] must list ALL education details available, including degree title, field of study, institution, location/country, dates/year, grade, and notes when present.
  15. UNIVERSAL TRANSLATOR: If the input CV is in a language other than English, natively output JSON translated into professional English.
  16. REVERSE CHRONOLOGICAL ORDER & EXACT JOB INTEGRITY: You MUST arrange the 'experiences' and 'adequacy' arrays in STANDARD REVERSE CHRONOLOGICAL ORDER (most recent first, from e.g. Present down to oldest past). DO NOT aggressively break or "split" table entries or jobs (e.g. if a CV lists one job from 2006 to 2008, keep it as ONE job experience. Do NOT split it into multiple).
  17. PROFILE REQUIREMENTS: You MUST extract or synthesize a 'profileSummary' (7-10 lines minimum) capturing the expert's full narrative in paragraph form. Integrate ANY notable achievements, research, or highlights directly into this paragraph. DO NOT output bullet points for a profile.
  18. SINGLE OBJECT PER EXPERT: You MUST return EXACTLY ONE object inside the 'experts' array for each person found in the CV. Put ALL of their details (location, countries, education, experiences) into that SINGLE object. DO NOT split one person's data across multiple objects in the array.
  19. STRICT FORMAT & TOKENS CONSERVATION: DO NOT hallucinate repeating strings or get caught in infinite loops. Your dates (Start and End) must be incredibly short and concise (e.g., 'Jan 2018'). DO NOT write long explanations in date fields. Ensure you output completely valid JSON without literal newlines or unescaped quotes inside strings.
  20. EXTREME EXTRACTION AGGRESSIVENESS: Make sure you are 100% aggressive in extracting the CV. Everything that is on the CV MUST be extracted to the corresponding schema fields unless it really doesn't exist. Do not skip any skills, experiences, adequacy table, certifications, etc. Extract them in extreme detail.
  21. ZERO MISSED ASSIGNMENTS: For Adequacy, if the CV contains a section like 'Key Experience', 'Relevant Assignments', or 'Projects', you MUST pick up EVERY SINGLE ASSIGNMENT related to a particular job. You cannot miss out on any assignment.
  22. DURATION CAPTURE: Always capture exact dates, durations, and periods for both experiences and adequacy assignments. Do not leave dates blank if they are present in the CV text.
  23. BE THE EYE OF THE GODS: Look at every single word in the CV. Leave no job description, no date, no country, no assignment behind.
  24. OCR/TYPOGRAPHY CLEANUP WITHOUT FACT INVENTION: Correct obvious PDF/OCR/typography problems in output text where needed: broken words, duplicated whitespace, bullet artifacts, strange symbols, inconsistent capitalization, and malformed punctuation. You may improve sentence readability and grammar, but you MUST NOT invent employers, dates, degrees, clients, countries, roles, project names, certifications, or years of experience.
  25. TABLE RECONSTRUCTION: If dates, employers, positions, countries, and responsibilities are separated by PDF extraction into different lines, intelligently align them into the correct row before writing JSON. A date range followed by an employer and title usually belongs to one employment record.
  26. EMPLOYMENT VS ADEQUACY SPLIT: 'experiences' is the chronological employer/job record. 'adequacy_experience' is the project/key-assignment proof section. If the CV does not explicitly have an adequacy section, derive adequacy_experience from the most tender-relevant projects and responsibilities found inside the employment history, preserving the actual facts. Each adequacy assignment must explain the expert's contribution/responsibilities, not just name the project.
  28. ADEQUACY ASSIGNMENT FORMAT: In adequacy_experience[].assignment, use clear bullet-like lines. List each assignment/project as its own line, then include one or more responsibility/duty lines describing what the expert did. Example: "- Design and construction of Khasab-Daba asphalt road\n- Design and repairs of infrastructure at monsoon-affected areas\n- Responsibilities included structural design of bridges, culverts, retaining walls, pavement structures, coordination, and supervision."
  27. GENERAL CV READINESS: The output must be ready to generate a General tender CV. Every expert should have enough information for DATE OF BIRTH, COUNTRY OF CITIZENSHIP, EDUCATION, PROFILE, SOFTWARE, TRAINING/COURSES, EMPLOYMENT RECORD, ADEQUACY/KEY EXPERIENCE, LANGUAGE SKILLS, and CONTACT INFO when those facts exist in the source.
  
  Analyze this document relentlessly like an elite HR headhunter and tender CV specialist who misses absolutely nothing. DO NOT SUMMARIZE EXPERIENCES. Preserve facts, repair obvious text extraction damage, and structure the data so a tender-ready General CV can be produced.
  
  CV Text:
  ${text}`;

  const response = await callGenAIWithRetry((modelName) => getAI().models.generateContent({
    model: modelName,
    contents: [{ role: 'user', parts: [{ text: prompt }]}],
    config: {
      responseMimeType: "application/json",
      responseSchema: cvSchema,
      temperature: 0.2,
    }
  }), ["gemini-3.1-flash-lite", "gemini-3.1-pro-preview", "gemini-3.5-flash"]);

  const responseText = response.text || '{}';
  console.log("Raw CV Response:", responseText);
  let result = { experts: [] };
  try {
    result = parseGenAIJSON(responseText);
  } catch (e: any) {
    console.error("Failed to parse AI JSON:", e.message);
    // Don't truncate too aggressively so we can debug later if needed
    throw new Error("Failed to parse AI response as JSON: " + e.message + ". First 200 chars: " + responseText.substring(0, 200));
  }
  return (result.experts || []).map((e: any) => {
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
        temperature: 0.1,
      }
    }), ["gemini-3.1-flash-lite", "gemini-3.1-pro-preview", "gemini-3.5-flash"], 1);

    const output = response.text || "{}";
    let parsed = expert;
    try {
      parsed = parseGenAIJSON(output);
    } catch (e) {
      console.error("Parse JSON error in CV audit", e);
      return expert;
    }

    return {
      ...expert,
      ...parsed,
      metadata: {
        ...(expert.metadata || {}),
        ...(parsed.metadata || {}),
      },
    };
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
    .replace(/^[\d.)\-\s]+/, "")
    .replace(/\b(no\.?|number|qty|quantity|personnel|staff|expert|key expert|position|role)\b\s*:?\s*/gi, "")
    .replace(/\s*\(\s*\d+\s*(?:nos?\.?|persons?|staff)?\s*\)\s*$/i, "")
    .replace(/\s*[-–—:]\s*\d+\s*(?:nos?\.?|persons?|staff)?\s*$/i, "")
    .replace(/\s+(?:qty|quantity|no\.?|number)\s*[:\-]?\s*\d{1,2}\s*$/i, "")
    .replace(/\s+\d{1,2}\s*$/i, "")
    .replace(/[.;:,]\s*$/, "")
    .trim();
}

function isLikelyStaffRoleTitle(value: string) {
  const title = normalizePositionTitle(value);
  if (!title || title.length < 4 || title.length > 90) return false;
  if (/^(scope|background|objective|deliverables|submission|evaluation|financial|technical|appendix|annex|table|minimum|general|specific|description)$/i.test(title)) return false;
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
  const byTitle = new Map<string, any>();

  [...existing, ...recovered].forEach((position) => {
    const title = normalizePositionTitle(position.position_title || position.title || position.role || "");
    if (!title) return;
    const key = title.toLowerCase();
    const current = byTitle.get(key) || {};
    byTitle.set(key, {
      ...position,
      ...current,
      position_title: current.position_title || title,
      quantity: current.quantity || position.quantity || 1,
      minimum_education: current.minimum_education || position.minimum_education || "",
      minimum_years_experience: current.minimum_years_experience || position.minimum_years_experience,
      general_experience: current.general_experience || position.general_experience || "",
      specific_experience: current.specific_experience || position.specific_experience || "",
      role_description: current.role_description || position.role_description || position.description || "",
      required_sector_experience: current.required_sector_experience || position.required_sector_experience || [],
      mandatory_skills: current.mandatory_skills || position.mandatory_skills || [],
      required_keywords: Array.from(new Set([...(current.required_keywords || []), ...(position.required_keywords || [])])),
      nationality_preference: current.nationality_preference || position.nationality_preference || "",
      recovered_from_text: Boolean(current.recovered_from_text || position.recovered_from_text),
    });
  });

  const positions = Array.from(byTitle.values());
  return {
    ...tender,
    positions,
    extraction_recovery: {
      ...(tender.extraction_recovery || {}),
      tenderPositionsRecoveredFromText: recovered.map((position) => position.position_title),
    },
    source_evidence: mergeSourceEvidence(tender.source_evidence, universalFacts.sourceEvidence),
  };
}

export async function runParseTenderText(text: string): Promise<any> {
  const prompt = `You are an ultra-aggressive, highly analytical, and extremely detail-oriented ultimate tender document extraction AI.
  The user may have provided MULTIPLE documents for a single tender concatenated together (e.g. Primary Tender + Scope/TOR). 
  Your goal is to parse the provided tender document(s) line-by-line, leaving no word unread.
  You MUST consolidate the extracted roles, staffing positions, requirements, metrics, scores, and project details from ALL uploaded documents into a single cohesive tender object with 100% accuracy. Do not summarize or ignore details.
  
  CRITICAL INSTRUCTIONS (AGGRESSIVE EXTRACTION):
  1. EXHAUSTIVE COMPREHENSIVE EXTRACTION: Do not skim. Read every single line across all documents. Capture every specific certification, language proficiency, local or international experience requirement, and duration mentioned.
  2. DEEP POSITION ANALYSIS & CONSOLIDATION: For each staffing position, rigorously map out 'role_description', 'general_experience', 'specific_experience', 'minimum_education', 'minimum_years_experience', 'required_sector_experience', 'required_keywords', and 'mandatory_skills'. You MUST extract the verbatim text for the experience requirements. Do not leave 'general_experience' or 'specific_experience' or 'role_description' blank!
  3. CAPTURE IMPLICIT & HIDDEN REQUIREMENTS: Read between the lines. If it's a World Bank or EU project, implicitly infer the need for specific safeguards or standards. Identify the exact technologies, methodologies, and frameworks required.
  4. NO DATA LEFT BEHIND: Think about how this data will be used to perfectly match and tailor CVs. Ensure 'scope_summary' and 'special_requirements' are extremely detailed and rich in context.
  5. TEAM-LEVEL CONSTRAINTS: Look for any rules that affect the *whole team* rather than a single position (e.g., "The team must have at least one local citizen", "One member must be a certified auditor"). Extract these into 'global_team_constraints'.
  6. EXHAUSTIVE TENDER TYPE EXTRACTION: In the 'project_sector' array, pick EVERYTHING the job is related to (for example: ["Infrastructure", "Roads", "Bridges", "Construction"]). Be as generous and comprehensive as possible.
  7. STAFF ROLE TABLES ARE CRITICAL: Search for headings and tables named "Key Experts", "Staff", "Personnel", "Team Composition", "Professional Staff", "Experts Required", "Positions", "Required Experts", "Manpower", "Schedule of Staff", "TOR", and "Terms of Reference". Every role/title in those sections MUST become one item in positions.
  8. DO NOT CONFUSE CV JOB TITLES WITH TENDER STAFF ROLES: positions[] must contain only roles requested by the tender, not candidate CV roles or company internal roles unless the tender explicitly requests them.
  9. DEDUPLICATE POSITIONS: If the same staff role appears in several sections, merge it into one position and consolidate all requirements.

  Tender Text(s):
  ${text}`;
  
  const response = await callGenAIWithRetry((modelName) => getAI().models.generateContent({
    model: modelName,
    contents: [{ role: 'user', parts: [{ text: prompt }]}],
    config: {
      responseMimeType: "application/json",
      responseSchema: tenderSchema,
      temperature: 0.1,
    }
  }), ["gemini-3.1-flash-lite", "gemini-3.1-pro-preview", "gemini-3.5-flash"]);

  const responseText = response.text || '{}';
  console.log("Raw Tender Response:", responseText);
  let parsed = {};
  try {
    parsed = parseGenAIJSON(responseText);
  } catch (e) {
    console.error("Failed to parse AI JSON for Tender:", e);
  }
  return postProcessTenderExtraction(parsed, text);
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
  // Step 1: Find target position
  const position = tender.positions.find((p:any) => p.id?.toString() === positionId || p.position_title === positionId);
  if (!position) throw new Error("Position not found");

  // Provide a naive text overlap score for initial ranking since we don't have a real vector DB populated
  // We will score based on matching keywords from the position title and requirements against the expert's text.
  const reqLower = (position.position_title + " " + (position.requirements?.join(" ") || "") + " " + (position.description || "")).toLowerCase();
  const reqWords = Array.from(new Set(reqLower.match(/\b\w{4,}\b/g) || []));

  const scoredExperts = experts.map((e: any) => {
    const expertText = JSON.stringify({ p: e.primary_position, s: e.skills, r: e.experiences, h: e.profileSummary }).toLowerCase();
    
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
    projects: e.experiences || e.projects 
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
