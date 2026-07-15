import { useState, useEffect, Fragment } from "react";
import {
  Target,
  Search,
  ChevronRight,
  ChevronDown,
  CheckCircle,
  AlertCircle,
  TrendingUp,
  FileCheck,
  Target as TargetIcon,
  Loader2,
  FileText as FileIcon,
  Settings2,
  Copy,
  Layers,
  X,
  Image as ImageIcon,
  ArrowLeft,
  Briefcase,
  History,
  ThumbsUp,
  ThumbsDown,
  Trash2,
  Download,
  Eye,
  Languages,
  Wand2,
  BrainCircuit,
  FileText,
  RefreshCw,
  CheckCircle2,
  Printer,
  Zap,
  Globe
} from "lucide-react";
import { Link, useSearchParams } from "react-router-dom";
import clsx from "clsx";
import { motion, AnimatePresence } from "motion/react";
import { api } from "../lib/api";
import { generateReformatedCV } from "../lib/pdf";
import { BrandingModal } from "../components/BrandingModal";
import { useTasks } from "../lib/TasksContext";
import ConfirmModal from "../components/ConfirmModal";
import { RegenerateCVModal } from "../components/RegenerateCVModal";
import { ModeAuditPanel } from "../components/ModeAuditPanel";
import { translateExpertData, adaptExpertData, renderExpertData } from "../lib/gemini";
import { downloadHtmlAsPdf, downloadHtmlAsDocx } from "../lib/exportHtml";
import { generateCVHtml } from "../lib/htmlCV";
import { Document, Page, pdfjs } from 'react-pdf';
import ReactQuill from 'react-quill-new';
import 'react-quill-new/dist/quill.snow.css';
import { buildModeAudit, resolveCvExpert } from "../lib/cvModes";

pdfjs.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

