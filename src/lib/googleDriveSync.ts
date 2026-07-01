import { api, extractDocumentFromFile } from "./api";
import { auditExtractedCV, parseCVText } from "./gemini";
import { extractContactsFromText, mergeRecoveredContacts } from "./contactExtraction";
import { postProcessExtractedExpert } from "./cvPostProcess";

const SUPPORTED_MIME_TYPES = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);

function isSupportedDriveFile(file: any) {
  const name = String(file.name || "").toLowerCase();
  return (
    SUPPORTED_MIME_TYPES.has(file.mimeType) ||
    name.endsWith(".pdf") ||
    name.endsWith(".docx")
  );
}

async function getJson(url: string) {
  const response = await fetch(url, { credentials: "include" });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || `Request failed: ${response.status}`);
  }
  return data;
}

async function listDriveFiles() {
  const data = await getJson("/api/google-drive/list");
  return data.files || [];
}

async function downloadDriveFile(file: any) {
  const response = await fetch("/api/google-drive/download", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ fileId: file.id }),
  });

  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || `Download failed: ${response.status}`);
  }

  const blob = await response.blob();
  return new File([blob], file.name, { type: file.mimeType || blob.type });
}

async function processDriveCvFile(driveFile: any) {
  await api.upsertDriveFile({
    googleFileId: driveFile.id,
    name: driveFile.name,
    mimeType: driveFile.mimeType,
    folderType: "cv",
    status: "processing",
    modifiedTime: driveFile.modifiedTime,
    webViewLink: driveFile.webViewLink,
  });

  try {
    const file = await downloadDriveFile(driveFile);
    const extracted = await extractDocumentFromFile(file);
    const recoveredContacts = extractContactsFromText(extracted.rawText || extracted.text);
    const parsedExperts = await parseCVText(extracted.text);
    const cleanedExperts = [];

    for (const parsedExpert of parsedExperts || []) {
      const withContacts = mergeRecoveredContacts(parsedExpert, recoveredContacts);
      const postProcessed = postProcessExtractedExpert(withContacts, extracted.rawText || extracted.text);
      const audited = await auditExtractedCV(extracted.rawText || extracted.text, postProcessed);
      cleanedExperts.push(postProcessExtractedExpert(audited, extracted.rawText || extracted.text));
    }

    if (!cleanedExperts.length) {
      throw new Error("No expert profile could be extracted.");
    }

    const reviewExperts = cleanedExperts.map((expert: any) => ({
        ...expert,
        source: "google_drive",
        sourceFileName: driveFile.name,
        sourceGoogleFileId: driveFile.id,
        extraction_audit: {
          ...(expert.extraction_audit || {}),
          source: "google_drive",
          google_file_id: driveFile.id,
          google_file_name: driveFile.name,
          raw_text: extracted.rawText || extracted.text,
          extracted_json: parsedExperts,
          approved_json: expert,
          extraction_metadata: extracted.metadata,
        },
      }));

    await api.addPendingDriveReview({
      googleFileId: driveFile.id,
      fileName: driveFile.name,
      mimeType: driveFile.mimeType,
      modifiedTime: driveFile.modifiedTime,
      webViewLink: driveFile.webViewLink,
      experts: reviewExperts,
    });

    await api.updateDriveFile(driveFile.id, {
      status: "review_required",
      expertName: cleanedExperts
        .map((expert: any) => expert.fullName || expert.name)
        .filter(Boolean)
        .join(", "),
      confidenceScore: Math.max(
        0,
        ...cleanedExperts.map((expert: any) => Number(expert.extraction_confidence?.score || 0)),
      ),
      errorMessage: "",
      reviewedAt: "",
      processedAt: new Date().toISOString(),
    });

    return { status: "review_required", experts: cleanedExperts.length };
  } catch (error: any) {
    await api.updateDriveFile(driveFile.id, {
      status: "failed",
      errorMessage: error.message || "Drive import failed",
      processedAt: new Date().toISOString(),
    });
    return { status: "failed", error: error.message };
  }
}

export async function scanGoogleDriveNow(addTask?: any, updateTask?: any) {
  const config = await api.getGoogleDriveSettings();
  if (!config?.cvFolderId) {
    throw new Error("Add a Google Drive CV folder ID before scanning.");
  }
  if (!config?.oauthConnected && !config?.apiKeyConfigured && !config?.serviceAccountConfigured) {
    throw new Error("Connect Google Drive before scanning.");
  }

  const taskId = addTask?.({
    type: "UPLOAD",
    title: "Google Drive Scan",
    message: "Checking CV folder for new files...",
  });

  const existingDriveFiles = await api.getDriveFiles();
  const existingIds = new Set(
    existingDriveFiles
      .filter((file: any) => ["processed", "processing", "review_required"].includes(file.status))
      .map((file: any) => file.googleFileId),
  );

  const files = (await listDriveFiles()).filter(isSupportedDriveFile);
  const newFiles = files.filter((file: any) => !existingIds.has(file.id));

  if (!newFiles.length) {
    if (taskId) {
      updateTask?.(taskId, {
        status: "completed",
        percent: 100,
        message: "No new Google Drive CV files found.",
      });
    }
    return { scanned: files.length, imported: 0, failed: 0 };
  }

  let imported = 0;
  let failed = 0;

  for (let index = 0; index < newFiles.length; index++) {
    const file = newFiles[index];
    updateTask?.(taskId, {
      percent: Math.round((index / newFiles.length) * 100),
      message: `Processing ${index + 1} of ${newFiles.length}: ${file.name}`,
    });

    const result = await processDriveCvFile(file);
    if (result.status === "review_required") imported++;
    else failed++;
  }

  updateTask?.(taskId, {
    status: failed ? "completed" : "completed",
    percent: 100,
    message: `Google Drive scan complete. Ready for review ${imported}, failed ${failed}.`,
  });

  window.dispatchEvent(new Event("expertsUpdated"));
  return { scanned: files.length, imported, failed };
}

export async function syncGoogleDriveInBackground(addTask: any, updateTask: any) {
  const config = await api.getGoogleDriveSettings();
  if (!config?.autoScanEnabled) return;
  try {
    await scanGoogleDriveNow(addTask, updateTask);
  } catch (error) {
    console.error("Google Drive background scan error:", error);
  }
}
