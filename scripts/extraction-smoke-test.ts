import fs from "fs";
import mammoth from "mammoth";
import { PDFParse } from "pdf-parse";
import { extractUniversalCVFacts, extractUniversalTenderFacts } from "../src/lib/universalExtraction.ts";
import { normalizeExpertCollections, postProcessExtractedExpert } from "../src/lib/cvPostProcess.ts";
import { normalizeTenderRecord } from "../src/lib/tenderPostProcess.ts";
import { extractTenderRoleContext, getTenderTableContextsForRange, inferTenderTableContextsFromText, mergeTenderExtractions, reconcileTenderEvidencePages, selectTenderPagesForPro, validateTenderFieldSemantics } from "../src/backend/ai.ts";

async function readDocxText(path: string) {
  const result = await mammoth.extractRawText({ buffer: fs.readFileSync(path) });
  return result.value;
}

async function readPdfText(path: string) {
  const parser = new PDFParse({ data: fs.readFileSync(path) });
  const result = await parser.getText();
  await parser.destroy();
  return result.text;
}

async function main() {
  const silviaPath = "C:/Users/Dell/Downloads/Silvia_DellOrco_CV_EN.docx";
  if (fs.existsSync(silviaPath)) {
    const text = await readDocxText(silviaPath);
    const facts = extractUniversalCVFacts(text);
    const expert = postProcessExtractedExpert({
      fullName: "Silvia Dell'Orco",
      experiences: [
        { duration: "05/2025 - Present", start_date: "05/2025", end_date: "Present", role: "AI Trainer", organization: "Digital Attitude", description: "" },
        { duration: "02/2025 - Present", start_date: "02/2025", end_date: "Present", role: "AI Advisor", organization: "ViA International", description: "- AI Advisor with strategic and operational responsibilities, including analysis of business processes and staff training for the adoption of innovative technologies\n- Design and implementation of Artificial Intelligence solutions, including research, configuration, testing, results monitoring and support for strategic business planning." },
        { duration: "01/2023 - Present", start_date: "01/2023", end_date: "Present", role: "AI Optimizer - AI Trainer", organization: "Freelance", description: "- Process optimization through the use of Artificial Intelligence tools\n- Creation of Virtual Assistants using AI\n- Training for professionals and companies in the field of Artificial Intelligence." },
      ],
    }, text);
    console.log("Silvia language facts:", facts.languages);
    console.log("Silvia post-processed languages:", expert.languages);
    console.log("Silvia education details:", expert.education);
    if (facts.languages.length < 5) throw new Error("Expected Silvia CV language recovery to find at least 5 languages.");
    if (expert.educationLevel !== "Master Degree") throw new Error(`Expected Silvia education level to be Master Degree, got ${expert.educationLevel}.`);
    if (expert.metadata?.educations?.length !== 2) throw new Error(`Expected Silvia CV to have exactly 2 formal education details, got ${expert.metadata?.educations?.length}.`);
    if (/training|course|erasmus|qualification to practice/i.test(JSON.stringify(expert.metadata?.educations || []))) {
      throw new Error("Silvia formal education details are contaminated with training/course/exchange/license entries.");
    }
    const duplicatedSilviaEducation = normalizeExpertCollections({
      education: [
        "Master in Product Design 04/2022 - 06/2023",
        "Master's Degree in Architecture 09/2012 - 03/2018",
        "Master in Product Design, QUASAR | Institute for Advanced Design, Rome",
        "Master's Degree in Architecture, Faculty of Architecture La Sapienza, Rome",
      ],
    });
    if (duplicatedSilviaEducation.metadata?.educations?.length !== 2) {
      throw new Error(`Expected duplicated Silvia education fragments to merge into 2 records, got ${duplicatedSilviaEducation.metadata?.educations?.length}.`);
    }
    const aiTrainer = expert.experiences?.find((item: any) => item.role === "AI Trainer");
    if (!aiTrainer?.description?.includes("Copilot")) throw new Error("Expected AI Trainer duties to be recovered from Silvia CV.");
    if (/AI Advisor with strategic/i.test(aiTrainer.description)) throw new Error("AI Trainer duties are contaminated with AI Advisor responsibilities.");
  } else {
    console.log("Silvia sample not found; skipping local DOCX smoke check.");
  }

  const tenderText = `
    Key Experts / Team Composition
    1. Team Leader / Project Manager - 1 person
    Minimum qualification: Master's Degree in Engineering
    General experience: 15 years

    2. Resident Engineer - 2 persons
    Specific experience: roads and bridges supervision

    3. QA/QC Engineer Qty: 1
    Duties: quality assurance and site inspections
  `;
  const tenderFacts = extractUniversalTenderFacts(tenderText);
  console.log("Tender role facts:", tenderFacts.positions.map((item) => item.position_title));
  if (tenderFacts.positions.length < 3) throw new Error("Expected tender role recovery to find at least 3 positions.");

  const looseTenderText = `
    Technical Proposal Request
    Required Positions
    - Senior Transport Economist (1)
      Education: Master's degree in Economics, Transport Planning, or related field.
      General Experience: Minimum 12 years of professional experience in transport economics.
      Specific Experience: At least 5 years preparing feasibility studies and economic analysis for road infrastructure projects.
      Responsibilities: Lead economic evaluation, traffic demand analysis, benefit-cost analysis, and reporting.
    - Environmental Safeguards Specialist - Qty: 1
      Qualification: Degree in Environmental Science or Environmental Engineering.
      Experience: Minimum 10 years in environmental safeguards, ESIA, ESMP, and donor-funded infrastructure projects.
      Duties: Review safeguards documentation, supervise compliance, and prepare mitigation reports.
    - Social Development / Resettlement Expert
      Academic qualification: Sociology, Social Development, or related discipline.
      Specific experience: RAP preparation, stakeholder engagement, grievance redress, and community consultations.
  `;
  const looseTenderFacts = extractUniversalTenderFacts(looseTenderText);
  const looseTitles = looseTenderFacts.positions.map((item) => item.position_title);
  console.log("Loose tender role facts:", looseTitles);
  ["Senior Transport Economist", "Environmental Safeguards Specialist", "Social Development / Resettlement Expert"].forEach((title) => {
    if (!looseTitles.includes(title)) throw new Error(`Expected loose tender recovery to include ${title}.`);
  });
  const environmental = looseTenderFacts.positions.find((item) => item.position_title === "Environmental Safeguards Specialist");
  if (!environmental?.role_description?.includes("Review safeguards")) throw new Error("Expected loose tender recovery to capture role duties.");

  const proposalFormNoiseText = `
    Experience.   TECH-2A A. Consultant's Organization   TECH-2B B. Consultant's Experience
    Required Positions
    1. Feasibility Study Team Leader
       Education Requirement: Master's degree in Transport Planning, Civil Engineering, Economics or related field.
       Role Description: Lead the feasibility study, coordinate all experts, prepare methodology, and submit final reports.
       General Experience: Minimum 15 years of professional experience in transport, infrastructure, and feasibility studies.
       Specific Experience: At least 8 years as Team Leader on road or transport feasibility studies.
    2. Road Engineer
       Education Requirement: Bachelor's degree in Civil Engineering.
       Role Description: Review road alignment, pavement options, quantities, and technical feasibility.
       General Experience: Minimum 10 years of road engineering experience.
       Specific Experience: Experience in road feasibility studies and preliminary design.
  `;
  const proposalFormFacts = extractUniversalTenderFacts(proposalFormNoiseText);
  const proposalFormTitles = proposalFormFacts.positions.map((item) => item.position_title);
  if (proposalFormTitles.some((title) => /TECH-2|Consultant's Organization|Consultant's Experience|Experience\./i.test(title))) {
    throw new Error(`Proposal form headings were incorrectly extracted as positions: ${proposalFormTitles.join(", ")}`);
  }
  const teamLeader = proposalFormFacts.positions.find((item) => item.position_title === "Feasibility Study Team Leader");
  if (!teamLeader?.minimum_education?.includes("Master")) throw new Error("Expected Team Leader education requirement to be recovered.");
  if (!teamLeader?.role_description?.includes("Lead the feasibility study")) throw new Error("Expected Team Leader role description to be recovered.");
  if (!teamLeader?.general_experience?.includes("15 years")) throw new Error("Expected Team Leader general experience to be recovered.");
  if (!teamLeader?.specific_experience?.includes("8 years")) throw new Error("Expected Team Leader specific experience to be recovered.");

  const pollutedTender = normalizeTenderRecord({
    positions: [
      { position_title: "Team Leader", general_experience: "15 years" },
      { position_title: "Traffic Engineer" },
      { position_title: "Instructions to Consultant" },
      { position_title: "Name of Expert" },
      { position_title: "CODE OF CONDUCT FOR EXPERT" },
      { position_title: "Appendix B - Key Expert" },
      { position_title: "The Consultant" },
      { position_title: "FIDIC International Federation of Consulting Engineer" },
      { position_title: "Planning and Design Manager" },
    ],
  });
  const cleanedTenderTitles = pollutedTender.positions.map((item: any) => item.position_title);
  ["Team Leader", "Traffic Engineer", "Planning and Design Manager"].forEach((title) => {
    if (!cleanedTenderTitles.includes(title)) throw new Error(`Expected cleaned tender positions to keep ${title}.`);
  });
  ["Instructions to Consultant", "Name of Expert", "CODE OF CONDUCT FOR EXPERT", "Appendix B - Key Expert", "The Consultant", "FIDIC International Federation of Consulting Engineer"].forEach((title) => {
    if (cleanedTenderTitles.includes(title)) throw new Error(`Expected cleaned tender positions to remove ${title}.`);
  });

  const screenshotFailureTender = normalizeTenderRecord({
    positions: [
      { position_title: "Documents Establishing the Eligibility of the Consultant", minimum_education: "Period of Validity of Proposals", role_description: "Submit eligibility declarations" },
      { position_title: "Documents Establishing the Qualifications of the Consultant" },
      { position_title: "Institution of Professional Engineer", role_description: "The appointing authority for the Adjudicator" },
      { position_title: "E Obligations of the Consultant", role_description: "Government policy requires consultants to provide impartial advice" },
      { position_title: "Associated with these assumptions are a number of risks. The Consultant" },
      { position_title: "Materials & Quality Control Engineer", quantity: 1, minimum_years_experience: 8, minimum_education: "Bachelor's degree in Civil Engineering", role_description: "Prepare the Quality Assurance Plan", source_page_numbers: [145], source_quotes: ["Materials & Quality Control Engineer"] },
    ],
  });
  const screenshotTitles = screenshotFailureTender.positions.map((item: any) => item.position_title);
  if (screenshotTitles.length !== 1 || screenshotTitles[0] !== "Materials & Quality Control Engineer") {
    throw new Error(`Screenshot false positions were not rejected: ${screenshotTitles.join(", ")}`);
  }

  const unknownFactsTender = normalizeTenderRecord({ positions: [{ position_title: "Road Engineer" }] });
  if (unknownFactsTender.positions[0].quantity !== undefined) throw new Error("Missing quantity must not default to 1.");
  if (unknownFactsTender.positions[0].minimum_years_experience !== undefined) throw new Error("Missing years must not default to 0.");
  if (unknownFactsTender.positions[0].nationality_preference !== "") throw new Error("Missing nationality must not default to Any.");

  const repeatedTitleTender = mergeTenderExtractions([
    { positions: [{ position_title: "Civil Engineer", source_position_number: 2, lot_reference: "Lot A", work_location: "North", minimum_education: "BSc Civil Engineering" }] },
    { positions: [{ position_title: "Civil Engineer", source_position_number: 2, lot_reference: "Lot B", work_location: "South", minimum_education: "MSc Civil Engineering" }] },
  ]);
  if (repeatedTitleTender.positions.length !== 2) throw new Error("Same-title positions from separate lots must remain separate.");

  const segmentedRoleTender = normalizeTenderRecord({
    extraction_warnings: [
      "K-1: Senior Highway Design Engineer /Team Leader for Design Update: Education requirement was not extracted.",
      "Page classification missing for page 99.",
    ],
    positions: [
      {
        position_title: "K-1: Senior Highway Design Engineer /Team Leader for Design Update",
        quantity: 1,
        expert_category: "Key Expert",
        source_page_numbers: [35],
        source_quotes: ["Should have a minimum of a Master's Degree in Civil Engineering, Highways, Geotechnical Engineering"],
        minimum_education: "Should have a minimum of a Master's Degree in Civil Engineering, Highways, Geotechnical Engineering",
        general_experience: "Minimum 10 years postgraduate experience in road design.",
        specific_experience: "At least three similar urban road projects.",
      },
      {
        position_title: "Senior Highway Design Engineer / Team Leader for Design Update",
        general_experience: "Minimum 15 years postgraduate experience in road design and construction supervision.",
        role_description: "Lead the design review activities and coordinate the design team.",
        source_page_numbers: [94],
      },
      {
        position_title: "Senior Highway Design Engineer/Team Leader for Design Update",
        source_position_number: 1,
      },
      {
        position_title: "K-5 Hydrologist/Drainage Engineer",
        source_page_numbers: [36],
        source_quotes: ["Should have a minimum of a BSc Civil Engineering; Registered Engineer with a valid practicing licence."],
        minimum_education: "Should have a minimum of a BSc Civil Engineering; Registered Engineer with a valid practicing licence.",
        specific_experience: "Five years as a Drainage Engineer.",
      },
      {
        position_title: "Hydrologist/ Drainage Engineer (Supervision)",
        general_experience: "Minimum 10 years in water resources engineering and hydrology.",
        role_description: "Perform hydrological analysis and review road drainage designs.",
        source_page_numbers: [97],
      },
      {
        position_title: "Senior Land Surveyor",
        source_page_numbers: [36],
        source_quotes: ["Minimum BSc in Surveying or Geomatics."],
        minimum_education: "Minimum BSc in Surveying or Geomatics.",
        general_experience: "At least 10 years surveying road construction projects.",
      },
      {
        position_title: "Senior Surveyor",
        role_description: "Prepare survey work and advise the Team Leader on setting out the alignment.",
        source_page_numbers: [95],
      },
      {
        position_title: "K-8 Contract/Claims Expert",
        source_page_numbers: [37],
        source_quotes: ["K-8 Contract/Claims Expert"],
      },
      {
        position_title: "Contract/Claims Expert",
        source_page_numbers: [38],
        source_quotes: ["Should have a minimum of a BSc Civil Engineering; Registered/Chartered Engineer with a valid practicing licence."],
        minimum_education: "Should have a minimum of a BSc Civil Engineering; Registered/Chartered Engineer with a valid practicing licence.",
        general_experience: "Minimum 10 years in contract administration and claims management.",
      },
    ],
  });
  if (segmentedRoleTender.positions.length !== 4) {
    throw new Error(`Expected segmented role fragments to merge into 4 positions, got ${segmentedRoleTender.positions.length}.`);
  }
  const mergedHighwayRole = segmentedRoleTender.positions.find((position: any) => /Highway Design Engineer/i.test(position.position_title));
  if (!mergedHighwayRole?.minimum_education?.includes("Master")) throw new Error("Expected explicitly extracted education to survive role consolidation.");
  if (!mergedHighwayRole?.role_description?.includes("design review")) throw new Error("Expected detailed role duties to merge into the role-register entry.");
  if (!mergedHighwayRole?.general_experience?.includes("15 years")) throw new Error("Conflicting experience requirements must retain the stricter explicit minimum.");
  const mergedClaimsRole = segmentedRoleTender.positions.find((position: any) => /Contract\/Claims Expert/i.test(position.position_title));
  if (/^K-?8/i.test(mergedClaimsRole?.position_title || "")) {
    throw new Error("Position title must not keep K-number prefixes after normalization.");
  }
  if (!mergedClaimsRole?.minimum_education?.includes("BSc Civil Engineering")) {
    throw new Error("Contract/Claims Expert education from a continuation page must merge into the role.");
  }
  if (/registered|chartered|practi/i.test(mergedClaimsRole?.minimum_education || "")) {
    throw new Error("Contract/Claims Expert registration/licence must not replace or pollute minimum_education.");
  }
  if (!mergedClaimsRole?.required_certifications?.some((item: string) => /Registered\/Chartered Engineer/i.test(item))) {
    throw new Error("Contract/Claims Expert registration/licence must be preserved as certification.");
  }
  if (segmentedRoleTender.extraction_warnings.some((warning: string) => /Education requirement was not extracted/i.test(warning))) {
    throw new Error(`Resolved position warnings must not survive later normalization passes: ${JSON.stringify(segmentedRoleTender.extraction_warnings)}`);
  }
  if (!segmentedRoleTender.extraction_warnings.some((warning: string) => /Page classification missing/i.test(warning))) {
    throw new Error("Non-position extraction warnings must be retained.");
  }
  const evidenceOnlyEducation = normalizeTenderRecord({ positions: [{
    position_title: "Road Engineer",
    source_page_numbers: [2],
    source_quotes: ["Bachelor's Degree in Civil Engineering"],
  }] });
  if (evidenceOnlyEducation.positions[0].minimum_education) {
    throw new Error("Internal evidence must validate facts, not silently populate missing business fields.");
  }
  const semanticFieldIssues = validateTenderFieldSemantics({ positions: [
    { position_title: "K-1: Resident Engineer", quantity: 1, minimum_education: "Bachelor's Degree in Civil Engineering", role_description: "Supervise construction works." },
    { position_title: "K1 Team Leader", quantity: 1 },
    { position_title: "Position K3 Environmental Specialist" },
    { position_title: "Materials Engineer 2 No.", quantity: 2 },
    { position_title: "Bachelor's Degree and 15 years of experience" },
  ] });
  if (semanticFieldIssues.length < 5) throw new Error("Semantic field validation must reject codes, quantities, and requirements inside position titles.");
  const cleanSemanticFields = validateTenderFieldSemantics({ positions: [{
    position_title: "Resident Engineer",
    source_position_number: 1,
    quantity: 1,
    minimum_education: "Bachelor's Degree in Civil Engineering",
    general_experience: "Minimum 15 years of professional experience.",
    specific_experience: "At least 5 years supervising urban road construction.",
    role_description: "Supervise construction works and administer the contract.",
    field_evidence: [
      { field: "position_title", page_number: 1, quote: "K-1 Resident Engineer" },
      { field: "quantity", page_number: 1, quote: "Resident Engineer 1 No." },
      { field: "minimum_education", page_number: 1, quote: "Bachelor's Degree in Civil Engineering" },
      { field: "general_experience", page_number: 1, quote: "Minimum 15 years of professional experience" },
      { field: "specific_experience", page_number: 1, quote: "At least 5 years supervising urban road construction" },
      { field: "role_description", page_number: 1, quote: "Supervise construction works and administer the contract" },
    ],
  }] });
  if (cleanSemanticFields.length) throw new Error(`Valid semantic field mapping was rejected: ${cleanSemanticFields.join(" ")}`);
  const sourceQuoteBackedNumericFields = validateTenderFieldSemantics({ positions: [{
    position_title: "Resident Engineer",
    source_page_numbers: [7],
    source_quotes: [
      "Resident Engineer: One",
      "Experience: ten (10) years or more",
      "Input months: 12",
    ],
    quantity: 1,
    minimum_years_experience: 10,
    input_months: 12,
  }] });
  if (sourceQuoteBackedNumericFields.length) {
    throw new Error(`Source quote backed numeric fields should not fail evidence validation: ${sourceQuoteBackedNumericFields.join(" ")}`);
  }
  const contractClaimsExpert = validateTenderFieldSemantics({ positions: [{
    position_title: "Contract/Claims Expert",
    source_quotes: ["K-8 Contract/Claims Expert"],
  }] });
  if (contractClaimsExpert.some((issue) => /clause or heading/i.test(issue))) {
    throw new Error("Contract/Claims Expert is a real role and must not be rejected as a contract clause.");
  }
  const notStatedRoleDuties = validateTenderFieldSemantics({ positions: [{
    position_title: "Electrical Engineer",
    role_description: "Electrical systems.",
    role_duties_status: "not_stated",
    source_quotes: ["Electrical Engineer"],
  }] });
  if (notStatedRoleDuties.some((issue) => /clear duty|qualifications or years/i.test(issue))) {
    throw new Error("Duties marked not_stated must not fail duty wording validation.");
  }
  // Intentionally invalid examples: each value below is placed in the wrong
  // field so the validator proves it can reject bad AI field mapping.
  const intentionallyMisfiledSecondaryFields = validateTenderFieldSemantics({ positions: [{
    position_title: "Railway Engineer",
    required_sector_experience: ["Bachelor degree in Civil Engineering"],
    mandatory_skills: ["AutoCAD"],
    required_software: ["10 years of experience"],
    required_languages: ["Registered Engineer"],
    position_deliverables: ["Master degree in Transport Planning"],
    required_keywords: ["The expert shall have a minimum of ten years of experience and must prepare reports"],
  }] });
  if (intentionallyMisfiledSecondaryFields.length < 6) {
    throw new Error("Semantic validation must catch misplaced secondary tender fields.");
  }
  const continuedTableContexts = [{
    table_title: "Key Personnel Requirements",
    header_page: 40,
    first_data_page: 40,
    last_data_page: 46,
    columns: [
      { header: "Position", meaning: "position_title" },
      { header: "Qualification", meaning: "minimum_education" },
      { header: "Experience", meaning: "general_experience and specific_experience" },
    ],
    continues_after_chunk: false,
  }];
  if (getTenderTableContextsForRange(continuedTableContexts, 44, 45).length !== 1) {
    throw new Error("Headerless continuation pages must inherit the active table header context.");
  }
  if (getTenderTableContextsForRange(continuedTableContexts, 47, 50).length !== 0) {
    throw new Error("Table header context must stop after the table's final page.");
  }
  const fullDocumentRoleContext = extractTenderRoleContext([
    "--- PAGE 10 ---",
    "Key staff: K1 Team Leader",
    "--- PAGE 42 ---",
    "Team Leader Education: Master's degree in Transport Planning. Experience: 15 years general experience.",
    "--- PAGE 88 ---",
    "The Team Leader shall coordinate the feasibility study, supervise experts, and lead reporting.",
  ].join("\n"), "Team Leader", 1);
  if (!/Master's degree/i.test(fullDocumentRoleContext) || !/coordinate the feasibility study/i.test(fullDocumentRoleContext)) {
    throw new Error("Position-first role context must search the full tender and include multiple occurrences of the same role.");
  }
  const deterministicTableContexts = inferTenderTableContextsFromText([
    { page_number: 20, text: "Table 3: Required qualifications of Non-Key Staff S/No Staff Position Qualifications Experience" },
    { page_number: 21, text: "1 Materials Engineer Education: Bachelor degree in Civil Engineering Experience: ten years or more" },
    { page_number: 22, text: "2 Environmental Specialist Education: Bachelor degree in Environmental Science Experience in World Bank projects" },
    { page_number: 23, text: "Section 8 Conditions of Contract payment clauses" },
  ]);
  if (!deterministicTableContexts.some((context) => context.first_data_page === 20 && context.last_data_page === 22)) {
    throw new Error("Deterministic table extraction must keep continued staff table pages under the original header.");
  }
  const notStatedDuties = normalizeTenderRecord({ positions: [{
    position_title: "Railway Engineer",
    source_page_numbers: [5],
    field_evidence: [
      { field: "position_title", page_number: 5, quote: "Railway Engineer" },
      { field: "minimum_education", page_number: 5, quote: "Bachelor degree in Civil Engineering" },
      { field: "general_experience", page_number: 5, quote: "Ten years general experience" },
    ],
    minimum_education: "Bachelor degree in Civil Engineering",
    general_experience: "Ten years general experience",
    role_duties_status: "not_stated",
  }] });
  if (notStatedDuties.extraction_blocking_issues.some((issue: string) => /responsibilities/i.test(issue))) {
    throw new Error("A searched-and-not-stated duty status must not block as a missed responsibility.");
  }

  const metadataPrecedenceTender = mergeTenderExtractions([
    { tender_title: "Authoritative Cover Title", client: "Procuring Entity", positions: [{ position_title: "Road Engineer", source_page_numbers: [1] }] },
    { tender_title: "A much longer but incorrect contract subsection heading that must not replace the cover title", client: "A longer organization mentioned in a later background paragraph", positions: [] },
  ]);
  if (metadataPrecedenceTender.tender_title !== "Authoritative Cover Title" || metadataPrecedenceTender.client !== "Procuring Entity") {
    throw new Error("Later contract text must not overwrite earlier tender metadata.");
  }

  const longRequirement = Array.from({ length: 2500 }, (_, index) => `Responsibility ${index + 1}`).join("; ");
  const untruncatedTender = normalizeTenderRecord({ positions: [{ position_title: "Resident Engineer", role_description: longRequirement }] });
  if (untruncatedTender.positions[0].role_description.length < longRequirement.length * 0.9) {
    throw new Error("Tender role requirements must not be silently truncated.");
  }

  const pageClassifications = Array.from({ length: 200 }, (_, index) => ({
    page_number: index + 1,
    categories: ["contract_clause"],
    readability: "CLEAR",
    confidence: 0.99,
    has_staff_requirements: false,
    summary: "Standard contract conditions",
  }));
  pageClassifications[49] = { ...pageClassifications[49], categories: ["staff_schedule"], has_staff_requirements: true, summary: "Key expert schedule" };
  pageClassifications[99] = { ...pageClassifications[99], confidence: 0.5 };
  pageClassifications[149] = { ...pageClassifications[149], readability: "UNREADABLE" };
  const routing = selectTenderPagesForPro(pageClassifications, 1, 200, { confidenceThreshold: 0.85, contextRadius: 2 });
  [48, 49, 50, 51, 52, 98, 99, 100, 101, 102, 148, 149, 150, 151, 152].forEach((page) => {
    if (!routing.selectedPages.includes(page)) throw new Error(`Expected relevance routing to send page ${page} to Pro.`);
  });
  if (!routing.skippedPages.includes(20)) throw new Error("Expected high-confidence contract boilerplate to skip Pro extraction.");
  const noClassificationRouting = selectTenderPagesForPro([], 1, 25);
  if (noClassificationRouting.selectedPages.length !== 25) throw new Error("Unclassified pages must always be sent to Pro.");
  const tableContextRouting = selectTenderPagesForPro(pageClassifications, 1, 200, {
    confidenceThreshold: 0.85,
    contextRadius: 0,
    tableContexts: [{
      table_title: "Continued staff table",
      header_page: 120,
      first_data_page: 120,
      last_data_page: 124,
      columns: [{ header: "Staff", meaning: "position_title" }],
      continues_after_chunk: false,
    }],
  });
  [120, 121, 122, 123, 124].forEach((page) => {
    if (!tableContextRouting.selectedPages.includes(page)) throw new Error(`Continued personnel table page ${page} must be routed to Pro extraction.`);
  });

  const reconciledPages = reconcileTenderEvidencePages({
    tender_field_evidence: [{ field: "deadline", page_number: 94, quote: "Deadline for proposal submission is 8 January 2025" }],
    positions: [{
      position_title: "Senior Laboratory Technician",
      source_page_numbers: [],
      source_quotes: ["Senior Laboratory Technician"],
      field_evidence: [{ field: "minimum_education", page_number: 94, quote: "Higher Diploma in Civil Engineering" }],
    }],
  }, [
    { page_number: 95, text: "Staff schedule: Senior Laboratory Technician (1 No.)" },
    { page_number: 98, text: "Senior Laboratory Technician - Higher Diploma in Civil Engineering" },
    { page_number: 100, text: "Deadline for proposal submission is 8 January 2025" },
  ]);
  if (reconciledPages.tender_field_evidence[0].page_number !== 100) throw new Error("Tender evidence must use the physical PDF page containing its quote.");
  if (reconciledPages.positions[0].field_evidence[0].page_number !== 98) throw new Error("Position evidence must use the physical PDF page containing its quote.");
  if (!reconciledPages.positions[0].source_page_numbers.includes(95) || !reconciledPages.positions[0].source_page_numbers.includes(98)) {
    throw new Error("Position source pages must be recovered deterministically from titles and quotes.");
  }

  const torPaths = [
    "C:/Users/Dell/Downloads/TOR 2024.OM.RFP.49_1.pdf",
    "C:/Users/Dell/Downloads/TOR 2024.OM.RFP.49_2.pdf",
  ];
  if (torPaths.every((path) => fs.existsSync(path))) {
    const torText = (await Promise.all(torPaths.map(readPdfText))).map((text, index) => `--- TENDER DOC ${index + 1} ---\n${text}`).join("\n\n");
    const torFacts = extractUniversalTenderFacts(torText);
    const titles = torFacts.positions.map((item) => item.position_title);
    console.log("TOR 2024.OM.RFP.49 role facts:", titles);
    const expectedTitles = ["Resident Engineer", "Civil Engineer", "Material Engineer", "Quantity Surveyor", "Land Surveyor", "Site Inspector", "Material / Lab Inspector", "Document Controller"];
    expectedTitles.forEach((title) => {
      if (!titles.includes(title)) throw new Error(`Expected TOR role recovery to include ${title}.`);
    });
    if (torFacts.positions.length !== expectedTitles.length) throw new Error(`Expected TOR role recovery to find ${expectedTitles.length} positions, got ${torFacts.positions.length}.`);

    const flattenedTorText = `LIST OF CONCULTANCY PERSONNEL Consultant Engineer shall provide indicted number of personnel dedicated for this contract: Item No. Position Total Required Personnel Omani National Expatriate No. No. 1 Requirements in Construction phase Resident Engineer 1 1 2 Civil Engineer 1 1 3 Material Engineer 1 1 4 Quantity Surveyor 1 1 5 Land Surveyor 1 1 6 Site Inspector 2 1 1 7 Material / Lab Inspector 2 1 1 8 Document Controller 1 1 Requirements in Construction phase: JOB TITLE Resident Engineer Location Site Qualification Bachelor’s Degree in a relevant Engineering discipline. Experience Shall have minimum 20 years in the field of road construction. Role & Responsibilities Shall manage project reporting. JOB TITLE Civil Engineer Location Site Qualification Bachelor’s Degree in Civil Engineering discipline. Experience Shall have minimum 8 years relevant work experience. Role & Responsibilities To supervise Earthworks and asphalt work. JOB TITLE Material Engineer Location Site Qualification Bachelor’s degree in Engineering. Experience Shall have minimum 8 years. Role & Responsibilities Review and approve all material. JOB TITLE Site Inspector Location Site Qualification Diploma/Bachelor’s Degree. Experience Shall have minimum 5 years. Role & Responsibilities To supervise all structural work. JOB TITLE Quantity Surveyor Location Site Qualification Diploma/Bachelor’s Degree in Engineering/QS Degree. Experience Shall have minimum 8 years. Role & Responsibilities Responsible for valuing completed works. JOB TITLE Land Surveyor Location Site Qualification Diploma/Bachelor’s degree in Engineering discipline Experience Shall have minimum 5 years. Role & Responsibilities Monitor field progress. JOB TITLE Material / Lab Inspector Location Site Qualification Diploma/Bachelor’s Degree. Experience minimum 5 years in road / bridge construction laboratory works. Role & Responsibilities Review and monitor all material. JOB TITLE Document Controller (Omani only) Location Site Qualification High Secondary School Experience No experience required. Role & Responsibilities Maintaining files.`;
    const flattenedFacts = extractUniversalTenderFacts(flattenedTorText);
    const flattenedTitles = flattenedFacts.positions.map((item) => item.position_title);
    expectedTitles.forEach((title) => {
      if (!flattenedTitles.includes(title)) throw new Error(`Expected flattened TOR recovery to include ${title}.`);
    });
    if (flattenedFacts.positions.length !== expectedTitles.length) throw new Error(`Expected flattened TOR recovery to find ${expectedTitles.length} positions, got ${flattenedFacts.positions.length}.`);
  } else {
    console.log("TOR 2024.OM.RFP.49 samples not found; skipping local PDF tender smoke check.");
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
