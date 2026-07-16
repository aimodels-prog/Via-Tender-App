import { api } from './api';

async function readApiResponse(response: Response) {
  const text = await response.text();
  const contentType = response.headers.get('content-type') || '';
  const isJson = contentType.includes('application/json') || /^[\s\n\r]*[\[{]/.test(text);
  if (!isJson) {
    const cleanText = text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    return {
      data: {},
      error: cleanText || `Server returned ${response.status} ${response.statusText || ''}`.trim(),
    };
  }
  try {
    return { data: JSON.parse(text), error: '' };
  } catch (error: any) {
    return {
      data: {},
      error: `Server returned invalid JSON: ${error.message}`,
    };
  }
}

export async function parseCVText(text: string): Promise<any[]> {
  const taxonomyItems = await api.getTaxonomy();
  const aiSettings = await api.getAISettings();
  try {
    const response = await fetch('/api/parse-cv', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, taxonomy: taxonomyItems })
    });
    if (!response.ok) {
        const { data: errorData, error } = await readApiResponse(response);
        if (error) throw new Error(error);
        throw new Error(errorData.error || "Failed to parse CV");
    }
    const { data, error } = await readApiResponse(response);
    if (error) throw new Error(error);
    return data.experts || [];
  } catch (error) {
    console.error("Parse CV Error:", error);
    throw error;
  }
}

export async function auditExtractedCV(rawText: string, expert: any): Promise<any> {
  try {
    const response = await fetch('/api/audit-cv', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rawText, expert })
    });
    if (!response.ok) {
      const { data: errorData, error } = await readApiResponse(response);
      if (error) throw new Error(error);
      throw new Error(errorData.error || "Failed to audit CV extraction");
    }
    const { data, error } = await readApiResponse(response);
    if (error) throw new Error(error);
    return data.expert || expert;
  } catch (error) {
    console.error("Audit CV Error:", error);
    return expert;
  }
}

export async function parseTenderText(text: string): Promise<any> {
  const aiSettings = await api.getAISettings();
  try {
    const response = await fetch('/api/parse-tender', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text })
    });
    if (!response.ok) {
        const { data: errorData, error } = await readApiResponse(response);
        if (error) throw new Error(`Tender parsing failed (${response.status}): ${error}`);
        throw new Error(errorData.error || "Failed to parse Tender");
    }
    const { data, error } = await readApiResponse(response);
    if (error) throw new Error(`Tender parsing failed: ${error}`);
    if (data.tender) return data.tender || {};
    const jobId = data.jobId;
    if (!jobId) throw new Error("Tender parsing did not return a job id.");

    const startedAt = Date.now();
    const timeoutMs = 20 * 60 * 1000;
    while (Date.now() - startedAt < timeoutMs) {
      await new Promise((resolve) => setTimeout(resolve, 3500));
      const pollResponse = await fetch(`/api/parse-tender/${encodeURIComponent(jobId)}`);
      const { data: pollData, error: pollError } = await readApiResponse(pollResponse);
      if (!pollResponse.ok) {
        if (pollError) throw new Error(`Tender parsing status failed (${pollResponse.status}): ${pollError}`);
        throw new Error(pollData.error || "Failed to check tender parsing status");
      }
      if (pollError) throw new Error(`Tender parsing status failed: ${pollError}`);
      if (pollData.status === 'completed') {
        const tender = pollData.tender || {};
        if (!String(tender.tender_title || tender.name || tender.client || '').trim() && !Array.isArray(tender.positions)) {
          throw new Error("Tender parsing completed but returned no tender data.");
        }
        if (Array.isArray(tender.positions) && tender.positions.length === 0 && !String(tender.tender_title || tender.name || tender.client || '').trim()) {
          throw new Error("Tender parsing completed but found no title, client, or positions.");
        }
        return tender;
      }
      if (pollData.status === 'failed') throw new Error(pollData.error || "Tender parsing failed.");
    }
    throw new Error("Tender parsing is still running after 20 minutes. Please check the tender again later.");
  } catch (error) {
    console.error("Parse Tender Error:", error);
    throw error;
  }
}