export default function MatchResults() {
  const [searchParams] = useSearchParams();
  const [matches, setMatches] = useState<any[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedTemplate, setSelectedTemplate] = useState<"Specialized" | "General">("General");
  const [selectedTenderId, setSelectedTenderId] = useState<string>(searchParams.get("tenderId") || "all");
  const [tenders, setTenders] = useState<any[]>([]);
  const [brandingTender, setBrandingTender] = useState<any | null>(null);
  const [expandedTenders, setExpandedTenders] = useState<Set<string>>(
    new Set(),
  );
  const [selectedMatchIds, setSelectedMatchIds] = useState<Set<string>>(
    new Set()
  );
  
  // CV Actions states
  const [allExperts, setAllExperts] = useState<any[]>([]);
  const [cvs, setCvs] = useState<any[]>([]);
  const [translatingId, setTranslatingId] = useState<string | null>(null);
  const [adaptingId, setAdaptingId] = useState<string | null>(null);
  const [renderingId, setRenderingId] = useState<string | null>(null);
  const [targetLang, setTargetLang] = useState<Record<string, string>>({});
  const [bulkTargetLang, setBulkTargetLang] = useState<string>("French");
  const [previewCv, setPreviewCv] = useState<any>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [cvToRegenerate, setCvToRegenerate] = useState<any>(null);
  const [numPages, setNumPages] = useState<number | null>(null);
  const [isEditingRichText, setIsEditingRichText] = useState(false);
  const [richTextContent, setRichTextContent] = useState('');
  const [expandedPositions, setExpandedPositions] = useState<Set<string>>(
    new Set(),
  );
  const [expandedMatchId, setExpandedMatchId] = useState<string | null>(null);
  const [positionSearchQueries, setPositionSearchQueries] = useState<Record<string, string>>({});
  const [candidateSearchQueries, setCandidateSearchQueries] = useState<Record<string, string>>({});
  const [feedback, setFeedback] = useState<
    Record<string, { type: "up" | "down"; reason?: string }>
  >({});
  const [feedbackModalMatch, setFeedbackModalMatch] = useState<any | null>(
    null,
  );
  const { tasks, addTask, updateTask } = useTasks();

  const generatingMatchIds = tasks
    .filter((t) => t.type === "GENERATE" && t.status === "running")
    .map((t) => t.message?.match(/ID: ([\w-]+)/)?.[1])
    .filter(Boolean);
  const isBulkGenerating = tasks.some(
    (t) =>
      t.type === "GENERATE" &&
      t.title.startsWith("Bulk Generate") &&
      t.status === "running",
  );
  const activeBulkTask = tasks.find(
    (t) =>
      t.type === "GENERATE" &&
      t.title.startsWith("Bulk Generate") &&
      t.status === "running",
  );

  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  useEffect(() => {
    fetchMatches();
    fetchTenders();
    api.getExperts().then(setAllExperts);
    api.getCVs().then(setCvs);
  }, []);

  const handleDeleteMatch = async (id: string) => {
    await api.deleteMatch(id);
    fetchMatches();
  };

  const toggleMatchSelection = (matchId: string) => {
    const newSelected = new Set(selectedMatchIds);
    if (newSelected.has(matchId)) {
      newSelected.delete(matchId);
    } else {
      newSelected.add(matchId);
    }
    setSelectedMatchIds(newSelected);
  };

  const togglePositionSelection = (positionMatches: any[]) => {
    const allSelected = positionMatches.every((m: any) => selectedMatchIds.has(m.id));
    const newSelected = new Set(selectedMatchIds);
    if (allSelected) {
      positionMatches.forEach((m: any) => newSelected.delete(m.id));
    } else {
      positionMatches.forEach((m: any) => newSelected.add(m.id));
    }
    setSelectedMatchIds(newSelected);
  };

  const toggleTenderSelection = (tenderMatches: any[]) => {
    const allSelected = tenderMatches.every((m: any) => selectedMatchIds.has(m.id));
    const newSelected = new Set(selectedMatchIds);
    if (allSelected) {
      tenderMatches.forEach((m: any) => newSelected.delete(m.id));
    } else {
      tenderMatches.forEach((m: any) => newSelected.add(m.id));
    }
    setSelectedMatchIds(newSelected);
  };

  const toggleTender = (tenderName: string) => {
    const newExpanded = new Set(expandedTenders);
    if (newExpanded.has(tenderName)) {
      newExpanded.delete(tenderName);
    } else {
      newExpanded.add(tenderName);
    }
    setExpandedTenders(newExpanded);
  };

  const togglePosition = (tenderName: string, positionTitle: string) => {
    const key = `${tenderName}-${positionTitle}`;
    const newExpanded = new Set(expandedPositions);
    if (newExpanded.has(key)) {
      newExpanded.delete(key);
    } else {
      newExpanded.add(key);
    }
    setExpandedPositions(newExpanded);
  };

  const fetchTenders = async () => {
    const data = await api.getTenders();
    setTenders(data);
  };

  const fetchMatches = async () => {
    try {
      const data = await api.getMatches("");
      setMatches(data);
    } catch (err) {
      console.error(err);
    }
  };

  const filteredMatches = matches.filter((m) => {
    const matchesSearch =
      m.expertName?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      m.positionId?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      m.tenderName?.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesTender =
      selectedTenderId === "all" || m.tenderId === selectedTenderId;
    return matchesSearch && matchesTender;
  });

  const groupedMatches = filteredMatches.reduce((acc: any, match) => {
    const tenderName = match.tenderName || "Uncategorized Tender";
    const positionTitle =
      match.positionTitle || match.positionId || "Unknown Position";

    if (!acc[tenderName]) acc[tenderName] = {};
    if (!acc[tenderName][positionTitle]) acc[tenderName][positionTitle] = [];

    acc[tenderName][positionTitle].push(match);
    return acc;
  }, {});

  const runBulkActionSequence = async (
    actionName: string,
    actionVerb: string,
    actionFn: (cv: any) => Promise<void>
  ) => {
    if (isBulkGenerating) return;
    const targets = filteredMatches.filter((m) => selectedMatchIds.has(m.id));
    if (targets.length === 0) {
      alert(`No matches selected for bulk ${actionName.toLowerCase()}.`);
      return;
    }
    if (!confirm(`Are you sure you want to bulk ${actionName.toLowerCase()} ${targets.length} CVs?`)) return;

    // Use a custom bulk generation task
    const taskId = addTask({
      type: "GENERATE",
      title: `Bulk ${actionName} (${targets.length} CVs)`,
      message: `Starting bulk ${actionName.toLowerCase()}...`,
    });

    try {
      for (let i = 0; i < targets.length; i++) {
        const match = targets[i];
        updateTask(taskId, {
          percent: Math.round((i / targets.length) * 100),
          eta: (targets.length - i) * 15, // rough estimate
          message: `${actionVerb} ${i + 1}/${targets.length}: ${match.expertName}`,
        });

        // Determine best CV explicitly for bulk
        const cvsForMatch = cvs.filter(
          (c: any) =>
            c.expertId === match.expertId &&
            (c.positionId === match.positionId || c.positionTitle === match.positionTitle)
        );
        let visualCv = cvsForMatch[cvsForMatch.length - 1] || match;
        if (cvsForMatch.length > 0 && cvsForMatch.some((c: any) => c.customRichText)) {
          visualCv = cvsForMatch.find((c: any) => c.customRichText) || visualCv;
        }

        await actionFn(visualCv);
        await new Promise((r) => setTimeout(r, 500));
      }

      updateTask(taskId, {
        status: "completed",
        percent: 100,
        eta: 0,
        message: `Completed ${targets.length} CVs`,
      });
      api.getCVs().then(setCvs); // Refresh just in case
      setSelectedMatchIds(new Set()); // Auto-clear selection after successful bulk action
    } catch (err: any) {
      console.error(err);
      updateTask(taskId, { status: "error", message: err.message });
      alert(`Bulk ${actionName.toLowerCase()} failed: ${err.message}`);
    }
  };

  const handleBulkAdapt = () => runBulkActionSequence("Adapt", "Adapting", handleAdaptCV);
  const handleBulkRender = () => runBulkActionSequence("Render", "Rendering", handleRenderCV);
  const handleBulkWord = () => runBulkActionSequence("Word Export", "Exporting", handleDownloadDocx);
  const handleBulkPdf = () => runBulkActionSequence("PDF Export", "Exporting", handleDownloadPdf);
  
  const handleBulkTranslate = async () => {
    if (isBulkGenerating) return;
    const targets = filteredMatches.filter((m) => selectedMatchIds.has(m.id));
    if (targets.length === 0) return;
    
    // Auto-apply bulkTargetLang to targetLang state for these CVs so handleTranslateCV works seamlessly
    const newTargetLang = { ...targetLang };
    for (const match of targets) {
      // Need ID to inject lang, but we use match.id as fallback for newly minted phantoms in handleTranslateCV
      newTargetLang[match.id] = bulkTargetLang;
    }
    setTargetLang(newTargetLang);
    
    // We defer the execution slightly so the state has time to settle, or we just override the behavior.
    // Actually, state updates are async, so let's just use runBulkActionSequence and we'll patch handleTranslateCV to accept a direct lang param.
    // Wait, let's just add the direct lang parameter to handleTranslateCV!
  };

  const handleBulkGenerate = async () => {
    if (isBulkGenerating) return;
    const targets = filteredMatches.filter((m) => selectedMatchIds.has(m.id));
    if (targets.length === 0) {
      alert(
        "No matches selected for bulk generation. Please check the boxes next to the candidates you want to compile.",
      );
      return;
    }

    if (
      !confirm(
        `Are you sure you want to generate ${targets.length} CVs in template ${selectedTemplate}?`,
      )
    )
      return;

    const taskId = addTask({
      type: "GENERATE",
      title: `Bulk Generate (${targets.length} CVs)`,
      message: `Starting bulk compilation...`,
    });

    try {
      const experts = await api.getExperts();

      for (let i = 0; i < targets.length; i++) {
        const match = targets[i];

        updateTask(taskId, {
          percent: Math.round((i / targets.length) * 100),
          eta: (targets.length - i) * 15,
          message: `Building ${i + 1}/${targets.length}: ${match.expertName}`,
        });

        const expert = experts.find(
          (e) => e.id === match.expertId || e.name === match.expertName,
        );
        const tender = tenders.find((t) => t.id === match.tenderId);

        if (expert && tender) {
          const doc = await generateReformatedCV({
            template: selectedTemplate,
            branding: tender?.branding,
            expert: expert,
            position_title: match.positionTitle || match.positionId,
          });

          await api.saveCV({
            expertId: match.expertId,
            expertName: match.expertName,
            tenderId: match.tenderId,
            tenderName: match.tenderName,
            positionId: match.positionId,
            positionTitle: match.positionTitle || match.positionId,
            language: "English",
            score: match.score,
            match_summary: match.match_summary,
            strong_points: match.strong_points,
            risk_level: match.risk_level,
            template: selectedTemplate,
          });

          doc.save(
            `${selectedTemplate}_CV_${(match.expertName || "Unnamed").split(" ").join("_")}.pdf`,
          );
          // Small delay to prevent browser download freezing/throttling
          await new Promise((r) => setTimeout(r, 500));
        }
      }

      updateTask(taskId, {
        status: "completed",
        percent: 100,
        eta: 0,
        message: `Completed ${targets.length} CVs`,
      });
    } catch (err: any) {
      console.error(err);
      updateTask(taskId, { status: "error", message: err.message });
    }
  };

  const handleGenerateCV = async (match: any) => {
    const taskId = addTask({
      type: "GENERATE",
      title: `Build CV: ${match.expertName}`,
      message: `Building CV. ID: ${match.id}`,
    });

    let currentPercent = 5;
    let currentEta = 15;
    const interval = setInterval(() => {
      currentPercent = Math.min(currentPercent + Math.random() * 8, 95);
      currentEta = Math.max(currentEta - 1, 1);
      updateTask(taskId, { percent: currentPercent, eta: currentEta });
    }, 1000);

    try {
      // 1. Fetch full expert and tender data for branding and rich profile
      const experts = await api.getExperts();
      const expert = experts.find(
        (e) => e.id === match.expertId || e.name === match.expertName,
      );

      const tender = await api.getTender(match.tenderId);

      if (!expert) throw new Error("Expert data not found");

      // 2. Generate PDF using specialized engine
      updateTask(taskId, { message: "Rendering branded PDF...", percent: 80 });
      const doc = await generateReformatedCV({
        template: selectedTemplate,
        branding: tender?.branding,
        expert: expert,
        position_title: match.positionTitle || match.positionId,
      });

      // 3. Save metadata to Generated CVs list
      await api.saveCV({
        expertId: match.expertId,
        expertName: match.expertName,
        tenderId: match.tenderId,
        tenderName: match.tenderName,
        positionId: match.positionId,
        positionTitle: match.positionTitle || match.positionId,
        language: "English",
        score: match.score,
        match_summary: match.match_summary,
        strong_points: match.strong_points,
        risk_level: match.risk_level,
        template: selectedTemplate,
      });

      doc.save(
        `${selectedTemplate}_CV_${(match.expertName || "Unnamed").split(" ").join("_")}.pdf`,
      );

      clearInterval(interval);
      updateTask(taskId, {
        status: "completed",
        percent: 100,
        eta: 0,
        message: "CV Compiled and Downloaded",
      });
    } catch (err: any) {
      clearInterval(interval);
      console.error(err);
      updateTask(taskId, {
        status: "error",
        message: `CV Generation failed: ${err.message}`,
      });
      alert(`CV Generation failed: ${err.message}`);
    }
  };

  const handleAdaptCV = async (cv: any) => {
    setAdaptingId(cv.id);
    try {
      let currentCv = { ...cv };
      if (cv.id && cv.id.startsWith("phantom-")) {
        const res = await api.saveCV({
          expertId: cv.expertId,
          expertName: cv.expertName,
          tenderId: cv.tenderId,
          tenderName: cv.tenderName,
          positionId: cv.positionId,
          positionTitle: cv.positionTitle,
          language: "English",
          template: cv.template || "General",
        });
        if (res.success && res.cv) {
          currentCv = res.cv;
        }
      }

      const experts = await api.getExperts();
      const expert = experts.find(
        (e) => e.id === currentCv.expertId || e.name === currentCv.expertName,
      );
      if (!expert) {
        alert("Expert data missing. Cannot adapt CV.");
        return;
      }

      let t = tenders.find((t) => t.id === currentCv.tenderId);
      if (!t) {
        const allTenders = await api.getTenders();
        t = allTenders.find((tx: any) => tx.id === currentCv.tenderId);
      }

      const adaptedExpert = await adaptExpertData(
        expert,
        t,
        currentCv.positionTitle || currentCv.positionId,
      );

      const doc = await generateReformatedCV({
        template: currentCv.template || "General",
        branding: currentCv.customBranding || t?.branding,
        expert: adaptedExpert,
        position_title: currentCv.positionTitle || currentCv.positionId,
      });
      doc.save(
        `${currentCv.template || "General"} - ${adaptedExpert.fullName || adaptedExpert.name || "Expert"} (Adapted).pdf`,
      );

      const modeAudit = buildModeAudit("ADAPT", expert, adaptedExpert, t, currentCv.positionTitle || currentCv.positionId);
      const updatedCvRes = await api.updateCV({
        ...currentCv,
        mode: "ADAPT",
        expertData: adaptedExpert,
        modeAudit,
        modeHistory: [...(currentCv.modeHistory || []), modeAudit],
        customRichText: undefined,
        isAdapted: true,
        isRendered: false,
      });

      setCvs(prev => {
        const next = [...prev];
        const idx = next.findIndex(c => c.id === currentCv.id);
        if (idx >= 0) next[idx] = updatedCvRes || { ...currentCv, isAdapted: true };
        else next.push(updatedCvRes || { ...currentCv, isAdapted: true });
        return next;
      });
      alert('CV successfully adapted to tender requirements!');
    } catch (e) {
      console.error(e);
      alert('Failed to adapt CV');
    } finally {
      setAdaptingId(null);
    }
  };

  const handleRenderCV = async (cv: any) => {
    setRenderingId(cv.id);
    try {
      let currentCv = { ...cv };
      if (cv.id && cv.id.startsWith("phantom-")) {
        const res = await api.saveCV({
          expertId: cv.expertId,
          expertName: cv.expertName,
          tenderId: cv.tenderId,
          tenderName: cv.tenderName,
          positionId: cv.positionId,
          positionTitle: cv.positionTitle,
          language: "English",
          template: cv.template || "General",
        });
        if (res.success && res.cv) {
          currentCv = res.cv;
        }
      }

      const experts = await api.getExperts();
      const expert = experts.find(
        (e) => e.id === currentCv.expertId || e.name === currentCv.expertName,
      );
      if (!expert) {
        alert("Expert data missing. Cannot render CV.");
        return;
      }

      let t = tenders.find((t) => t.id === currentCv.tenderId);
      if (!t) {
        const allTenders = await api.getTenders();
        t = allTenders.find((tx: any) => tx.id === currentCv.tenderId);
      }

      const renderedExpert = await renderExpertData(
        expert,
        t,
        currentCv.positionTitle || currentCv.positionId,
      );
      const doc = await generateReformatedCV({
        template: currentCv.template || "General",
        branding: currentCv.customBranding || t?.branding,
        expert: renderedExpert,
        position_title: currentCv.positionTitle || currentCv.positionId,
      });
      doc.save(
        `${currentCv.template || "General"} - ${renderedExpert.fullName || renderedExpert.name || "Expert"} (Rendered).pdf`,
      );

      // Update local storage with the AI-rendered version
      const modeAudit = buildModeAudit("RENDER", expert, renderedExpert, t, currentCv.positionTitle || currentCv.positionId);
      const updatedCvRes = await api.updateCV({
        ...currentCv,
        mode: "RENDER",
        expertData: renderedExpert,
        modeAudit,
        modeHistory: [...(currentCv.modeHistory || []), modeAudit],
        customRichText: undefined,
        isAdapted: true,
        isRendered: true,
      });

      setCvs(prev => {
        const next = [...prev];
        const idx = next.findIndex(c => c.id === currentCv.id);
        if (idx >= 0) next[idx] = updatedCvRes || { ...currentCv, isAdapted: true, isRendered: true };
        else next.push(updatedCvRes || { ...currentCv, isAdapted: true, isRendered: true });
        return next;
      });
      alert('CV successfully rendered to 100% capacity!');
    } catch (e) {
      console.error(e);
      alert('Failed to render CV');
    } finally {
      setRenderingId(null);
    }
  };

  const handleTranslateCV = async (cv: any, forceLang?: string) => {
    const lang = forceLang || targetLang[cv.id];
    if (!lang) {
      alert("Please select a target language first.");
      return;
    }
    setTranslatingId(cv.id);
    try {
      if (cv.id && cv.id.startsWith('phantom-')) {
         await api.saveCV({
           expertId: cv.expertId,
           expertName: cv.expertName,
           tenderId: cv.tenderId,
           tenderName: cv.tenderName,
           positionId: cv.positionId,
           positionTitle: cv.positionTitle,
           language: 'English',
           template: cv.template || 'General'
         });
         api.getCVs().then(setCvs);
      }
      
      const experts = await api.getExperts();
      const baseExpert = experts.find(e => e.id === cv.expertId || e.name === cv.expertName);
      const expertToTranslate = resolveCvExpert(cv, baseExpert);
      if (!expertToTranslate) {
        alert("Expert data missing. Cannot translate CV.");
        return;
      }
      const translatedExpert = await translateExpertData(expertToTranslate, lang);
      const tender = tenders.find(t => t.id === cv.tenderId);
      const doc = await generateReformatedCV({
        template: cv.template || 'General',
        branding: cv.customBranding || tender?.branding,
        expert: translatedExpert,
        position_title: cv.positionTitle || cv.positionId 
      });
      const expertName = translatedExpert.fullName || translatedExpert.name || 'Expert';
      doc.save(`${cv.template || 'General'} - ${expertName} (${lang}).pdf`);
    } catch (err: any) {
      console.error(err);
      alert("Translation failed: " + err.message);
    } finally {
      setTranslatingId(null);
    }
  };

  const confirmRegenerate = async (cvId: string, customBranding?: any) => {
    let cv = cvs.find(c => c.id === cvId);
    if (!cv && cvId.startsWith('phantom-') && cvToRegenerate?.id === cvId) {
        cv = cvToRegenerate;
    }
    if (!cv) return;
    setCvToRegenerate(null);
    const taskId = addTask({ type: 'GENERATE', title: `Regenerating CV`, message: `ID: ${cvId}` });
    let currentPercent = 5;
    const progressInterval = setInterval(() => {
      currentPercent = Math.min(currentPercent + Math.random() * 8, 95);
      updateTask(taskId, { percent: currentPercent, eta: 10 });
    }, 1000);
    try {
      const baseExpert = allExperts.find(e => e.id === cv.expertId || e.name === cv.expertName);
      const expert = resolveCvExpert(cv, baseExpert);
      if (!expert) throw new Error("Expert data not found for regeneration");
      
      const tender = tenders.find(t => t.id === cv.tenderId);
      
      const doc = await generateReformatedCV({
        template: cv.template || 'General',
        branding: customBranding || tender?.branding,
        expert: expert,
        position_title: cv.positionTitle || cv.positionId 
      });
      doc.save(`${cv.template || 'General'} - ${cv.expertName || 'Expert'} (Regenerated).pdf`);
      
      if (customBranding) {
          const dbcv = await api.getCVs().then(c=>c.find((x:any)=>x.id===cvId));
          if(dbcv) {
             dbcv.customBranding = customBranding;
             await api.updateCV(dbcv);
          } else if (cvId.startsWith('phantom-')) {
             await api.saveCV({
               expertId: cv.expertId,
               expertName: cv.expertName,
               tenderId: cv.tenderId,
               tenderName: cv.tenderName,
               positionId: cv.positionId,
               positionTitle: cv.positionTitle,
               language: 'English',
               template: cv.template || 'General',
               customBranding: customBranding
             });
             const updatedCvs = await api.getCVs();
             setCvs(updatedCvs);
          }
      } else if (cvId.startsWith('phantom-')) {
         await api.saveCV({
           expertId: cv.expertId,
           expertName: cv.expertName,
           tenderId: cv.tenderId,
           tenderName: cv.tenderName,
           positionId: cv.positionId,
           positionTitle: cv.positionTitle,
           language: 'English',
           template: cv.template || 'General'
         });
         const updatedCvs = await api.getCVs();
         setCvs(updatedCvs);
      }
      clearInterval(progressInterval);
      updateTask(taskId, { status: 'completed', percent: 100, eta: 0, message: 'CV Rebuilt and Downloaded' });
    } catch (err: any) {
      clearInterval(progressInterval);
      console.error(err);
      updateTask(taskId, { status: 'error', message: err.message });
      alert("Regeneration failed: " + err.message);
    }
  };

  const handleBulkTranslateAction = () => runBulkActionSequence("Translate", "Translating", (cv) => handleTranslateCV(cv, bulkTargetLang));

  const handleDownloadDocx = async (cv: any) => {
    try {
      if (cv.customRichText) {
        downloadHtmlAsDocx(cv.customRichText, `CV_${cv.expertName || 'Expert'}`);
        return;
      }
      const baseExpert = allExperts.find(e => e.id === cv.expertId || e.name === cv.expertName);
      const expert = resolveCvExpert(cv, baseExpert);
      if (!expert) {
        alert("Expert data missing. Cannot download CV.");
        return;
      }
      
      if (cv.id && cv.id.startsWith('phantom-')) {
         await api.saveCV({
           expertId: cv.expertId,
           expertName: cv.expertName,
           tenderId: cv.tenderId,
           tenderName: cv.tenderName,
           positionId: cv.positionId,
           positionTitle: cv.positionTitle,
           language: 'English',
           template: cv.template || 'General'
         });
         api.getCVs().then(setCvs);
      }
      const tender = tenders.find(t => t.id === cv.tenderId);
      const { generateDocxCV } = await import('../lib/docx');
      await generateDocxCV({
        template: cv.template || 'General',
        expert,
        branding: cv.customBranding || tender?.branding,
        position_title: cv.positionTitle || cv.positionId 
      });
    } catch (err: any) {
      console.error(err);
      alert("Download failed: " + err.message);
    }
  };

  const handleDownloadPdf = async (cv: any) => {
    try {
      if (cv.customRichText) {
        await downloadHtmlAsPdf(cv.customRichText, `CV_${cv.expertName || 'Expert'}`);
        return;
      }
      const baseExpert = allExperts.find(e => e.id === cv.expertId || e.name === cv.expertName);
      const expert = resolveCvExpert(cv, baseExpert);
      if (!expert) {
        alert("Expert data missing. Cannot download CV.");
        return;
      }
      if (cv.id && cv.id.startsWith('phantom-')) {
         await api.saveCV({
           expertId: cv.expertId,
           expertName: cv.expertName,
           tenderId: cv.tenderId,
           tenderName: cv.tenderName,
           positionId: cv.positionId,
           positionTitle: cv.positionTitle,
           language: 'English',
           template: cv.template || 'General'
         });
         api.getCVs().then(setCvs);
      }
      const tender = tenders.find(t => t.id === cv.tenderId);
      const doc = await generateReformatedCV({
        template: cv.template || 'General',
        branding: cv.customBranding || tender?.branding,
        expert,
        position_title: cv.positionTitle || cv.positionId 
      });
      doc.save(`${cv.template || 'General'} - ${cv.expertName || 'Expert'}.pdf`);
    } catch (err: any) {
      console.error(err);
      alert("Download failed: " + err.message);
    }
  };

  const handlePreview = async (cv: any) => {
    try {
      const baseExpert = allExperts.find(e => e.id === cv.expertId || e.name === cv.expertName) || {};
      const expert = resolveCvExpert(cv, baseExpert);
      
      if (cv.id && cv.id.startsWith('phantom-')) {
         await api.saveCV({
           expertId: cv.expertId,
           expertName: cv.expertName,
           tenderId: cv.tenderId,
           tenderName: cv.tenderName,
           positionId: cv.positionId,
           positionTitle: cv.positionTitle,
           language: 'English',
           template: cv.template || 'General'
         });
         api.getCVs().then(setCvs);
      }
      
      setPreviewCv({ ...cv, expertData: expert });
      
      const tender = tenders.find(t => t.id === cv.tenderId);
      
      const doc = await generateReformatedCV({
        template: cv.template || 'General',
        branding: cv.customBranding || tender?.branding,
        expert,
        position_title: cv.positionTitle || cv.positionId 
      });
      const pdfBlob = doc.output('blob');
      const url = URL.createObjectURL(pdfBlob);
      setPreviewUrl(url);
    } catch (err: any) {
      console.error(err);
      alert("Preview failed: " + err.message);
    }
  };

  const closePreview = () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
    setPreviewCv(null);
    setIsEditingRichText(false);
  };

  const saveRichText = async () => {
    try {
      const updatedPreviewCv = { ...previewCv, customRichText: richTextContent };
      setPreviewCv(updatedPreviewCv);
      
      // Save it to DB
      if (updatedPreviewCv.id) {
         updatedPreviewCv.customBranding = updatedPreviewCv.customBranding || undefined;
         await api.updateCV({ id: updatedPreviewCv.id, ...updatedPreviewCv });
         api.getCVs().then(setCvs);
      }
      setIsEditingRichText(false);
    } catch (err: any) {
      console.error(err);
      alert("Failed to save: " + err.message);
    }
  };

  return (
    <div className="space-y-6 max-w-full w-full pb-32 mx-auto">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <Link
            to="/tenders"
            className="w-10 h-10 flex shrink-0 items-center justify-center bg-white border border-slate-200 rounded-lg text-slate-400 hover:text-blue-600 hover:border-blue-200 shadow-sm transition-all active:scale-95"
          >
            <ArrowLeft size={20} />
          </Link>
          <div>
            <h2 className="text-2xl font-bold text-slate-900">
              Global Matches
            </h2>
            <p className="text-sm text-slate-500 mt-1">
              Historical Intelligence & Scored Archives
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3 lg:gap-4">
          <div className="flex items-center gap-1 p-1 bg-white border border-slate-200 rounded-lg shadow-sm w-full sm:w-auto overflow-x-auto">
            <button
              onClick={() => setSelectedTemplate("General")}
              className={clsx(
                "flex-1 sm:flex-none px-4 py-2 rounded-md text-sm font-medium transition-colors whitespace-nowrap",
                selectedTemplate === "General"
                  ? "bg-slate-900 text-white shadow-sm"
                  : "text-slate-600 hover:bg-slate-50",
              )}
            >
              General
            </button>
            <button
              onClick={() => setSelectedTemplate("Specialized2")}
              className={clsx(
                "flex-1 sm:flex-none px-4 py-2 rounded-md text-sm font-medium transition-colors whitespace-nowrap",
                selectedTemplate === "Specialized"
                  ? "bg-slate-900 text-white shadow-sm"
                  : "text-slate-600 hover:bg-slate-50",
              )}
            >
              Specialized
            </button>
          </div>

          <button
            onClick={handleBulkGenerate}
            disabled={isBulkGenerating}
            className="flex-1 sm:flex-none flex items-center justify-center gap-2 px-6 py-2.5 bg-[#2563eb] hover:bg-blue-700 text-white rounded-lg text-sm font-medium shadow-sm transition-colors disabled:opacity-50 whitespace-nowrap"
          >
            {isBulkGenerating ? (
              <>
                <Loader2 size={16} className="animate-spin shrink-0" />
                <span>
                  {activeBulkTask?.percent || 0}% - ETA{" "}
                  {activeBulkTask?.eta || 0}s
                </span>
              </>
            ) : (
              <>
                <Layers size={16} className="shrink-0" />
                <span>Bulk Render CVs</span>
              </>
            )}
          </button>
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
        <div className="p-4 sm:p-5 border-b border-slate-100 flex flex-col xl:flex-row xl:items-center justify-between gap-4 bg-slate-50/50 w-full">
          <div className="flex flex-col lg:flex-row lg:items-center gap-4 flex-1 w-full min-w-0">
            <div className="flex items-center gap-3 group flex-1 bg-white border border-slate-200 rounded-lg px-4 py-2.5 shadow-sm focus-within:border-blue-500 focus-within:ring-1 focus-within:ring-blue-500 transition-all min-w-0">
              <Search
                className="text-slate-400 shrink-0 group-focus-within:text-blue-500"
                size={18}
              />
              <input
                type="text"
                placeholder="Search candidates or tenders..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="bg-transparent text-sm text-slate-900 focus:outline-none w-full placeholder:text-slate-400 min-w-0"
              />
            </div>

            <div className="hidden lg:block h-8 w-px bg-slate-200 shrink-0"></div>

            <div className="flex flex-col sm:flex-row sm:items-center gap-3 w-full lg:w-auto shrink-0">
              <span className="text-sm font-medium text-slate-500 shrink-0 hidden sm:block">
                Filter:
              </span>
              <select
                value={selectedTenderId}
                onChange={(e) => setSelectedTenderId(e.target.value)}
                className="flex-1 sm:flex-none bg-white border border-slate-200 rounded-lg px-3 py-2.5 text-sm text-slate-900 font-medium outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 shadow-sm cursor-pointer w-full sm:w-60 text-ellipsis overflow-hidden"
              >
                <option value="all">All Tenders</option>
                {tenders.map((t) => (
                  <option key={t.id} value={t.id} className="truncate">
                    {t.name}
                  </option>
                ))}
              </select>

              {selectedTenderId !== "all" && (
                <button
                  onClick={() => {
                    const t = tenders.find(
                      (t) => t.id.toString() === selectedTenderId,
                    );
                    setBrandingTender(t);
                  }}
                  className="w-full sm:w-auto flex items-center justify-center gap-2 px-4 py-2.5 bg-white hover:bg-slate-50 rounded-lg text-sm font-medium text-[#2563eb] transition-colors border border-[#2563eb]/20 shadow-sm whitespace-nowrap shrink-0"
                >
                  <ImageIcon size={16} className="shrink-0" />
                  Edit Branding
                </button>
              )}
            </div>
          </div>
        </div>
        <div className="divide-y divide-slate-100">
          {Object.entries(groupedMatches).map(
            ([tenderName, positions]: [string, any], tenderIdx) => {
              const isTenderExpanded = expandedTenders.has(tenderName);

              return (
                <div
                  key={tenderName}
                  className="group/tender border-b border-slate-100 last:border-0"
                >
                  {/* Tender Header */}
                  <button
                    onClick={() => toggleTender(tenderName)}
                    className={clsx(
                      "w-full px-4 sm:px-6 py-4 sm:py-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 transition-colors text-left",
                      isTenderExpanded ? "bg-blue-50/50" : "hover:bg-slate-50",
                    )}
                  >
                    <div className="flex items-center gap-3 sm:gap-4 flex-1 min-w-0">
                      <div className="flex items-center justify-center shrink-0" onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          className="w-5 h-5 rounded border-slate-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
                          checked={Object.values(positions).flatMap((p: any) => p).every((m: any) => selectedMatchIds.has(m.id))}
                          ref={(input) => {
                            if (input) {
                              const matches = Object.values(positions).flatMap((p: any) => p);
                              const someSelected = matches.some((m: any) => selectedMatchIds.has(m.id));
                              const allSelected = matches.every((m: any) => selectedMatchIds.has(m.id));
                              input.indeterminate = someSelected && !allSelected;
                            }
                          }}
                          onChange={() => toggleTenderSelection(Object.values(positions).flatMap((p: any) => p))}
                        />
                      </div>
                      <div
                        className={clsx(
                          "w-10 h-10 rounded-lg flex items-center justify-center transition-colors shrink-0",
                          isTenderExpanded
                            ? "bg-[#2563eb] text-white"
                            : "bg-slate-100 text-slate-500",
                        )}
                      >
                        <Briefcase size={20} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <h3 className="text-base font-semibold text-slate-900 truncate">
                          {tenderName}
                        </h3>
                        <p className="text-sm text-slate-500 mt-0.5">
                          Tender Project
                        </p>
                      </div>
                    </div>

                    <div className="flex flex-wrap sm:flex-nowrap items-center gap-2 sm:gap-4 shrink-0 w-full sm:w-auto mt-2 sm:mt-0">
                      {(() => {
                        const tId =
                          positions &&
                          Object.values(positions)[0]?.[0]?.tenderId;
                        const tenderObj = tenders.find(
                          (t: any) => t.id === tId,
                        );
                        const reqs =
                          tenderObj?.requirements?.nationality_requirements;
                        if (
                          reqs?.required_percentage > 0 &&
                          reqs?.preferred_nationalities?.length > 0
                        ) {
                          const firstMatches = Object.values(positions as any)
                            .map((arr: any) => arr[0])
                            .filter(Boolean);
                          const total = firstMatches.length;
                          const local = firstMatches.filter((m: any) =>
                            reqs.preferred_nationalities.some((n: string) =>
                              (m.expertCitizenship || m.expertNationality || "")
                                .toLowerCase()
                                .includes(n.toLowerCase()),
                            ),
                          ).length;
                          const pct = total > 0 ? (local / total) * 100 : 0;
                          if (pct < reqs.required_percentage) {
                            return (
                              <div className="flex items-center gap-1.5 px-3 py-1 bg-red-50 text-red-700 border border-red-100 rounded-md text-xs font-semibold shrink-0">
                                <AlertCircle size={14} className="shrink-0" />
                                <span className="truncate max-w-[200px] sm:max-w-none">
                                  Warning: Proposed team ({pct.toFixed(0)}%)
                                  does not meet the {reqs.required_percentage}%
                                  localization requirement.
                                </span>
                              </div>
                            );
                          }
                        }
                        return null;
                      })()}
                      <div className="text-right sm:block flex-1 sm:flex-none">
                        <p className="text-sm font-medium text-slate-700 whitespace-nowrap">
                          {Object.keys(positions).length} Roles
                        </p>
                      </div>
                      {positions &&
                        Object.values(positions)[0]?.[0]?.tenderId && !searchParams.get("tenderId") && (
                          <Link
                            to={`/tenders/${Object.values(positions)[0][0].tenderId}`}
                            onClick={(e) => e.stopPropagation()}
                            className="flex flex-row items-center justify-center gap-2 px-3 py-1.5 bg-white border border-slate-200 hover:border-blue-300 hover:text-blue-600 rounded-lg text-xs font-medium text-slate-600 transition-colors shadow-sm ml-auto sm:ml-2 whitespace-nowrap"
                          >
                            <TargetIcon size={14} />
                            Run Engine
                          </Link>
                        )}
                      <div
                        className={clsx(
                          "shrink-0 flex items-center justify-center transition-transform duration-200",
                          isTenderExpanded
                            ? "rotate-90 text-slate-900"
                            : "text-slate-400",
                        )}
                      >
                        <ChevronRight size={20} />
                      </div>
                    </div>
                  </button>

                  {/* Positions within Tender (Animated Expansion) */}
                  <AnimatePresence>
                    {isTenderExpanded && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        className="overflow-hidden bg-white"
                      >
                        <div className="divide-y divide-slate-100">
                          <div className="px-6 py-3 bg-slate-50 border-b border-slate-100">
                            <div className="relative max-w-sm">
                              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                              <input
                                type="text"
                                placeholder={`Search ${Object.keys(positions).length} roles...`}
                                value={positionSearchQueries[tenderName] || ""}
                                onChange={(e) => setPositionSearchQueries(prev => ({ ...prev, [tenderName]: e.target.value }))}
                                className="w-full pl-9 pr-4 py-1.5 text-sm bg-white border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
                              />
                            </div>
                          </div>
                          {Object.entries(positions)
                            .filter(([positionTitle]) => {
                              const q = positionSearchQueries[tenderName]?.toLowerCase() || "";
                              return positionTitle.toLowerCase().includes(q);
                            })
                            .map(
                            ([positionTitle, positionMatches]: [
                              string,
                              any,
                            ]) => {
                              const posKey = `${tenderName}-${positionTitle}`;
                              const isPosExpanded =
                                expandedPositions.has(posKey);

                              return (
                                <div
                                  key={positionTitle}
                                  className="group/position"
                                >
                                  <button
                                    onClick={() =>
                                      togglePosition(tenderName, positionTitle)
                                    }
                                    className={clsx(
                                      "w-full pl-6 sm:pl-16 pr-4 sm:pr-6 py-4 flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4 transition-colors text-left",
                                      isPosExpanded
                                        ? "bg-slate-50"
                                        : "hover:bg-slate-50/50",
                                    )}
                                  >
                                    <div className="flex items-center gap-3 flex-1 min-w-0 w-full">
                                      <div className="flex items-center justify-center shrink-0" onClick={(e) => e.stopPropagation()}>
                                        <input
                                          type="checkbox"
                                          className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
                                          checked={positionMatches.every((m: any) => selectedMatchIds.has(m.id))}
                                          ref={(input) => {
                                            if (input) {
                                              const someSelected = positionMatches.some((m: any) => selectedMatchIds.has(m.id));
                                              const allSelected = positionMatches.every((m: any) => selectedMatchIds.has(m.id));
                                              input.indeterminate = someSelected && !allSelected;
                                            }
                                          }}
                                          onChange={() => togglePositionSelection(positionMatches)}
                                        />
                                      </div>
                                      <div
                                        className={clsx(
                                          "w-8 h-8 rounded-lg flex items-center justify-center transition-colors shrink-0",
                                          isPosExpanded
                                            ? "bg-blue-100 text-blue-700"
                                            : "bg-slate-100 text-slate-500",
                                        )}
                                      >
                                        <Target size={16} />
                                      </div>
                                      <div className="flex-1 min-w-0">
                                        <span className="text-sm font-medium text-slate-900 line-clamp-2">
                                          {positionTitle}
                                        </span>
                                      </div>
                                    </div>
                                    <div className="flex items-center gap-4 shrink-0 justify-between sm:justify-end w-full sm:w-auto pl-11 sm:pl-0">
                                      <span className="text-xs font-medium text-slate-600 bg-white border border-slate-200 px-2.5 py-1 rounded-md shadow-sm">
                                        {positionMatches.length} candidates
                                      </span>
                                      <ChevronRight
                                        size={18}
                                        className={clsx(
                                          "text-slate-400 transition-transform",
                                          isPosExpanded && "rotate-90",
                                        )}
                                      />
                                    </div>
                                  </button>

                                  {/* Matches within Position (Recursive Expansion) */}
                                  <AnimatePresence>
                                    {isPosExpanded && (
                                      <motion.div
                                        initial={{ height: 0, opacity: 0 }}
                                        animate={{ height: "auto", opacity: 1 }}
                                        exit={{ height: 0, opacity: 0 }}
                                        className="overflow-hidden"
                                      >
                                        
<div className="bg-slate-50/50 pt-0 pb-4 px-0 md:px-8 space-y-0">
  <div className="px-6 py-3 bg-slate-50 border-t border-slate-200">
    <div className="relative max-w-sm">
      <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
      <input
        type="text"
        placeholder={`Search ${positionMatches.length} candidates...`}
        value={candidateSearchQueries[posKey] || ""}
        onChange={(e) => setCandidateSearchQueries(prev => ({ ...prev, [posKey]: e.target.value }))}
        className="w-full pl-9 pr-4 py-1.5 text-sm bg-white border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
      />
    </div>
  </div>
  <div className="w-full overflow-x-auto shadow-sm border-t border-slate-200">
    <table className="w-full text-left border-collapse bg-white">
      <thead className="bg-[#f8fafc] border-b border-slate-200">
        <tr>
          <th className="px-4 py-3 w-10">
            <input
              type="checkbox"
              className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
              checked={positionMatches.every((m: any) => selectedMatchIds.has(m.id))}
              ref={(input) => {
                if (input) {
                  const someSelected = positionMatches.some((m: any) => selectedMatchIds.has(m.id));
                  const allSelected = positionMatches.every((m: any) => selectedMatchIds.has(m.id));
                  input.indeterminate = someSelected && !allSelected;
                }
              }}
              onChange={() => togglePositionSelection(positionMatches)}
            />
          </th>
          <th className="px-6 py-3 text-[10px] font-bold uppercase tracking-wider text-slate-500">Score</th>
          <th className="px-6 py-3 text-[10px] font-bold uppercase tracking-wider text-slate-500">Candidate</th>
          <th className="px-6 py-3 text-[10px] font-bold uppercase tracking-wider text-slate-500 hidden md:table-cell">Location</th>
          <th className="px-6 py-3 text-[10px] font-bold uppercase tracking-wider text-slate-500 hidden lg:table-cell">Experience</th>
          <th className="px-6 py-3 text-[10px] font-bold uppercase tracking-wider text-slate-500">Risk Level</th>
          <th className="px-6 py-3 text-right text-[10px] font-bold uppercase tracking-wider text-slate-500">Actions</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-slate-100">
        {positionMatches
          .filter((match: any) => {
            const q = candidateSearchQueries[posKey]?.toLowerCase() || "";
            return match.expertName?.toLowerCase().includes(q) || match.expert_type?.toLowerCase().includes(q);
          })
          .sort((a: any, b: any) => (b.score || 0) - (a.score || 0))
          .map((match: any, matchIdx: number) => {
          const isMatchExpanded = expandedMatchId === match.id;
          const matchExpert = allExperts.find(e => e.id === match.expertId || e.name === match.expertName);
          const location = matchExpert?.location || matchExpert?.contact?.address || match.location || '-';
          const experience = matchExpert?.experienceYears ? `${matchExpert.experienceYears} Years` : (matchExpert?.employment_history?.length || matchExpert?.experiences?.length) ? `${matchExpert.employment_history?.length || matchExpert.experiences?.length} Roles` : match.experience || '-';
          
          return (
            <Fragment key={match.id || matchIdx}>
              <tr 
                className={clsx("hover:bg-blue-50/50 transition-colors cursor-pointer", isMatchExpanded ? "bg-blue-50/30" : "")}
                onClick={(e) => {
                  e.stopPropagation();
                  setExpandedMatchId(isMatchExpanded ? null : match.id);
                }}
              >
                <td className="px-4 py-4" onClick={(e) => e.stopPropagation()}>
                  <input
                    type="checkbox"
                    className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
                    checked={selectedMatchIds.has(match.id)}
                    onChange={() => toggleMatchSelection(match.id)}
                  />
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <div className="flex items-center gap-2">
                    <div className={clsx("font-bold text-lg", match.score >= 85 ? "text-emerald-600" : match.score >= 50 ? "text-blue-600" : "text-amber-600")}>
                      {match.score}%
                    </div>
                  </div>
                </td>
                <td className="px-6 py-4">
                  <div className="font-semibold text-slate-900">{match.expertName}</div>
                  <div className="text-xs text-slate-500 mt-0.5">{match.expert_type || 'Expert'}</div>
                </td>
                <td className="px-6 py-4 hidden md:table-cell text-sm text-slate-600">{location}</td>
                <td className="px-6 py-4 hidden lg:table-cell text-sm text-slate-600">{experience}</td>
                <td className="px-6 py-4">
                   <div className={clsx("inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] font-bold uppercase tracking-wider", match.risk_level === "LOW" ? "bg-emerald-50 text-emerald-700" : match.risk_level === "MEDIUM" ? "bg-amber-50 text-amber-700" : "bg-rose-50 text-rose-700")}>
                      {match.risk_level}
                   </div>
                </td>
                <td className="px-6 py-4 text-right">
                  <button className="text-blue-600 hover:bg-blue-100 p-1.5 rounded-lg transition-colors">
                     <ChevronDown className={clsx("transition-transform duration-200", isMatchExpanded && "rotate-180")} size={20} />
                  </button>
                </td>
              </tr>
              <AnimatePresence>
                {isMatchExpanded && (
                  <tr>
                    <td colSpan={7} className="p-0 border-0">

                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        className="overflow-hidden bg-slate-50/50"
                      >
                         <div className="p-6">
                            {/* Original block but wrapped inside the expanded row */}
                            <div className="bg-white border border-blue-100 shadow-sm rounded-xl p-5">
                                <div className="flex flex-col md:flex-row md:items-start gap-5">
                                   {/* We remove the original Score Ring and Header because it's now in the table row */}
                                   <div className="flex-1 min-w-0">
                                      {match.met_team_constraints && match.met_team_constraints.length > 0 && (
                                        <div className="flex flex-wrap items-center gap-2 mb-4">
                                          <span className="text-xs font-bold uppercase text-slate-400 tracking-wider">Met Constraints:</span>
                                          {match.met_team_constraints.map((c: string, cIdx: number) => (
                                            <span
                                              key={cIdx}
                                              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-100/80 text-emerald-700 border border-emerald-200"
                                            >
                                              <CheckCircle2 size={12} /> {c}
                                            </span>
                                          ))}
                                        </div>
                                      )}
                                      
                                      {/* Extract Strengths, Gaps, Reasoning from original code using naive find-replace or by just keeping the JSX string portion starting from the grids */}
                                      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
                                        <div className="flex flex-col gap-4">
                                          <div className="bg-emerald-50/50 border border-emerald-100 rounded-lg p-3 flex-1">
                                            <h5 className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-emerald-800 mb-2">
                                              <CheckCircle2 size={14} className="text-emerald-500" /> Key Strengths
                                            </h5>
                                            <ul className="space-y-1">
                                              {(match.strong_points || match.fulfilled_requirements || match.strengths || [])?.map((s: string, sIdx: number) => (
                                                <li key={sIdx} className="text-xs text-emerald-900/80 flex items-start gap-1.5">
                                                  <span className="text-emerald-500 mt-0.5">•</span>
                                                  <span className="leading-snug">{s}</span>
                                                </li>
                                              ))}
                                            </ul>
                                          </div>
                                          
                                          {match.recommended_projects_to_highlight && match.recommended_projects_to_highlight.length > 0 && (
                                            <div className="bg-blue-50/50 border border-blue-100 rounded-lg p-3">
                                              <h5 className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-blue-800 mb-2">
                                                <Zap size={14} className="text-blue-500" /> Suggested Highlights
                                              </h5>
                                              <ul className="space-y-1">
                                                {match.recommended_projects_to_highlight.map((proj: string, i: number) => (
                                                  <li key={i} className="text-xs text-blue-900/80 flex items-start gap-1.5">
                                                    <span className="text-blue-500 mt-0.5">•</span>
                                                    <span className="leading-snug">{proj}</span>
                                                  </li>
                                                ))}
                                              </ul>
                                            </div>
                                          )}
                                        </div>

                                        <div className="bg-amber-50/50 border border-amber-100 rounded-lg p-3">
                                          <h5 className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-amber-800 mb-2">
                                            <AlertCircle size={14} className="text-amber-500" /> Missing / Gaps
                                          </h5>
                                          <ul className="space-y-1">
                                            {(match.missing_requirements || match.gaps)?.length > 0 ? (match.missing_requirements || match.gaps).map((g: string, gIdx: number) => (
                                              <li key={gIdx} className="text-xs text-amber-900/80 flex items-start gap-1.5">
                                                <span className="text-amber-500 mt-0.5">•</span>
                                                <span className="leading-snug">{g}</span>
                                              </li>
                                            )) : <li className="text-xs text-amber-900/80">No major gaps identified</li>}
                                          </ul>
                                        </div>
                                      </div>

                                      <div className="bg-slate-50 border border-slate-100 rounded-lg p-3">
                                          <h5 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-1">
                                            Match Reasoning
                                          </h5>
                                          <p className="text-xs text-slate-700 leading-relaxed font-semibold mb-2">
                                            {match.match_summary || ""}
                                          </p>
                                          <p className="text-xs text-slate-700 leading-relaxed">
                                            {match.scoring_rationale || match.justification || match.reasoning || "No detailed reasoning provided."}
                                          </p>
                                      </div>
                                   </div>
                                    
                                   {/* CV ACTIONS - Extracted dynamically from original elementCode */}
                                   <div className="flex-shrink-0 w-full md:w-[240px] flex flex-col gap-3">
                                      {(() => {
                                        const cvsForMatch = cvs.filter((c: any) => c.expertId === match.expertId && (c.positionId === match.positionId || c.positionTitle === match.positionTitle));
                                        let visualCv = cvsForMatch[cvsForMatch.length - 1] || cvsForMatch[0] || match;
                                        if (cvsForMatch.length > 0 && cvsForMatch.some((c:any) => c.customRichText)) {
                                            visualCv = cvsForMatch.find((c:any) => c.customRichText) || visualCv;
                                        }
                                        return (
                                          <div className="flex flex-col gap-2 w-full sm:w-[220px]">
                                                             <h5 className="text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-1 mt-1">
                                                               Normal CV
                                                             </h5>
                                                             <div className="grid grid-cols-2 gap-1.5 w-full mb-1">
                                                               <button onClick={(e) => { e.stopPropagation(); handlePreview(visualCv); }} className="flex items-center gap-1.5 p-1.5 justify-center border border-slate-200 rounded-lg text-slate-600 hover:bg-slate-50 transition-colors shadow-sm text-[10px] font-medium" title="View CV">
                                                                 <Eye size={12} /> View
                                                               </button>
                                                               <button onClick={(e) => { e.stopPropagation(); setCvToRegenerate(visualCv); }} className="flex items-center gap-1.5 p-1.5 justify-center border border-slate-200 rounded-lg text-slate-600 hover:bg-slate-50 transition-colors shadow-sm text-[10px] font-medium" title="Regenerate CV">
                                                                 <RefreshCw size={12} /> Regenerate
                                                               </button>
                                                               <button onClick={(e) => { e.stopPropagation(); handleDownloadDocx(visualCv); }} className="flex items-center gap-1.5 p-1.5 justify-center border border-blue-200 bg-blue-50 text-blue-700 rounded-lg hover:bg-blue-100 transition-colors shadow-sm text-[10px] font-medium" title="Download DOCX">
                                                                 <FileIcon size={12} /> Word
                                                               </button>
                                                               <button onClick={(e) => { e.stopPropagation(); handleDownloadPdf(visualCv); }} className="flex items-center gap-1.5 p-1.5 justify-center border border-red-200 bg-red-50 text-red-700 rounded-lg hover:bg-red-100 transition-colors shadow-sm text-[10px] font-medium" title="Download PDF">
                                                                 <Download size={12} /> PDF
                                                               </button>
                                                             </div>

                                                              <div className="flex items-center gap-1.5 w-full border border-blue-200 rounded-lg p-1 bg-blue-50/50 shadow-sm mt-1.5 mb-2">
                                                                <select
                                                                  value={targetLang[visualCv.id] || ""}
                                                                  onChange={(e) => { e.stopPropagation(); setTargetLang((prev) => ({ ...prev, [visualCv.id]: e.target.value })); }}
                                                                  onClick={(e) => e.stopPropagation()}
                                                                  className="text-[10px] uppercase font-bold bg-transparent outline-none text-blue-700 flex-1 px-1 cursor-pointer w-full min-w-[80px]"
                                                                >
                                                                  <option value="">Language</option>
                                                                  <option value="French">French</option>
                                                                  <option value="Spanish">Spanish</option>
                                                                  <option value="German">German</option>
                                                                </select>
                                                                <button
                                                                  onClick={(e) => { e.stopPropagation(); handleTranslateCV(visualCv); }}
                                                                  disabled={translatingId === visualCv.id || !targetLang[visualCv.id]}
                                                                  className="flex items-center justify-center gap-1.5 p-1 px-2 text-[10px] font-bold uppercase tracking-wider text-blue-700 bg-white border border-blue-200 hover:bg-blue-50 rounded transition-colors disabled:opacity-50"
                                                                  title="Translate Current CV Version"
                                                                >
                                                                  {translatingId === visualCv.id ? <Loader2 size={12} className="animate-spin" /> : <Languages size={12} />}
                                                                  Translate
                                                                </button>
                                                              </div>
                                                                                                                      <h5 className="text-[11px] font-bold uppercase tracking-wider text-indigo-500 mb-1">
                                                               Adapt CV
                                                             </h5>
                                                             <button
                                                               onClick={(e) => { e.stopPropagation(); handleAdaptCV(visualCv); }}
                                                               disabled={adaptingId === visualCv.id || renderingId === visualCv.id}
                                                               className="flex items-center justify-center gap-2 w-full px-4 py-2 border border-indigo-200 bg-indigo-50 text-indigo-800 rounded-lg hover:bg-indigo-100 transition-all shadow-sm focus:ring-2 focus:ring-indigo-500 font-semibold text-xs disabled:opacity-50 mb-1"
                                                             >
                                                               {adaptingId === visualCv.id ? <Loader2 size={16} className="animate-spin" /> : <Wand2 size={16} />}
                                                               {visualCv.isAdapted ? "Re-Adapt CV" : "Adapt CV"}
                                                             </button>
                                                             <div className="grid grid-cols-3 gap-1.5 w-full">
                                                               <button
                                                                 onClick={(e) => { e.stopPropagation(); handlePreview(visualCv); }}
                                                                 disabled={!visualCv.isAdapted}
                                                                 className="flex items-center gap-1.5 p-1.5 justify-center border border-slate-200 rounded-lg text-slate-600 hover:bg-slate-50 transition-colors shadow-sm text-[10px] font-medium disabled:opacity-50 disabled:cursor-not-allowed disabled:bg-slate-50"
                                                                 title="View CV"
                                                               >
                                                                 <Eye size={12} /> View
                                                               </button>
                                                               <button
                                                                 onClick={(e) => { e.stopPropagation(); handleDownloadDocx(visualCv); }}
                                                                 disabled={!visualCv.isAdapted}
                                                                 className="flex items-center gap-1.5 p-1.5 justify-center border border-blue-200 bg-blue-50 text-blue-700 rounded-lg hover:bg-blue-100 transition-colors shadow-sm text-[10px] font-medium disabled:opacity-50 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400 disabled:border-slate-200"
                                                               >
                                                                 <FileIcon size={12} /> Word
                                                               </button>
                                                               <button
                                                                 onClick={(e) => { e.stopPropagation(); handleDownloadPdf(visualCv); }}
                                                                 disabled={!visualCv.isAdapted}
                                                                 className="flex items-center gap-1.5 p-1.5 justify-center border border-red-200 bg-red-50 text-red-700 rounded-lg hover:bg-red-100 transition-colors shadow-sm text-[10px] font-medium disabled:opacity-50 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400 disabled:border-slate-200"
                                                               >
                                                                 <Download size={12} /> PDF
                                                               </button>
                                                             </div>

                                                              <div className="flex items-center gap-1.5 w-full border border-blue-200 rounded-lg p-1 bg-blue-50/50 shadow-sm mt-1.5 mb-2">
                                                                <select
                                                                  value={targetLang[visualCv.id] || ""}
                                                                  onChange={(e) => { e.stopPropagation(); setTargetLang((prev) => ({ ...prev, [visualCv.id]: e.target.value })); }}
                                                                  onClick={(e) => e.stopPropagation()}
                                                                  disabled={!visualCv.isAdapted}
                                                                  className="text-[10px] uppercase font-bold bg-transparent outline-none text-blue-700 flex-1 px-1 cursor-pointer w-full min-w-[80px] disabled:opacity-50 disabled:cursor-not-allowed"
                                                                >
                                                                  <option value="">Language</option>
                                                                  <option value="French">French</option>
                                                                  <option value="Spanish">Spanish</option>
                                                                  <option value="German">German</option>
                                                                </select>
                                                                <button
                                                                  onClick={(e) => { e.stopPropagation(); handleTranslateCV(visualCv); }}
                                                                  disabled={translatingId === visualCv.id || !targetLang[visualCv.id] || !visualCv.isAdapted}
                                                                  className="flex items-center justify-center gap-1.5 p-1 px-2 text-[10px] font-bold uppercase tracking-wider text-blue-700 bg-white border border-blue-200 hover:bg-blue-50 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                                                  title="Translate Current CV Version"
                                                                >
                                                                  {translatingId === visualCv.id ? <Loader2 size={12} className="animate-spin" /> : <Languages size={12} />}
                                                                  Translate
                                                                </button>
                                                              </div>

                                                             <div className="h-px bg-slate-100 my-1"></div>

                                                             <h5 className="text-[11px] font-bold uppercase tracking-wider text-emerald-600 mb-1">
                                                               Render CV
                                                             </h5>
                                                             <button
                                                               onClick={(e) => { e.stopPropagation(); handleRenderCV(visualCv); }}
                                                               disabled={renderingId === visualCv.id || adaptingId === visualCv.id}
                                                               className="flex items-center justify-center gap-2 w-full px-4 py-2 border border-emerald-200 bg-emerald-50 text-emerald-800 rounded-lg hover:bg-emerald-100 transition-all shadow-sm focus:ring-2 focus:ring-emerald-500 font-semibold text-xs disabled:opacity-50 disabled:cursor-not-allowed mb-1"
                                                             >
                                                               {renderingId === visualCv.id ? <Loader2 size={16} className="animate-spin" /> : <BrainCircuit size={16} />}
                                                               {visualCv.isRendered ? "Re-Render CV" : "Render CV"}
                                                             </button>
                                                             <div className="grid grid-cols-3 gap-1.5 w-full">
                                                               <button
                                                                 onClick={(e) => { e.stopPropagation(); handlePreview(visualCv); }}
                                                                 disabled={!visualCv.isRendered}
                                                                 className="flex items-center gap-1.5 p-1.5 justify-center border border-slate-200 rounded-lg text-slate-600 hover:bg-slate-50 transition-colors shadow-sm text-[10px] font-medium disabled:opacity-50 disabled:cursor-not-allowed disabled:bg-slate-50"
                                                               >
                                                                 <Eye size={12} /> View
                                                               </button>
                                                               <button
                                                                 onClick={(e) => { e.stopPropagation(); handleDownloadDocx(visualCv); }}
                                                                 disabled={!visualCv.isRendered}
                                                                 className="flex items-center gap-1.5 p-1.5 justify-center border border-blue-200 bg-blue-50 text-blue-700 rounded-lg hover:bg-blue-100 transition-colors shadow-sm text-[10px] font-medium disabled:opacity-50 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400 disabled:border-slate-200"
                                                               >
                                                                 <FileIcon size={12} /> Word
                                                               </button>
                                                               <button
                                                                 onClick={(e) => { e.stopPropagation(); handleDownloadPdf(visualCv); }}
                                                                 disabled={!visualCv.isRendered}
                                                                 className="flex items-center gap-1.5 p-1.5 justify-center border border-red-200 bg-red-50 text-red-700 rounded-lg hover:bg-red-100 transition-colors shadow-sm text-[10px] font-medium disabled:opacity-50 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400 disabled:border-slate-200"
                                                               >
                                                                 <Download size={12} /> PDF
                                                                </button>
                                                               </div>
                                                              
                                                            </div>
                                        );
                                      })()}
                                   </div>
                                </div>
                            </div>
                         </div>
                      </motion.div>

                    </td>
                  </tr>
                )}
              </AnimatePresence>
            </Fragment>
          );
        })}
      </tbody>
    </table>
  </div>
</div>

                                      </motion.div>
                                    )}
                                  </AnimatePresence>
                                </div>
                              );
                            },
                          )}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              );
            },
          )}

          {matches.length === 0 && (
            <div className="py-24 flex flex-col items-center justify-center space-y-6 text-center">
              <div className="w-16 h-16 rounded-2xl bg-slate-50 border border-slate-100 flex items-center justify-center text-slate-400">
                <History size={24} />
              </div>
              <div>
                <h3 className="text-lg font-semibold text-slate-900 mb-1">
                  No Matches Found
                </h3>
                <p className="text-sm text-slate-500 max-w-sm mx-auto">
                  Run the Match Engine from a tender to see results here.
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
      <ConfirmModal
        isOpen={!!confirmDeleteId}
        title="Delete Match"
        message="Are you sure you want to remove this match? This cannot be undone."
        confirmText="Delete"
        isDestructive={true}
        onConfirm={() => {
          if (confirmDeleteId) handleDeleteMatch(confirmDeleteId);
          setConfirmDeleteId(null);
        }}
        onCancel={() => setConfirmDeleteId(null)}
      />
      <AnimatePresence>
        {brandingTender && (
          <BrandingModal
            tender={brandingTender}
            onClose={() => setBrandingTender(null)}
            onSave={fetchTenders}
          />
        )}

        {feedbackModalMatch && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white rounded-2xl shadow-xl w-full max-w-md flex flex-col overflow-hidden"
            >
              <div className="flex items-center justify-between p-6 border-b border-slate-100">
                <h2 className="text-lg font-bold text-slate-900">
                  Provide Feedback
                </h2>
                <button
                  onClick={() => setFeedbackModalMatch(null)}
                  className="p-2 text-slate-400 hover:text-slate-600 rounded-lg transition-colors"
                >
                  <X size={20} />
                </button>
              </div>
              <div className="p-6">
                <p className="text-sm text-slate-600 mb-4">
                  Why is <strong>{feedbackModalMatch.expertName}</strong> a poor
                  match for <strong>{feedbackModalMatch.positionTitle}</strong>?
                  Your feedback improves the matching engine.
                </p>
                <textarea
                  className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:bg-white focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none resize-none h-32"
                  placeholder="e.g., Lacks relevant bridge design experience, nationality requirement not met..."
                  onChange={async (e) => {
                    const val = e.target.value;
                    await api.updateMatch(feedbackModalMatch.id, {
                      feedback_reason: val,
                    });
                    setFeedback((prev) => ({
                      ...prev,
                      [feedbackModalMatch.id]: { type: "down", reason: val },
                    }));
                  }}
                ></textarea>
              </div>
              <div className="p-6 border-t border-slate-100 bg-slate-50 flex justify-end gap-3">
                <button
                  onClick={() => setFeedbackModalMatch(null)}
                  className="px-5 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-200 rounded-lg transition-colors border border-slate-200"
                >
                  Submit & Hide
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
      
      {/* Regenerate CV Modal */}
      {cvToRegenerate && (
        <RegenerateCVModal
          cv={cvToRegenerate}
          onClose={() => setCvToRegenerate(null)}
          onRegenerate={confirmRegenerate}
        />
      )}

      {/* Document Preview Modal */}
      <AnimatePresence>
        {previewCv && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6">
            <motion.div 
              initial={{ opacity: 0 }} 
              animate={{ opacity: 1 }} 
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-slate-950/80 backdrop-blur-sm"
              onClick={closePreview}
            />

            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="relative w-full max-w-4xl h-[85vh] bg-white rounded-2xl overflow-hidden shadow-2xl flex flex-col"
            >
              <div className="bg-slate-900 px-6 py-4 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <FileText className="text-blue-400" size={20} />
                  <span className="text-sm font-bold text-white">
                    CV_{previewCv.expertName?.split(" ").join("_")}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => {
                      if (!isEditingRichText) {
                        setRichTextContent(
                          previewCv.customRichText ||
                            generateCVHtml(
                              previewCv.expertData,
                              previewCv.positionTitle || previewCv.positionId,
                            ),
                        );
                      }
                      setIsEditingRichText(!isEditingRichText);
                    }}
                    className="flex items-center gap-2 px-3 py-1.5 bg-slate-700 hover:bg-slate-600 rounded-lg text-xs font-bold text-white transition-colors"
                  >
                    <span>
                      {isEditingRichText ? "Cancel Edit" : "Edit (Rich Text)"}
                    </span>
                  </button>
                  {isEditingRichText && (
                    <button
                      onClick={saveRichText}
                      className="flex items-center gap-2 px-3 py-1.5 bg-green-600 hover:bg-green-700 rounded-lg text-xs font-bold text-white transition-colors"
                    >
                      <CheckCircle2 size={14} />
                      <span>Save Changes</span>
                    </button>
                  )}

                  {!isEditingRichText && (
                    <>
                      <button
                        onClick={() => handleDownloadDocx(previewCv)}
                        className="flex items-center gap-2 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 rounded-lg text-xs font-bold text-white transition-colors"
                      >
                        <FileText size={14} />
                        <span>Export to Google Docs / Word</span>
                      </button>
                      <button
                        onClick={() => handleDownloadPdf(previewCv)}
                        className="flex items-center gap-2 px-3 py-1.5 bg-red-600 hover:bg-red-700 rounded-lg text-xs font-bold text-white transition-colors"
                      >
                        <Download size={14} />
                        <span>Download PDF</span>
                      </button>
                    </>
                  )}
                  <button
                    onClick={closePreview}
                    className="p-2 hover:bg-slate-800 rounded-lg text-slate-400 hover:text-white transition-colors"
                  >
                    <X size={20} />
                  </button>
                </div>
              </div>

              <ModeAuditPanel cv={previewCv} />

              {/* A4 Document Content Simulation / PDF Viewer */}
              {isEditingRichText ? (
                <div className="flex-1 w-full bg-slate-50 flex flex-col relative overflow-y-hidden">
                  <div className="p-4 bg-white border-b border-slate-200 text-slate-600 text-sm flex items-center justify-between shadow-sm z-10">
                    <p>
                      Edit the content directly. Formatting will be preserved on
                      download or export.
                    </p>
                  </div>
                  <div className="flex-1 overflow-auto bg-slate-100 p-8 custom-scrollbar">
                    <div className="max-w-[800px] mx-auto bg-white min-h-[1000px] shadow-lg">
                      <ReactQuill
                        theme="snow"
                        value={richTextContent}
                        onChange={setRichTextContent}
                        className="h-full border-none [&_.ql-toolbar]:border-x-0 [&_.ql-toolbar]:border-t-0 [&_.ql-container]:border-none [&_.ql-editor]:min-h-[800px] [&_.ql-editor]:p-12 text-black"
                        modules={{
                          toolbar: [
                            [{ header: [1, 2, 3, false] }],
                            ["bold", "italic", "underline", "strike"],
                            [{ list: "ordered" }, { list: "bullet" }],
                            ["clean"],
                          ],
                        }}
                      />
                    </div>
                  </div>
                </div>
              ) : (
                <div className="flex-1 overflow-y-auto bg-slate-100 flex justify-center custom-scrollbar py-8">
                  {previewCv.customRichText ? (
                    <div className="max-w-[800px] w-full bg-white shadow-lg p-12 min-h-[1000px] text-black">
                      <div
                        className="ql-editor"
                        dangerouslySetInnerHTML={{
                          __html: previewCv.customRichText,
                        }}
                      />
                    </div>
                  ) : previewUrl ? (
                    <Document
                      file={previewUrl}
                      onLoadSuccess={({ numPages }) => setNumPages(numPages)}
                      loading={
                        <div className="flex flex-col items-center justify-center gap-3 mt-20">
                          <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
                          <p className="text-slate-500 font-medium">
                            Loading PDF...
                          </p>
                        </div>
                      }
                      className="flex flex-col items-center gap-6"
                    >
                      {Array.from(new Array(numPages || 0), (el, index) => (
                        <div
                          key={`page_${index + 1}`}
                          className="shadow-[0_0_50px_-12px_rgba(0,0,0,0.1)] mb-4"
                        >
                          <Page
                            pageNumber={index + 1}
                            width={750}
                            className="bg-white"
                            renderTextLayer={true}
                            renderAnnotationLayer={true}
                          />
                        </div>
                      ))}
                    </Document>
                  ) : (
                    <div className="flex flex-col items-center justify-center gap-4 text-slate-400 h-full">
                      <Printer className="w-12 h-12 opacity-20" />
                      <p>Generating preview...</p>
                    </div>
                  )}
                </div>
              )}
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* FLOATING ACTION BAR FOR BULK ACTIONS */}
      <AnimatePresence>
        {selectedMatchIds.size > 0 && (
          <motion.div
            initial={{ y: 100, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 100, opacity: 0 }}
            className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 bg-white border border-slate-200 shadow-2xl rounded-2xl p-2 flex items-center gap-2"
          >
            <div className="px-4 py-2 bg-blue-50 text-blue-700 font-bold text-sm rounded-xl shrink-0">
              {selectedMatchIds.size} Selected
            </div>
            
            <div className="w-px h-8 bg-slate-200 mx-2"></div>
            
            <div className="flex items-center gap-1 bg-slate-50 p-1 rounded-xl border border-slate-100">
              <span className="text-xs font-semibold text-slate-500 uppercase px-2">Generate:</span>
              <button
                onClick={handleBulkGenerate}
                disabled={isBulkGenerating}
                className="px-4 py-2 hover:bg-white hover:shadow-sm rounded-lg text-sm font-semibold text-slate-700 transition-all disabled:opacity-50"
              >
                Normal
              </button>
              <button
                onClick={handleBulkAdapt}
                disabled={isBulkGenerating}
                className="px-4 py-2 hover:bg-white hover:shadow-sm rounded-lg text-sm font-semibold text-emerald-600 transition-all disabled:opacity-50"
              >
                Adapt
              </button>
              <button
                onClick={handleBulkRender}
                disabled={isBulkGenerating}
                className="px-4 py-2 hover:bg-white hover:shadow-sm rounded-lg text-sm font-semibold text-purple-600 transition-all disabled:opacity-50"
              >
                Render
              </button>
            </div>

            <div className="w-px h-8 bg-slate-200 mx-2"></div>

            <div className="flex items-center gap-1 bg-slate-50 p-1 rounded-xl border border-slate-100">
              <span className="text-xs font-semibold text-slate-500 uppercase px-2">Export:</span>
              <button
                onClick={handleBulkWord}
                disabled={isBulkGenerating}
                className="flex items-center gap-1.5 px-4 py-2 hover:bg-blue-600 hover:text-white rounded-lg text-sm font-semibold text-blue-600 transition-all disabled:opacity-50"
              >
                <FileText size={16} /> Word
              </button>
              <button
                onClick={handleBulkPdf}
                disabled={isBulkGenerating}
                className="flex items-center gap-1.5 px-4 py-2 hover:bg-red-600 hover:text-white rounded-lg text-sm font-semibold text-red-600 transition-all disabled:opacity-50"
              >
                <Download size={16} /> PDF
              </button>
            </div>

            <div className="w-px h-8 bg-slate-200 mx-2"></div>

            <div className="flex items-center gap-2 bg-slate-50 p-1 rounded-xl border border-slate-100">
              <select
                value={bulkTargetLang}
                onChange={(e) => setBulkTargetLang(e.target.value)}
                className="bg-white border-slate-200 text-sm rounded-lg px-3 py-2 text-slate-700 focus:ring-blue-500 font-medium"
              >
                <option value="French">French</option>
                <option value="Spanish">Spanish</option>
                <option value="Russian">Russian</option>
                <option value="Arabic">Arabic</option>
                <option value="Portuguese">Portuguese</option>
                <option value="Serbian">Serbian</option>
                <option value="Romanian">Romanian</option>
                <option value="Georgian">Georgian</option>
              </select>
              <button
                onClick={handleBulkTranslateAction}
                disabled={isBulkGenerating}
                className="flex items-center gap-1.5 px-4 py-2 hover:bg-amber-500 hover:text-white rounded-lg text-sm font-semibold text-amber-600 transition-all disabled:opacity-50"
              >
                <Globe size={16} /> Translate
              </button>
            </div>
            
            <button 
              onClick={() => setSelectedMatchIds(new Set())}
              className="ml-2 p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-full transition-colors"
            >
              <X size={20} />
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
