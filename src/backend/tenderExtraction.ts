import { GoogleGenAI, Schema, Type, createPartFromUri, FileState } from "@google/genai";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PDFDocument } from "pdf-lib";
import { PDFParse } from "pdf-parse";
import { normalizeTenderRecord } from "../lib/tenderPostProcess.ts";

export type TenderPdfInput = { path: string; originalname: string; mimetype?: string };

type TenderPage = {
  page_number: number;
  document_name: string;
  document_page_number: number;
  text: string;
  readable: boolean;
};

const positionSchema: Schema = {
  type: Type.OBJECT,
  properties: {
    position_title: { type: Type.STRING, description: "Occupational role only. Remove K-codes, row numbers, quantities, and section labels." },
    quantity: { type: Type.INTEGER, description: "Number of people required. Omit when not stated." },
    source_position_number: { type: Type.INTEGER, description: "Numeric K/position reference, without the K prefix." },
    source_document: { type: Type.STRING },
    lot_reference: { type: Type.STRING },
    expert_category: { type: Type.STRING },
    is_key_expert: { type: Type.BOOLEAN },
    input_months: { type: Type.NUMBER },
    work_location: { type: Type.STRING },
    minimum_education: { type: Type.STRING, description: "Academic degree, diploma, level, and discipline only." },
    minimum_years_experience: { type: Type.INTEGER, description: "Minimum overall professional experience years." },
    minimum_specific_years: { type: Type.INTEGER, description: "Minimum role, sector, project, or task-specific experience years." },
    minimum_similar_projects: { type: Type.INTEGER },
    general_experience: { type: Type.STRING, description: "Exact broad professional/overall experience requirement." },
    specific_experience: { type: Type.STRING, description: "Exact role, sector, project, geography, or task-specific experience requirement." },
    role_description: { type: Type.STRING, description: "Duties, responsibilities, tasks, and functions assigned to this role." },
    role_duties_status: { type: Type.STRING, enum: ["explicit", "tor_scope", "not_stated", "needs_review"] },
    required_sector_experience: { type: Type.ARRAY, items: { type: Type.STRING } },
    mandatory_skills: { type: Type.ARRAY, items: { type: Type.STRING } },
    required_software: { type: Type.ARRAY, items: { type: Type.STRING } },
    required_certifications: { type: Type.ARRAY, items: { type: Type.STRING } },
    professional_memberships: { type: Type.ARRAY, items: { type: Type.STRING } },
    required_languages: { type: Type.ARRAY, items: { type: Type.STRING } },
    regional_experience: { type: Type.STRING },
    country_experience: { type: Type.STRING },
    required_keywords: { type: Type.ARRAY, items: { type: Type.STRING } },
    nationality_preference: { type: Type.STRING },
    residency_requirement: { type: Type.STRING },
    position_deliverables: { type: Type.ARRAY, items: { type: Type.STRING } },
    evaluation_points: { type: Type.NUMBER },
    source_page_numbers: { type: Type.ARRAY, items: { type: Type.INTEGER } },
  },
};

const tenderSchema: Schema = {
  type: Type.OBJECT,
  properties: {
    tender_format: { type: Type.STRING },
    tender_title: { type: Type.STRING },
    client: { type: Type.STRING },
    country: { type: Type.STRING },
    tender_number: { type: Type.STRING },
    deadline: { type: Type.STRING },
    submission_type: { type: Type.STRING },
    project_sector: { type: Type.ARRAY, items: { type: Type.STRING } },
    scope_summary: { type: Type.STRING },
    objectives: { type: Type.ARRAY, items: { type: Type.STRING } },
    deliverables: { type: Type.ARRAY, items: { type: Type.STRING } },
    eligibility_requirements: { type: Type.ARRAY, items: { type: Type.STRING } },
    evaluation_criteria: { type: Type.ARRAY, items: { type: Type.STRING } },
    duration: { type: Type.STRING },
    special_requirements: { type: Type.ARRAY, items: { type: Type.STRING } },
    global_team_constraints: { type: Type.ARRAY, items: { type: Type.STRING } },
    positions: { type: Type.ARRAY, items: positionSchema },
  },
};

