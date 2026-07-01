import { api } from './api';

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
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to parse CV");
    }
    const data = await response.json();
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
      const errorData = await response.json();
      throw new Error(errorData.error || "Failed to audit CV extraction");
    }
    const data = await response.json();
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
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to parse Tender");
    }
    const data = await response.json();
    return data.tender || {};
  } catch (error) {
    console.error("Parse Tender Error:", error);
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
