import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Plus, 
  Search,
  Filter,
  RefreshCw,
  SlidersHorizontal,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Loader2,
  Upload,
  Check,
  FolderOpen,
  EditIcon,
  Trash2,
  X
} from 'lucide-react';
import clsx from 'clsx';
import { api, extractDocumentFromFile } from '../lib/api';
import { auditExtractedCV, parseCVText } from '../lib/gemini';
import { extractContactsFromText, mergeRecoveredContacts } from '../lib/contactExtraction';
import { postProcessExtractedExpert } from '../lib/cvPostProcess';
import { useTasks } from '../lib/TasksContext';
import AddExpertModal from '../components/AddExpertModal';
import { EditExpertRoleModal } from '../components/EditExpertRoleModal';
import ConfirmModal from '../components/ConfirmModal';
import { PRIMARY_POSITIONS, ALL_PRIMARY_POSITIONS } from '../lib/constants';
import { useAuth } from '../lib/auth';

const ALL_COLUMNS = [
  { id: 'select', label: 'SELECT' },
  { id: 'fullName', label: 'FULL NAME' },
  { id: 'primary_position', label: 'PRIMARY POSITION' },
  { id: 'role', label: 'FOLDER NAME' },
  { id: 'location', label: 'LOCATION' },
  { id: 'countries', label: 'COUNTRIES' },
  { id: 'education', label: 'EDUCATION' },
  { id: 'experience', label: 'EXPERIENCE' },
  { id: 'type', label: 'TYPE' },
  { id: 'skills', label: 'SKILLS' },
  { id: 'awards', label: 'AWARDS' },
  { id: 'languages', label: 'LANGUAGES' },
  { id: 'certifications', label: 'CERTIFICATIONS' },
  { id: 'software', label: 'SOFTWARE' },
  { id: 'dateOfBirth', label: 'DATE OF BIRTH' },
  { id: 'citizenship', label: 'CITIZENSHIP' },
  { id: 'professionalMembership', label: 'PROFESSIONAL MEMBERSHIP' },
  { id: 'createdAt', label: 'CREATED' },
  { id: 'actions', label: 'ACTIONS' },
];