const roleDetailSchema: Schema = {
  type: Type.OBJECT,
  properties: { positions: { type: Type.ARRAY, items: positionSchema } },
};

const CORE_PROMPT = `You are a senior tender-document extraction analyst. Read the supplied tender pages line by line and return source-grounded facts only.

FIELD CONTRACT
- tender_title: the actual procurement/assignment title, not a section heading or contract template.
- client: the procuring authority or contracting client.
- deadline: exact submission date, time, and timezone when written.
- scope_summary: services and works being procured, preserving important locations, lots, assets, and activities.
- position_title: a real occupational staff role the consultant/bidder must provide. Store "Resident Engineer", never "K-1 Resident Engineer". Never create roles from clauses, institutions, forms, obligations, risks, eligibility headings, or sentence fragments.
- quantity: number of people required. Never default to 1.
- minimum_education: academic degree/diploma, level, and discipline only. Registration, chartership, practising certificates, and licences belong in required_certifications.
- general_experience: broad total professional experience, usually the overall minimum years.
- specific_experience: experience in the role, sector, project type, task, geography, or similar assignments.
- role_description: duties, responsibilities, functions, tasks, and activities. Do not place qualifications here.
- input_months: staff effort/person-months, not project duration or years of experience.
- work_location: explicit duty station/place of assignment.
- nationality_preference: explicit citizenship/nationality requirement only. Never default to "Any".
- required_sector_experience: explicit domains such as roads, railways, bridges, water, buildings, or power.
- mandatory_skills: explicit non-software capabilities. Degrees, years, languages, registration, and software do not belong here.
- required_software: named software/tools only.
- required_certifications: registration, chartership, licences, practising certificates, and certifications.
- professional_memberships: required membership of a professional institution/body.
- required_languages: explicit language and proficiency only.
- position_deliverables: outputs explicitly assigned to that role; project-wide outputs remain tender-level deliverables.
- evaluation_points: technical scoring points only, never quantity, months, years, or page numbers.

COMPLETENESS RULES
1. Extract every key expert, non-key expert, support role, technician, inspector, survey assistant, laboratory role, CAD role, and administrative role required by the tender.
2. Tables can continue on later pages without repeating their header. Carry the active table headings and role identity into continuation pages. A qualification or duty on the next page still belongs to the preceding role until a new role begins.
3. The same role may appear in a staff schedule, evaluation table, qualification table, input schedule, and TOR duties. Merge all available facts into one role without changing their meaning.
4. Keep exact requirement wording after only repairing broken line wraps and obvious OCR spacing. Do not infer requirements from the country, donor, sector, or job title.
5. Missing means absent: omit numeric values and use empty strings/arrays. Never use 0, 1, "Any", or "Not stated" as invented defaults.
6. Attach physical page numbers in source_page_numbers. Do not output source quotes, evidence objects, commentary, reasoning, or duplicated copies of the same fact.
7. Keep the JSON compact. Each requirement belongs in its correct field once. Read all supplied pages before producing JSON and output JSON only.`;

const RELEVANCE_TERMS = [
  /request for proposals?|letter of invitation|invitation to (?:bid|tender)|data sheet|submission deadline|deadline for submission|proposal submission date|date and time.*submission/i,
  /terms of reference|scope of (?:work|services)|objectives?|deliverables?|reporting requirements?|duration of (?:the )?(?:assignment|services)/i,
  /list of key experts?|key expert schedule|key professional staff|non[- ]key experts?|professional staff|staff schedule|required personnel|personnel schedule|team composition|experts? input|person[- ]months?/i,
  /qualification|education|academic|degree|diploma|registered|chartered|practi[cs]ing (?:certificate|licen[cs]e)/i,
  /general experience|specific experience|professional experience|years?['’]? experience|similar (?:projects?|assignments?)/i,
  /role and responsibilities|roles? & responsibilities|duties|tasks? assigned|job description|functions? of|responsible for/i,
  /engineer|specialist|expert|team leader|project manager|surveyor|inspector|technician|coordinator|advisor|analyst|planner|architect|officer|assistant/i,
  /evaluation criteria|technical score|scoring points|maximum points|curriculum vitae|staff input/i,
];

function getAI() {
  const apiKey = String(process.env.GEMINI_API_KEY || "").trim();
  if (!apiKey) throw new Error("GEMINI_API_KEY is not configured.");
  return new GoogleGenAI({ apiKey });
}

function modelNames() {
  return Array.from(new Set([
    process.env.TENDER_EXTRACTION_MODEL || "gemini-3.5-flash",
    process.env.TENDER_EXTRACTION_FALLBACK_MODEL || "gemini-3.1-flash-lite",
  ].map((value) => value.trim()).filter(Boolean)));
}

function parseJson(text: string) {
  const cleaned = String(text || "{}")
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .replace(/,\s*([}\]])/g, "$1");
  return JSON.parse(cleaned || "{}");
}

