import { extractUniversalCVFacts } from "../src/lib/universalExtraction.ts";
import { postProcessExtractedExpert } from "../src/lib/cvPostProcess.ts";
import { normalizeTenderRecord } from "../src/lib/tenderPostProcess.ts";
import { mergeTenderResults, selectRelevantTenderPages } from "../src/backend/tenderExtraction.ts";

function expect(condition: any, message: string) {
  if (!condition) throw new Error(message);
}

async function main() {
  const cvText = `
    Jane Doe
    jane.doe@via-int.com | +971 50 123 4567
    Languages: English - Fluent; French - Intermediate
    Education
    Master of Science in Civil Engineering, University of Example, 2018
    Software: AutoCAD, Civil 3D, Primavera
  `;
  const cvFacts = extractUniversalCVFacts(cvText);
  expect(cvFacts.contacts.emails.includes("jane.doe@via-int.com"), "CV email extraction regressed.");
  expect(cvFacts.languages.some((item) => item.name === "English"), "CV language extraction regressed.");
  const expert = postProcessExtractedExpert({ fullName: "Jane Doe" }, cvText);
  expect(expert.email === "jane.doe@via-int.com", "CV post-processing no longer preserves extracted email.");

  const pages = Array.from({ length: 120 }, (_, index) => ({
    page_number: index + 1,
    document_name: "sample.pdf",
    document_page_number: index + 1,
    text: "Standard contract clause and boilerplate conditions.",
    readable: true,
  }));
  pages[49].text = "Key Experts and professional staff schedule: K-1 Resident Engineer";
  pages[50].text = "Qualification Master's Degree in Civil Engineering and 15 years professional experience";
  pages[51].text = "Role and responsibilities: supervise the construction works and administer the contract";
  const selected = selectRelevantTenderPages(pages as any).map((page: any) => page.page_number);
  [48, 49, 50, 51, 52].forEach((page) => {
    expect(selected.includes(page), `Relevant page selection lost staff-table context page ${page}.`);
  });
  expect(!selected.includes(80), "High-confidence irrelevant contract pages should be skipped.");

  const merged = mergeTenderResults([
    {
      tender_title: "Construction Supervision of Selected Roads",
      client: "Mukono District Local Government",
      positions: [{
        position_title: "K-1 Senior Highway Design Engineer / Team Leader for Design Update",
        source_position_number: 1,
        quantity: 1,
        minimum_education: "Master's Degree in Civil Engineering, Highways, or Geotechnical Engineering",
        source_page_numbers: [35],
        field_evidence: [{ field: "minimum_education", page_number: 35, quote: "minimum of a Master's Degree in Civil Engineering, Highways, Geotechnical Engineering" }],
      }],
    },
    {
      tender_title: "Construction Supervision of Selected Roads",
      positions: [{
        position_title: "Senior Highway Design Engineer / Team Leader for Design Update",
        source_position_number: 1,
        minimum_years_experience: 15,
        general_experience: "15 years post-graduate experience carrying out road design and construction supervision",
        required_certifications: ["Registered/Chartered Engineer with valid practising certificate"],
        role_description: "Lead the design update and detailed engineering design review.",
        role_duties_status: "explicit",
        source_page_numbers: [36, 96],
      }],
    },
    {
      positions: [{
        position_title: "Senior Laboratory Technician",
        quantity: 1,
        input_months: 17,
        minimum_education: "Higher Diploma (HD) in Civil Engineering or related discipline",
        minimum_years_experience: 10,
        general_experience: "Minimum 10 years' experience in a similar position on civil and construction projects",
        source_page_numbers: [98],
      }],
    },
  ]);

  expect(merged.tender_title === "Construction Supervision of Selected Roads", "Tender metadata must not be concatenated during chunk merging.");
  expect(merged.positions.length === 2, `Expected two consolidated roles, got ${merged.positions.length}.`);
  const lead = merged.positions.find((position: any) => /Highway Design Engineer/i.test(position.position_title));
  expect(lead?.position_title === "Senior Highway Design Engineer / Team Leader for Design Update", "K-code was not removed from the occupational title.");
  expect(/Master's Degree/i.test(lead?.minimum_education || ""), "Education was lost while merging role occurrences.");
  expect(lead?.minimum_years_experience === 15, "General experience years were lost while merging role occurrences.");
  expect(/Registered\/Chartered/i.test(lead?.required_certifications?.join(" ") || ""), "Professional registration was lost.");
  expect(/design update/i.test(lead?.role_description || ""), "Role duties were lost.");

  const support = merged.positions.find((position: any) => position.position_title === "Senior Laboratory Technician");
  expect(support?.quantity === 1 && support?.input_months === 17, "Support staff quantity/input months were lost.");
  expect(/Higher Diploma/i.test(support?.minimum_education || ""), "Support staff education was lost.");

  const separateLots = mergeTenderResults([
    { positions: [{ position_title: "Civil Engineer", lot_reference: "Lot A", minimum_education: "BSc Civil Engineering" }] },
    { positions: [{ position_title: "Civil Engineer", lot_reference: "Lot B", minimum_education: "MSc Civil Engineering" }] },
  ]);
  expect(separateLots.positions.length === 2, "Same-title roles from separate lots must remain separate.");

  const unknown = normalizeTenderRecord({ positions: [{ position_title: "Road Engineer" }] });
  expect(unknown.positions[0].quantity === undefined, "Missing quantity must not default to 1.");
  expect(unknown.positions[0].minimum_years_experience === undefined, "Missing experience must not default to 0.");
  expect(unknown.positions[0].nationality_preference === "", "Missing nationality must not default to Any.");

  console.log("Extraction smoke tests passed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
