import fs from "fs";
import mammoth from "mammoth";
import { extractUniversalCVFacts, extractUniversalTenderFacts } from "../src/lib/universalExtraction.ts";
import { postProcessExtractedExpert } from "../src/lib/cvPostProcess.ts";

async function readDocxText(path: string) {
  const result = await mammoth.extractRawText({ buffer: fs.readFileSync(path) });
  return result.value;
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
    if (facts.languages.length < 5) throw new Error("Expected Silvia CV language recovery to find at least 5 languages.");
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
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
