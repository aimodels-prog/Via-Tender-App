function clean(value: any) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function wordCount(value: any) {
  return clean(value).split(/\s+/).filter(Boolean).length;
}

function pointCount(value: any) {
  const text = clean(value);
  if (!text) return 0;
  const bulletParts = text
    .split(/\n+|(?:^|\s)[\-•]\s+/)
    .map((part) => part.trim())
    .filter((part) => wordCount(part) >= 4);
  if (bulletParts.length > 1) return bulletParts.length;
  return text.split(/[.;]\s+/).map((part) => part.trim()).filter((part) => wordCount(part) >= 5).length;
}

function normalizedIncludes(haystack: string, needle: string) {
  const value = clean(needle).toLowerCase();
  return value.length >= 4 && haystack.toLowerCase().includes(value);
}

function getRelevantSourceWindow(rawText: string, item: any) {
  const text = clean(rawText);
  if (!text) return "";
  const period = clean(item.duration || item.period || `${item.start_date || ""} ${item.end_date || ""}`);
  const anchors = [
    item.organization,
    item.client,
    item.role,
    item.country,
    period,
    ...(period.match(/\b(19|20)\d{2}\b/g) || []),
  ].map(clean).filter((anchor) => anchor.length >= 4);

  let bestIndex = -1;
  let bestScore = 0;
  anchors.forEach((anchor) => {
    const index = text.toLowerCase().indexOf(anchor.toLowerCase());
    if (index < 0) return;
    const window = text.slice(Math.max(0, index - 180), index + 1100);
    const score = anchors.filter((candidate) => normalizedIncludes(window, candidate)).length;
    if (score > bestScore) {
      bestScore = score;
      bestIndex = index;
    }
  });

  if (bestIndex < 0 || bestScore < 2) return "";
  return text.slice(Math.max(0, bestIndex - 220), bestIndex + 1300);
}

function splitActivityPoints(value: string) {
  return clean(value)
    .replace(/\s*[•▪◦]\s*/g, "\n")
    .replace(/\s+-\s+/g, "\n")
    .split(/\n+|;\s+|(?<=[.])\s+(?=(?:Prepared|Reviewed|Designed|Supervised|Managed|Coordinated|Checked|Monitored|Inspected|Handled|Assisted|Conducted|Developed|Evaluated|Prepared|Ensured|Provided|Responsible|Duties|Responsibilities)\b)/i)
    .map((line) => clean(line).replace(/^[-•]\s*/, ""))
    .filter((line) => wordCount(line) >= 5)
    .filter((line) => /responsib|duties|prepared|preparation|designed|reviewed|supervised|supervision|managed|coordinated|checked|checking|analysis|inspection|progress|quality|safety|construction|claims|variation|monitor|estimate|report|site|contract|quantity|survey|boq|invoice|measurement/i.test(line));
}

function mergeActivityDetails(currentDescription: string, sourceWindow: string) {
  const current = clean(currentDescription);
  const currentLower = current.toLowerCase();
  const sourcePoints = splitActivityPoints(sourceWindow);
  const missingPoints = sourcePoints.filter((point) => {
    const keywords = (point.toLowerCase().match(/\b[a-z]{5,}\b/g) || []).slice(0, 8);
    const overlap = keywords.filter((keyword) => currentLower.includes(keyword)).length;
    return overlap < Math.min(3, keywords.length);
  });

  if (!missingPoints.length) return currentDescription;

  const existingLines = current
    ? current
        .split(/\n+/)
        .map((line) => clean(line).replace(/^[-•]\s*/, ""))
        .filter(Boolean)
    : [];

  const merged = [...existingLines, ...missingPoints]
    .map((line) => `- ${line.replace(/[.;]\s*$/, "")}`)
    .join("\n");

  return merged || currentDescription;
}

export function recoverEmploymentActivitiesFromText(expert: any, rawText: string) {
  const experiences = expert.experiences || expert.employment_history || [];
  if (!experiences.length || !rawText) return expert;

  const recoveredIndexes: number[] = [];
  const nextExperiences = experiences.map((item: any, index: number) => {
    const description = clean(item.description);
    const sourceWindow = getRelevantSourceWindow(rawText, item);
    if (!sourceWindow) return item;

    const sourceHasMoreDetail =
      /responsib|duties|prepared|preparation|designed|reviewed|supervised|supervision|managed|coordinated|checked|checking|analysis|inspection|progress|quality|safety|construction|claims|variation|monitor|estimate|report|site|contract|quantity|survey|boq|invoice|measurement/i.test(sourceWindow) &&
      wordCount(sourceWindow) >= Math.max(45, wordCount(description) + 20) &&
      pointCount(sourceWindow) >= Math.max(2, pointCount(description) + 1);

    if (!sourceHasMoreDetail) return item;

    const mergedDescription = mergeActivityDetails(description, sourceWindow);
    if (clean(mergedDescription) === description) return item;

    recoveredIndexes.push(index + 1);
    return {
      ...item,
      description: mergedDescription,
    };
  });

  if (!recoveredIndexes.length) return expert;

  return {
    ...expert,
    experiences: nextExperiences,
    employment_history: nextExperiences,
    extraction_recovery: {
      ...(expert.extraction_recovery || {}),
      employmentActivitiesRecoveredFromRawText: recoveredIndexes,
    },
    metadata: {
      ...(expert.metadata || {}),
      extraction_audit_notes: [
        ...(expert.metadata?.extraction_audit_notes || []),
        `Recovered additional employment activity details from source CV for employment record(s): ${recoveredIndexes.join(", ")}.`,
      ],
    },
  };
}