export default function Experts() {
  const { isAdmin } = useAuth();
  const [experts, setExperts] = useState<any[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState("All Types");
  const [selectedFolder, setSelectedFolder] = useState<string | null>(null);
  const [isAddExpertOpen, setIsAddExpertOpen] = useState(false);
  const [expertToEdit, setExpertToEdit] = useState<any | null>(null);
  const [visibleColumns, setVisibleColumns] = useState<string[]>(ALL_COLUMNS.map(c => c.id).filter(id => !['dateOfBirth', 'citizenship'].includes(id)));
  const [showColumnMenu, setShowColumnMenu] = useState(false);
  const columnMenuRef = useRef<HTMLDivElement>(null);
  
  const [sortConfig, setSortConfig] = useState<{ key: string, direction: 'asc' | 'desc' } | null>(null);
  const [columnFilters, setColumnFilters] = useState<Record<string, string>>({});
  const [activeColumnMenu, setActiveColumnMenu] = useState<string | null>(null);
  const [editingRoleExpert, setEditingRoleExpert] = useState<any | null>(null);
  const activeColumnMenuRef = useRef<HTMLDivElement>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [pendingUploadFiles, setPendingUploadFiles] = useState<File[] | null>(null);
  const [showTypeModal, setShowTypeModal] = useState(false);
  const [selectedUploadType, setSelectedUploadType] = useState("External");
  const [fileTypes, setFileTypes] = useState<Record<number, string>>({});
  const [taxonomy, setTaxonomy] = useState<string[]>([]);
  const [pendingExtractedExperts, setPendingExtractedExperts] = useState<any[]>([]);
  const [isSavingExtractedExperts, setIsSavingExtractedExperts] = useState(false);
  const [showDiscardExtractionConfirm, setShowDiscardExtractionConfirm] = useState(false);

  const { tasks, addTask, updateTask } = useTasks();

  const isUploading = tasks.some(t => t.type === 'UPLOAD' && t.status === 'running');

  useEffect(() => {
    fetchExperts();
    loadPendingDriveReviews();
  }, [tasks]);

  const loadPendingDriveReviews = async () => {
    const reviews = await api.getPendingDriveReviews();
    if (!reviews.length) return;
    setPendingExtractedExperts(
      reviews.flatMap((review: any) =>
        (review.experts || []).map((expert: any) => ({
          ...expert,
          source: "google_drive",
          sourceFileName: review.fileName,
          sourceGoogleFileId: review.googleFileId,
        })),
      ),
    );
  };

  const handleDeleteExpert = async (id: string) => {
    try {
      await api.deleteExpert(id);
      fetchExperts();
    } catch (err: any) {
      alert("Delete failed: " + err.message);
    }
  };

  useEffect(() => {
    const handleExpertsUpdate = () => {
      fetchExperts();
    };
    window.addEventListener('expertsUpdated', handleExpertsUpdate);
    window.addEventListener('driveReviewsUpdated', loadPendingDriveReviews);
    return () => {
      window.removeEventListener('expertsUpdated', handleExpertsUpdate);
      window.removeEventListener('driveReviewsUpdated', loadPendingDriveReviews);
    };
  }, []);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (columnMenuRef.current && !columnMenuRef.current.contains(event.target as Node)) {
        setShowColumnMenu(false);
      }
      if (activeColumnMenuRef.current && !activeColumnMenuRef.current.contains(event.target as Node)) {
        setActiveColumnMenu(null);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const toggleColumn = (id: string) => {
    setVisibleColumns(prev => 
      prev.includes(id) ? prev.filter(c => c !== id) : [...prev, id]
    );
  };

  const fetchExperts = async () => {
    try {
      const tax = await api.getTaxonomy();
      setTaxonomy(tax || ALL_PRIMARY_POSITIONS);

      const data = await api.getExperts();
      setExperts(data);
    } catch (err) {
      console.error(err);
    }
  };

  const handleUploadClick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const fileArr = Array.from(files);
    const initialTypes: Record<number, string> = {};
    fileArr.forEach((_, i) => initialTypes[i] = "External");
    setFileTypes(initialTypes);
    
    setPendingUploadFiles(fileArr);
    setShowTypeModal(true);
    e.target.value = ''; // Clear the input
  };

  const confirmUpload = async () => {
    if (!pendingUploadFiles) return;
    const fileList = pendingUploadFiles;
    const typesMap = fileTypes;
    setShowTypeModal(false);
    setPendingUploadFiles(null);

    const taskId = addTask({
      type: 'UPLOAD',
      title: `Ingesting ${fileList.length} Expert CVs`,
      message: 'Extracting text from documents...'
    });

    let currentEta = fileList.length * 15;
    let currentPercent = 5;
    
    const interval = setInterval(() => {
      currentPercent = Math.min(currentPercent + Math.random() * 8, 95);
      currentEta = Math.max(currentEta - 3, 2);
      updateTask(taskId, {
        percent: currentPercent,
        eta: currentEta
      });
    }, 1500);

    try {
      let allParsedExperts: any[] = [];

      for (let i = 0; i < fileList.length; i++) {
        const typeLabel = typesMap[i] || selectedUploadType;
        updateTask(taskId, { message: `Extracting text from ${fileList[i].name}...` });
        const extractedDocument = await extractDocumentFromFile(fileList[i]);
        const text = extractedDocument.text;
        const recoveredContacts = extractContactsFromText(text);
        
        let formData = new FormData();
        formData.append('file', fileList[i]);
        let uploadedFileUrl = "";
        try {
           const ures = await fetch('/api/upload', { method: 'POST', body: formData });
           if (ures.ok) {
              const udata = await ures.json();
              uploadedFileUrl = `/uploads/${udata.filename}`;
           }
        } catch (e) {
           console.error("Failed to upload document", e);
        }

        updateTask(taskId, { message: `Cognitive Engine is parsing ${fileList[i].name}...` });
        const contactHint = [
          "DETERMINISTIC CONTACT RECOVERY FROM RAW CV TEXT:",
          `Emails found: ${recoveredContacts.emails.length ? recoveredContacts.emails.join(", ") : "None"}`,
          `Phones found: ${recoveredContacts.phones.length ? recoveredContacts.phones.join(", ") : "None"}`,
          "If these contacts belong to the expert, preserve them exactly in the expert email and phone fields.",
        ].join("\n");
        let parsedChunk = await parseCVText(`--- DOC: ${fileList[i].name} ---\n${contactHint}\n\n${text}`);
        
        // Enhance with raw text and override type
        parsedChunk = parsedChunk.map((exp: any) =>
          postProcessExtractedExpert(
            mergeRecoveredContacts(
              {
                ...exp,
                type: typeLabel,
                original_cv_text: text, // 100% extracted text attached here
                original_cv_url: uploadedFileUrl,
                original_cv_filename: fileList[i].name,
                extraction_audit: {
                  sourceFile: {
                    filename: fileList[i].name,
                    url: uploadedFileUrl,
                    uploadedAt: new Date().toISOString(),
                    type: typeLabel,
                  },
                  rawText: text,
                  rawPageText: extractedDocument.rawText,
                  extractionMetadata: extractedDocument.metadata,
                  aiExtractedJson: exp,
                  aiCleanedJson: exp,
                  deterministicRecovery: recoveredContacts,
                },
              },
              recoveredContacts,
            ),
            text,
          ),
        );

        updateTask(taskId, { message: `AI auditor is checking ${fileList[i].name} against the raw CV...` });
        parsedChunk = await Promise.all(
          parsedChunk.map(async (expert: any) => {
            const audited = await auditExtractedCV(text, expert);
            return postProcessExtractedExpert(
              mergeRecoveredContacts(
                {
                  ...expert,
                  ...audited,
                  extraction_audit: {
                    ...(expert.extraction_audit || {}),
                    aiCleanedJson: audited,
                    auditNotes: audited.metadata?.extraction_audit_notes || [],
                  },
                },
                recoveredContacts,
              ),
              text,
            );
          }),
        );
        
        allParsedExperts.push(...parsedChunk);
      }

      clearInterval(interval);
      setPendingExtractedExperts(allParsedExperts);
      updateTask(taskId, { 
        status: 'completed', 
        percent: 100, 
        eta: 0,
        message: `Extraction complete. Review ${allParsedExperts.length} expert profile${allParsedExperts.length === 1 ? '' : 's'} before saving.` 
      });
      
    } catch (err: any) {
      clearInterval(interval);
      console.error(err);
      updateTask(taskId, { 
        status: 'error', 
        message: err.message 
      });
    }
  };

  const getExtractionIssues = (expert: any) => {
    const issues: string[] = [];
    const employment = expert.experiences || expert.employment_history || [];
    const adequacy = expert.adequacy_experience || expert.metadata?.adequacy || [];
    const education = expert.education || expert.metadata?.educations || [];
    const weakValues = /^(n\/?a|na|none|null|unknown|not stated|not available|various|client|employer|-|--)?$/i;
    const monthMap: Record<string, number> = {
      jan: 0, january: 0,
      feb: 1, february: 1,
      mar: 2, march: 2,
      apr: 3, april: 3,
      may: 4,
      jun: 5, june: 5,
      jul: 6, july: 6,
      aug: 7, august: 7,
      sep: 8, sept: 8, september: 8,
      oct: 9, october: 9,
      nov: 10, november: 10,
      dec: 11, december: 11,
    };

    const clean = (value: any) => String(value || "").replace(/\s+/g, " ").trim();
    const sourceText = [
      expert.original_cv_text,
      expert.rawText,
      expert.extraction_audit?.rawText,
      expert.extraction_audit?.raw_text,
      expert.extraction_audit?.rawPageText,
      expert.extraction_audit?.raw_page_text,
    ].map(clean).find(Boolean) || "";
    const isWeak = (value: any) => weakValues.test(clean(value));
    const wordCount = (value: any) => clean(value).split(/\s+/).filter(Boolean).length;
    const educationText = (item: any) =>
      clean(typeof item === "string" ? item : [item.degree, item.field, item.institution, item.location, item.year].filter(Boolean).join(" "));
    const isStrongEducation = (item: any) => {
      const text = educationText(item);
      const hasDegree = /\b(ph\.?d|doctor|master|m\.?sc|m\.?eng|meng|bachelor|b\.?sc|beng|degree|diploma|dae)\b/i.test(text);
      const hasField = /\b(civil|structural|engineering|quantity surveying|architecture|construction|geotechnical)\b/i.test(text);
      const hasInstitutionOrDate = /\b(university|college|institute|uet|saitama|pakistan|japan|oman|india|usa|uk)\b/i.test(text) || /\b(19|20)\d{2}\b/.test(text) || /\b\d{1,2}\/\d{4}\b/.test(text);
      return hasDegree && (hasField || hasInstitutionOrDate);
    };
    const pointCount = (value: any) => {
      const text = clean(value);
      if (!text) return 0;
      const bulletParts = text
        .split(/\n+|(?:^|\s)[\-•]\s+/)
        .map((part) => part.trim())
        .filter((part) => wordCount(part) >= 4);
      if (bulletParts.length > 1) return bulletParts.length;
      return text.split(/[.;]\s+/).map((part) => part.trim()).filter((part) => wordCount(part) >= 5).length;
    };
    const normalizedIncludes = (haystack: string, needle: string) => {
      const n = clean(needle).toLowerCase();
      return n.length >= 4 && haystack.toLowerCase().includes(n);
    };
    const getRelevantSourceWindow = (item: any) => {
      const text = clean(sourceText);
      if (!text) return "";
      const period = clean(item.duration || item.period || `${item.start_date || ""} ${item.end_date || ""}`);
      const anchors = [
        item.organization,
        item.client,
        item.role,
        period,
        ...(period.match(/\b(19|20)\d{2}\b/g) || []),
      ].map(clean).filter((anchor) => anchor.length >= 4);

      let bestIndex = -1;
      let bestScore = 0;
      anchors.forEach((anchor) => {
        const index = text.toLowerCase().indexOf(anchor.toLowerCase());
        if (index < 0) return;
        const window = text.slice(Math.max(0, index - 180), index + 900);
        const score = anchors.filter((candidate) => normalizedIncludes(window, candidate)).length;
        if (score > bestScore) {
          bestScore = score;
          bestIndex = index;
        }
      });

      if (bestIndex < 0 || bestScore < 2) return "";
      return text.slice(Math.max(0, bestIndex - 220), bestIndex + 1100);
    };
    const sourceAppearsRicherThanExtraction = (item: any, extractedDetails: string) => {
      if (!sourceText) return true;
      const sourceWindow = getRelevantSourceWindow(item);
      if (!sourceWindow) return false;
      const extractedWords = wordCount(extractedDetails);
      const sourceWords = wordCount(sourceWindow);
      const extractedPoints = pointCount(extractedDetails);
      const sourcePoints = pointCount(sourceWindow);
      const sourceHasDutyLanguage = /responsib|duties|prepared|preparation|designed|reviewed|supervised|supervision|managed|coordinated|checked|checking|analysis|inspection|progress|quality|safety|construction|claims|variation/i.test(sourceWindow);

      return (
        sourceHasDutyLanguage &&
        sourceWords >= Math.max(45, extractedWords + 25) &&
        sourcePoints > Math.max(1, extractedPoints)
      );
    };
    const hasYear = (value: any) => /\b(19|20)\d{2}\b/.test(clean(value));
    const parseDateToken = (value: string, fallbackMonth: number) => {
      const token = clean(value).toLowerCase();
      if (!token) return null;
      if (/present|current|till date|to date|ongoing/.test(token)) return new Date();
      const yearMatch = token.match(/\b(19|20)\d{2}\b/);
      if (!yearMatch) return null;
      const monthMatch = token.match(/\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b/i);
      const month = monthMatch ? monthMap[monthMatch[0].toLowerCase()] : fallbackMonth;
      return new Date(Number(yearMatch[0]), month, 1);
    };
    const parsePeriod = (item: any) => {
      const startText = clean(item.start_date);
      const endText = clean(item.end_date);
      const periodText = clean(item.duration || item.period);
      if (startText || endText) {
        return {
          start: parseDateToken(startText, 0),
          end: parseDateToken(endText, 11),
          raw: clean(`${startText} ${endText}`) || periodText,
        };
      }
      const parts = periodText.split(/\s+(?:-|–|—|to|until|till)\s+/i);
      return {
        start: parseDateToken(parts[0] || "", 0),
        end: parseDateToken(parts.slice(1).join(" ") || "", 11),
        raw: periodText,
      };
    };
    const monthsBetween = (olderEnd: Date, newerStart: Date) =>
      (newerStart.getFullYear() - olderEnd.getFullYear()) * 12 +
      (newerStart.getMonth() - olderEnd.getMonth());

    if (!(expert.fullName || expert.name)) issues.push("Missing expert name");
    if (!expert.email) issues.push("Missing email");
    if (!expert.phone) issues.push("Missing phone");
    if (!(expert.primary_position || expert.role)) issues.push("Missing current/proposed role");
    if (!(expert.dateOfBirth || expert.birth_date)) issues.push("Missing date of birth");
    if (!(expert.countryOfCitizenship || expert.nationality)) issues.push("Missing citizenship");
    if (!education.length) issues.push("Missing education");
    if (education.length && !education.some(isStrongEducation)) {
      issues.push("Education details look thin or incomplete");
    }
    if (!employment.length) issues.push("Missing employment records");
    if (!adequacy.length) issues.push("Missing adequacy/key experience");

    employment.forEach((item: any, index: number) => {
      const period = clean(item.duration || item.period || `${item.start_date || ""} ${item.end_date || ""}`);
      const employer = clean(item.organization || item.client);
      const description = clean(item.description);
      if (!period) issues.push(`Employment #${index + 1} missing period`);
      if (period && !hasYear(period)) issues.push(`Employment #${index + 1} period has no clear year`);
      if (!employer) issues.push(`Employment #${index + 1} missing employer`);
      if (employer && isWeak(employer)) issues.push(`Employment #${index + 1} has unclear employer/client`);
      if (!item.role || isWeak(item.role)) issues.push(`Employment #${index + 1} missing role/title`);
      if (!item.country || isWeak(item.country)) issues.push(`Employment #${index + 1} missing country`);
      const sourceHasMoreEmploymentDetail = sourceAppearsRicherThanExtraction(item, description);
      if ((!description || description.length < 80) && sourceHasMoreEmploymentDetail) {
        issues.push(`Employment #${index + 1} may have missed activity details from the source CV`);
      }
      if (description && pointCount(description) < 2 && wordCount(description) < 35 && sourceHasMoreEmploymentDetail) {
        issues.push(`Employment #${index + 1} may have missed additional duty points from the source CV`);
      }
    });

    const datedEmployment = employment
      .map((item: any, index: number) => ({ index, ...parsePeriod(item) }))
      .filter((item: any) => item.start && item.end)
      .sort((a: any, b: any) => b.end.getTime() - a.end.getTime());

    datedEmployment.forEach((current: any, index: number) => {
      const older = datedEmployment[index + 1];
      if (!older) return;
      const gapMonths = monthsBetween(older.end, current.start);
      if (gapMonths > 24) {
        issues.push(`Timeline note: employment gap of about ${gapMonths} months between Employment #${older.index + 1} and #${current.index + 1}`);
      }
      if (gapMonths < -3) {
        issues.push(`Timeline note: possible overlapping employment dates between Employment #${older.index + 1} and #${current.index + 1}`);
      }
    });

    adequacy.forEach((item: any, index: number) => {
      const assignment = clean(item.assignment);
      if (!item.period) issues.push(`Adequacy #${index + 1} missing period`);
      if (item.period && !hasYear(item.period)) issues.push(`Adequacy #${index + 1} period has no clear year`);
      if (!item.country || isWeak(item.country)) issues.push(`Adequacy #${index + 1} missing country`);
      if (!item.client || isWeak(item.client)) issues.push(`Adequacy #${index + 1} has unclear client`);
      if (!item.position || isWeak(item.position)) issues.push(`Adequacy #${index + 1} missing position`);
      if (!assignment || assignment.length < 80) issues.push(`Adequacy #${index + 1} has thin assignment details`);
      if (assignment && pointCount(assignment) < 2) issues.push(`Adequacy #${index + 1} appears to have only one assignment/duty point`);
      if (assignment && !/responsib|duties|included|prepared|preparation|designed|reviewed|supervised|supervision|managed|coordinated|checked|checking|analysis|inspection|progress report|bar bending|quality|safety|earthwork|construction/i.test(assignment)) {
        issues.push(`Adequacy #${index + 1} may list projects without explaining what the expert did`);
      }
    });

    return issues;
  };

  const getExtractionConfidence = (issues: string[]) => {
    if (issues.length === 0) return 100;
    const majorCount = issues.filter((issue) => /missing employment|missing education|missing expert name|missing adequacy|missing period|missing employer/i.test(issue)).length;
    const noteCount = issues.filter((issue) => /^Timeline note:/i.test(issue)).length;
    const minorCount = issues.length - majorCount - noteCount;
    return Math.max(35, 100 - majorCount * 10 - minorCount * 5 - noteCount * 0);
  };

  const renderIssuePanel = (title: string, panelIssues: string[], confidence?: number) => {
    if (panelIssues.length === 0) return null;
    return (
      <div className="mt-3 p-3 bg-amber-50 border border-amber-100 rounded text-xs text-amber-800">
        <div className="flex items-center justify-between gap-3 mb-2">
          <div className="font-semibold text-amber-900">{title}</div>
          <div className="font-semibold text-amber-700">
            {confidence !== undefined ? `${confidence}% confidence · ` : ""}{panelIssues.length} flags
          </div>
        </div>
        <div className="grid grid-cols-1 gap-1.5">
          {panelIssues.map((issue) => (
            <div key={issue} className="rounded border border-amber-200 bg-white/70 px-2 py-1 leading-snug">
              {issue}
            </div>
          ))}
        </div>
      </div>
    );
  };

  const saveReviewedExperts = async () => {
    if (pendingExtractedExperts.length === 0) return;
    setIsSavingExtractedExperts(true);
    try {
      const approvedAt = new Date().toISOString();
      const approvedExperts = pendingExtractedExperts.map((expert) => ({
        ...expert,
        extraction_audit: {
          ...(expert.extraction_audit || {}),
          approvedJson: {
            ...expert,
            extraction_audit: undefined,
          },
          approval: {
            approvedAt,
            approvedBy: "local-user",
          },
        },
      }));
      const saveResult = await api.saveExperts(approvedExperts);
      const googleFileIds: string[] = Array.from(
        new Set(
          pendingExtractedExperts
            .map((expert) => expert.sourceGoogleFileId)
            .filter(Boolean)
            .map(String),
        ),
      );
      for (const googleFileId of googleFileIds) {
        await api.updateDriveFile(googleFileId, {
          status: "processed",
          reviewedAt: approvedAt,
          errorMessage: "",
        });
      }
      await api.clearPendingDriveReviews(googleFileIds);
      setPendingExtractedExperts([]);
      fetchExperts();
      alert(`Saved extraction. Added ${saveResult.added} and updated ${saveResult.updated} expert profiles.`);
    } catch (err: any) {
      alert("Save failed: " + err.message);
    } finally {
      setIsSavingExtractedExperts(false);
    }
  };

  const requestDiscardExtractedExperts = () => {
    setShowDiscardExtractionConfirm(true);
  };

  const confirmDiscardExtractedExperts = async () => {
    const googleFileIds: string[] = Array.from(
      new Set(
        pendingExtractedExperts
          .map((expert) => expert.sourceGoogleFileId)
          .filter(Boolean)
          .map(String),
      ),
    );
    if (googleFileIds.length) {
      await api.clearPendingDriveReviews(googleFileIds);
    }
    setPendingExtractedExperts([]);
    setShowDiscardExtractionConfirm(false);
  };

  const updatePendingExpert = (expertIndex: number, updates: Record<string, any>) => {
    setPendingExtractedExperts((prev) =>
      prev.map((expert, index) =>
        index === expertIndex ? { ...expert, ...updates } : expert,
      ),
    );
  };

  const updatePendingExpertListItem = (
    expertIndex: number,
    listKey: "experiences" | "adequacy_experience",
    itemIndex: number,
    updates: Record<string, any>,
  ) => {
    setPendingExtractedExperts((prev) =>
      prev.map((expert, index) => {
        if (index !== expertIndex) return expert;
        const currentList = [...(expert[listKey] || [])];
        currentList[itemIndex] = { ...currentList[itemIndex], ...updates };
        const nextExpert = { ...expert, [listKey]: currentList };
        if (listKey === "experiences") nextExpert.employment_history = currentList;
        if (listKey === "adequacy_experience") {
          nextExpert.metadata = { ...(nextExpert.metadata || {}), adequacy: currentList };
        }
        return nextExpert;
      }),
    );
  };

  const addPendingExpertListItem = (
    expertIndex: number,
    listKey: "experiences" | "adequacy_experience",
  ) => {
    const emptyItem =
      listKey === "experiences"
        ? {
            duration: "",
            start_date: "",
            end_date: "",
            organization: "",
            role: "",
            country: "",
            description: "",
          }
        : {
            period: "",
            country: "",
            client: "",
            position: "",
            assignment: "",
          };

    setPendingExtractedExperts((prev) =>
      prev.map((expert, index) => {
        if (index !== expertIndex) return expert;
        const currentList = [...(expert[listKey] || []), emptyItem];
        const nextExpert = { ...expert, [listKey]: currentList };
        if (listKey === "experiences") nextExpert.employment_history = currentList;
        if (listKey === "adequacy_experience") {
          nextExpert.metadata = { ...(nextExpert.metadata || {}), adequacy: currentList };
        }
        return nextExpert;
      }),
    );
  };

  const removePendingExpertListItem = (
    expertIndex: number,
    listKey: "experiences" | "adequacy_experience",
    itemIndex: number,
  ) => {
    setPendingExtractedExperts((prev) =>
      prev.map((expert, index) => {
        if (index !== expertIndex) return expert;
        const currentList = (expert[listKey] || []).filter((_: any, i: number) => i !== itemIndex);
        const nextExpert = { ...expert, [listKey]: currentList };
        if (listKey === "experiences") nextExpert.employment_history = currentList;
        if (listKey === "adequacy_experience") {
          nextExpert.metadata = { ...(nextExpert.metadata || {}), adequacy: currentList };
        }
        return nextExpert;
      }),
    );
  };

  const handleUpdateRole = async (expertId: string, role: string) => {
    await api.updateExpertRole(expertId, role);
    setEditingRoleExpert(null);
    fetchExperts();
  };

  const filteredExperts = experts.filter(e => {
    const name = e.name || "";
    const skills = e.skills || [];
    const expertType = e.type || "External";
    
    const matchesSearch = name.toLowerCase().includes(searchQuery.toLowerCase()) || 
                          skills.some((s:string) => s.toLowerCase().includes(searchQuery.toLowerCase()));
    
    const matchesType = typeFilter === "All Types" || expertType.toLowerCase() === typeFilter.toLowerCase();
    const roleMatch = e.role || "";
    
    let matchesFolder = true;
    if (selectedFolder === 'Others') {
       matchesFolder = !taxonomy.map(t=>t.toLowerCase()).includes(roleMatch.toLowerCase());
    } else if (selectedFolder) {
       matchesFolder = roleMatch.toLowerCase() === selectedFolder.toLowerCase();
    }
    
    const matchesColumnFilters = Object.entries(columnFilters).every(([key, value]) => {
      if (!value) return true;
      const lowerValue = (value as string).toLowerCase();
      if (key === 'fullName') return (e.fullName || e.name || "").toLowerCase().includes(lowerValue);
      if (key === 'primary_position') return (e.primary_position || "").toLowerCase().includes(lowerValue);
      if (key === 'role') return (e.role || "").toLowerCase().includes(lowerValue);
      if (key === 'location') return (e.location || "").toLowerCase().includes(lowerValue);
      if (key === 'countries') return (e.countries?.join(', ') || "").toLowerCase().includes(lowerValue);
      if (key === 'education') return (e.educationLevel || e.metadata?.educations?.[0]?.degree || e.education?.[0] || "").toLowerCase().includes(lowerValue);
      if (key === 'experience') return (e.experienceYears?.toString() || e.employment_history?.length?.toString() || e.experiences?.length?.toString() || "").toLowerCase().includes(lowerValue);
      if (key === 'type') return (e.type || "External").toLowerCase().includes(lowerValue);
      if (key === 'skills') return (e.skills?.join(', ') || "").toLowerCase().includes(lowerValue);
      if (key === 'awards') return (e.metadata?.awards?.map((a:any) => a.title).join(', ') || "").toLowerCase().includes(lowerValue);
      if (key === 'languages') return (e.metadata?.languages?.map((l:any) => l.name).join(', ') || e.languages?.map((l:any) => l.language || l).join(', ') || "").toLowerCase().includes(lowerValue);
      if (key === 'certifications') return (e.metadata?.certifications?.map((c:any) => c.title).join(', ') || "").toLowerCase().includes(lowerValue);
      if (key === 'software') return (e.software?.join(', ') || "").toLowerCase().includes(lowerValue);
      if (key === 'dateOfBirth') return (e.dateOfBirth || "").toLowerCase().includes(lowerValue);
      if (key === 'citizenship') return (e.countryOfCitizenship || e.nationality || "").toLowerCase().includes(lowerValue);
      if (key === 'professionalMembership') return (e.professionalMembership?.join(', ') || "").toLowerCase().includes(lowerValue);
      if (key === 'createdAt') return ((e.createdAt || e.created_at) ? new Date(e.createdAt || e.created_at).toLocaleDateString() : "").toLowerCase().includes(lowerValue);

      return true;
    });

    return matchesSearch && matchesType && matchesFolder && matchesColumnFilters;
  }).sort((a, b) => {
    if (!sortConfig) return 0;
    const { key, direction } = sortConfig;
    const mod = direction === 'asc' ? 1 : -1;
    
    const getValue = (e: any, k: string) => {
      if (k === 'fullName') return (e.fullName || e.name || "").toLowerCase();
      if (k === 'primary_position') return (e.primary_position || "").toLowerCase();
      if (k === 'role') return (e.role || "").toLowerCase();
      if (k === 'location') return (e.location || "").toLowerCase();
      if (k === 'countries') return (e.countries?.join(', ') || "").toLowerCase();
      if (k === 'education') return (e.educationLevel || e.metadata?.educations?.[0]?.degree || e.education?.[0] || "").toLowerCase();
      if (k === 'experience') return parseInt(e.experienceYears || e.employment_history?.length || e.experiences?.length || 0);
      if (k === 'type') return (e.type || "External").toLowerCase();
      if (k === 'skills') return (e.skills?.join(', ') || "").toLowerCase();
      if (k === 'awards') return (e.metadata?.awards?.map((x:any) => x.title).join(', ') || "").toLowerCase();
      if (k === 'languages') return (e.metadata?.languages?.map((l:any) => l.name).join(', ') || e.languages?.map((l:any) => l.language || l).join(', ') || "").toLowerCase();
      if (k === 'certifications') return (e.metadata?.certifications?.map((c:any) => c.title).join(', ') || "").toLowerCase();
      if (k === 'software') return (e.software?.join(', ') || "").toLowerCase();
      if (k === 'dateOfBirth') return (e.dateOfBirth || "").toLowerCase();
      if (k === 'citizenship') return (e.countryOfCitizenship || e.nationality || "").toLowerCase();
      if (k === 'professionalMembership') return (e.professionalMembership?.join(', ') || "").toLowerCase();
      if (k === 'createdAt') return new Date(e.createdAt || e.created_at || 0).getTime();
      return "";
    };

    const valA = getValue(a, key);
    const valB = getValue(b, key);

    if (valA < valB) return -1 * mod;
    if (valA > valB) return 1 * mod;
    return 0;
  });

  const renderColumnHeader = (id: string, label: string) => (
    <th key={id} className="px-6 py-4 font-semibold text-[11px] uppercase tracking-wider text-slate-500 whitespace-nowrap relative">
      <div 
        className="flex items-center gap-1 cursor-pointer hover:text-slate-700 select-none"
        onClick={(e) => {
          e.stopPropagation();
          setActiveColumnMenu(activeColumnMenu === id ? null : id);
        }}
      >
        {label} 
        {sortConfig?.key === id ? (
          sortConfig.direction === 'asc' ? <ChevronUp size={12} className="text-blue-600" /> : <ChevronDown size={12} className="text-blue-600" />
        ) : (
          <ChevronDown size={12} className="opacity-50" />
        )}
      </div>

      {activeColumnMenu === id && (
        <div 
          ref={activeColumnMenuRef}
          className="absolute left-6 top-10 mt-1 w-64 bg-white rounded-lg shadow-xl border border-slate-200 z-30 font-normal normal-case tracking-normal"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="p-1">
            <div className="px-3 py-2 text-xs font-semibold text-slate-500">Sort</div>
            <button 
              className="w-full flex items-center gap-2 px-3 py-2 hover:bg-slate-50 text-sm font-medium text-slate-700 rounded-md transition-colors"
              onClick={() => {
                setSortConfig({ key: id, direction: 'asc' });
                setActiveColumnMenu(null);
              }}
            >
              <ChevronUp size={16} className="text-slate-500" /> Sort Ascending
            </button>
            <button 
              className="w-full flex items-center gap-2 px-3 py-2 hover:bg-slate-50 text-sm font-medium text-slate-700 rounded-md transition-colors"
              onClick={() => {
                setSortConfig({ key: id, direction: 'desc' });
                setActiveColumnMenu(null);
              }}
            >
              <ChevronDown size={16} className="text-slate-500" /> Sort Descending
            </button>
          </div>
          <div className="border-t border-slate-100 p-2">
            <div className="px-2 pb-2 text-xs font-semibold text-slate-500">Filter</div>
            <div className="relative">
              <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input 
                type="text" 
                placeholder={`Filter ${label.toLowerCase()}...`}
                value={columnFilters[id] || ""}
                onChange={(e) => setColumnFilters(prev => ({ ...prev, [id]: e.target.value }))}
                className="w-full pl-8 pr-3 py-2 bg-white border border-slate-200 rounded-lg text-sm outline-none focus:border-blue-500 shadow-sm"
              />
            </div>
          </div>
        </div>
      )}
    </th>
  );

  return (
    <div className="space-y-6 max-w-full w-full mx-auto pb-32">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-2">
        <div>
          <h2 className="text-[22px] font-semibold text-slate-900 mb-1">Experts</h2>
          <p className="text-slate-500 text-sm">Manage your talent pool and CV profiles</p>
        </div>
        
        <div className="flex flex-wrap items-center gap-3 w-full sm:w-auto">
          <label className={clsx(
            "flex items-center gap-2 bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 px-4 py-2.5 rounded-lg font-medium text-sm transition-colors shadow-sm cursor-pointer",
            isUploading && "opacity-50 cursor-not-allowed"
          )}>
            {isUploading ? <Loader2 size={16} className="animate-spin text-slate-500" /> : <Upload size={16} />}
            {isUploading ? "Uploading..." : "Upload Expert CVs"}
            <input type="file" multiple className="hidden" onChange={handleUploadClick} disabled={isUploading} />
          </label>
          <button 
            onClick={() => setIsAddExpertOpen(true)}
            className="flex items-center gap-2 bg-[#2563eb] hover:bg-blue-700 text-white px-4 py-2.5 rounded-lg font-medium text-sm transition-colors shadow-sm"
          >
            <Plus size={16} />
            Add Expert
          </button>
        </div>
      </div>

      {/* Filter Bar */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 py-2 w-full">
        <div className="flex flex-col sm:flex-row sm:items-center gap-4 flex-1 min-w-0 w-full">
          <div className="relative flex-1 min-w-0">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 shrink-0" size={16} />
            <input 
              type="text" 
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search experts by name, skill, or long queries..."
              className="w-full bg-white border border-slate-200 rounded-lg py-2.5 pl-10 pr-4 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all shadow-sm min-w-0"
            />
          </div>
          <div className="flex gap-2 items-center shrink-0">
            <Filter size={16} className="text-slate-400 ml-2 hidden sm:block" />
            <div className="relative w-full sm:w-auto">
              <select 
                value={typeFilter}
                onChange={(e) => setTypeFilter(e.target.value)}
                className="w-full sm:w-auto appearance-none bg-white border border-slate-200 rounded-lg py-2.5 pl-3 pr-8 text-sm font-medium text-slate-700 shadow-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 transition-all cursor-pointer"
              >
                <option value="All Types">All Types</option>
                <option value="Internal">Internal</option>
                <option value="External">External</option>
              </select>
              <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" />
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3 shrink-0">
          <button 
            onClick={fetchExperts}
            className="flex-1 sm:flex-none flex justify-center items-center gap-2 px-4 py-2.5 bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 rounded-lg text-sm font-medium transition-colors shadow-sm"
          >
            <RefreshCw size={14} className="shrink-0" />
            Refresh
          </button>
          <div className="relative flex-1 sm:flex-none" ref={columnMenuRef}>
            <button 
              onClick={() => setShowColumnMenu(!showColumnMenu)}
              className="w-full sm:w-auto flex justify-center items-center gap-2 px-4 py-2.5 bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 rounded-lg text-sm font-medium transition-colors shadow-sm"
            >
              <SlidersHorizontal size={14} className="shrink-0" />
              Columns
              <span className="bg-[#bfdbfe] text-blue-800 text-xs font-bold px-1.5 py-0.5 rounded ml-1 shrink-0">{ALL_COLUMNS.length}</span>
            </button>
            {showColumnMenu && (
              <div className="absolute right-0 top-full mt-2 w-48 bg-white rounded-lg shadow-xl border border-slate-200 py-2 z-20">
                <div className="px-3 py-1.5 text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">
                  Toggle Columns
                </div>
                {ALL_COLUMNS.map(col => (
                  <label key={col.id} className="flex items-center gap-3 px-3 py-2 hover:bg-slate-50 cursor-pointer">
                    <div className={clsx("w-4 h-4 rounded border flex items-center justify-center transition-colors", visibleColumns.includes(col.id) ? "bg-blue-600 border-blue-600" : "border-slate-300")}>
                      {visibleColumns.includes(col.id) && <Check size={12} className="text-white" />}
                    </div>
                    <input 
                      type="checkbox" 
                      className="hidden" 
                      checked={visibleColumns.includes(col.id)}
                      onChange={() => toggleColumn(col.id)}
                    />
                    <span className="text-sm font-medium text-slate-700">{col.label}</span>
                  </label>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex gap-6 items-start">
        {/* Folders Sidebar */}
        <div className="w-64 bg-white rounded-xl border border-slate-200 shadow-sm shrink-0 overflow-hidden flex flex-col h-[700px]">
          <div className="font-semibold text-sm text-slate-800 p-4 border-b border-slate-100 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <FolderOpen size={16} className="text-blue-500" />
              Taxonomy Folders
            </div>
          </div>
          <div className="overflow-y-auto flex-1 p-2">
            <div 
              onClick={() => setSelectedFolder(null)}
              className={clsx(
                "px-3 py-2 rounded-lg text-sm mb-1 cursor-pointer transition-colors font-medium",
                !selectedFolder ? "bg-blue-50 text-blue-700" : "text-slate-600 hover:bg-slate-50"
              )}
            >
              All Experts ({experts.length})
            </div>
            <div className="mb-4 mt-2">
              <div className="px-3 text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1">
                Taxonomy Folders
              </div>
              {(() => {
                const foldersWithCounts = taxonomy.map(role => {
                  const count = experts.filter(e => (e.role || "").toLowerCase() === role.toLowerCase()).length;
                  return { role, count };
                });
                
                foldersWithCounts.sort((a, b) => {
                  if (a.count > 0 && b.count === 0) return -1;
                  if (a.count === 0 && b.count > 0) return 1;
                  return 0;
                });

                return foldersWithCounts.map(({ role, count }) => (
                  <div 
                    key={role}
                    onClick={() => setSelectedFolder(role)}
                    className={clsx(
                      "px-3 py-1.5 rounded-lg text-sm cursor-pointer transition-colors flex justify-between items-center group/folder relative",
                      selectedFolder === role 
                        ? "bg-blue-100 text-blue-800 font-medium" 
                        : (count > 0 ? "bg-[#e0f2fe] text-sky-900 font-medium hover:bg-[#bae6fd] mb-0.5" : "text-slate-500 hover:bg-slate-50")
                    )}
                  >
                    <span className="break-words whitespace-normal text-left pr-2 leading-tight">{role}</span>
                    {count > 0 && (
                      <span className={clsx("text-xs px-1.5 rounded-md min-w-[20px] text-center", selectedFolder === role ? "bg-blue-200 text-blue-800" : "bg-sky-200 text-sky-900")}>{count}</span>
                    )}
                  </div>
                ));
              })()}
            </div>

            <div className="mb-4 mt-2">
              <div className="px-3 text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1">
                Other
              </div>
              {(() => {
                const count = experts.filter(e => !taxonomy.map(t=>t.toLowerCase()).includes((e.role || "").toLowerCase())).length;
                return (
                  <div 
                    onClick={() => setSelectedFolder("Others")}
                    className={clsx(
                      "px-3 py-1.5 rounded-lg text-sm cursor-pointer transition-colors flex justify-between items-center mt-1",
                      selectedFolder === "Others" 
                        ? "bg-blue-100 text-blue-800 font-medium" 
                        : (count > 0 ? "bg-[#e0f2fe] text-sky-900 font-medium hover:bg-[#bae6fd]" : "text-slate-500 hover:bg-slate-50")
                    )}
                  >
                    <span className="truncate">Others</span>
                    {count > 0 && <span className={clsx("text-xs px-1.5 rounded-md min-w-[20px] text-center font-medium", selectedFolder === "Others" ? "bg-blue-200 text-blue-800" : "bg-sky-200 text-sky-900")}>{count}</span>}
                  </div>
                )
              })()}
            </div>
          </div>
        </div>

        {/* Table Container */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden flex-1 flex flex-col min-w-0">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse min-w-[1200px]">
            <thead>
              <tr className="border-b border-slate-200 bg-[#fafafa]">
                {visibleColumns.includes('select') && (
                  <th className="px-6 py-4 font-semibold text-[11px] uppercase tracking-wider text-slate-500 whitespace-nowrap w-16">
                    <div className="flex items-center gap-2">
                      <input type="checkbox" className="rounded border-slate-300 text-blue-600 focus:ring-blue-500 w-4 h-4 cursor-pointer" />
                      SELECT
                    </div>
                  </th>
                )}
                {visibleColumns.includes('fullName') && renderColumnHeader('fullName', 'FULL NAME')}
                {visibleColumns.includes('primary_position') && renderColumnHeader('primary_position', 'PRIMARY POSITION')}
                {visibleColumns.includes('role') && renderColumnHeader('role', 'FOLDER NAME')}
                {visibleColumns.includes('location') && renderColumnHeader('location', 'LOCATION')}
                {visibleColumns.includes('countries') && renderColumnHeader('countries', 'COUNTRIES')}
                {visibleColumns.includes('education') && renderColumnHeader('education', 'EDUCATION')}
                {visibleColumns.includes('experience') && renderColumnHeader('experience', 'EXPERIENCE')}
                {visibleColumns.includes('type') && renderColumnHeader('type', 'TYPE')}
                {visibleColumns.includes('skills') && renderColumnHeader('skills', 'SKILLS')}
                {visibleColumns.includes('awards') && renderColumnHeader('awards', 'AWARDS')}
                {visibleColumns.includes('languages') && renderColumnHeader('languages', 'LANGUAGES')}
                {visibleColumns.includes('certifications') && renderColumnHeader('certifications', 'CERTIFICATIONS')}
                {visibleColumns.includes('software') && renderColumnHeader('software', 'SOFTWARE')}
                {visibleColumns.includes('dateOfBirth') && renderColumnHeader('dateOfBirth', 'DATE OF BIRTH')}
                {visibleColumns.includes('citizenship') && renderColumnHeader('citizenship', 'CITIZENSHIP')}
                {visibleColumns.includes('professionalMembership') && renderColumnHeader('professionalMembership', 'MEMBERSHIP')}
                {visibleColumns.includes('createdAt') && renderColumnHeader('createdAt', 'CREATED')}
                {visibleColumns.includes('actions') && (
                  <th className="px-6 py-4 font-semibold text-[11px] uppercase tracking-wider text-slate-500 whitespace-nowrap">ACTIONS</th>
                )}
              </tr>
            </thead>
            <tbody>
              {filteredExperts.length > 0 ? (
                filteredExperts.map((expert) => (
                  <tr 
                    key={expert.id} 
                    className="border-b border-slate-100 hover:bg-slate-50 transition-colors group cursor-pointer"
                    onClick={() => { setExpertToEdit(expert); setIsAddExpertOpen(true); }}
                  >
                    {visibleColumns.includes('select') && (
                      <td className="px-6 py-4" onClick={(e) => e.stopPropagation()}>
                        <input type="checkbox" className="rounded border-slate-300 text-blue-600 focus:ring-blue-500 w-4 h-4 cursor-pointer" />
                      </td>
                    )}
                    {visibleColumns.includes('fullName') && (
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          <div className="min-w-8 w-8 h-8 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center font-medium text-xs">
                            {(expert.fullName || expert.name || "UN").split(' ').map((n:string) => n[0]).join('').substring(0, 2).toUpperCase()}
                          </div>
                          <div className="flex flex-col min-w-0">
                            <span className="font-semibold text-sm text-slate-900 truncate max-w-[300px]">{expert.fullName || expert.name || "Unnamed"}</span>
                          </div>
                        </div>
                      </td>
                    )}
                    {visibleColumns.includes('primary_position') && (
                      <td className="px-6 py-4 text-sm text-slate-600 truncate max-w-[150px]">
                        <span className="truncate">{expert.primary_position || '-'}</span>
                      </td>
                    )}
                    {visibleColumns.includes('role') && (
                      <td className="px-6 py-4 text-sm text-slate-600 truncate max-w-[150px]">
                        <div className="flex items-center justify-between group/role">
                          <span className="truncate">{expert.role || '-'}</span>
                          <button 
                            onClick={(e) => { e.stopPropagation(); setEditingRoleExpert(expert); }}
                            className="text-slate-400 hover:text-blue-600 opacity-0 group-hover/role:opacity-100 transition-opacity p-1"
                            title="Edit Folder Name"
                          >
                            <EditIcon size={14} />
                          </button>
                        </div>
                      </td>
                    )}
                    {visibleColumns.includes('location') && (
                      <td className="px-6 py-4 text-sm text-slate-600">{expert.location || '-'}</td>
                    )}
                    {visibleColumns.includes('countries') && (
                      <td className="px-6 py-4 text-sm text-slate-600 truncate max-w-[250px]">{expert.countries?.join(', ') || '-'}</td>
                    )}
                    {visibleColumns.includes('education') && (
                      <td className="px-6 py-4 text-sm text-slate-600">{expert.educationLevel || expert.metadata?.educations?.[0]?.degree || expert.education?.[0] || '-'}</td>
                    )}
                    {visibleColumns.includes('experience') && (
                      <td className="px-6 py-4 text-sm text-slate-600">{expert.experienceYears ? `${expert.experienceYears} Years` : (expert.employment_history?.length || expert.experiences?.length) ? `${expert.employment_history?.length || expert.experiences?.length} Roles` : '-'}</td>
                    )}
                    {visibleColumns.includes('type') && (
                      <td className="px-6 py-4">
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-slate-100 text-slate-800">
                          { (expert.type || 'External').toLowerCase().includes('external') ? 'External' : (expert.type || 'External') }
                        </span>
                      </td>
                    )}
                    {visibleColumns.includes('skills') && (
                      <td className="px-6 py-4">
                        <div className="flex gap-1 flex-wrap max-w-[300px]">
                          {expert.skills?.slice(0, 2).map((s: string, idx: number) => (
                             <span key={idx} className="truncate max-w-[80px] bg-white border border-slate-200 text-slate-600 text-xs px-1.5 py-0.5 rounded">{s}</span>
                          ))}
                          {expert.skills?.length > 2 && <span className="text-slate-400 text-xs py-0.5">+{expert.skills.length - 2}</span>}
                        </div>
                      </td>
                    )}
                    {visibleColumns.includes('awards') && (
                      <td className="px-6 py-4 text-sm text-slate-600 truncate max-w-[200px]">{expert.metadata?.awards?.length ? expert.metadata.awards[0].title : '-'}</td>
                    )}
                    {visibleColumns.includes('languages') && (
                      <td className="px-6 py-4 text-sm text-slate-600 truncate max-w-[200px]">{expert.metadata?.languages?.map((l:any) => typeof l === 'string' ? l : l.name)?.join(', ') || expert.languages?.map((l:any) => typeof l === 'string' ? l : l.language)?.join(', ') || '-'}</td>
                    )}
                    {visibleColumns.includes('certifications') && (
                      <td className="px-6 py-4 text-sm text-slate-600 truncate max-w-[250px]">{expert.metadata?.certifications?.map((c:any) => c.title)?.join(', ') || '-'}</td>
                    )}
                    {visibleColumns.includes('software') && (
                      <td className="px-6 py-4 text-sm text-slate-600 truncate max-w-[250px]">{expert.software?.join(', ') || '-'}</td>
                    )}
                    {visibleColumns.includes('dateOfBirth') && (
                      <td className="px-6 py-4 text-sm text-slate-600">{expert.dateOfBirth || '-'}</td>
                    )}
                    {visibleColumns.includes('citizenship') && (
                      <td className="px-6 py-4 text-sm text-slate-600">{expert.countryOfCitizenship || expert.nationality || '-'}</td>
                    )}
                    {visibleColumns.includes('professionalMembership') && (
                      <td className="px-6 py-4 text-sm text-slate-600 truncate max-w-[250px]">{expert.professionalMembership?.join(', ') || '-'}</td>
                    )}
                    {visibleColumns.includes('createdAt') && (
                      <td className="px-6 py-4 text-sm text-slate-600">{(expert.created_at || expert.createdAt) ? new Date(expert.created_at || expert.createdAt).toLocaleDateString() : '-'}</td>
                    )}
                    {visibleColumns.includes('actions') && (
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          <span 
                            onClick={(e) => { e.stopPropagation(); setExpertToEdit(expert); setIsAddExpertOpen(true); }}
                            className="text-sm text-blue-600 font-medium cursor-pointer hover:underline"
                          >
                            View
                          </span>
                          {isAdmin && (
                            <button 
                              onClick={(e) => { e.preventDefault(); e.stopPropagation(); setConfirmDeleteId(expert.id); }}
                              className="text-slate-400 hover:text-red-600 transition-colors relative z-10"
                              title="Delete Expert"
                            >
                              <Trash2 size={16} />
                            </button>
                          )}
                        </div>
                      </td>
                    )}
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={visibleColumns.length} className="px-6 py-24 text-center text-[15px] text-slate-500 bg-white">
                    No experts found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Horizontal Scrollbar Track Visual (Decorative context from design) */}
        {!filteredExperts.length && (
          <div className="px-4 py-2 border-t border-slate-200/50 flex items-center gap-2">
            <ChevronLeft size={14} className="text-slate-400" />
            <div className="flex-1 h-2.5 bg-slate-200 rounded-full w-full relative">
               <div className="absolute left-0 top-0 bottom-0 bg-slate-400 rounded-full w-1/2"></div>
            </div>
            <ChevronRight size={14} className="text-slate-400" />
          </div>
        )}

          {/* Footer Pagination */}
          <div className="px-6 py-4 border-t border-slate-200 bg-white flex justify-between items-center">
            <div className="text-sm text-slate-600">
              Showing <span className="font-semibold">{filteredExperts.length > 0 ? 1 : 0}</span> to <span className="font-semibold">{filteredExperts.length}</span> of <span className="font-semibold">{filteredExperts.length}</span> results
            </div>
            <div className="flex items-center gap-3">
              <span className="text-sm text-slate-600 font-medium">Items per page:</span>
              <div className="relative">
                <select className="appearance-none bg-white border border-slate-200 rounded text-sm py-1 pl-2 pr-6 focus:outline-none focus:border-blue-500 shadow-sm">
                  <option>10</option>
                  <option>20</option>
                  <option>50</option>
                </select>
                <ChevronDown size={14} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" />
              </div>
            </div>
          </div>
        </div>
      </div>

      <ConfirmModal
        isOpen={!!confirmDeleteId}
        title="Delete Expert"
        message="Are you sure you want to delete this Expert? This action cannot be undone."
        confirmText="Delete"
        isDestructive={true}
        onConfirm={() => {
          if (confirmDeleteId) handleDeleteExpert(confirmDeleteId);
          setConfirmDeleteId(null);
        }}
        onCancel={() => setConfirmDeleteId(null)}
      />

      <AddExpertModal 
        isOpen={isAddExpertOpen} 
        onClose={() => { setIsAddExpertOpen(false); setExpertToEdit(null); }} 
        onSuccess={fetchExperts} 
        initialData={expertToEdit}
      />

      <AnimatePresence>
        {pendingExtractedExperts.length > 0 && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.96 }}
              className="bg-white rounded-xl shadow-2xl w-full max-w-5xl max-h-[90vh] overflow-hidden flex flex-col"
            >
              <div className="p-6 border-b border-slate-100 shrink-0 flex items-start justify-between gap-4">
                <div>
                  <h3 className="text-lg font-bold text-slate-900">Review Extracted CV Details</h3>
                  <p className="text-sm text-slate-500 mt-1">Confirm the Employment Record and Adequacy / Key Experience before saving to the expert database.</p>
                </div>
                <button onClick={requestDiscardExtractedExperts} className="p-2 hover:bg-slate-100 rounded-lg text-slate-500">
                  <X size={20} />
                </button>
              </div>

              <div className="p-6 overflow-y-auto space-y-4">
                {pendingExtractedExperts.map((expert, idx) => {
                  const employment = expert.experiences || expert.employment_history || [];
                  const adequacy = expert.adequacy_experience || expert.metadata?.adequacy || [];
                  const issues = getExtractionIssues(expert);
                  const confidence = getExtractionConfidence(issues);
                  const employmentIssues = issues.filter((issue) => /^(Employment|Timeline note:.*employment)/i.test(issue));
                  const adequacyIssues = issues.filter((issue) => /^Adequacy/i.test(issue));
                  const coreIssues = issues.filter((issue) => !employmentIssues.includes(issue) && !adequacyIssues.includes(issue));
                  return (
                    <div key={`${expert.name || expert.fullName || 'expert'}-${idx}`} className="border border-slate-200 rounded-lg overflow-hidden">
                      <div className="p-4 bg-slate-50 border-b border-slate-200 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
                        <div>
                          <div className="font-semibold text-slate-900">{expert.fullName || expert.name || "Unnamed Expert"}</div>
                          <div className="text-sm text-slate-600">{expert.primary_position || "-"} · {expert.role || "Uncategorized"} · {expert.original_cv_filename || "Uploaded CV"}</div>
                          {expert.extraction_audit?.extractionMetadata?.likelyAttachmentPages?.length > 0 && (
                            <div className="text-xs text-amber-700 mt-1">
                              Used pages {expert.extraction_audit.extractionMetadata.usedPages.join(", ")} of {expert.extraction_audit.extractionMetadata.totalPages}; ignored likely scanned/attachment pages {expert.extraction_audit.extractionMetadata.likelyAttachmentPages.join(", ")}.
                            </div>
                          )}
                          {expert.extraction_audit?.auditNotes?.length > 0 && (
                            <div className="text-xs text-blue-700 mt-1">
                              AI audit: {expert.extraction_audit.auditNotes.slice(0, 3).join(" · ")}
                            </div>
                          )}
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <span className="text-xs font-semibold px-2 py-1 rounded bg-blue-50 text-blue-700 border border-blue-100">{employment.length} employment records</span>
                          <span className="text-xs font-semibold px-2 py-1 rounded bg-emerald-50 text-emerald-700 border border-emerald-100">{adequacy.length} adequacy blocks</span>
                          <span className={clsx("text-xs font-semibold px-2 py-1 rounded border", confidence >= 85 ? "bg-green-50 text-green-700 border-green-100" : confidence >= 65 ? "bg-amber-50 text-amber-700 border-amber-100" : "bg-red-50 text-red-700 border-red-100")}>
                            {confidence}% confidence
                          </span>
                          <span className={clsx("text-xs font-semibold px-2 py-1 rounded border", issues.length ? "bg-amber-50 text-amber-700 border-amber-100" : "bg-green-50 text-green-700 border-green-100")}>
                            {issues.length ? `${issues.length} review flags` : "Ready"}
                          </span>
                        </div>
                      </div>

                      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 p-4">
                        <div className="space-y-3">
                          <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500">Core Details</h4>
                          <div className="grid grid-cols-1 gap-3">
                            <label className="space-y-1">
                              <span className="text-xs font-semibold text-slate-600">Full Name</span>
                              <input value={expert.fullName || expert.name || ""} onChange={(e) => updatePendingExpert(idx, { fullName: e.target.value, name: e.target.value })} className="w-full border border-slate-300 rounded-md px-3 py-2 text-sm" />
                            </label>
                            <label className="space-y-1">
                              <span className="text-xs font-semibold text-slate-600">Primary Position</span>
                              <input value={expert.primary_position || ""} onChange={(e) => updatePendingExpert(idx, { primary_position: e.target.value })} className="w-full border border-slate-300 rounded-md px-3 py-2 text-sm" />
                            </label>
                            <label className="space-y-1">
                              <span className="text-xs font-semibold text-slate-600">Folder / Taxonomy Role</span>
                              <input value={expert.role || ""} onChange={(e) => updatePendingExpert(idx, { role: e.target.value })} className="w-full border border-slate-300 rounded-md px-3 py-2 text-sm" />
                            </label>
                            <div className="grid grid-cols-2 gap-3">
                              <label className="space-y-1">
                                <span className="text-xs font-semibold text-slate-600">Email</span>
                                <input value={expert.email || ""} onChange={(e) => updatePendingExpert(idx, { email: e.target.value })} className="w-full border border-slate-300 rounded-md px-3 py-2 text-sm" />
                                {expert.contact_recovery?.recoveredEmail && (
                                  <span className="text-[11px] font-medium text-emerald-700">Recovered from raw CV text</span>
                                )}
                              </label>
                              <label className="space-y-1">
                                <span className="text-xs font-semibold text-slate-600">Phone</span>
                                <input value={expert.phone || ""} onChange={(e) => updatePendingExpert(idx, { phone: e.target.value })} className="w-full border border-slate-300 rounded-md px-3 py-2 text-sm" />
                                {expert.contact_recovery?.recoveredPhone && (
                                  <span className="text-[11px] font-medium text-emerald-700">Recovered from raw CV text</span>
                                )}
                              </label>
                            </div>
                            <div className="grid grid-cols-2 gap-3">
                              <label className="space-y-1">
                                <span className="text-xs font-semibold text-slate-600">DOB</span>
                                <input value={expert.dateOfBirth || expert.birth_date || ""} onChange={(e) => updatePendingExpert(idx, { dateOfBirth: e.target.value, birth_date: e.target.value })} className="w-full border border-slate-300 rounded-md px-3 py-2 text-sm" />
                              </label>
                              <label className="space-y-1">
                                <span className="text-xs font-semibold text-slate-600">Citizenship</span>
                                <input value={expert.countryOfCitizenship || expert.nationality || ""} onChange={(e) => updatePendingExpert(idx, { countryOfCitizenship: e.target.value, nationality: e.target.value })} className="w-full border border-slate-300 rounded-md px-3 py-2 text-sm" />
                              </label>
                            </div>
                            <label className="space-y-1">
                              <span className="text-xs font-semibold text-slate-600">Education</span>
                              <textarea value={(expert.education || expert.metadata?.educations || []).map((e: any) => typeof e === 'string' ? e : [e.degree, e.field, e.institution, e.location, e.year].filter(Boolean).join(', ')).join('\n')} onChange={(e) => updatePendingExpert(idx, { education: e.target.value.split('\n').map((line) => line.trim()).filter(Boolean) })} rows={3} className="w-full border border-slate-300 rounded-md px-3 py-2 text-sm resize-y" />
                              {expert.extraction_recovery?.educationRecoveredFromRawText?.length > 0 && (
                                <span className="text-[11px] font-medium text-emerald-700">Education recovered from raw CV text</span>
                              )}
                            </label>
                            <label className="space-y-1">
                              <span className="text-xs font-semibold text-slate-600">Software</span>
                              <textarea value={(expert.software || []).join(', ')} onChange={(e) => updatePendingExpert(idx, { software: e.target.value.split(',').map((item) => item.trim()).filter(Boolean) })} rows={2} className="w-full border border-slate-300 rounded-md px-3 py-2 text-sm resize-y" />
                            </label>
                            <details className="border border-slate-200 rounded-md bg-white">
                              <summary className="cursor-pointer px-3 py-2 text-sm font-semibold text-slate-700">Profile Summary</summary>
                              <div className="p-3 border-t border-slate-100">
                                <textarea value={expert.profileSummary || expert.profile_summary || ""} onChange={(e) => updatePendingExpert(idx, { profileSummary: e.target.value, profile_summary: e.target.value })} rows={8} className="w-full border border-slate-300 rounded-md px-3 py-2 text-sm resize-y" />
                              </div>
                            </details>
                          </div>
                          {renderIssuePanel("Core Details Review", coreIssues, confidence)}
                        </div>

                        <div className="space-y-2">
                          <div className="flex items-center justify-between gap-2">
                            <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500">Employment Record</h4>
                            <button type="button" onClick={() => addPendingExpertListItem(idx, "experiences")} className="text-xs font-semibold text-blue-700 bg-blue-50 border border-blue-100 rounded px-2 py-1 hover:bg-blue-100">Add</button>
                          </div>
                          <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
                            {employment.map((item: any, i: number) => (
                              <details key={i} className="border border-slate-200 rounded bg-white" open={i === 0}>
                                <summary className="cursor-pointer p-3">
                                  <div className="flex items-start justify-between gap-2">
                                    <div>
                                      <div className="text-sm font-semibold text-slate-900">{item.duration || `${item.start_date || ""} - ${item.end_date || ""}` || `Employment #${i + 1}`}</div>
                                      <div className="text-xs text-slate-600">{item.organization || item.client || "-"} - {item.role || "-"} - {item.country || "-"}</div>
                                    </div>
                                    <button type="button" onClick={(e) => { e.preventDefault(); removePendingExpertListItem(idx, "experiences", i); }} className="text-slate-400 hover:text-red-600" title="Delete employment record">
                                      <Trash2 size={14} />
                                    </button>
                                  </div>
                                </summary>
                                <div className="p-3 border-t border-slate-100 space-y-3">
                                  <div className="grid grid-cols-2 gap-2">
                                    <input placeholder="Period" value={item.duration || ""} onChange={(e) => updatePendingExpertListItem(idx, "experiences", i, { duration: e.target.value })} className="border border-slate-300 rounded px-2 py-1.5 text-sm" />
                                    <input placeholder="Country" value={item.country || ""} onChange={(e) => updatePendingExpertListItem(idx, "experiences", i, { country: e.target.value })} className="border border-slate-300 rounded px-2 py-1.5 text-sm" />
                                    <input placeholder="Employer" value={item.organization || ""} onChange={(e) => updatePendingExpertListItem(idx, "experiences", i, { organization: e.target.value })} className="border border-slate-300 rounded px-2 py-1.5 text-sm" />
                                    <input placeholder="Title / Position" value={item.role || ""} onChange={(e) => updatePendingExpertListItem(idx, "experiences", i, { role: e.target.value })} className="border border-slate-300 rounded px-2 py-1.5 text-sm" />
                                  </div>
                                  <textarea placeholder="Summary of activities performed relevant to the assignment" value={item.description || ""} onChange={(e) => updatePendingExpertListItem(idx, "experiences", i, { description: e.target.value })} rows={8} className="w-full border border-slate-300 rounded px-2 py-1.5 text-sm resize-y" />
                                </div>
                              </details>
                            ))}
                            {employment.length === 0 && <p className="text-sm text-slate-500">No employment records extracted.</p>}
                          </div>
                          {renderIssuePanel("Employment Record Review", employmentIssues)}
                        </div>

                        <div className="space-y-2">
                          <div className="flex items-center justify-between gap-2">
                            <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500">Adequacy / Key Experience</h4>
                            <button type="button" onClick={() => addPendingExpertListItem(idx, "adequacy_experience")} className="text-xs font-semibold text-blue-700 bg-blue-50 border border-blue-100 rounded px-2 py-1 hover:bg-blue-100">Add</button>
                          </div>
                          <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
                            {adequacy.map((item: any, i: number) => (
                              <details key={i} className="border border-slate-200 rounded bg-white" open={i === 0}>
                                <summary className="cursor-pointer p-3">
                                  <div className="flex items-start justify-between gap-2">
                                    <div>
                                      <div className="text-sm font-semibold text-slate-900">{item.period || `Adequacy #${i + 1}`}</div>
                                      <div className="text-xs text-slate-600">{item.position || "-"} - {item.country || "-"} - {item.client || "-"}</div>
                                    </div>
                                    <button type="button" onClick={(e) => { e.preventDefault(); removePendingExpertListItem(idx, "adequacy_experience", i); }} className="text-slate-400 hover:text-red-600" title="Delete adequacy record">
                                      <Trash2 size={14} />
                                    </button>
                                  </div>
                                </summary>
                                <div className="p-3 border-t border-slate-100 space-y-3">
                                  <div className="grid grid-cols-2 gap-2">
                                    <input placeholder="Period" value={item.period || ""} onChange={(e) => updatePendingExpertListItem(idx, "adequacy_experience", i, { period: e.target.value })} className="border border-slate-300 rounded px-2 py-1.5 text-sm" />
                                    <input placeholder="Country" value={item.country || ""} onChange={(e) => updatePendingExpertListItem(idx, "adequacy_experience", i, { country: e.target.value })} className="border border-slate-300 rounded px-2 py-1.5 text-sm" />
                                    <input placeholder="Client" value={item.client || ""} onChange={(e) => updatePendingExpertListItem(idx, "adequacy_experience", i, { client: e.target.value })} className="border border-slate-300 rounded px-2 py-1.5 text-sm" />
                                    <input placeholder="Position" value={item.position || ""} onChange={(e) => updatePendingExpertListItem(idx, "adequacy_experience", i, { position: e.target.value })} className="border border-slate-300 rounded px-2 py-1.5 text-sm" />
                                  </div>
                                  <textarea placeholder="Assignment / key experience details" value={item.assignment || ""} onChange={(e) => updatePendingExpertListItem(idx, "adequacy_experience", i, { assignment: e.target.value })} rows={8} className="w-full border border-slate-300 rounded px-2 py-1.5 text-sm resize-y" />
                                </div>
                              </details>
                            ))}
                            {adequacy.length === 0 && <p className="text-sm text-slate-500">No adequacy/key experience extracted.</p>}
                          </div>
                          {renderIssuePanel("Adequacy / Key Experience Review", adequacyIssues)}
                        </div>

                        <div className="hidden">
                          <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500">Employment Record</h4>
                          <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
                            {employment.map((item: any, i: number) => (
                              <div key={i} className="p-3 border border-slate-200 rounded bg-white">
                                <div className="text-sm font-semibold text-slate-900">{item.duration || `${item.start_date || ""} - ${item.end_date || ""}`}</div>
                                <div className="text-xs text-slate-600">{item.organization || item.client || "-"} · {item.role || "-"} · {item.country || "-"}</div>
                                <p className="text-xs text-slate-500 mt-1 line-clamp-3">{item.description || "-"}</p>
                              </div>
                            ))}
                            {employment.length === 0 && <p className="text-sm text-slate-500">No employment records extracted.</p>}
                          </div>
                        </div>

                        <div className="hidden">
                          <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500">Adequacy / Key Experience</h4>
                          <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
                            {adequacy.map((item: any, i: number) => (
                              <div key={i} className="p-3 border border-slate-200 rounded bg-white">
                                <div className="text-sm font-semibold text-slate-900">{item.period || "-"}</div>
                                <div className="text-xs text-slate-600">{item.position || "-"} · {item.country || "-"} · {item.client || "-"}</div>
                                <p className="text-xs text-slate-500 mt-1 line-clamp-3">{item.assignment || "-"}</p>
                              </div>
                            ))}
                            {adequacy.length === 0 && <p className="text-sm text-slate-500">No adequacy/key experience extracted.</p>}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="p-5 bg-slate-50 border-t border-slate-100 flex justify-end gap-3 shrink-0">
                <button
                  onClick={requestDiscardExtractedExperts}
                  disabled={isSavingExtractedExperts}
                  className="px-4 py-2 text-sm font-medium text-slate-600 bg-white border border-slate-200 rounded-lg hover:bg-slate-100 transition-colors disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  onClick={saveReviewedExperts}
                  disabled={isSavingExtractedExperts}
                  className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 flex items-center gap-2"
                >
                  {isSavingExtractedExperts && <Loader2 size={16} className="animate-spin" />}
                  Save Reviewed Experts
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <ConfirmModal
        isOpen={showDiscardExtractionConfirm}
        title="Discard Extracted CV Details?"
        message="If you cancel this review, the extracted CV details will not be saved in the expert database. Any edits you made in this review window will be discarded. Please confirm that you understand and want to continue."
        confirmText="Discard Extraction"
        cancelText="Continue Reviewing"
        isDestructive={true}
        onConfirm={confirmDiscardExtractedExperts}
        onCancel={() => setShowDiscardExtractionConfirm(false)}
      />
      
      <AnimatePresence>
        {editingRoleExpert && (
          <EditExpertRoleModal
            expert={editingRoleExpert}
            taxonomy={taxonomy}
            onSave={handleUpdateRole}
            onClose={() => setEditingRoleExpert(null)}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showTypeModal && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className={clsx("bg-white rounded-xl shadow-xl w-full overflow-hidden flex flex-col", pendingUploadFiles && pendingUploadFiles.length > 1 ? "max-w-xl max-h-[90vh]" : "max-w-sm")}
            >
              <div className="p-6 border-b border-slate-100 shrink-0">
                <h3 className="text-lg font-bold text-slate-900">Expert Type</h3>
                <p className="text-sm text-slate-500 mt-1">Please select the type of expert for the uploaded CV(s).</p>
              </div>
              
              <div className="p-6 overflow-y-auto space-y-4">
                {pendingUploadFiles && pendingUploadFiles.length === 1 ? (
                  <>
                    <label className="flex items-center gap-3 p-3 rounded-lg border border-slate-200 cursor-pointer hover:bg-slate-50 transition-colors">
                      <input 
                        type="radio" 
                        name="expertType" 
                        value="External" 
                        checked={fileTypes[0] === 'External'}
                        onChange={(e) => setFileTypes(prev => ({...prev, 0: e.target.value}))}
                        className="w-4 h-4 text-blue-600 focus:ring-blue-500 border-slate-300"
                      />
                      <div>
                        <div className="text-sm font-medium text-slate-900">External Expert</div>
                        <div className="text-[11px] text-slate-500">Independent consultant / contractor</div>
                      </div>
                    </label>
                    <label className="flex items-center gap-3 p-3 rounded-lg border border-slate-200 cursor-pointer hover:bg-slate-50 transition-colors">
                      <input 
                        type="radio" 
                        name="expertType" 
                        value="Internal" 
                        checked={fileTypes[0] === 'Internal'}
                        onChange={(e) => setFileTypes(prev => ({...prev, 0: e.target.value}))}
                        className="w-4 h-4 text-blue-600 focus:ring-blue-500 border-slate-300"
                      />
                      <div>
                        <div className="text-sm font-medium text-slate-900">Internal Expert</div>
                        <div className="text-[11px] text-slate-500">Permanent staff member</div>
                      </div>
                    </label>
                  </>
                ) : pendingUploadFiles && pendingUploadFiles.length > 1 ? (
                  <div className="space-y-4">
                     <div className="flex items-center justify-between bg-slate-50 p-3 rounded-lg border border-slate-200 sticky top-0 z-10">
                        <span className="text-sm font-medium text-slate-700">Set all to:</span>
                        <div className="flex gap-2">
                           <button onClick={() => {
                             const newTypes: Record<number, string> = {};
                             pendingUploadFiles.forEach((_, i) => newTypes[i] = 'External');
                             setFileTypes(newTypes);
                           }} className="px-3 py-1.5 bg-white border border-slate-200 rounded text-sm hover:bg-slate-50 transition-colors font-medium text-slate-700 shadow-sm">External</button>
                           <button onClick={() => {
                             const newTypes: Record<number, string> = {};
                             pendingUploadFiles.forEach((_, i) => newTypes[i] = 'Internal');
                             setFileTypes(newTypes);
                           }} className="px-3 py-1.5 bg-white border border-slate-200 rounded text-sm hover:bg-slate-50 transition-colors font-medium text-slate-700 shadow-sm">Internal</button>
                        </div>
                     </div>
                     <div className="space-y-2">
                       {pendingUploadFiles.map((f, i) => (
                          <div key={i} className="flex items-center justify-between p-3 rounded-lg border border-slate-200 bg-white">
                            <span className="text-sm font-medium text-slate-700 truncate mr-4" title={f.name}>{f.name}</span>
                            <select 
                              value={fileTypes[i] || 'External'}
                              onChange={e => setFileTypes(prev => ({...prev, [i]: e.target.value}))}
                              className="text-sm border border-slate-300 rounded px-2.5 py-1.5 min-w-[120px] bg-slate-50 hover:bg-white transition-colors focus:ring-2 focus:ring-blue-500 focus:outline-none"
                            >
                               <option value="External">External</option>
                               <option value="Internal">Internal</option>
                            </select>
                          </div>
                       ))}
                     </div>
                  </div>
                ) : null}
              </div>
              
              <div className="p-5 bg-slate-50 border-t border-slate-100 flex justify-end gap-3 shrink-0">
                <button 
                  onClick={() => { setShowTypeModal(false); setPendingUploadFiles(null); }}
                  className="px-4 py-2 text-sm font-medium text-slate-600 bg-white border border-slate-200 rounded-lg hover:bg-slate-100 transition-colors"
                >
                  Cancel
                </button>
                <button 
                  onClick={confirmUpload}
                  className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors"
                >
                  Confirm & Upload
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