function incompleteJsonError(error: any, responseLength = 0) {
  const wrapped: any = new Error(`Gemini returned incomplete JSON (${responseLength} characters). The extraction will be retried in smaller batches.`);
  wrapped.code = "TENDER_INCOMPLETE_JSON";
  wrapped.cause = error;
  return wrapped;
}

function isIncompleteJsonError(error: any) {
  return error?.code === "TENDER_INCOMPLETE_JSON";
}

function isRetryable(error: any) {
  const message = String(error?.message || error || "");
  return error?.status === 429 || error?.status === 503 || /429|503|temporar|high demand|unavailable/i.test(message);
}

async function generateJson(prompt: string, schema: Schema, parts?: any[]) {
  let lastError: any;
  for (const model of modelNames()) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const response = await getAI().models.generateContent({
          model,
          contents: [{ role: "user", parts: parts || [{ text: prompt }] }],
          config: {
            responseMimeType: "application/json",
            responseSchema: schema,
            temperature: 0,
            maxOutputTokens: Math.max(4096, Number(process.env.TENDER_EXTRACTION_MAX_OUTPUT_TOKENS || 32768)),
          },
        });
        const responseText = response.text || "{}";
        try {
          return parseJson(responseText);
        } catch (error) {
          throw incompleteJsonError(error, responseText.length);
        }
      } catch (error: any) {
        lastError = error;
        if (isIncompleteJsonError(error)) throw error;
        if (!isRetryable(error) || attempt === 1) break;
        await new Promise((resolve) => setTimeout(resolve, 1200 * (attempt + 1)));
      }
    }
  }
  throw lastError || new Error("Tender extraction failed.");
}