export async function parseTenderPdfFiles(files: File[]): Promise<any> {
  try {
    const formData = new FormData();
    files.forEach((file) => formData.append('files', file, file.name));
    const response = await fetch('/api/parse-tender-files', { method: 'POST', body: formData });
    const { data, error } = await readApiResponse(response);
    if (!response.ok) throw new Error(error || data.error || `Tender upload failed (${response.status}).`);
    if (data.tender) return data.tender;
    const jobId = data.jobId;
    if (!jobId) throw new Error('Native tender extraction did not return a job id.');

    const startedAt = Date.now();
    const timeoutMs = 2 * 60 * 60 * 1000;
    while (Date.now() - startedAt < timeoutMs) {
      await new Promise((resolve) => setTimeout(resolve, 4000));
      const pollResponse = await fetch(`/api/parse-tender/${encodeURIComponent(jobId)}`);
      const { data: pollData, error: pollError } = await readApiResponse(pollResponse);
      if (!pollResponse.ok) throw new Error(pollError || pollData.error || 'Failed to check tender extraction status.');
      if (pollData.status === 'completed') {
        const tender = pollData.tender || {};
        if (!String(tender.tender_title || tender.name || tender.client || '').trim() && (!Array.isArray(tender.positions) || tender.positions.length === 0)) {
          throw new Error('Native PDF extraction completed but returned no tender information.');
        }
        return tender;
      }
      if (pollData.status === 'failed') throw new Error(pollData.error || 'Native PDF tender extraction failed.');
    }
    throw new Error('Tender extraction is still running after two hours. Check the extraction job again later.');
  } catch (error) {
    console.error('Parse Tender PDF Error:', error);
    throw error;
  }
}

export async function runMatchEngine(tender: any, positionId: string, experts: any[]): Promise<any[]> {
  const aiSettings = await api.getAISettings();
  try {
    const response = await fetch('/api/match-engine', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ tender, positionId, experts })
    });

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      throw new Error(errData.error || "Failed to process match engine request");
    }

    const { matches } = await response.json();
    return matches || [];
  } catch (error) {
    console.error("Gemini Match Error:", error);
    throw error;
  }
}

export async function translateExpertData(expert: any, language: string): Promise<any> {
  const aiSettings = await api.getAISettings();
  try {
    const response = await fetch('/api/expert/translate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ expert, language })
    });

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      throw new Error(errData.error || "Failed to translate expert profile");
    }

    const { translated } = await response.json();
    return translated || expert;
  } catch (error) {
    console.error("Translate Profile Error:", error);
    throw error;
  }
}

export async function optimizeExpertData(expert: any, tender: any, positionTitle: string, isAccepted: boolean = false): Promise<any> {
  const aiSettings = await api.getAISettings();
  try {
    const response = await fetch('/api/expert/optimize', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ expert, tender, positionTitle, isAccepted })
    });

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      throw new Error(errData.error || "Failed to optimize expert profile");
    }

    const { expert: optimizedExpert } = await response.json();
    return optimizedExpert || expert;
  } catch (error) {
    console.error("Optimize Profile Error:", error);
    throw error;
  }
}

export async function renderExpertData(expert: any, tender: any, positionTitle: string): Promise<any> {
  try {
    const response = await fetch('/api/expert/render', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ expert, tender, positionTitle })
    });

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      throw new Error(errData.error || "Failed to render expert profile");
    }

    const { expert: rendered } = await response.json();
    return rendered || expert;
  } catch (error) {
    console.error("Render Profile Error:", error);
    throw error;
  }
}

export async function adaptExpertData(expert: any, tender: any, positionTitle: string): Promise<any> {
  try {
    const response = await fetch('/api/expert/adapt', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ expert, tender, positionTitle })
    });

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      throw new Error(errData.error || "Failed to adapt expert profile");
    }

    const { expert: adapted } = await response.json();
    return adapted || expert;
  } catch (error) {
    console.error("Adapt Profile Error:", error);
    throw error;
  }
}
