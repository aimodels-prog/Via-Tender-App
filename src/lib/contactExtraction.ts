export interface ExtractedContacts {
  emails: string[];
  phones: string[];
}

function unique(values: string[]) {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

export function normalizeContactText(text: string) {
  return String(text || "")
    .replace(/\u00A0/g, " ")
    .replace(/[|]/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\s*\(\s*at\s*\)\s*/gi, "@")
    .replace(/\s*\[\s*at\s*\]\s*/gi, "@")
    .replace(/\s+at\s+/gi, "@")
    .replace(/\s*\(\s*dot\s*\)\s*/gi, ".")
    .replace(/\s*\[\s*dot\s*\]\s*/gi, ".")
    .replace(/\s+dot\s+/gi, ".")
    .replace(/\s*@\s*/g, "@")
    .replace(/\s*\.\s*/g, ".")
    .replace(/\s*-\s*/g, "-")
    .trim();
}

export function extractContactsFromText(text: string): ExtractedContacts {
  const normalized = normalizeContactText(text);
  const emailPattern = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
  const emails = unique(
    (normalized.match(emailPattern) || []).map((email) =>
      email.replace(/[),.;:]+$/g, "").toLowerCase(),
    ),
  );

  const phonePattern =
    /(?:\+?\d{1,4}[\s.-]?)?(?:\(?\d{2,5}\)?[\s.-]?){2,5}\d{3,5}/g;
  const phones = unique(
    (normalized.match(phonePattern) || [])
      .map((phone) => phone.replace(/[^\d+]/g, ""))
      .filter((phone) => {
        const digits = phone.replace(/\D/g, "");
        return digits.length >= 8 && digits.length <= 16;
      })
      .map((phone) =>
        phone.startsWith("+")
          ? phone.replace(/^\++/, "+")
          : phone,
      ),
  );

  return { emails, phones };
}

export function mergeRecoveredContacts(expert: any, contacts: ExtractedContacts) {
  const recoveredEmail = contacts.emails[0] || "";
  const recoveredPhone = contacts.phones[0] || "";
  const email = String(expert.email || "").trim() || recoveredEmail;
  const phone = String(expert.phone || "").trim() || recoveredPhone;

  const contactRecovery = {
    emails: contacts.emails,
    phones: contacts.phones,
    recoveredEmail: !expert.email && Boolean(recoveredEmail),
    recoveredPhone: !expert.phone && Boolean(recoveredPhone),
  };

  return {
    ...expert,
    email,
    phone,
    contact_recovery: contactRecovery,
    metadata: {
      ...(expert.metadata || {}),
      contact_recovery: contactRecovery,
    },
  };
}
