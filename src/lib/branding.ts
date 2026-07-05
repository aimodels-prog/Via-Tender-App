export type DocumentBranding = {
  ministry?: string;
  department?: string;
  tender_no?: string;
  header_base64?: string;
  footer_base64?: string;
  header_name?: string;
  footer_name?: string;
  source?: string;
};

function normalizeBranding(branding?: DocumentBranding | null): DocumentBranding {
  return {
    ...(branding || {}),
    header_base64: branding?.header_base64 || "",
    footer_base64: branding?.footer_base64 || "",
    header_name: branding?.header_name || "",
    footer_name: branding?.footer_name || "",
  };
}

function hasBrandingAsset(branding?: DocumentBranding | null) {
  return Boolean(branding?.header_base64 || branding?.footer_base64);
}

async function fetchGlobalBranding(): Promise<DocumentBranding> {
  if (typeof fetch !== "function") return {};
  try {
    const response = await fetch("/api/settings/globalBranding", {
      credentials: "include",
    });
    if (!response.ok) return {};
    return normalizeBranding(await response.json());
  } catch {
    return {};
  }
}

export async function resolveDocumentBranding(
  branding?: DocumentBranding | null,
): Promise<DocumentBranding> {
  const local = normalizeBranding(branding);

  if (local.source === "none") {
    return { ...local, header_base64: "", footer_base64: "" };
  }

  if (hasBrandingAsset(local) && local.source !== "globalBranding") {
    return local;
  }

  const globalBranding = await fetchGlobalBranding();
  return normalizeBranding({
    ...local,
    header_base64: local.header_base64 || globalBranding.header_base64 || "",
    footer_base64: local.footer_base64 || globalBranding.footer_base64 || "",
    header_name: local.header_name || globalBranding.header_name || "",
    footer_name: local.footer_name || globalBranding.footer_name || "",
    source: local.source || (hasBrandingAsset(globalBranding) ? "globalBranding" : local.source),
  });
}
