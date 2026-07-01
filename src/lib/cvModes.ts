export type CvMode = "NORMAL" | "ADAPT" | "RENDER";

const protectedFactPaths = [
  "fullName",
  "name",
  "email",
  "phone",
  "dateOfBirth",
  "birth_date",
  "countryOfCitizenship",
  "nationality",
  "educationLevel",
  "experienceYears",
  "primary_position",
  "role",
];

function clean(value: any) {
  if (value === undefined || value === null) return "";
  return String(value).replace(/\s+/g, " ").trim();
}

function getPathValue(obj: any, path: string) {
  return path.split(".").reduce((acc, key) => acc?.[key], obj);
}

function employmentFacts(expert: any) {
  return (expert?.experiences || expert?.employment_history || []).map((item: any) => ({
    period: clean(item.duration || item.period || `${item.start_date || ""} - ${item.end_date || ""}`),
    employer: clean(item.organization || item.employer),
    client: clean(item.client),
    role: clean(item.role || item.position),
    country: clean(item.country),
    project: clean(item.project_name),
  }));
}

function educationFacts(expert: any) {
  const education = expert?.metadata?.educations || expert?.education || [];
  return education.map((item: any) => {
    if (typeof item === "string") return clean(item);
    return clean([item.degree, item.field, item.institution, item.location, item.year].filter(Boolean).join(" | "));
  });
}

function projectFacts(expert: any) {
  const projects = [
    ...(expert?.projects || []).map((item: any) => item?.name || item?.project_name),
    ...(expert?.adequacy_experience || expert?.metadata?.adequacy || []).map((item: any) => item?.assignment),
  ];
  return projects.map(clean).filter(Boolean);
}

export function getCvMode(cv: any): CvMode {
  if (cv?.mode === "RENDER" || cv?.isRendered) return "RENDER";
  if (cv?.mode === "ADAPT" || cv?.isAdapted) return "ADAPT";
  return "NORMAL";
}

export function resolveCvExpert(cv: any, baseExpert: any) {
  const mode = getCvMode(cv);
  if (mode === "NORMAL") return baseExpert;
  return cv?.expertData || baseExpert;
}

export function buildModeAudit(mode: CvMode, baseExpert: any, outputExpert: any, tender: any, positionTitle: string) {
  const protectedFactChanges: any[] = [];

  protectedFactPaths.forEach((path) => {
    const before = clean(getPathValue(baseExpert, path));
    const after = clean(getPathValue(outputExpert, path));
    if (before !== after) {
      protectedFactChanges.push({ field: path, before, after });
    }
  });

  const beforeEmployment = employmentFacts(baseExpert);
  const afterEmployment = employmentFacts(outputExpert);
  const maxEmployment = Math.max(beforeEmployment.length, afterEmployment.length);
  for (let i = 0; i < maxEmployment; i++) {
    const before = beforeEmployment[i] || {};
    const after = afterEmployment[i] || {};
    ["period", "employer", "client", "role", "country", "project"].forEach((field) => {
      if (clean((before as any)[field]) !== clean((after as any)[field])) {
        protectedFactChanges.push({
          field: `employment[${i + 1}].${field}`,
          before: clean((before as any)[field]),
          after: clean((after as any)[field]),
        });
      }
    });
  }

  const beforeEducation = educationFacts(baseExpert);
  const afterEducation = educationFacts(outputExpert);
  if (JSON.stringify(beforeEducation) !== JSON.stringify(afterEducation)) {
    protectedFactChanges.push({ field: "education", before: beforeEducation, after: afterEducation });
  }

  return {
    mode,
    generatedAt: new Date().toISOString(),
    tenderId: tender?.id || "",
    tenderName: tender?.name || tender?.tender_title || "",
    positionTitle,
    protectedFactChanges,
    protectedFactChangeCount: protectedFactChanges.length,
    projectEvidenceCount: projectFacts(outputExpert).length,
  };
}
