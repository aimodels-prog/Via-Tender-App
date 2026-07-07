import fs from "fs";
import mammoth from "mammoth";
import { PDFParse } from "pdf-parse";
import { extractUniversalCVFacts, extractUniversalTenderFacts } from "../src/lib/universalExtraction.ts";
import { normalizeExpertCollections, postProcessExtractedExpert } from "../src/lib/cvPostProcess.ts";
import { normalizeTenderRecord } from "../src/lib/tenderPostProcess.ts";

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