export function recoverEducationFromText(text: string) {
  const normalized = clean(text);
  const start = normalized.search(/\b(qualification|qualifications|education|academic qualifications|academic)\b/i);
  if (start < 0) return [];

  const endMatch = normalized
    .slice(start)
    .search(/\b(additional qualification|computer|professional experience|employment|experience|skills|personal profile|references)\b/i);
  const section = normalized
    .slice(start, endMatch > 0 ? start + endMatch : start + 900)
    .replace(/[•]/g, " ");
  const patterns = [
    /\b(?:Ph\.?D\.?|Doctor(?:ate)?|DAE|Diploma|Bachelor|Bachelors|Bachelor's|BSc|B\.?Sc\.?|Master|Masters|MSc|M\.?Sc\.?|MEng|M\.?Eng|Degree|Intermediate|Matriculation)\s+(?:in\s+)?[A-Za-z&/.,() -]{3,160}(?=\s+(?:Ph\.?D|Doctor|DAE|Diploma|Bachelor|BSc|B\.?Sc|Master|MSc|MEng|M\.?Eng|Intermediate|Matriculation|Memberships|Skills|Personal Profile|References)|$)/gi,
    /\b(?:Civil Engineering|Structural Engineering|Civil Engineer|Quantity Surveying|Pre-Engineering|Matriculation Science|Architecture|Surveying|Construction Management)\b(?:\s*\([^)]+\))?/gi,
  ];

  const found = patterns
    .flatMap((pattern) => section.match(pattern) || [])
    .map((item) => item.replace(/^(qualification|education)\s*:?/i, "").trim())
    .map((item) => item.replace(/[•]/g, "").replace(/\s+/g, " ").trim())
    .filter((item) => wordCount(item) >= 2);

  return Array.from(new Set(found));
}

export function strengthenAdequacyFromEmployment(expert: any) {
  const experiences = expert.experiences || expert.employment_history || [];
  const adequacy = expert.adequacy_experience || expert.metadata?.adequacy || [];
  if (!experiences.length || !adequacy.length) return expert;

  const strongerAdequacy = adequacy.map((item: any, index: number) => {
    const assignment = clean(item.assignment);
    const matchingExperience =
      experiences.find((exp: any) => {
        const samePeriod = clean(exp.duration || exp.period).toLowerCase() === clean(item.period).toLowerCase();
        const sameRole = clean(exp.role).toLowerCase() === clean(item.position).toLowerCase();
        const sameClient = clean(exp.client).toLowerCase() && clean(item.client).toLowerCase().includes(clean(exp.client).toLowerCase());
        return samePeriod || sameRole || sameClient;
      }) || experiences[index];

    const description = clean(matchingExperience?.description);
    const projectName = clean(matchingExperience?.project_name);
    const client = clean(item.client || matchingExperience?.client || matchingExperience?.organization || matchingExperience?.employer);

    if (wordCount(assignment) >= 25 && /responsib|duties|interim|checking|variation|analysis|progress|schedule|claims|supervis|prepared|managed|coordinated/i.test(assignment)) {
      return { ...item, client };
    }

    const lines = [
      assignment || projectName || client,
      description ? `Responsibilities included ${description.replace(/^performed here my duty as [^.]+\.?\s*/i, "")}` : "",
    ].filter(Boolean);

    return {
      ...item,
      client,
      assignment: lines
        .join("\n")
        .split(/\n+|;\s+/)
        .map((line) => clean(line).replace(/^[-\u2022]\s*/, ""))
        .filter(Boolean)
        .map((line) => `- ${line}`)
        .join("\n"),
    };
  });

  return {
    ...expert,
    adequacy_experience: strongerAdequacy,
    metadata: {
      ...(expert.metadata || {}),
      adequacy: strongerAdequacy,
    },
  };
}

export function postProcessExtractedExpert(expert: any, rawText: string) {
  let next = { ...expert };
  const existingEducation = next.education || next.metadata?.educations || [];
  if (!existingEducation.length) {
    const recoveredEducation = recoverEducationFromText(rawText);
    if (recoveredEducation.length) {
      next = {
        ...next,
        education: recoveredEducation,
        educationLevel: next.educationLevel || recoveredEducation[0],
        metadata: {
          ...(next.metadata || {}),
          educations: recoveredEducation.map((item) => ({ degree: item })),
        },
        extraction_recovery: {
          ...(next.extraction_recovery || {}),
          educationRecoveredFromRawText: recoveredEducation,
        },
      };
    }
  }

  next = recoverEmploymentActivitiesFromText(next, rawText);

  return strengthenAdequacyFromEmployment(next);
}
