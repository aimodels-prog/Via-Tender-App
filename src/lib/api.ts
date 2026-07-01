import { getDocument, GlobalWorkerOptions } from "pdfjs-dist";
// @ts-ignore
import pdfWorker from "pdfjs-dist/build/pdf.worker.mjs?url";
import * as mammoth from "mammoth";

GlobalWorkerOptions.workerSrc = pdfWorker;

export interface ExtractedDocumentPage {
  pageNumber: number;
  text: string;
  charCount: number;
  isBlank: boolean;
}

export interface ExtractedDocument {
  text: string;
  rawText: string;
  pages: ExtractedDocumentPage[];
  metadata: {
    totalPages: number;
    usedPages: number[];
    blankPages: number[];
    likelyAttachmentPages: number[];
    detectedCvPageCount?: number;
    cleanupNotes: string[];
  };
}

function normalizePdfText(value: string) {
  return String(value || "")
    .replace(/\u00A0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\s+([,.;:])/g, "$1")
    .replace(/\(\s*Since/g, "(Since")
    .replace(/\b(\d+)\s+(st|nd|rd|th)\b/gi, "$1$2")
    .trim();
}

function removeRepeatedCvHeaders(text: string) {
  return text
    .replace(/\b[A-Z][a-z]+ [A-Z][a-z]+ [A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\s+Mobile:\s*\+?[\d\s,+-]+/gi, " ")
    .replace(/\bPage\s+\d+\s+of\s+\d+\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function detectCvPageCount(pages: ExtractedDocumentPage[]) {
  for (const page of pages.slice(0, 3)) {
    const match = page.text.match(/\bPage\s+1\s+of\s+(\d{1,3})\b/i);
    if (match) return Number(match[1]);
  }
  return undefined;
}

function isLikelyCvPage(text: string) {
  const t = text.toLowerCase();
  const signals = [
    "professional experience",
    "employment",
    "qualification",
    "education",
    "personnel",
    "curriculum vitae",
    "quantity surveyor",
    "date of birth",
    "nationality",
    "e-mail",
    "email",
  ];
  return signals.some((signal) => t.includes(signal));
}

function preprocessCvText(rawPages: ExtractedDocumentPage[]): ExtractedDocument {
  const cleanupNotes: string[] = [];
  const detectedCvPageCount = detectCvPageCount(rawPages);
  const blankPages = rawPages.filter((page) => page.isBlank).map((page) => page.pageNumber);
  let usedPages = rawPages.filter((page) => !page.isBlank).map((page) => page.pageNumber);

  if (detectedCvPageCount && detectedCvPageCount < rawPages.length) {
    usedPages = rawPages
      .filter((page) => page.pageNumber <= detectedCvPageCount && !page.isBlank)
      .map((page) => page.pageNumber);
    cleanupNotes.push(`Detected CV page range from "Page 1 of ${detectedCvPageCount}" and ignored later attachment pages.`);
  } else {
    const firstBlankAfterText = rawPages.find(
      (page) =>
        page.isBlank &&
        rawPages.some((p) => p.pageNumber < page.pageNumber && !p.isBlank) &&
        rawPages.slice(page.pageNumber).filter((p) => !p.isBlank).length === 0,
    );
    if (firstBlankAfterText) {
      usedPages = rawPages
        .filter((page) => page.pageNumber < firstBlankAfterText.pageNumber && !page.isBlank)
        .map((page) => page.pageNumber);
      cleanupNotes.push("Ignored trailing blank/scanned pages after text CV body.");
    }
  }

  const likelyAttachmentPages = rawPages
    .filter((page) => !usedPages.includes(page.pageNumber) && (page.isBlank || !isLikelyCvPage(page.text)))
    .map((page) => page.pageNumber);

  let cleaned = rawPages
    .filter((page) => usedPages.includes(page.pageNumber))
    .map((page) => removeRepeatedCvHeaders(page.text))
    .join("\n")
    .replace(/\n+/g, "\n")
    .replace(/([.)])\s+(\d{1,2}\.\s+(?:Asst\.\s*)?[A-Z][A-Za-z ./&-]+?\s+(?:Surveyor|Supervisor|Engineer|Manager|Consultant|Specialist|Inspector|Officer|Coordinator))/g, "$1\n$2")
    .replace(/\s+o\s+/g, "\n- ")
    .replace(/\n\s*-\s+/g, "\n- ")
    .replace(/[ \t]+/g, " ")
    .trim();

  cleanupNotes.push("Preserved page-aware CV body and removed repeated page headers/footers.");
  if (blankPages.length) cleanupNotes.push(`Detected ${blankPages.length} blank or scanned page(s) with no selectable text.`);

  return {
    text: cleaned,
    rawText: rawPages.map((page) => `--- PAGE ${page.pageNumber} ---\n${page.text}`).join("\n\n"),
    pages: rawPages,
    metadata: {
      totalPages: rawPages.length,
      usedPages,
      blankPages,
      likelyAttachmentPages,
      detectedCvPageCount,
      cleanupNotes,
    },
  };
}

export async function extractDocumentFromFile(file: File): Promise<ExtractedDocument> {
  const fileExt = file.name.split('.').pop()?.toLowerCase();
  const arrayBuffer = await file.arrayBuffer();

  if (fileExt === 'docx') {
    try {
      const result = await mammoth.extractRawText({ arrayBuffer });
      const text = normalizePdfText(result.value);
      return {
        text,
        rawText: result.value,
        pages: [{ pageNumber: 1, text, charCount: text.length, isBlank: !text }],
        metadata: {
          totalPages: 1,
          usedPages: [1],
          blankPages: [],
          likelyAttachmentPages: [],
          cleanupNotes: ["Extracted DOCX raw text."],
        },
      };
    } catch (err) {
      console.error("Failed to parse DOCX:", err);
      throw new Error("Unable to parse DOCX file layout.");
    }
  }

  if (fileExt === 'pdf') {
    try {
      const pdf = await getDocument({ data: arrayBuffer }).promise;
      const pages: ExtractedDocumentPage[] = [];
      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const textContent = await page.getTextContent();
        const pageText = normalizePdfText(textContent.items.map((item: any) => item.str).join(" "));
        pages.push({
          pageNumber: i,
          text: pageText,
          charCount: pageText.length,
          isBlank: pageText.length < 20,
        });
      }
      return preprocessCvText(pages);
    } catch(err) {
       console.error("Failed to parse PDF:", err);
       throw new Error("Unable to parse PDF file.");
    }
  }

  const textDecoder = new TextDecoder("utf-8");
  const text = normalizePdfText(textDecoder.decode(arrayBuffer));
  return {
    text,
    rawText: text,
    pages: [{ pageNumber: 1, text, charCount: text.length, isBlank: !text }],
    metadata: {
      totalPages: 1,
      usedPages: [1],
      blankPages: [],
      likelyAttachmentPages: [],
      cleanupNotes: ["Extracted plain text file."],
    },
  };
}

export async function extractTextFromPDF(file: File): Promise<string> {
  const extracted = await extractDocumentFromFile(file);
  return extracted.text;
}

async function request<T = any>(url: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(url, {
    ...options,
    credentials: "include",
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(options.headers || {}),
    },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || `Request failed: ${response.status}`);
  }
  return data;
}

function jsonBody(value: any) {
  return JSON.stringify(value ?? {});
}

// Global API
export const api = {
  getStats: async () => {
    return request("/api/stats");
  },

  getLogs: async () => {
    return request("/api/logs");
  },

  getUsers: async () => {
    return request("/api/users");
  },

  addUser: async (user: any) => {
    try {
      return await request("/api/users", { method: "POST", body: jsonBody(user) });
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  },

  updateUser: async (id: string, updatedUser: any) => {
    try {
      return await request(`/api/users/${id}`, { method: "PATCH", body: jsonBody(updatedUser) });
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  },

  deleteUser: async (id: string) => {
    return request(`/api/users/${id}`, { method: "DELETE" });
  },

  getExperts: async () => {
    return request("/api/experts");
  },

  getTenders: async () => {
    return request("/api/tenders");
  },

  getTender: async (id: string) => {
    return request(`/api/tenders/${id}`);
  },

  updateExpertRole: async (expertId: string, role: string) => {
    return request(`/api/experts/${expertId}`, { method: "PATCH", body: jsonBody({ role }) });
  },

  updateExpert: async (id: string, updatedExpert: any) => {
    return request(`/api/experts/${id}`, { method: "PATCH", body: jsonBody(updatedExpert) });
  },

  saveExperts: async (newExperts: any[]) => {
    return request("/api/experts/save", { method: "POST", body: jsonBody({ experts: newExperts }) });
  },

  saveTender: async (tender: any) => {
    return request("/api/tenders", { method: "POST", body: jsonBody(tender) });
  },

  updateTender: async (id: string, updates: any) => {
    return request(`/api/tenders/${id}`, { method: "PATCH", body: jsonBody(updates) });
  },

  updateTenderBranding: async (id: string, branding: any) => {
    await request(`/api/tenders/${id}`, { method: "PATCH", body: jsonBody({ branding }) });
    return { success: true };
  },

  updateTenderRequirements: async (id: string, requirements: any) => {
    await request(`/api/tenders/${id}`, { method: "PATCH", body: jsonBody({ requirements }) });
    return { success: true };
  },

  getMatches: async (tenderId?: string) => {
    return request(`/api/matches${tenderId ? `?tenderId=${encodeURIComponent(tenderId)}` : ""}`);
  },

  saveMatches: async (
    tenderId: string,
    positionId: string,
    positionTitle: string,
    matches: any[],
  ) => {
    return request("/api/matches/save", {
      method: "POST",
      body: jsonBody({ tenderId, positionId, positionTitle, matches }),
    });
  },

  saveCV: async (cv: any) => {
    return request("/api/cvs", { method: "POST", body: jsonBody(cv) });
  },

  updateCV: async (updatedCV: any) => {
    return request(`/api/cvs/${updatedCV.id}`, { method: "PATCH", body: jsonBody(updatedCV) });
  },

  getCVs: async () => {
    return request("/api/cvs");
  },

  getGoogleDriveSettings: async () => {
    return request("/api/settings/googleDrive");
  },

  saveGoogleDriveSettings: async (settings: any) => {
    return request("/api/settings/googleDrive", { method: "PUT", body: jsonBody(settings) });
  },

  getDriveFiles: async () => {
    return request("/api/drive-files");
  },

  upsertDriveFile: async (driveFile: any) => {
    return request("/api/drive-files", { method: "POST", body: jsonBody(driveFile) });
  },

  updateDriveFile: async (googleFileId: string, updates: any) => {
    return request(`/api/drive-files/${googleFileId}`, { method: "PATCH", body: jsonBody(updates) });
  },

  getPendingDriveReviews: async () => {
    return request("/api/pending-drive-reviews");
  },

  addPendingDriveReview: async (review: any) => {
    const result = await request("/api/pending-drive-reviews", { method: "POST", body: jsonBody(review) });
    window.dispatchEvent(new Event("driveReviewsUpdated"));
    return result;
  },

  clearPendingDriveReviews: async (googleFileIds?: string[]) => {
    await request("/api/pending-drive-reviews", {
      method: "DELETE",
      body: jsonBody({ googleFileIds: googleFileIds || [] }),
    });
    window.dispatchEvent(new Event("driveReviewsUpdated"));
    return { success: true };
  },

  getGlobalBranding: async () => {
    return request("/api/settings/globalBranding");
  },

  saveGlobalBranding: async (branding: any) => {
    return request("/api/settings/globalBranding", { method: "PUT", body: jsonBody(branding) });
  },

  getTaxonomy: async () => {
    return request("/api/settings/taxonomy");
  },

  saveTaxonomy: async (taxonomy: string[]) => {
    return request("/api/settings/taxonomy", { method: "PUT", body: jsonBody(taxonomy) });
  },

  getAISettings: async () => {
    return request("/api/settings/aiSettings");
  },

  saveAISettings: async (settings: any) => {
    return request("/api/settings/aiSettings", { method: "PUT", body: jsonBody(settings) });
  },

  getLookups: async () => {
    return request("/api/lookups");
  },

  deleteExpert: async (id: string) => {
    return request(`/api/experts/${id}`, { method: "DELETE" });
  },

  deleteTender: async (id: string) => {
    return request(`/api/tenders/${id}`, { method: "DELETE" });
  },

  deleteCV: async (id: string) => {
    return request(`/api/cvs/${id}`, { method: "DELETE" });
  },

  deleteMatch: async (id: string) => {
    return request(`/api/matches/${id}`, { method: "DELETE" });
  },

  updateMatch: async (id: string, updates: any) => {
    return request(`/api/matches/${id}`, { method: "PATCH", body: jsonBody(updates) });
  },

  clearData: async () => {
    return request("/api/data", { method: "DELETE" });
  },
};