async function mapWithConcurrency<T, R>(items: T[], concurrency: number, mapper: (item: T, index: number) => Promise<R>) {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(Math.max(1, concurrency), items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await mapper(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

function cleanText(value: any) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function uniqueStrings(values: any[]) {
  const seen = new Set<string>();
  return values.map(cleanText).filter((value) => {
    const key = value.toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function cleanRoleTitle(value: any) {
  return cleanText(value)
    .replace(/^\s*(?:position\s+)?K\s*[-.:]?\s*\d+\s*[:.)-]?\s*/i, "")
    .replace(/^\s*\d+\s*[.)-]\s*/, "")
    .replace(/\s+(?:\d+\s*)?(?:no\.?|nos\.?)\s*$/i, "")
    .trim();
}

function roleKey(position: any) {
  const source = Number(position?.source_position_number || 0);
  const lot = cleanText(position?.lot_reference).toLowerCase().replace(/[^a-z0-9]+/g, " ");
  const title = cleanRoleTitle(position?.position_title).toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").trim();
  return source ? `${lot}|k${source}` : `${lot}|${title}`;
}

function richerText(left: any, right: any) {
  const a = cleanText(left);
  const b = cleanText(right);
  if (!a) return b;
  if (!b) return a;
  if (a.toLowerCase().includes(b.toLowerCase())) return a;
  if (b.toLowerCase().includes(a.toLowerCase())) return b;
  return `${a} ${b}`.trim();
}

function mergePosition(left: any, right: any) {
  const arrays = [
    "required_sector_experience", "mandatory_skills", "required_software", "required_certifications",
    "professional_memberships", "required_languages", "required_keywords", "position_deliverables",
  ];
  const textFields = [
    "source_document", "lot_reference", "expert_category", "work_location", "minimum_education",
    "general_experience", "specific_experience", "role_description", "regional_experience", "country_experience",
    "nationality_preference", "residency_requirement",
  ];
  const merged = { ...left, ...right, position_title: cleanRoleTitle(right.position_title || left.position_title) };
  textFields.forEach((field) => { merged[field] = richerText(left?.[field], right?.[field]); });
  arrays.forEach((field) => { merged[field] = uniqueStrings([...(left?.[field] || []), ...(right?.[field] || [])]); });
  merged.source_page_numbers = Array.from(new Set([...(left?.source_page_numbers || []), ...(right?.source_page_numbers || [])]))
    .map(Number).filter((page) => page > 0).sort((a, b) => a - b);
  merged.quantity = right?.quantity ?? left?.quantity;
  merged.input_months = right?.input_months ?? left?.input_months;
  merged.minimum_years_experience = Math.max(Number(left?.minimum_years_experience || 0), Number(right?.minimum_years_experience || 0)) || undefined;
  merged.minimum_specific_years = Math.max(Number(left?.minimum_specific_years || 0), Number(right?.minimum_specific_years || 0)) || undefined;
  merged.minimum_similar_projects = Math.max(Number(left?.minimum_similar_projects || 0), Number(right?.minimum_similar_projects || 0)) || undefined;
  merged.evaluation_points = right?.evaluation_points ?? left?.evaluation_points;
  merged.source_position_number = right?.source_position_number ?? left?.source_position_number;
  merged.is_key_expert = right?.is_key_expert ?? left?.is_key_expert;
  const statuses = [left?.role_duties_status, right?.role_duties_status];
  merged.role_duties_status = merged.role_description
    ? (statuses.includes("explicit") ? "explicit" : statuses.includes("tor_scope") ? "tor_scope" : "needs_review")
    : (statuses.includes("not_stated") ? "not_stated" : "needs_review");
  return merged;
}

export function mergeTenderResults(results: any[]) {
  const output: any = { positions: [] };
  const positionMap = new Map<string, any>();
  const arrayFields = ["project_sector", "objectives", "deliverables", "eligibility_requirements", "evaluation_criteria", "special_requirements", "global_team_constraints"];
  const metadataFields = ["tender_format", "tender_title", "client", "country", "tender_number", "deadline", "submission_type", "duration"];

  results.filter(Boolean).forEach((item) => {
    metadataFields.forEach((field) => { if (!cleanText(output[field]) && cleanText(item[field])) output[field] = cleanText(item[field]); });
    output.scope_summary = richerText(output.scope_summary, item.scope_summary);
    arrayFields.forEach((field) => { output[field] = uniqueStrings([...(output[field] || []), ...(item[field] || [])]); });
    (Array.isArray(item.positions) ? item.positions : []).forEach((raw: any) => {
      const position = { ...raw, position_title: cleanRoleTitle(raw?.position_title) };
      if (!position.position_title) return;
      const key = roleKey(position);
      positionMap.set(key, positionMap.has(key) ? mergePosition(positionMap.get(key), position) : mergePosition({}, position));
    });
  });
  output.positions = Array.from(positionMap.values());
  output.name = output.tender_title;
  return output;
}

function isRelevantPage(page: TenderPage) {
  const text = page.text;
  const top = text.slice(0, 500);
  const occupation = /\b(?:engineers?|specialists?|team leaders?|project managers?|surveyors?|inspectors?|technicians?|coordinators?|advisors?|analysts?|planners?|architects?|officers?|assistants?|controllers?|draftsmen|economists?|sociologists?|environmentalists?|hydrologists?|geologists?)\b/i.test(text);
  const roleDetail = RELEVANCE_TERMS[3].test(text) || RELEVANCE_TERMS[4].test(text) || RELEVANCE_TERMS[5].test(text);
  const metadataPage = /^(?:section\s+\d+[:.]?\s*)?(?:proposal data sheet|letter of invitation)\b/im.test(text) || /\b(?:procurement reference number|submission deadline|deadline for submission|proposal submission date)\b/i.test(text);
  const staffPage = RELEVANCE_TERMS[2].test(text) || /\bK\s*[-.]?\s*\d+\b|\b(?:job title|staff position|designation)\b/i.test(text) || (occupation && roleDetail);
  const eligibilityPage = /\b(?:eligible countries|team-level requirements?|joint venture.*jointly and severally|nationality of an eligible country)\b/i.test(text);
  const standardSection = /\b(?:instructions to consultants|general conditions of contract|special conditions of contract|proposal forms?|contract forms?)\b/i.test(top);
  if (standardSection && !metadataPage && !eligibilityPage) return false;
  return (
    metadataPage ||
    /^(?:section\s+\d+[:.]?\s*)?(?:terms of reference|statement of requirements|scope of work|scope of services|objectives? of (?:the )?(?:assignment|services)|required deliverables?|reporting requirements?)\b/im.test(text) ||
    staffPage ||
    /\bK\s*[-.]?\s*\d+\b|\b(?:job title|position title|staff position|designation)\b/i.test(text) ||
    (occupation && roleDetail) ||
    (/\b(?:evaluation criteria|technical score|maximum points)\b/i.test(text) && occupation) ||
    eligibilityPage
  );
}

export function selectRelevantTenderPages(pages: TenderPage[]) {
  if (pages.length <= 60) return pages;
  const repeatedLineKey = (value: string) => cleanText(value).toLowerCase().replace(/\b\d+\b/g, "#").replace(/[^a-z#]+/g, " ").trim();
  const lineFrequency = new Map<string, number>();
  pages.forEach((page) => {
    const pageLines = new Set(page.text.split(/\r?\n/).map(repeatedLineKey).filter((line) => line.length >= 4 && line.length <= 180));
    pageLines.forEach((line) => lineFrequency.set(line, (lineFrequency.get(line) || 0) + 1));
  });
  const repeatedThreshold = Math.max(8, Math.ceil(pages.length * 0.2));
  const scoringPages = pages.map((page) => ({
    ...page,
    text: page.text
      .split(/\r?\n/)
      .filter((line) => (lineFrequency.get(repeatedLineKey(line)) || 0) < repeatedThreshold)
      .join("\n"),
  }));
  const selected = new Set<number>();
  const tableAnchors = new Set<number>();
  pages.slice(0, 8).forEach((page) => selected.add(page.page_number));
  scoringPages.forEach((page) => {
    if (!isRelevantPage(page)) return;
    const hasOccupation = RELEVANCE_TERMS[6].test(page.text);
    const hasRoleDetail = RELEVANCE_TERMS[2].test(page.text) || RELEVANCE_TERMS[3].test(page.text) || RELEVANCE_TERMS[4].test(page.text) || RELEVANCE_TERMS[5].test(page.text);
    if (/\bK\s*[-.]?\s*\d+\b|\b(?:job title|position title|staff position|designation)\b/i.test(page.text) || (hasOccupation && hasRoleDetail)) {
      tableAnchors.add(page.page_number);
    }
    for (let offset = -2; offset <= 2; offset++) {
      const candidate = page.page_number + offset;
      if (pages.some((item) => item.page_number === candidate)) selected.add(candidate);
    }
  });

  // Keep short gaps inside continued tables even when the repeated header is absent.
  const ordered = Array.from(tableAnchors).sort((a, b) => a - b);
  for (let index = 1; index < ordered.length; index++) {
    if (ordered[index] - ordered[index - 1] <= 6) {
      for (let page = ordered[index - 1]; page <= ordered[index]; page++) selected.add(page);
    }
  }
  return pages.filter((page) => selected.has(page.page_number));
}

function pagesToText(pages: TenderPage[]) {
  return pages.map((page) => `--- DOCUMENT: ${page.document_name} | PHYSICAL PAGE: ${page.page_number} | DOCUMENT PAGE: ${page.document_page_number} ---\n${page.text}`).join("\n\n");
}

function chunkPages(pages: TenderPage[], maxChars = Number(process.env.TENDER_EXTRACTION_CHUNK_CHARS || 35000)) {
  const chunks: TenderPage[][] = [];
  let current: TenderPage[] = [];
  let length = 0;
  for (const page of pages) {
    const pageLength = page.text.length + 140;
    if (current.length && length + pageLength > maxChars) {
      chunks.push(current);
      current = current.slice(-2);
      length = current.reduce((sum, item) => sum + item.text.length + 140, 0);
    }
    current.push(page);
    length += pageLength;
  }
  if (current.length) chunks.push(current);
  return chunks;
}

function roleTokens(title: string) {
  const ignored = new Set(["and", "for", "the", "of", "to", "senior", "junior", "assistant", "lead", "team"]);
  return cleanRoleTitle(title).toLowerCase().split(/[^a-z0-9]+/).filter((token) => token.length > 2 && !ignored.has(token));
}

function pagesForRole(pages: TenderPage[], position: any) {
  const exact = cleanRoleTitle(position.position_title).toLowerCase();
  const tokens = roleTokens(exact);
  const hits = new Set<number>();
  pages.forEach((page) => {
    const haystack = page.text.toLowerCase();
    const tokenHits = tokens.filter((token) => haystack.includes(token)).length;
    if (haystack.includes(exact) || (tokens.length && tokenHits >= Math.max(1, Math.ceil(tokens.length * 0.65)))) {
      for (let offset = -2; offset <= 2; offset++) hits.add(page.page_number + offset);
    }
  });
  return pages.filter((page) => hits.has(page.page_number));
}

async function extractTextPages(files: TenderPdfInput[]) {
  const pages: TenderPage[] = [];
  const maxPages = Math.max(1, Number(process.env.TENDER_MAX_PAGES || 2000));
  let offset = 0;
  for (const file of files) {
    const bytes = await fs.readFile(file.path);
    const parser = new PDFParse({ data: bytes });
    try {
      const result = await parser.getText();
      if (offset + result.pages.length > maxPages) throw new Error(`Tender exceeds the configured ${maxPages}-page limit.`);
      result.pages.forEach((page, index) => {
        const text = String(page.text || "").trim();
        pages.push({
          page_number: offset + index + 1,
          document_name: file.originalname,
          document_page_number: index + 1,
          text,
          readable: text.replace(/\s+/g, "").length >= 80,
        });
      });
      offset += result.pages.length;
    } finally {
      await parser.destroy().catch(() => undefined);
    }
  }
  return pages;
}

async function extractUnreadablePages(files: TenderPdfInput[], pages: TenderPage[]) {
  const unreadable = pages.filter((page) => !page.readable);
  if (!unreadable.length) return [];
  const ratio = unreadable.length / Math.max(1, pages.length);
  if (ratio < Number(process.env.TENDER_OCR_MIN_UNREADABLE_RATIO || 0.15)) return [];

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "via-tender-ocr-"));
  const outputs: any[] = [];
  try {
    let globalOffset = 0;
    for (const file of files) {
      const sourceBytes = await fs.readFile(file.path);
      const source = await PDFDocument.load(sourceBytes);
      const filePageCount = source.getPageCount();
      const weak = unreadable.filter((page) => page.page_number > globalOffset && page.page_number <= globalOffset + filePageCount);
      globalOffset += filePageCount;
      if (!weak.length) continue;

      const batches: TenderPage[][] = [];
      for (let index = 0; index < weak.length; index += 8) batches.push(weak.slice(index, index + 8));
      for (const batch of batches) {
        const pdf = await PDFDocument.create();
        const copied = await pdf.copyPages(source, batch.map((page) => page.document_page_number - 1));
        copied.forEach((page) => pdf.addPage(page));
        const filePath = path.join(tempDir, `ocr-${outputs.length + 1}.pdf`);
        await fs.writeFile(filePath, await pdf.save());

        const ai = getAI();
        const uploaded = await ai.files.upload({ file: filePath, config: { mimeType: "application/pdf", displayName: `Unreadable tender pages ${batch.map((page) => page.page_number).join(",")}` } });
        if (!uploaded.name) throw new Error("Gemini did not return an uploaded file name for OCR fallback.");
        let ready = uploaded;
        for (let attempt = 0; ready.state === FileState.PROCESSING && attempt < 60; attempt++) {
          await new Promise((resolve) => setTimeout(resolve, 1500));
          ready = await ai.files.get({ name: uploaded.name });
        }
        if (!ready.uri || !ready.mimeType || ready.state === FileState.FAILED) throw new Error("Gemini could not read the scanned tender pages.");
        const map = batch.map((page, index) => `local page ${index + 1} = physical page ${page.page_number}`).join(", ");
        const prompt = `${CORE_PROMPT}\n\nOCR/VISUAL FALLBACK: These pages had no usable PDF text layer. Read text and tables visually. Page map: ${map}. Extract every visible tender fact and role.`;
        outputs.push(await generateJson(prompt, tenderSchema, [createPartFromUri(ready.uri, ready.mimeType), { text: prompt }]));
        await ai.files.delete({ name: uploaded.name }).catch(() => undefined);
      }
    }
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
  }
  return outputs;
}

function completenessWarnings(tender: any) {
  const warnings: string[] = [];
  if (!cleanText(tender.tender_title)) warnings.push("Tender title was not found.");
  if (!cleanText(tender.client)) warnings.push("Client/procuring authority was not found.");
  if (!Array.isArray(tender.positions) || !tender.positions.length) warnings.push("No required staff positions were found.");
  (tender.positions || []).forEach((position: any) => {
    const missing: string[] = [];
    if (!cleanText(position.minimum_education)) missing.push("education");
    if (!cleanText(position.general_experience) && !cleanText(position.specific_experience)) missing.push("experience");
    if (!cleanText(position.role_description) && position.role_duties_status !== "not_stated") missing.push("duties");
    if (missing.length) warnings.push(`${position.position_title}: ${missing.join(", ")} not found after full-document role search.`);
  });
  return warnings;
}

async function extractPageBatch(pages: TenderPage[], label: string): Promise<any> {
  const prompt = `${CORE_PROMPT}\n\n${label}. Extract all tender-level facts and every required staff position visible here. Preserve table continuation context within the supplied pages.\n\n${pagesToText(pages)}`;
  try {
    return await generateJson(prompt, tenderSchema);
  } catch (error) {
    if (!isIncompleteJsonError(error) || pages.length <= 1) throw error;
    const middle = Math.ceil(pages.length / 2);
    const [left, right] = await Promise.all([
      extractPageBatch(pages.slice(0, middle), `${label}, first half`),
      extractPageBatch(pages.slice(middle), `${label}, second half`),
    ]);
    return mergeTenderResults([left, right]);
  }
}

async function extractRoleBatch(batch: Array<{ position: any; pages: TenderPage[] }>, label: string): Promise<any> {
  const contexts = batch.map(({ position, pages: rolePages }) => `=== ROLE TO COMPLETE ===\n${JSON.stringify({
    position_title: position.position_title,
    source_position_number: position.source_position_number,
    lot_reference: position.lot_reference,
    current_values: position,
  })}\n=== EVERY MATCHING SOURCE PAGE ===\n${pagesToText(rolePages)}`).join("\n\n");
  const prompt = `${CORE_PROMPT}\n\n${label}: Complete ONLY the listed roles. Search every supplied occurrence and nearby page, including continued rows. Preserve current correct values, add every available missing requirement, and never transfer facts between roles. If duties truly are not separately stated after this search, set role_duties_status to not_stated.\n\n${contexts}`;
  try {
    return await generateJson(prompt, roleDetailSchema);
  } catch (error) {
    if (!isIncompleteJsonError(error)) throw error;
    if (batch.length > 1) {
      const middle = Math.ceil(batch.length / 2);
      const [left, right] = await Promise.all([
        extractRoleBatch(batch.slice(0, middle), `${label}, first role group`),
        extractRoleBatch(batch.slice(middle), `${label}, second role group`),
      ]);
      return mergeTenderResults([left, right]);
    }
    const only = batch[0];
    if (!only || only.pages.length <= 1) throw error;
    const middle = Math.ceil(only.pages.length / 2);
    const [left, right] = await Promise.all([
      extractRoleBatch([{ ...only, pages: only.pages.slice(0, middle) }], `${label}, first source-page group`),
      extractRoleBatch([{ ...only, pages: only.pages.slice(middle) }], `${label}, second source-page group`),
    ]);
    return mergeTenderResults([left, right]);
  }
}

async function runPipeline(pages: TenderPage[], visualResults: any[] = []) {
  const readablePages = pages.filter((page) => page.readable);
  const relevantPages = selectRelevantTenderPages(readablePages);
  const chunks = chunkPages(relevantPages);
  const concurrency = Math.max(1, Math.min(4, Number(process.env.TENDER_EXTRACTION_CONCURRENCY || 2)));
  const initialResults = await mapWithConcurrency(chunks, concurrency, async (chunk, index) => {
    return extractPageBatch(chunk, `Relevant page chunk ${index + 1} of ${chunks.length}`);
  });

  let merged = mergeTenderResults([...initialResults, ...visualResults]);
  const roleContexts = (merged.positions || []).map((position: any) => ({ position, pages: pagesForRole(readablePages, position) }));
  const roleBatches: Array<Array<{ position: any; pages: TenderPage[] }>> = [];
  let current: Array<{ position: any; pages: TenderPage[] }> = [];
  let currentLength = 0;
  for (const item of roleContexts) {
    const length = pagesToText(item.pages).length + JSON.stringify(item.position).length;
    if (current.length && currentLength + length > 50000) {
      roleBatches.push(current);
      current = [];
      currentLength = 0;
    }
    current.push(item);
    currentLength += length;
  }
  if (current.length) roleBatches.push(current);

  const detailResults = await mapWithConcurrency(roleBatches, concurrency, async (batch, index) => {
    return extractRoleBatch(batch, `Full-document role search ${index + 1} of ${roleBatches.length}`);
  });
  merged = mergeTenderResults([merged, ...detailResults]);

  const normalized = normalizeTenderRecord(merged);
  const warnings = completenessWarnings(normalized);
  return {
    ...normalized,
    extraction_warnings: Array.from(new Set(warnings)),
    extraction_blocking_issues: [],
    review_required: warnings.length > 0,
    extraction_audit: {
      pipeline: "page-text -> relevance -> flash extraction -> full-document role search -> merge -> completeness",
      model: modelNames()[0],
      totalPages: pages.length,
      readablePages: readablePages.length,
      pagesSentToAI: relevantPages.length,
      pagesSkippedBeforeAI: pages.length - relevantPages.length,
      chunkCount: chunks.length,
      roleSearchBatches: roleBatches.length,
      positionCount: normalized.positions?.length || 0,
    },
  };
}

export async function runParseTenderText(text: string) {
  const pages = String(text || "")
    .split(/(?=---\s*PAGE\s+\d+\s*---)/i)
    .filter((part) => part.trim())
    .map((part, index) => {
      const page = Number(part.match(/---\s*PAGE\s+(\d+)\s*---/i)?.[1] || index + 1);
      return { page_number: page, document_name: "Tender text", document_page_number: page, text: part.replace(/---\s*PAGE\s+\d+\s*---/i, "").trim(), readable: true };
    });
  if (!pages.length) throw new Error("Tender text is empty.");
  return runPipeline(pages);
}

export async function runParseTenderPdfFiles(files: TenderPdfInput[]) {
  if (!files.length) throw new Error("At least one tender PDF is required.");
  const pages = await extractTextPages(files);
  if (!pages.length) throw new Error("No pages could be read from the tender PDF.");
  const visualResults = await extractUnreadablePages(files, pages);
  return runPipeline(pages, visualResults);
}
