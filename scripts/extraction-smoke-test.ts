import fs from "fs";
import mammoth from "mammoth";
import { PDFParse } from "pdf-parse";
import { extractUniversalCVFacts, extractUniversalTenderFacts } from "../src/lib/universalExtraction.ts";
import { normalizeExpertCollections, postProcessExtractedExpert } from "../src/lib/cvPostProcess.ts";

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
  } else {
    console.log("TOR 2024.OM.RFP.49 samples not found; skipping local PDF tender smoke check.");
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
