import React, { useState, useEffect, useRef } from "react";
import { useParams, Link } from "react-router-dom";
import {
  Search,
  ArrowLeft,
  Filter,
  Folder,
  ChevronRight,
  Target,
  Zap,
  CheckCircle,
  AlertCircle,
  Loader2,
  BrainCircuit,
  Languages,
  Milestone,
  FileCheck,
  ChevronDown,
  Briefcase,
  Target as TargetIcon,
  History,
  RefreshCw,
  Eye,
  FileText,
  X,
  Printer,
  Download,
  CheckCircle2,
  Wand2,
} from "lucide-react";
import clsx from "clsx";
import { api } from "../lib/api";
import {
  runMatchEngine,
  translateExpertData,
  renderExpertData,
  adaptExpertData,
} from "../lib/gemini";
import { generateReformatedCV } from "../lib/pdf";
import { useTasks } from "../lib/TasksContext";
import JSZip from "jszip";
import { saveAs } from "file-saver";
import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";
import { RegenerateCVModal } from "../components/RegenerateCVModal";
import { ModeAuditPanel } from "../components/ModeAuditPanel";
import { motion, AnimatePresence } from "motion/react";
import ReactQuill from "react-quill-new";
import "react-quill-new/dist/quill.snow.css";
import { generateCVHtml } from "../lib/htmlCV";
import { downloadHtmlAsPdf, downloadHtmlAsDocx } from "../lib/exportHtml";
import { buildModeAudit, resolveCvExpert } from "../lib/cvModes";

pdfjs.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

import { ALL_PRIMARY_POSITIONS } from "../lib/constants";

import { matchEngineGlobalState } from "../lib/matchEngineState";

export default function MatchEngine() {
  const { tenderId } = useParams();
  const [tender, setTender] = useState<any>(null);
  const [folderSelections, setFolderSelections] = useState<
    Record<string, string[]>
  >(() => {
    return matchEngineGlobalState[`matchEngine_folderSel_${tenderId}`] || {};
  });
  const [expertSelections, setExpertSelections] = useState<
    Record<string, any[]>
  >(() => {
    return matchEngineGlobalState[`matchEngine_expertSel_${tenderId}`] || {};
  });

  useEffect(() => {
    matchEngineGlobalState[`matchEngine_folderSel_${tenderId}`] =
      folderSelections;
  }, [folderSelections, tenderId]);

  useEffect(() => {
    matchEngineGlobalState[`matchEngine_expertSel_${tenderId}`] =
      expertSelections;
  }, [expertSelections, tenderId]);

  const [expertSearchQuery, setExpertSearchQuery] = useState<string>("");
  const [isExpertDropdownOpen, setIsExpertDropdownOpen] =
    useState<boolean>(false);

  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node)
      ) {
        setIsExpertDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const [activePositionId, setActivePositionId] = useState<string>(() => {
    return matchEngineGlobalState[`matchEngine_activePos_${tenderId}`] || "";
  });

  useEffect(() => {
    matchEngineGlobalState[`matchEngine_activePos_${tenderId}`] =
      activePositionId;
  }, [activePositionId, tenderId]);

  const [selectedPositionIds, setSelectedPositionIds] = useState<string[]>(
    () => {
      return (
        matchEngineGlobalState[`matchEngine_selectedPos_${tenderId}`] || []
      );
    },
  );
  const [matches, setMatches] = useState<any[]>(() => {
    return matchEngineGlobalState[`matchEngine_matches_${tenderId}`] || [];
  });
  const [allExperts, setAllExperts] = useState<any[]>([]);
  const [taxonomy, setTaxonomy] = useState<string[]>([]);
  const [expandedIds, setExpandedIds] = useState<string[]>([]);
  const [activeMatchTab, setActiveMatchTab] = useState<string>(() => {
    return matchEngineGlobalState[`matchEngine_activeTab_${tenderId}`] || "";
  });
  const [stage, setStage] = useState<1 | 2>(() => {
    return matchEngineGlobalState[`matchEngine_stage_${tenderId}`] || 1;
  });

  const [matchSearchQuery, setMatchSearchQuery] = useState("");
  const [matchSortBy, setMatchSortBy] = useState("score_desc");
  const [matchCurrentPage, setMatchCurrentPage] = useState(1);
  const matchesPerPage = 8;

  useEffect(() => {
    setMatchCurrentPage(1); // Reset page on tab/sort change
  }, [activeMatchTab, matchSortBy, matchSearchQuery]);

  useEffect(() => {
    matchEngineGlobalState[`matchEngine_matches_${tenderId}`] = matches;
  }, [matches, tenderId]);

  useEffect(() => {
    matchEngineGlobalState[`matchEngine_stage_${tenderId}`] = stage;
  }, [stage, tenderId]);

  useEffect(() => {
    matchEngineGlobalState[`matchEngine_selectedPos_${tenderId}`] =
      selectedPositionIds;
  }, [selectedPositionIds, tenderId]);

  useEffect(() => {
    matchEngineGlobalState[`matchEngine_activeTab_${tenderId}`] =
      activeMatchTab;
  }, [activeMatchTab, tenderId]);

  const { tasks, addTask, updateTask } = useTasks();

  const [cvs, setCvs] = useState<any[]>([]);
  const [targetLang, setTargetLang] = useState<{ [key: string]: string }>({});
  const [translatingId, setTranslatingId] = useState<string | null>(null);
  const [renderingId, setRenderingId] = useState<string | null>(null);
  const [adaptingId, setAdaptingId] = useState<string | null>(null);
  const [cvToRegenerate, setCvToRegenerate] = useState<any | null>(null);
  const [previewCv, setPreviewCv] = useState<any | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [numPages, setNumPages] = useState<number | null>(null);

  // Rich Text Editor State
  const [isEditingRichText, setIsEditingRichText] = useState(false);
  const [richTextContent, setRichTextContent] = useState("");

  const isMatching = tasks.some(
    (t) => t.type === "MATCH" && t.status === "running",
  );
  const generatingExpertIds = tasks
    .filter((t) => t.type === "GENERATE" && t.status === "running")
    .map((t) => t.message?.replace("Building CV for ", ""));

  useEffect(() => {
    fetchTenderAndExperts();
  }, [tenderId]);

  const fetchTenderAndExperts = async () => {
    try {
      const taxonomyFetch = await api.getTaxonomy();
      setTaxonomy(taxonomyFetch || ALL_PRIMARY_POSITIONS);

      const expertsData = await api.getExperts();
      setAllExperts(expertsData);

      const cvsData = await api.getCVs();
      setCvs(cvsData);

      const data = await api.getTender(tenderId!);
      setTender(data);
      if (data?.positions?.length > 0) {
        const firstPosId =
          data.positions[0].id?.toString() || data.positions[0].position_title;
        setSelectedPositionIds((prev) => (prev.length > 0 ? prev : []));
        setActivePositionId((prev) => prev || firstPosId);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const [selectedMatchIds, setSelectedMatchIds] = useState<string[]>([]);

  const toggleMatchSelection = (expertId: string) => {
    setSelectedMatchIds((prev) =>
      prev.includes(expertId)
        ? prev.filter((id) => id !== expertId)
        : [...prev, expertId],
    );
  };

  const toggleSelectAllMatches = (filteredMatches: any[]) => {
    if (selectedMatchIds.length === filteredMatches.length) {
      setSelectedMatchIds([]);
    } else {
      setSelectedMatchIds(filteredMatches.map((m) => m.expertId));
    }
  };

  const togglePosition = (posId: string) => {
    const isSelected = selectedPositionIds.includes(posId);

    if (isSelected) {
      setSelectedPositionIds([]);
      setFolderSelections({});
      setExpertSelections({});
      setActivePositionId("");
      setStage(1);
    } else {
      setSelectedPositionIds((prev) => [...prev, posId]);
    }
  };

  const handleGenerateCV = async (match: any) => {
    const expertIdToTrack = match.expertId;
    const taskId = addTask({
      type: "GENERATE",
      title: `Build CV: ${match.expertName}`,
      message: `Building CV for ${expertIdToTrack}`,
    });

    let currentPercent = 5;
    let currentEta = 15;
    const interval = setInterval(() => {
      currentPercent = Math.min(currentPercent + Math.random() * 8, 95);
      currentEta = Math.max(currentEta - 1, 1);
      updateTask(taskId, { percent: currentPercent, eta: currentEta });
    }, 1000);

    try {
      const experts = await api.getExperts();
      const expert = experts.find(
        (e) => e.id === match.expertId || e.name === match.expertName,
      );

      if (!expert) throw new Error("Expert data not found");

      const position_title = match.positionTitle;

      const doc = await generateReformatedCV({
        template: "General",
        branding: tender?.branding,
        expert: expert,
        position_title: position_title!,
      });

      // Save metadata
      await api.saveCV({
        expertId: match.expertId,
        expertName: match.expertName,
        tenderId: tender.id,
        tenderName: tender.name,
        positionId: match.positionId,
        positionTitle: match.positionTitle,
        language: "English",
        score: match.score,
        match_summary: match.match_summary,
        strong_points: match.strong_points,
        risk_level: match.risk_level,
        template: "General",
      });

      doc.save(
        `CV_${(match.expertName || "Unnamed").split(" ").join("_")}.pdf`,
      );

      const updatedCvs = await api.getCVs();
      setCvs(updatedCvs);

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
      updateTask(taskId, { status: "error", message: err.message });
      alert(err.message);
    }
  };

  const handleTranslateCV = async (cv: any) => {
    const lang = targetLang[cv.id];
    if (!lang) {
      alert("Please select a target language first.");
      return;
    }
    setTranslatingId(cv.id);
    try {
      if (cv.id && cv.id.startsWith("phantom-")) {
        await api.saveCV({
          expertId: cv.expertId,
          expertName: cv.expertName,
          tenderId: cv.tenderId,
          tenderName: cv.tenderName,
          positionId: cv.positionId,
          positionTitle: cv.positionTitle,
          language: "English",
          template: cv.template || "General",
        });
        api.getCVs().then(setCvs);
      }

      const experts = await api.getExperts();
      const baseExpert = experts.find(
        (e) => e.id === cv.expertId || e.name === cv.expertName,
      );
      const expertToTranslate = resolveCvExpert(cv, baseExpert);
      if (!expertToTranslate) {
        alert("Expert data missing. Cannot translate CV.");
        return;
      }
      const translatedExpert = await translateExpertData(expertToTranslate, lang);
      const doc = await generateReformatedCV({
        template: cv.template || "General",
        branding: cv.customBranding || tender?.branding,
        expert: translatedExpert,
        position_title: cv.positionTitle || cv.positionId,
      });
      const expertName =
        translatedExpert.fullName || translatedExpert.name || "Expert";
      doc.save(`${cv.template || "General"} - ${expertName} (${lang}).pdf`);
    } catch (err: any) {
      console.error(err);
      alert("Translation failed: " + err.message);
    } finally {
      setTranslatingId(null);
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
        api.getCVs().then(setCvs);
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
      const adaptedExpert = await adaptExpertData(
        expert,
        tender,
        currentCv.positionTitle || currentCv.positionId,
      );
      const doc = await generateReformatedCV({
        template: currentCv.template || "General",
        branding: currentCv.customBranding || tender?.branding,
        expert: adaptedExpert,
        position_title: currentCv.positionTitle || currentCv.positionId,
      });
      doc.save(
        `${currentCv.template || "General"} - ${adaptedExpert.fullName || adaptedExpert.name || "Expert"} (Adapted).pdf`,
      );

      // Update local storage with the AI-adapted version
      const modeAudit = buildModeAudit("ADAPT", expert, adaptedExpert, tender, currentCv.positionTitle || currentCv.positionId);
      await api.updateCV({
        ...currentCv,
        mode: "ADAPT",
        expertData: adaptedExpert,
        modeAudit,
        modeHistory: [...(currentCv.modeHistory || []), modeAudit],
        customRichText: undefined,
        isAdapted: true,
        isRendered: false,
      });
      api.getCVs().then(setCvs);
    } catch (err: any) {
      console.error(err);
      alert("Adaptation failed: " + err.message);
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
        api.getCVs().then(setCvs);
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
      const renderedExpert = await renderExpertData(
        expert,
        tender,
        currentCv.positionTitle || currentCv.positionId,
      );
      const doc = await generateReformatedCV({
        template: currentCv.template || "General",
        branding: currentCv.customBranding || tender?.branding,
        expert: renderedExpert,
        position_title: currentCv.positionTitle || currentCv.positionId,
      });
      doc.save(
        `${currentCv.template || "General"} - ${renderedExpert.fullName || renderedExpert.name || "Expert"} (Rendered).pdf`,
      );

      // Update local storage with the AI-rendered version
      const modeAudit = buildModeAudit("RENDER", expert, renderedExpert, tender, currentCv.positionTitle || currentCv.positionId);
      await api.updateCV({
        ...currentCv,
        mode: "RENDER",
        expertData: renderedExpert,
        modeAudit,
        modeHistory: [...(currentCv.modeHistory || []), modeAudit],
        customRichText: undefined,
        isAdapted: true,
        isRendered: true,
      });
      api.getCVs().then(setCvs);
    } catch (err: any) {
      console.error(err);
      alert("Render failed: " + err.message);
    } finally {
      setRenderingId(null);
    }
  };

  const confirmRegenerate = async (cvId: string, customBranding?: any) => {
    let cv = cvs.find((c) => c.id === cvId);
    if (!cv && cvId.startsWith("phantom-") && cvToRegenerate?.id === cvId) {
      cv = cvToRegenerate;
    }
    if (!cv) return;
    setCvToRegenerate(null);
    const taskId = addTask({
      type: "GENERATE",
      title: `Regenerating CV`,
      message: `ID: ${cvId}`,
    });
    let currentPercent = 5;
    const progressInterval = setInterval(() => {
      currentPercent = Math.min(currentPercent + Math.random() * 8, 95);
      updateTask(taskId, { percent: currentPercent, eta: 10 });
    }, 1000);
    try {
      const baseExpert = allExperts.find(
        (e) => e.id === cv.expertId || e.name === cv.expertName,
      );
      const expert = resolveCvExpert(cv, baseExpert);
      if (!expert) throw new Error("Expert data not found for regeneration");
      const doc = await generateReformatedCV({
        template: cv.template || "General",
        branding: customBranding || tender?.branding,
        expert: expert,
        position_title: cv.positionTitle || cv.positionId,
      });
      doc.save(
        `${cv.template || "General"} - ${cv.expertName || "Expert"} (Regenerated).pdf`,
      );

      if (customBranding) {
        const dbcv = await api
          .getCVs()
          .then((c) => c.find((x: any) => x.id === cvId));
        if (dbcv) {
          dbcv.customBranding = customBranding;
          await api.updateCV(dbcv);
        } else if (cvId.startsWith("phantom-")) {
          await api.saveCV({
            expertId: cv.expertId,
            expertName: cv.expertName,
            tenderId: cv.tenderId,
            tenderName: cv.tenderName,
            positionId: cv.positionId,
            positionTitle: cv.positionTitle,
            language: "English",
            template: cv.template || "General",
            customBranding: customBranding,
          });
          const updatedCvs = await api.getCVs();
          setCvs(updatedCvs);
        }
      } else if (cvId.startsWith("phantom-")) {
        await api.saveCV({
          expertId: cv.expertId,
          expertName: cv.expertName,
          tenderId: cv.tenderId,
          tenderName: cv.tenderName,
          positionId: cv.positionId,
          positionTitle: cv.positionTitle,
          language: "English",
          template: cv.template || "General",
        });
        const updatedCvs = await api.getCVs();
        setCvs(updatedCvs);
      }
      clearInterval(progressInterval);
      updateTask(taskId, {
        status: "completed",
        percent: 100,
        eta: 0,
        message: "CV Rebuilt and Downloaded",
      });
    } catch (err: any) {
      clearInterval(progressInterval);
      console.error(err);
      updateTask(taskId, { status: "error", message: err.message });
      alert("Regeneration failed: " + err.message);
    }
  };

  const handleDownloadDocx = async (cv: any) => {
    try {
      if (cv.customRichText) {
        downloadHtmlAsDocx(
          cv.customRichText,
          `CV_${cv.expertName || "Expert"}`,
        );
        return;
      }
      const baseExpert = allExperts.find(
        (e) => e.id === cv.expertId || e.name === cv.expertName,
      );
      const expert = resolveCvExpert(cv, baseExpert);
      if (!expert) {
        alert("Expert data missing. Cannot download CV.");
        return;
      }

      let currentCv = { ...cv };
      if (cv.id.startsWith("phantom-")) {
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
        api.getCVs().then(setCvs);
        if (res.success && res.cv) {
          currentCv = res.cv;
        }
      }
      const { generateDocxCV } = await import("../lib/docx");
      await generateDocxCV({
        template: currentCv.template || "General",
        expert,
        branding: currentCv.customBranding || tender?.branding,
        position_title: currentCv.positionTitle || currentCv.positionId,
      });
    } catch (err: any) {
      console.error(err);
      alert("Download failed: " + err.message);
    }
  };

  const handleDownloadPdf = async (cv: any) => {
    try {
      if (cv.customRichText) {
        await downloadHtmlAsPdf(
          cv.customRichText,
          `CV_${cv.expertName || "Expert"}`,
        );
        return;
      }
      const baseExpert = allExperts.find(
        (e) => e.id === cv.expertId || e.name === cv.expertName,
      );
      const expert = resolveCvExpert(cv, baseExpert);
      if (!expert) {
        alert("Expert data missing. Cannot download CV.");
        return;
      }
      let currentCv = { ...cv };
      if (cv.id.startsWith("phantom-")) {
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
        api.getCVs().then(setCvs);
        if (res.success && res.cv) {
          currentCv = res.cv;
        }
      }
      const doc = await generateReformatedCV({
        template: currentCv.template || "General",
        branding: currentCv.customBranding || tender?.branding,
        expert,
        position_title: currentCv.positionTitle || currentCv.positionId,
      });
      doc.save(
        `${currentCv.template || "General"} - ${currentCv.expertName || "Expert"}.pdf`,
      );
    } catch (err: any) {
      console.error(err);
      alert("Download failed: " + err.message);
    }
  };

  const handlePreview = async (cv: any) => {
    try {
      const baseExpert =
        allExperts.find(
          (e) => e.id === cv.expertId || e.name === cv.expertName,
        ) || {};
      const expert = resolveCvExpert(cv, baseExpert);

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
        api.getCVs().then(setCvs);
        if (res.success && res.cv) {
          currentCv = res.cv;
        }
      }

      setPreviewCv({ ...currentCv, expertData: expert });
      const doc = await generateReformatedCV({
        template: currentCv.template || "General",
        branding: currentCv.customBranding || tender?.branding,
        expert,
        position_title: currentCv.positionTitle || currentCv.positionId,
      });
      const pdfBlob = doc.output("blob");
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
      const updatedPreviewCv = {
        ...previewCv,
        customRichText: richTextContent,
      };
      setPreviewCv(updatedPreviewCv);

      // Save it to DB
      if (updatedPreviewCv.id) {
        updatedPreviewCv.customBranding =
          updatedPreviewCv.customBranding || undefined;
        await api.updateCV({ id: updatedPreviewCv.id, ...updatedPreviewCv });
        fetchTenderAndExperts(); // reload
      }
      setIsEditingRichText(false);
      handlePreview(updatedPreviewCv);
    } catch (err: any) {
      alert("Error saving rich text: " + err.message);
    }
  };

  const handleBulkAdapt = async () => {
    const targets =
      selectedMatchIds.length > 0
        ? matches.filter((m) => selectedMatchIds.includes(m.expertId))
        : matches;

    if (targets.length === 0) return;

    if (
      !window.confirm(
        `You are about to adapt ${targets.length} CVs using the AI engine. This might take several minutes depending on the number of candidates. Do you want to proceed?`,
      )
    )
      return;

    const taskId = addTask({
      type: "GENERATE",
      title: "Bulk Match Adaptation",
      message: `Adapting ${targets.length} CVs...`,
    });

    let currentPercent = 5;
    const interval = setInterval(() => {
      currentPercent = Math.min(currentPercent + Math.random() * 2, 90);
      updateTask(taskId, { percent: currentPercent, eta: targets.length * 10 });
    }, 2000);

    try {
      const experts = await api.getExperts();

      for (let i = 0; i < targets.length; i++) {
        const match = targets[i];

        let cv = cvs.find(
          (c) =>
            c.expertId === match.expertId &&
            c.tenderId === tender?.id &&
            c.positionId === match.positionId,
        );

        if (!cv) {
          const saved = await api.saveCV({
            expertId: match.expertId,
            expertName: match.expertName,
            tenderId: tender?.id,
            tenderName: tender?.name,
            positionId: match.positionId,
            positionTitle: match.positionTitle,
            language: "English",
            template: "General",
          });
          cv = saved.cv || saved;
        }

        const expert = experts.find(
          (e: any) => e.id === match.expertId || e.name === match.expertName,
        );
        if (expert) {
          updateTask(taskId, {
            message: `Adapting ${match.expertName || match.expertId}... (${i + 1}/${targets.length})`,
          });
          const adaptedExpert = await adaptExpertData(
            expert,
            tender,
            match.positionTitle || match.positionId,
          );
          const modeAudit = buildModeAudit("ADAPT", expert, adaptedExpert, tender, match.positionTitle || match.positionId);
          await api.updateCV({
            ...cv,
            mode: "ADAPT",
            customBranding: cv.customBranding || undefined,
            expertData: adaptedExpert,
            modeAudit,
            modeHistory: [...(cv.modeHistory || []), modeAudit],
            customRichText: undefined,
            isAdapted: true,
            isRendered: false,
          });
        }
      }

      const updatedCvs = await api.getCVs();
      setCvs(updatedCvs);

      clearInterval(interval);
      updateTask(taskId, {
        status: "completed",
        percent: 100,
        eta: 0,
        message: "Bulk Adaptation Complete",
      });
      alert(`Successfully adapted ${targets.length} CVs.`);
    } catch (err: any) {
      clearInterval(interval);
      console.error(err);
      updateTask(taskId, { status: "error", message: err.message });
      alert("Failed to adapt batch: " + err.message);
    }
  };

  const handleBulkRender = async () => {
    const targets =
      selectedMatchIds.length > 0
        ? matches.filter((m) => selectedMatchIds.includes(m.expertId))
        : matches;

    if (targets.length === 0) return;

    if (
      !window.confirm(
        `You are about to render and intelligently fill ${targets.length} CVs using the AI engine. This might take several minutes depending on the number of candidates. Do you want to proceed?`,
      )
    )
      return;

    const taskId = addTask({
      type: "GENERATE",
      title: "Bulk Match Render",
      message: `Rendering ${targets.length} CVs...`,
    });

    let currentPercent = 5;
    const interval = setInterval(() => {
      currentPercent = Math.min(currentPercent + Math.random() * 2, 90);
      updateTask(taskId, { percent: currentPercent, eta: targets.length * 10 });
    }, 2000);

    try {
      const experts = await api.getExperts();

      for (let i = 0; i < targets.length; i++) {
        const match = targets[i];

        let cv = cvs.find(
          (c) =>
            c.expertId === match.expertId &&
            c.tenderId === tender?.id &&
            c.positionId === match.positionId,
        );

        if (!cv) {
          const saved = await api.saveCV({
            expertId: match.expertId,
            expertName: match.expertName,
            tenderId: tender?.id,
            tenderName: tender?.name,
            positionId: match.positionId,
            positionTitle: match.positionTitle,
            language: "English",
            template: "General",
          });
          cv = saved.cv || saved;
        }

        const expert = experts.find(
          (e: any) => e.id === match.expertId || e.name === match.expertName,
        );
        if (expert) {
          updateTask(taskId, {
            message: `Rendering ${match.expertName || match.expertId}... (${i + 1}/${targets.length})`,
          });
          const renderedExpert = await renderExpertData(
            expert,
            tender,
            match.positionTitle || match.positionId,
          );
          const modeAudit = buildModeAudit("RENDER", expert, renderedExpert, tender, match.positionTitle || match.positionId);
          await api.updateCV({
            ...cv,
            mode: "RENDER",
            customBranding: cv.customBranding || undefined,
            expertData: renderedExpert,
            modeAudit,
            modeHistory: [...(cv.modeHistory || []), modeAudit],
            customRichText: undefined,
            isAdapted: true,
            isRendered: true,
          });
        }
      }

      const updatedCvs = await api.getCVs();
      setCvs(updatedCvs);

      clearInterval(interval);
      updateTask(taskId, {
        status: "completed",
        percent: 100,
        eta: 0,
        message: "Bulk Render Complete",
      });
      alert(`Successfully rendered ${targets.length} CVs.`);
    } catch (err: any) {
      clearInterval(interval);
      console.error(err);
      updateTask(taskId, { status: "error", message: err.message });
      alert("Failed to render batch: " + err.message);
    }
  };

  const handleBulkGenerate = async () => {
    const targets =
      selectedMatchIds.length > 0
        ? matches.filter((m) => selectedMatchIds.includes(m.expertId))
        : matches;

    if (targets.length === 0) return;

    const taskId = addTask({
      type: "GENERATE",
      title: "Bulk CV Compilation",
      message: `Building ${targets.length} CVs...`,
    });

    let currentPercent = 5;
    const interval = setInterval(() => {
      currentPercent = Math.min(currentPercent + Math.random() * 5, 90);
      updateTask(taskId, {
        percent: currentPercent,
        eta: Math.max(targets.length * 2 - Math.floor(currentPercent / 5), 1),
      });
    }, 1500);

    try {
      const zip = new JSZip();
      const experts = await api.getExperts();

      for (let i = 0; i < targets.length; i++) {
        const match = targets[i];
        const expert = experts.find(
          (e: any) => e.id === match.expertId || e.name === match.expertName,
        );
        if (expert) {
          const position_title = match.positionTitle;
          const doc = await generateReformatedCV({
            template: "General",
            branding: tender?.branding,
            expert: expert,
            position_title: position_title!,
          });
          const pdfBlob = doc.output("blob");
          zip.file(
            `CV_${(match.expertName || "Unnamed").split(" ").join("_")}_${(position_title || "Role").split(" ").join("_")}.pdf`,
            pdfBlob,
          );

          await api.saveCV({
            expertId: match.expertId,
            expertName: match.expertName,
            tenderId: tender.id,
            tenderName: tender.name,
            positionId: match.positionId,
            positionTitle: position_title,
            language: "English",
            score: match.score,
            match_summary: match.match_summary,
            strong_points: match.strong_points,
            risk_level: match.risk_level,
            template: "General",
          });
        }
      }

      const zipBlob = await zip.generateAsync({ type: "blob" });
      saveAs(zipBlob, `${tender.name}_CV_Batch.zip`);

      const updatedCvs = await api.getCVs();
      setCvs(updatedCvs);

      clearInterval(interval);
      updateTask(taskId, {
        status: "completed",
        percent: 100,
        eta: 0,
        message: "Batch CV Package Generated",
      });
    } catch (err: any) {
      clearInterval(interval);
      console.error(err);
      updateTask(taskId, { status: "error", message: err.message });
      alert("Failed to build batch: " + err.message);
    }
  };

  const toggleFolder = (folderId: string) => {
    if (selectedPositionIds.length === 0) return;

    setFolderSelections((prev) => {
      const referenceId =
        activePositionId && selectedPositionIds.includes(activePositionId)
          ? activePositionId
          : selectedPositionIds[0];
      const referenceFolders = prev[referenceId] || [];
      const isAdding = !referenceFolders.includes(folderId);

      const next = { ...prev };
      for (const posId of selectedPositionIds) {
        const current = next[posId] || [];
        if (isAdding) {
          if (!current.includes(folderId)) {
            next[posId] = [...current, folderId];
          }
        } else {
          next[posId] = current.filter((f) => f !== folderId);
        }
      }
      return next;
    });
  };

  const handleRunMatch = async () => {
    // Ensure all selected positions have at least one folder OR expert selected
    const missingFolders = selectedPositionIds.some((posId) => {
      const hasFolder =
        folderSelections[posId] && folderSelections[posId].length > 0;
      const hasExpert =
        expertSelections[posId] && expertSelections[posId].length > 0;
      return !hasFolder && !hasExpert;
    });
    if (selectedPositionIds.length === 0 || missingFolders) return;

    setStage(2);

    const taskId = addTask({
      type: "MATCH",
      title: `Matching for ${selectedPositionIds.length} roles`,
      message: "Processing Technical Neural Matrix...",
    });

    let currentPercent = 5;
    let currentEta = 30 * selectedPositionIds.length;
    const interval = setInterval(() => {
      currentPercent = Math.min(
        currentPercent + Math.random() * (5 / selectedPositionIds.length),
        95,
      );
      currentEta = Math.max(currentEta - 1, 1);
      updateTask(taskId, { percent: currentPercent, eta: currentEta });
    }, 1000);

    try {
      let allMatches: any[] = [];

      for (const posId of selectedPositionIds) {
        // Filter experts by selected folders specifically for this position
        const foldersForPos = folderSelections[posId] || [];
        const expertsForPos = expertSelections[posId] || [];

        const getExpertFolder = (expert: any) => {
          if (!expert.role) return "Others";
          const lowerRole = expert.role.toLowerCase();
          if (taxonomy.some((t) => t.toLowerCase() === lowerRole))
            return expert.role;
          return "Others";
        };

        const filteredPool = allExperts.filter((e) => {
          if (expertsForPos.some((ex) => ex.id === e.id)) return true;

          const eFolder = getExpertFolder(e);

          const folderIsSelected = foldersForPos.some((f) => {
            const fLower = f.toLowerCase();
            if (fLower === "others") return eFolder === "Others";
            return fLower === eFolder.toLowerCase();
          });

          if (folderIsSelected) {
            const explicitFromThisFolder = expertsForPos.some((ex) => {
              return getExpertFolder(ex) === eFolder;
            });
            if (!explicitFromThisFolder) return true;
          }

          return false;
        });

        // Stage 2: AI Scored Match
        const results = await runMatchEngine(tender, posId, filteredPool);

        const currentRole = tender.positions?.find(
          (p: any) => p.id?.toString() === posId || p.position_title === posId,
        );
        const position_title = currentRole?.position_title || posId;

        // Save results to API
        const matchesWithTender = results.map((r) => ({
          ...r,
          tenderName: tender.name,
          positionTitle: position_title,
          positionId: posId,
        }));
        await api.saveMatches(
          tenderId!,
          posId,
          position_title,
          matchesWithTender,
        );
        allMatches = [...allMatches, ...matchesWithTender];
      }

      allMatches.sort((a, b) => b.score - a.score);
      setMatches(allMatches);

      clearInterval(interval);
      updateTask(taskId, {
        status: "completed",
        percent: 100,
        eta: 0,
        message: "Matches compiled successfully",
      });
    } catch (err: any) {
      clearInterval(interval);
      console.error(err);
      updateTask(taskId, { status: "error", message: err.message });
    }
  };

  const metConstraints = React.useMemo(() => {
    const met = new Set<string>();
    cvs.forEach((cv: any) => {
      // Find the match corresponding to this generated CV
      const originalMatch = matches.find(
        (m) =>
          m.expertId === cv.expertId &&
          (m.positionId === cv.positionId ||
            m.positionTitle === cv.positionTitle),
      );
      if (originalMatch?.met_team_constraints) {
        originalMatch.met_team_constraints.forEach((c: string) => met.add(c));
      }
    });
    return met;
  }, [cvs, matches]);

  const matchGroups = React.useMemo(() => {
    return matches.reduce(
      (acc, match) => {
        const folder = match.positionTitle || "Uncategorized";
        if (!acc[folder]) acc[folder] = [];
        acc[folder].push(match);
        return acc;
      },
      {} as Record<string, any[]>,
    );
  }, [matches]);

  const matchTabs = Object.keys(matchGroups);

  React.useEffect(() => {
    if (
      matchTabs.length > 0 &&
      (!activeMatchTab || !matchTabs.includes(activeMatchTab))
    ) {
      setActiveMatchTab(matchTabs[0]);
    }
  }, [matchTabs, activeMatchTab]);

  if (!tender)
    return (
      <div className="flex h-96 items-center justify-center">
        <Loader2 className="text-blue-600 animate-spin" size={48} />
      </div>
    );

  const currentRole = tender.positions?.find(
    (p: any) =>
      p.id?.toString() === activePositionId ||
      p.position_title === activePositionId,
  );
  const activeMatchTask = tasks.find(
    (t) => t.type === "MATCH" && t.status === "running",
  );

  const activeGroup =
    activeMatchTab && matchGroups[activeMatchTab]
      ? matchGroups[activeMatchTab]
      : [];

  const filteredMatches = activeGroup.filter((m: any) => {
    if (!matchSearchQuery) return true;
    const searchLower = matchSearchQuery.toLowerCase();
    return (
      (m.expertName || "").toLowerCase().includes(searchLower) ||
      (m.expertId || "").toLowerCase().includes(searchLower)
    );
  });

  const sortedMatches = [...filteredMatches].sort((a: any, b: any) => {
    if (matchSortBy === "score_desc") return b.score - a.score;
    if (matchSortBy === "score_asc") return a.score - b.score;
    if (matchSortBy === "name_asc")
      return (a.expertName || "").localeCompare(b.expertName || "");
    return 0;
  });

  const matchTotalPages = Math.ceil(sortedMatches.length / matchesPerPage) || 1;
  const paginatedMatches = sortedMatches.slice(
    (matchCurrentPage - 1) * matchesPerPage,
    matchCurrentPage * matchesPerPage,
  );

  return (
    <div className="space-y-6 max-w-full w-full mx-auto pb-32">
      {/* Header Navigation */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link
            to="/tenders"
            className="w-10 h-10 flex items-center justify-center bg-white border border-slate-200 rounded-lg text-slate-400 hover:text-blue-600 hover:border-blue-200 shadow-sm transition-all active:scale-95"
          >
            <ArrowLeft size={20} />
          </Link>
          <div>
            <h2 className="text-2xl font-bold text-slate-900">{tender.name}</h2>
            <p className="text-sm text-slate-500 mt-1">
              Intelligent Match Engine: {tender.client}
            </p>
          </div>
        </div>
      </div>
      <div className="grid grid-cols-12 gap-12">
        {/* Left: Requirements & Stage 1 Selection */}
        <div className="col-span-12 xl:col-span-4 space-y-10">
          {/* Position Selection */}
          <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-6">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-lg font-semibold text-slate-900 flex items-center gap-2">
                <Target size={20} className="text-blue-500" />
                Select Target Roles
              </h3>
              <button
                onClick={() => {
                  if (stage === 2) setStage(1);
                  const allIds =
                    tender.positions?.map(
                      (p: any) => p.id?.toString() || p.position_title,
                    ) || [];
                  if (selectedPositionIds.length === allIds.length) {
                    setSelectedPositionIds([]);
                    setFolderSelections({}); // Clear all folders when clearing all roles
                    setExpertSelections({});
                  } else {
                    setSelectedPositionIds(allIds);
                  }
                }}
                className="text-sm font-medium text-blue-600 hover:bg-blue-50 px-2 py-1 rounded-lg transition-colors"
              >
                {selectedPositionIds.length === (tender.positions?.length || 0)
                  ? "Clear"
                  : "Select All"}
              </button>
            </div>
            <div className="space-y-3 max-h-[400px] overflow-y-auto custom-scrollbar pr-2">
              {tender.positions?.map((p: any) => {
                const posId = p.id?.toString() || p.position_title;
                return (
                  <div
                    key={p.position_title}
                    onClick={() => {
                      if (stage === 2) {
                        setStage(1);
                        // Optionally clear matches or keep them until new generation
                      }
                      setActivePositionId(posId);
                      if (!selectedPositionIds.includes(posId)) {
                        togglePosition(posId);
                      }
                    }}
                    className={clsx(
                      "w-full text-left p-4 rounded-xl border transition-all cursor-pointer group focus:outline-none flex items-start gap-3",
                      activePositionId === posId &&
                        selectedPositionIds.includes(posId)
                        ? "ring-2 ring-slate-400 ring-offset-2"
                        : "",
                      selectedPositionIds.includes(posId)
                        ? "bg-slate-900 border-slate-900 text-white shadow-md shadow-slate-900/10"
                        : "bg-white border-slate-200 text-slate-600 hover:border-slate-300 hover:bg-slate-50",
                    )}
                  >
                    <div
                      className="pt-0.5"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <input
                        type="checkbox"
                        className={clsx(
                          "w-4 h-4 cursor-pointer rounded text-blue-600 focus:outline-none border border-slate-300",
                          selectedPositionIds.includes(posId)
                            ? "accent-white bg-white/20 border-white/50"
                            : "accent-blue-600",
                        )}
                        checked={selectedPositionIds.includes(posId)}
                        onChange={(e) => {
                          if (stage === 2) setStage(1);
                          togglePosition(posId);
                          if (e.target.checked) setActivePositionId(posId);
                          else if (activePositionId === posId)
                            setActivePositionId("");
                        }}
                      />
                    </div>
                    <div className="flex-1 w-full min-w-0">
                      <div className="flex justify-between items-start mb-2">
                        <span className="font-medium text-[15px] leading-tight pr-2">
                          {p.position_title}
                        </span>
                        <span
                          className={clsx(
                            "text-[11px] px-2 py-0.5 rounded-md font-medium shrink-0",
                            selectedPositionIds.includes(posId)
                              ? "bg-white/20 text-white"
                              : "bg-slate-100 text-slate-500",
                          )}
                        >
                          Qty: {p.quantity || 1}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span
                          className={clsx(
                            "text-xs",
                            selectedPositionIds.includes(posId)
                              ? "text-slate-300"
                              : "text-slate-400 group-hover:text-blue-500",
                          )}
                        >
                          Req. Exp: {p.minimum_years_experience || "8+"} Years
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Role Configuration Detail */}
          {currentRole && (
            <div className="bg-slate-900 border border-slate-800 text-white rounded-xl shadow-lg p-6 relative overflow-hidden group">
              <div className="absolute top-0 right-0 w-32 h-32 bg-blue-500/10 blur-3xl rounded-full translate-x-10 -translate-y-10"></div>
              <h3 className="text-sm font-medium text-blue-400 mb-6">
                Requirement Protocol
              </h3>
              <div className="space-y-6 relative z-10 w-full overflow-hidden">
                <div className="flex gap-4">
                  <div className="w-10 h-10 rounded-lg bg-slate-800 border border-slate-700 flex items-center justify-center flex-shrink-0">
                    <Milestone size={18} className="text-blue-400" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-medium text-slate-400 mb-1">
                      Education Matrix
                    </p>
                    <p
                      className="text-sm font-medium text-white truncate"
                      title={
                        currentRole.minimum_education ||
                        "Standard Degree Requirement"
                      }
                    >
                      {currentRole.minimum_education ||
                        "Standard Degree Requirement"}
                    </p>
                  </div>
                </div>

                <div className="flex gap-4">
                  <div className="w-10 h-10 rounded-lg bg-slate-800 border border-slate-700 flex items-center justify-center flex-shrink-0">
                    <Languages size={18} className="text-blue-400" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-medium text-slate-400 mb-1">
                      Linguistic Profile
                    </p>
                    <p className="text-sm font-medium text-white truncate">
                      English,{" "}
                      {currentRole.nationality_preference === "Omani"
                        ? "Arabic (Native)"
                        : "Arabic (Optional)"}
                    </p>
                  </div>
                </div>

                <div>
                  <p className="text-xs font-medium text-slate-400 mb-3 flex items-center gap-2">
                    <Zap size={14} className="text-blue-400" />
                    Extraction Targets
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {currentRole.required_keywords?.map((k: string) => (
                      <span
                        key={k}
                        className="text-[12px] font-medium bg-slate-800 border border-slate-700 text-slate-300 px-2 py-1 rounded-md"
                      >
                        {k}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
        {/* Right: Engine Execution and Results */}
        <div className="col-span-12 xl:col-span-8 space-y-12">
          {/* Stage 1 Folder Selection */}
          <div
            className={clsx(
              "bg-white border border-slate-200 rounded-xl shadow-sm p-8 transition-all duration-700",
              stage === 2 &&
                "opacity-50 blur-[1px] pointer-events-none scale-[0.99]",
            )}
          >
            <div className="flex items-start justify-between mb-8">
              <div>
                <h3 className="text-lg font-semibold text-slate-900 mb-1 flex items-center gap-2">
                  <Filter size={18} className="text-blue-600" />
                  Select Candidate Pools
                </h3>
                <p className="text-sm text-slate-500">
                  Pick which expert folders to scan. Filtering pools improves
                  accuracy and reduces process time.
                </p>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() =>
                    activePositionId &&
                    selectedPositionIds.includes(activePositionId) &&
                    setFolderSelections((prev) => ({
                      ...prev,
                      [activePositionId]: [...taxonomy, "Others"],
                    }))
                  }
                  disabled={
                    !activePositionId ||
                    !selectedPositionIds.includes(activePositionId)
                  }
                  className="text-sm font-medium text-blue-600 hover:bg-blue-50 px-3 py-1.5 rounded-lg transition-colors border border-transparent hover:border-blue-100 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Select All
                </button>
                <button
                  onClick={() =>
                    activePositionId &&
                    selectedPositionIds.includes(activePositionId) &&
                    setFolderSelections((prev) => ({
                      ...prev,
                      [activePositionId]: [],
                    }))
                  }
                  disabled={
                    !activePositionId ||
                    !selectedPositionIds.includes(activePositionId)
                  }
                  className="text-sm font-medium text-slate-500 hover:bg-slate-50 px-3 py-1.5 rounded-lg transition-colors border border-transparent hover:border-slate-200 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Clear
                </button>
              </div>
            </div>

            <>
              {(() => {
                const referenceId =
                  activePositionId && selectedPositionIds.includes(activePositionId)
                    ? activePositionId
                    : selectedPositionIds[0];
                const activeFolders = referenceId ? folderSelections[referenceId] || [] : [];
                const activeSpecificExperts = referenceId ? expertSelections[referenceId] || [] : [];
                const isDisabled = selectedPositionIds.length === 0;

                return (
                  <>
                    <div className="text-sm text-slate-500 mb-4 bg-blue-50 text-blue-700 px-3 py-2 rounded-lg flex flex-wrap items-center gap-2 border border-blue-100">
                      <span>Configuring target pools for:</span>
                      <strong>
                        {selectedPositionIds.length > 1
                          ? tender.positions?.filter((p: any) => selectedPositionIds.includes(p.id?.toString() || p.position_title)).map((p: any) => p.position_title).join(', ')
                          : currentRole?.position_title || activePositionId || "No role selected"}
                      </strong>
                      {(activeFolders.length > 0 || activeSpecificExperts.length > 0) && (
                        <>
                          <div className="h-4 w-px bg-blue-300 rounded-full mx-1"></div>
                          {activeFolders.length > 0 && (
                            <span className="bg-blue-100 text-blue-800 px-2 py-0.5 rounded-md text-xs font-bold">
                              {activeFolders.length} Folder{activeFolders.length !== 1 ? 's' : ''}
                            </span>
                          )}
                          {activeSpecificExperts.length > 0 && (
                            <span className="bg-blue-100 text-blue-800 px-2 py-0.5 rounded-md text-xs font-bold">
                              {activeSpecificExperts.length} Specific Expert{activeSpecificExperts.length !== 1 ? 's' : ''}
                            </span>
                          )}
                        </>
                      )}
                    </div>
                    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                      {(() => {
                        const foldersWithCounts = [...taxonomy, "Others"].map((pos) => {
                      let count = 0;
                      if (pos === "Others") {
                        count = allExperts.filter(
                          (e) =>
                            !taxonomy
                              .map((t) => t.toLowerCase())
                              .includes((e.role || "").toLowerCase()),
                        ).length;
                      } else {
                        count = allExperts.filter(
                          (e) =>
                            (e.role || "").toLowerCase() === pos.toLowerCase(),
                        ).length;
                      }
                      return { pos, count };
                    },
                  );

                  foldersWithCounts.sort((a, b) => {
                    if (a.count > 0 && b.count === 0) return -1;
                    if (a.count === 0 && b.count > 0) return 1;
                    return 0;
                  });

                  return foldersWithCounts.map(({ pos, count }) => (
                    <button
                      key={pos}
                      disabled={isDisabled}
                      onClick={() => toggleFolder(pos)}
                      className={clsx(
                        "group flex items-start gap-3 p-4 rounded-xl border text-left transition-all",
                        isDisabled
                          ? "opacity-50 cursor-not-allowed bg-slate-50 border-slate-200"
                          : "active:scale-95",
                        !isDisabled && activeFolders.includes(pos)
                          ? "bg-slate-900 border-slate-900 text-white shadow-md shadow-slate-900/10"
                          : !isDisabled && count > 0
                            ? "bg-[#e0f2fe] border-[#bae6fd] hover:border-blue-300 hover:bg-[#bae6fd]"
                            : "bg-white border-slate-200 hover:border-blue-300 hover:bg-slate-50",
                      )}
                    >
                      <Folder
                        size={20}
                        className={clsx(
                          "flex-shrink-0 mt-0.5",
                          !isDisabled && activeFolders.includes(pos)
                            ? "text-white fill-white/10"
                            : count > 0
                              ? "text-sky-500 fill-sky-500/20"
                              : "text-slate-400",
                        )}
                      />
                      <div>
                        <span
                          className={clsx(
                            "block text-sm font-medium leading-snug",
                            !isDisabled && activeFolders.includes(pos)
                              ? "text-white"
                              : count > 0
                                ? "text-sky-900"
                                : "text-slate-700",
                          )}
                        >
                          {pos}
                        </span>
                        <span
                          className={clsx(
                            "block text-xs mt-1 font-medium",
                            !isDisabled && activeFolders.includes(pos)
                              ? "text-slate-300"
                              : count > 0
                                ? "text-sky-700"
                                : "text-slate-500",
                          )}
                        >
                          {count} candidates
                        </span>
                      </div>
                    </button>
                  ));
                })()}
              </div>
            </>
          );
        })()}
            </>
            {selectedPositionIds.length > 0 && (
              <div className="mt-8 border-t border-slate-100 pt-6">
                <h4 className="text-sm font-semibold text-slate-700 mb-2">
                  Or Add Specific Experts
                </h4>
                <div className="relative" ref={dropdownRef}>
                  <div className="relative w-full max-w-md">
                    <input
                      type="text"
                      placeholder="Search and select expert..."
                      value={expertSearchQuery}
                      onChange={(e) => {
                        setExpertSearchQuery(e.target.value);
                        setIsExpertDropdownOpen(true);
                      }}
                      onFocus={() => setIsExpertDropdownOpen(true)}
                      className="w-full pl-3 pr-8 py-2 border border-slate-200 rounded-lg text-sm bg-slate-50 focus:bg-white focus:ring-2 focus:ring-blue-500 focus:outline-none cursor-pointer"
                    />
                    <svg
                      onClick={() =>
                        setIsExpertDropdownOpen(!isExpertDropdownOpen)
                      }
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 cursor-pointer pointer-events-auto"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M19 9l-7 7-7-7"
                      />
                    </svg>
                  </div>
                  {isExpertDropdownOpen && (
                    <div className="absolute z-10 w-full max-w-md mt-1 bg-white border border-slate-200 rounded-lg shadow-lg max-h-60 overflow-auto">
                      {(() => {
                        const referenceId =
                          activePositionId &&
                          selectedPositionIds.includes(activePositionId)
                            ? activePositionId
                            : selectedPositionIds[0];
                        const activeFolders = referenceId
                          ? folderSelections[referenceId] || []
                          : [];
                        let pool = allExperts;
                        if (activeFolders.length > 0) {
                          pool = allExperts.filter((e) => {
                            if (activeFolders.includes("Others")) {
                              if (
                                !e.role ||
                                !taxonomy
                                  .map((t) => t.toLowerCase())
                                  .includes((e.role || "").toLowerCase())
                              )
                                return true;
                            }
                            return activeFolders.includes(e.role);
                          });
                        }
                        const filtered = pool
                          .filter((e) =>
                            (e.name || e.fullName || "")
                              .toLowerCase()
                              .includes(expertSearchQuery.toLowerCase()),
                          )
                          .slice(0, 50);
                        if (filtered.length === 0)
                          return (
                            <div className="px-3 py-2 text-sm text-slate-500">
                              No matching experts found
                            </div>
                          );
                        return filtered.map((ex) => (
                          <button
                            key={ex.id}
                            onClick={() => {
                              setExpertSelections((prev) => {
                                if (selectedPositionIds.length === 0)
                                  return prev;
                                const next = { ...prev };
                                for (const posId of selectedPositionIds) {
                                  const curr = next[posId] || [];
                                  if (!curr.find((x) => x.id === ex.id)) {
                                    next[posId] = [...curr, ex];
                                  }
                                }
                                return next;
                              });
                              setExpertSearchQuery("");
                              setIsExpertDropdownOpen(false);
                            }}
                            className="w-full text-left px-3 py-2 text-sm hover:bg-slate-50 border-b border-slate-50 last:border-0"
                          >
                            <div className="font-medium text-slate-900">
                              {ex.name || ex.fullName}
                            </div>
                            <div className="text-xs text-slate-500">
                              {ex.role || "Uncategorized"}
                            </div>
                          </button>
                        ));
                      })()}
                    </div>
                  )}
                </div>
                {(() => {
                  const referenceId =
                    activePositionId &&
                    selectedPositionIds.includes(activePositionId)
                      ? activePositionId
                      : selectedPositionIds[0];
                  return (
                    (expertSelections[referenceId] || []).length > 0 && (
                      <div className="flex flex-wrap gap-2 mt-4">
                        {(expertSelections[referenceId] || []).map((ex) => (
                          <div
                            key={ex.id}
                            className="flex items-center gap-2 px-3 py-1.5 bg-blue-50 border border-blue-100 text-blue-800 rounded-full text-sm font-medium"
                          >
                            <span>{ex.name || ex.fullName}</span>
                            <button
                              onClick={() =>
                                setExpertSelections((prev) => {
                                  if (selectedPositionIds.length === 0)
                                    return prev;
                                  const next = { ...prev };
                                  for (const posId of selectedPositionIds) {
                                    if (next[posId]) {
                                      next[posId] = next[posId].filter(
                                        (x) => x.id !== ex.id,
                                      );
                                    }
                                  }
                                  return next;
                                })
                              }
                              className="text-blue-500 hover:text-blue-700 font-bold ml-1 rounded-full w-4 h-4 flex items-center justify-center leading-none bg-blue-200/50"
                            >
                              ×
                            </button>
                          </div>
                        ))}
                      </div>
                    )
                  );
                })()}
              </div>
            )}

            <div className="mt-8 pt-6 border-t border-slate-100 flex justify-end">
              <button
                onClick={handleRunMatch}
                disabled={
                  isMatching ||
                  selectedPositionIds.length === 0 ||
                  selectedPositionIds.some((posId) => {
                    const hasFolder =
                      folderSelections[posId] &&
                      folderSelections[posId].length > 0;
                    const hasExpert =
                      expertSelections[posId] &&
                      expertSelections[posId].length > 0;
                    return !hasFolder && !hasExpert;
                  })
                }
                className="flex items-center gap-2 px-6 py-2.5 bg-[#2563eb] hover:bg-blue-700 text-white rounded-lg font-medium shadow-sm transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isMatching ? (
                  <Loader2 size={18} className="animate-spin" />
                ) : (
                  <BrainCircuit size={18} />
                )}
                <span>Run Match Engine</span>
              </button>
            </div>
          </div>
        </div>{" "}
        {/* End right col */}
      </div>{" "}
      {/* End first grid */}
      {/* STAGE 2 ROW */}
      <div className="grid grid-cols-12 gap-12 mt-4 pt-8">
        <div className="col-span-12 xl:col-span-4">
          {/* STAGE 2 LEFT: Position Tabs */}
          {(isMatching || matches.length > 0) && !isMatching && (
            <div className="space-y-4 animate-in">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold text-slate-900 flex items-center gap-2">
                  <Zap size={20} className="text-blue-500" />
                  AI Match Results
                </h3>
              </div>
              <div className="bg-white border text-sm border-slate-200 rounded-xl shadow-sm p-3 sticky top-6 max-h-[80vh] overflow-y-auto w-full">
                <h4 className="font-semibold text-slate-700 mb-3 px-2 border-b border-slate-100 pb-2 flex items-center gap-2">
                  <Briefcase size={16} className="text-blue-500" /> Positions
                </h4>
                <div className="space-y-1">
                  {matchTabs.map((tab) => (
                    <button
                      key={tab}
                      onClick={() => setActiveMatchTab(tab)}
                      className={clsx(
                        "w-full text-left px-3 py-2.5 rounded-lg font-medium transition-colors flex items-center justify-between",
                        activeMatchTab === tab
                          ? "bg-blue-50 text-blue-700 shadow-sm border border-blue-100"
                          : "text-slate-600 hover:bg-slate-50 border border-transparent",
                      )}
                    >
                      <span className="truncate pr-2">{tab}</span>
                      <span
                        className={clsx(
                          "px-2 py-0.5 rounded-full text-xs shrink-0",
                          activeMatchTab === tab
                            ? "bg-blue-100 text-blue-700"
                            : "bg-slate-100 text-slate-500",
                        )}
                      >
                        {matchGroups[tab].length}
                      </span>
                    </button>
                  ))}
                </div>

                {tender?.global_team_constraints &&
                  tender.global_team_constraints.length > 0 && (
                    <div className="mt-8 pt-6 border-t border-slate-100">
                      <h4 className="font-semibold text-slate-700 mb-3 px-2 flex items-center gap-2">
                        <CheckCircle size={16} className="text-emerald-500" />{" "}
                        Team Requirements
                      </h4>
                      <p className="text-xs text-slate-500 px-2 mb-4 leading-relaxed">
                        These are global constraints required by the tender.
                        Assigning candidates who meet these criteria will
                        automatically check them off.
                      </p>
                      <div className="space-y-2 px-2">
                        {tender.global_team_constraints.map(
                          (constraint: string, idx: number) => {
                            const isMet = metConstraints.has(constraint);
                            return (
                              <div
                                key={idx}
                                className={clsx(
                                  "flex items-start gap-2 p-3 rounded-lg border",
                                  isMet
                                    ? "bg-emerald-50 border-emerald-100 text-emerald-800"
                                    : "bg-slate-50 border-slate-200 text-slate-600",
                                )}
                              >
                                {isMet ? (
                                  <CheckCircle2
                                    size={16}
                                    className="text-emerald-500 shrink-0 mt-0.5"
                                  />
                                ) : (
                                  <div className="w-4 h-4 rounded-full border-2 border-slate-300 shrink-0 mt-0.5"></div>
                                )}
                                <span className="text-sm font-medium leading-snug">
                                  {constraint}
                                </span>
                              </div>
                            );
                          },
                        )}
                      </div>
                    </div>
                  )}
              </div>
            </div>
          )}
        </div>
        <div className="col-span-12 xl:col-span-8">
          {/* Stage 2 Scored Results RIGHT */}
          {(isMatching || matches.length > 0) && (
            <div className="space-y-8 animate-in">
              {!isMatching && matches.length > 0 && (
                <div className="flex items-center justify-end gap-4">
                  <span className="text-sm font-medium text-slate-500">
                    {matches.length} Candidates Evaluated
                  </span>
                  <div className="flex items-center gap-3">
                    <button
                      onClick={() => {
                        setStage(1);
                        setMatches([]);
                      }}
                      className="flex items-center gap-2 bg-slate-100 hover:bg-slate-200 text-slate-700 px-4 py-2 text-sm font-medium rounded-lg shadow-sm transition-colors border border-slate-200 hover:border-slate-300"
                    >
                      <RefreshCw size={16} />
                      Match Again
                    </button>
                  </div>
                </div>
              )}

              {isMatching ? (
                <div className="bg-white border border-slate-200 rounded-xl shadow-sm py-24 flex flex-col items-center justify-center space-y-8 relative overflow-hidden">
                  <div
                    className="absolute top-0 left-0 h-1 bg-blue-500 transition-all duration-1000 ease-out z-20"
                    style={{ width: `${activeMatchTask?.percent || 0}%` }}
                  ></div>

                  <div className="absolute top-6 right-6 flex items-center gap-6 z-20">
                    <div className="text-right">
                      <p className="text-xs font-medium text-slate-500 mb-0.5">
                        Estimated Time
                      </p>
                      <p className="text-sm font-semibold text-blue-600">
                        ~{activeMatchTask?.eta || 0}s
                      </p>
                    </div>
                    <div className="text-right border-l border-slate-200 pl-6">
                      <p className="text-xs font-medium text-slate-500 mb-0.5">
                        Progress
                      </p>
                      <p className="text-sm font-semibold text-blue-600">
                        {activeMatchTask?.percent || 0}%
                      </p>
                    </div>
                  </div>

                  <div className="relative flex items-center justify-center">
                    <div className="absolute inset-0 bg-blue-50 rounded-full animate-ping opacity-70"></div>
                    <div className="w-20 h-20 bg-blue-50 text-blue-600 rounded-full flex items-center justify-center relative z-10 shadow-sm border border-blue-100">
                      <BrainCircuit size={32} className="animate-pulse" />
                    </div>
                  </div>
                  <div className="text-center w-full max-w-sm mx-auto relative z-10">
                    <h4 className="text-lg font-semibold text-slate-900 mb-2">
                      Analyzing Profiles
                    </h4>
                    <p className="text-sm text-slate-500 leading-relaxed">
                      Cross-referencing candidate experience against role
                      requirements...
                    </p>
                  </div>
                </div>
              ) : (
                <div className="flex-1 min-w-0">
                  {activeMatchTab && matchGroups[activeMatchTab] && (
                    <div className="space-y-6">
                      <div className="flex flex-col sm:flex-row items-center gap-4 justify-between pb-4 border-b border-slate-200">
                        <div className="flex items-center gap-3 w-full sm:w-auto">
                          <input
                            type="checkbox"
                            className="w-5 h-5 cursor-pointer rounded border-slate-300 text-blue-600 focus:outline-none mt-1"
                            checked={
                              filteredMatches.length > 0 &&
                              filteredMatches.every((m: any) =>
                                selectedMatchIds.includes(m.expertId),
                              )
                            }
                            onChange={() =>
                              toggleSelectAllMatches(filteredMatches)
                            }
                            title="Select all active CVs"
                          />
                          <h4 className="text-xl font-bold text-slate-800 flex items-center gap-2">
                            {activeMatchTab}
                            <span className="bg-blue-50 text-blue-700 px-2 py-0.5 rounded-full text-xs font-semibold ml-2 border border-blue-100">
                              {filteredMatches.length} Evaluated
                            </span>
                          </h4>
                        </div>

                        <div className="flex items-center gap-3 w-full sm:w-auto">
                          <div className="relative flex-1 sm:w-60">
                            <input
                              type="text"
                              placeholder="Search matches..."
                              value={matchSearchQuery}
                              onChange={(e) =>
                                setMatchSearchQuery(e.target.value)
                              }
                              className="w-full pl-9 pr-3 py-1.5 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-shadow"
                            />
                            <Search
                              className="absolute left-3 top-2 text-slate-400"
                              size={16}
                            />
                          </div>
                          <select
                            value={matchSortBy}
                            onChange={(e) => setMatchSortBy(e.target.value)}
                            className="border border-slate-300 rounded-lg text-sm py-1.5 px-3 focus:ring-2 focus:ring-blue-500 outline-none bg-white cursor-pointer"
                          >
                            <option value="score_desc">Highest Score</option>
                            <option value="score_asc">Lowest Score</option>
                            <option value="name_asc">Name (A-Z)</option>
                          </select>
                        </div>
                      </div>

                      <div className="space-y-6">
                        {filteredMatches.length === 0 && (
                          <div className="py-12 text-center bg-slate-50 rounded-xl border border-dashed border-slate-200">
                            <p className="text-slate-500 font-medium">
                              No candidates match your search.
                            </p>
                            <button
                              onClick={() => setMatchSearchQuery("")}
                              className="mt-2 text-blue-600 hover:underline text-sm"
                            >
                              Clear search
                            </button>
                          </div>
                        )}
                        {paginatedMatches.map((match: any, idx: number) => {
                          const isGen = generatingExpertIds.includes(
                            match.expertId,
                          );
                          const existingCv = cvs.find(
                            (c) =>
                              c.expertId === match.expertId &&
                              c.tenderId === tender?.id &&
                              c.positionId === match.positionId,
                          );
                          return (
                            <div
                              key={`${match.expertId}-${idx}`}
                              className={clsx(
                                "bg-white border shadow-sm rounded-xl transition-all cursor-pointer relative overflow-hidden group animate-in fade-in slide-in-from-bottom-4 duration-500",
                                expandedIds.includes(match.expertId)
                                  ? "border-blue-300 ring-1 ring-blue-100"
                                  : "border-slate-200 hover:border-blue-300",
                              )}
                              style={{
                                animationDelay: `${idx * 50}ms`,
                                fillMode: "both",
                              }}
                              onClick={() =>
                                setExpandedIds((prev) =>
                                  prev.includes(match.expertId)
                                    ? prev.filter((id) => id !== match.expertId)
                                    : [...prev, match.expertId],
                                )
                              }
                            >
                              <div className="p-4 sm:p-5 flex items-center sm:items-start gap-4">
                                <div
                                  className="pt-1 sm:pt-2 shrink-0 pl-1"
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  <input
                                    type="checkbox"
                                    className="w-5 h-5 cursor-pointer rounded border-slate-300 text-blue-600 focus:outline-none block"
                                    checked={selectedMatchIds.includes(
                                      match.expertId,
                                    )}
                                    onChange={() =>
                                      toggleMatchSelection(match.expertId)
                                    }
                                  />
                                </div>

                                {/* Score Ring Compact */}
                                <div className="relative w-12 h-12 flex-shrink-0 flex items-center justify-center">
                                  <svg
                                    className="w-full h-full transform -rotate-90"
                                    viewBox="0 0 96 96"
                                  >
                                    <circle
                                      cx="48"
                                      cy="48"
                                      r="40"
                                      stroke="currentColor"
                                      strokeWidth="8"
                                      fill="transparent"
                                      className="text-slate-100"
                                    />
                                    <circle
                                      cx="48"
                                      cy="48"
                                      r="40"
                                      stroke="currentColor"
                                      strokeWidth="8"
                                      fill="transparent"
                                      className={clsx(
                                        "transition-all duration-1000 ease-out",
                                        match.score >= 85
                                          ? "text-emerald-500"
                                          : match.score >= 50
                                            ? "text-blue-500"
                                            : "text-rose-500",
                                      )}
                                      strokeDasharray={2 * Math.PI * 40}
                                      strokeDashoffset={
                                        2 *
                                        Math.PI *
                                        40 *
                                        (1 - match.score / 100)
                                      }
                                      strokeLinecap="round"
                                    />
                                  </svg>
                                  <div className="absolute inset-0 flex items-center justify-center">
                                    <span className="text-xs font-bold tracking-tight text-slate-900">
                                      {match.score}
                                    </span>
                                  </div>
                                </div>

                                {/* Header Content */}
                                <div className="flex-1 min-w-0 pr-8">
                                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-y-1">
                                    <h4 className="text-[17px] font-semibold text-slate-900 truncate">
                                      {match.expertName}
                                    </h4>
                                    <div className="flex items-center gap-2 shrink-0">
                                      <div
                                        className={clsx(
                                          "flex flex-row items-center gap-1.5 px-2 py-0.5 rounded border text-[11px] font-bold uppercase tracking-wider whitespace-nowrap",
                                          match.risk_level === "LOW"
                                            ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                                            : match.risk_level === "MEDIUM"
                                              ? "bg-amber-50 text-amber-700 border-amber-200"
                                              : "bg-rose-50 text-rose-700 border-rose-200"
                                        )}
                                      >
                                        {match.risk_level === "LOW" ? (
                                          <CheckCircle size={12} />
                                        ) : (
                                          <AlertCircle size={12} />
                                        )}
                                        {match.risk_level} Risk
                                      </div>
                                    </div>
                                  </div>

                                  <p className="text-[13px] text-slate-500 font-medium truncate flex items-center flex-wrap gap-x-3 gap-y-1 mt-1">
                                    {match.expert_type && (
                                      <span className="flex items-center gap-1.5">
                                        <Briefcase
                                          size={12}
                                          className="text-slate-400"
                                        />
                                        {match.expert_type}
                                      </span>
                                    )}
                                    {match.experience && (
                                      <span className="flex items-center gap-1.5">
                                        <History
                                          size={12}
                                          className="text-slate-400"
                                        />
                                        {match.experience}
                                      </span>
                                    )}
                                    {match.location && (
                                      <span className="flex items-center gap-1.5">
                                        <TargetIcon
                                          size={12}
                                          className="text-slate-400"
                                        />
                                        {match.location}
                                      </span>
                                    )}
                                  </p>
                                </div>

                                <div className="absolute top-4 right-4 text-slate-400 group-hover:text-blue-500 transition-colors p-1">
                                  <ChevronDown
                                    className={clsx(
                                      "transition-transform duration-300",
                                      expandedIds.includes(match.expertId) &&
                                        "-rotate-180",
                                    )}
                                    size={20}
                                  />
                                </div>
                              </div>

                              {/* Expanded Content */}
                              {expandedIds.includes(match.expertId) && (
                                <div
                                  className="px-5 pb-5 pt-0 border-t border-slate-100 mt-2 bg-slate-50/50"
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  <div className="pt-5 flex flex-col lg:flex-row gap-6">
                                    {/* Left Side Details */}
                                    <div className="flex-1 min-w-0">
                                      {match.met_team_constraints &&
                                        match.met_team_constraints.length >
                                          0 && (
                                          <div className="flex flex-wrap items-center gap-2 mb-4">
                                            {match.met_team_constraints.map(
                                              (c: string, cIdx: number) => (
                                                <span
                                                  key={cIdx}
                                                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-100/80 text-emerald-700 border border-emerald-200"
                                                >
                                                  🌟 Meets: {c}
                                                </span>
                                              ),
                                            )}
                                          </div>
                                        )}

                                      {match.scoring_rationale && (
                                        <div className="bg-white rounded-lg p-3.5 border border-slate-200 shadow-sm mb-4">
                                          <h4 className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1.5 flex items-center gap-1.5">
                                            <BrainCircuit
                                              size={12}
                                              className="text-indigo-500"
                                            />{" "}
                                            AI Scoring Rationale
                                          </h4>
                                          <p className="text-[13px] text-slate-700 leading-relaxed font-medium">
                                            {match.scoring_rationale}
                                          </p>
                                        </div>
                                      )}

                                      <div className="bg-indigo-50/70 rounded-lg p-3.5 border border-indigo-100/70 mb-4 shadow-sm text-indigo-900 text-[13px] leading-relaxed font-medium">
                                        {match.match_summary}
                                      </div>

                                      <div className="flex flex-wrap items-center gap-2 mb-5">
                                        {(
                                          match.fulfilled_requirements ||
                                          match.strong_points
                                        )?.map((pt: string, idx: number) => (
                                          <span
                                            key={idx}
                                            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded bg-white shadow-sm border border-emerald-100 text-[12px] text-slate-700 font-semibold"
                                          >
                                            <CheckCircle
                                              size={14}
                                              className="shrink-0 text-emerald-500"
                                            />
                                            <span>{pt}</span>
                                          </span>
                                        ))}
                                      </div>

                                      <div className="grid md:grid-cols-2 gap-4">
                                        <div className="bg-white rounded-xl p-4 border border-rose-100 shadow-sm">
                                          <p className="text-[13px] font-bold text-rose-800 mb-3 flex items-center gap-2">
                                            <AlertCircle
                                              size={16}
                                              className="text-rose-500"
                                            />
                                            Missing Requirements
                                          </p>
                                          <ul className="space-y-2.5">
                                            {match.missing_requirements?.map(
                                              (req: string, i: number) => (
                                                <li
                                                  key={i}
                                                  className="flex gap-2.5 text-[13px] text-slate-700 font-medium"
                                                >
                                                  <span className="w-1.5 h-1.5 rounded-full bg-rose-400 shrink-0 mt-1.5 border border-rose-500"></span>
                                                  <span className="leading-snug">
                                                    {req}
                                                  </span>
                                                </li>
                                              ),
                                            )}
                                            {(!match.missing_requirements ||
                                              match.missing_requirements
                                                .length === 0) && (
                                              <li className="text-[13px] text-slate-500 italic">
                                                No major missing requirements.
                                              </li>
                                            )}
                                          </ul>
                                        </div>

                                        <div className="bg-white rounded-xl p-4 border border-blue-100 shadow-sm">
                                          <p className="text-[13px] font-bold text-blue-900 mb-3 flex items-center gap-2">
                                            <Target
                                              size={16}
                                              className="text-blue-500"
                                            />
                                            Suggested Highlights
                                          </p>
                                          <ul className="space-y-2.5">
                                            {match.recommended_projects_to_highlight?.map(
                                              (proj: string, i: number) => (
                                                <li
                                                  key={i}
                                                  className="flex gap-2.5 text-[13px] text-slate-700 font-medium"
                                                >
                                                  <span className="w-1.5 h-1.5 rounded-full bg-blue-500 shrink-0 mt-1.5 border border-blue-600"></span>
                                                  <span className="leading-snug">
                                                    {proj}
                                                  </span>
                                                </li>
                                              ),
                                            )}
                                            {(!match.recommended_projects_to_highlight ||
                                              match
                                                .recommended_projects_to_highlight
                                                .length === 0) && (
                                              <li className="text-[13px] text-slate-500 italic">
                                                No specific projects
                                                recommended.
                                              </li>
                                            )}
                                          </ul>
                                        </div>
                                      </div>
                                    </div>

                                    {/* Right Side Actions */}
                                    <div className="flex flex-col gap-2 flex-shrink-0 w-full lg:w-[220px] items-stretch">
                                      {(() => {
                                        const visualCv = existingCv || {
                                          id: `phantom-${match.expertId}`,
                                          expertId: match.expertId,
                                          expertName: match.expertName,
                                          tenderId: tender?.id,
                                          tenderName: tender?.name,
                                          positionId: match.positionId,
                                          positionTitle: match.positionTitle,
                                          template: "General",
                                        };

                                        return (
                                          <div className="flex flex-col gap-2 w-full p-4 bg-white border border-slate-200 rounded-xl shadow-sm">
                                            <h5 className="text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-1">
                                              Normal CV
                                            </h5>

                                            <div className="grid grid-cols-2 gap-1.5 w-full">
                                              <button
                                                onClick={(e) => {
                                                  e.stopPropagation();
                                                  handlePreview(visualCv);
                                                }}
                                                className="flex items-center gap-2 p-2 px-3 justify-center border border-slate-200 rounded-lg text-slate-600 hover:bg-slate-50 transition-colors shadow-sm text-xs font-medium"
                                                title="View CV"
                                              >
                                                <Eye size={14} /> View
                                              </button>
                                              <button
                                                onClick={(e) => {
                                                  e.stopPropagation();
                                                  setCvToRegenerate(visualCv);
                                                }}
                                                className="flex items-center gap-2 p-2 px-3 justify-center border border-slate-200 rounded-lg text-slate-600 hover:bg-slate-50 transition-colors shadow-sm text-xs font-medium"
                                                title="Regenerate CV"
                                              >
                                                <RefreshCw size={14} />{" "}
                                                Regenerate
                                              </button>
                                              <button
                                                onClick={(e) => {
                                                  e.stopPropagation();
                                                  handleDownloadDocx(visualCv);
                                                }}
                                                className="flex items-center gap-2 p-2 px-3 justify-center border border-blue-200 bg-blue-50 text-blue-700 rounded-lg hover:bg-blue-100 transition-colors shadow-sm text-xs font-medium"
                                                title="Download Word DOCX"
                                              >
                                                <FileText size={14} /> Word
                                              </button>
                                              <button
                                                onClick={(e) => {
                                                  e.stopPropagation();
                                                  handleDownloadPdf(visualCv);
                                                }}
                                                className="flex items-center gap-2 p-2 px-3 justify-center border border-red-200 bg-red-50 text-red-700 rounded-lg hover:bg-red-100 transition-colors shadow-sm text-xs font-medium"
                                                title="Download PDF"
                                              >
                                                <Download size={14} /> PDF
                                                </button>
                                              </div>

                                            <div className="grid grid-cols-3 gap-1.5 w-full mt-1.5">
                                                <select
                                                  value={targetLang[visualCv.id] || ""}
                                                  onChange={(e) => {
                                                    e.stopPropagation();
                                                    setTargetLang((prev) => ({
                                                      ...prev,
                                                      [visualCv.id]: e.target.value,
                                                    }));
                                                  }}
                                                  onClick={(e) => e.stopPropagation()}
                                                  className="col-span-2 text-[10px] bg-slate-50 border border-slate-200 rounded-lg outline-none text-slate-700 px-2 py-1 cursor-pointer w-full focus:border-blue-300 focus:ring-1 focus:ring-blue-100 font-medium"
                                                >
                                                  <option value="">Language...</option>
                                                  <option value="French">French</option>
                                                  <option value="Spanish">Spanish</option>
                                                  <option value="Arabic">Arabic</option>
                                                  <option value="German">German</option>
                                                </select>
                                                <button
                                                  onClick={(e) => {
                                                    e.stopPropagation();
                                                    handleTranslateCV(visualCv);
                                                  }}
                                                  disabled={translatingId === visualCv.id || !targetLang[visualCv.id]}
                                                  className="col-span-1 text-blue-700 bg-blue-50 border border-blue-200 hover:bg-blue-100 p-1 rounded-lg disabled:opacity-50 transition-colors shadow-sm text-[10px] font-bold flex items-center justify-center gap-1"
                                                  title="Translate CV"
                                                >
                                                  {translatingId === visualCv.id ? (
                                                    <Loader2 size={12} className="animate-spin" />
                                                  ) : (
                                                    <Languages size={12} />
                                                  )}
                                                  Translate
                                                </button>
                                            </div>

                                              
    



                                            <h5 className="text-[11px] font-bold uppercase tracking-wider text-indigo-500 mb-1">
                                              Adapt CV
                                            </h5>
                                            <button
                                              onClick={(e) => {
                                                e.stopPropagation();
                                                handleAdaptCV(visualCv);
                                              }}
                                              disabled={
                                                adaptingId === visualCv.id ||
                                                renderingId === visualCv.id
                                              }
                                              className="flex items-center justify-center gap-2 w-full px-4 py-2 border border-indigo-200 bg-indigo-50 text-indigo-800 rounded-lg hover:bg-indigo-100 transition-all shadow-sm focus:ring-2 focus:ring-indigo-500 font-semibold text-xs disabled:opacity-50 mb-1"
                                            >
                                              {adaptingId === visualCv.id ? (
                                                <Loader2
                                                  size={16}
                                                  className="animate-spin"
                                                />
                                              ) : (
                                                <Wand2 size={16} />
                                              )}
                                              Adapt CV
                                            </button>
                                            <div className="grid grid-cols-3 gap-1.5 w-full">
                                              <button
                                                onClick={(e) => {
                                                  e.stopPropagation();
                                                  handlePreview(visualCv);
                                                }}
                                                className="flex items-center gap-1.5 p-1.5 justify-center border border-slate-200 rounded-lg text-slate-600 hover:bg-slate-50 transition-colors shadow-sm text-[10px] font-medium disabled:opacity-50 disabled:cursor-not-allowed disabled:bg-slate-50"
                                                title="View CV"
                                              >
                                                <Eye size={12} /> View
                                              </button>
                                              <button
                                                onClick={(e) => {
                                                  e.stopPropagation();
                                                  handleDownloadDocx(visualCv);
                                                }}
                                                className="flex items-center gap-1.5 p-1.5 justify-center border border-blue-200 bg-blue-50 text-blue-700 rounded-lg hover:bg-blue-100 transition-colors shadow-sm text-[10px] font-medium disabled:opacity-50 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400 disabled:border-slate-200"
                                                title="Download Word DOCX"
                                              >
                                                <FileText size={12} /> Word
                                              </button>
                                              <button
                                                onClick={(e) => {
                                                  e.stopPropagation();
                                                  handleDownloadPdf(visualCv);
                                                }}
                                                className="flex items-center gap-1.5 p-1.5 justify-center border border-red-200 bg-red-50 text-red-700 rounded-lg hover:bg-red-100 transition-colors shadow-sm text-[10px] font-medium disabled:opacity-50 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400 disabled:border-slate-200"
                                                title="Download PDF"
                                              >
                                                <Download size={12} /> PDF
                                              </button>
                                            </div>

                                            <div className="grid grid-cols-3 gap-1.5 w-full mt-1.5">
                                                <select
                                                  value={targetLang[visualCv.id] || ""}
                                                  onChange={(e) => {
                                                    e.stopPropagation();
                                                    setTargetLang((prev) => ({
                                                      ...prev,
                                                      [visualCv.id]: e.target.value,
                                                    }));
                                                  }}
                                                  onClick={(e) => e.stopPropagation()}
                                                  className="col-span-2 text-[10px] bg-slate-50 border border-slate-200 rounded-lg outline-none text-slate-700 px-2 py-1 cursor-pointer w-full focus:border-blue-300 focus:ring-1 focus:ring-blue-100 font-medium"
                                                >
                                                  <option value="">Language...</option>
                                                  <option value="French">French</option>
                                                  <option value="Spanish">Spanish</option>
                                                  <option value="Arabic">Arabic</option>
                                                  <option value="German">German</option>
                                                </select>
                                                <button
                                                  onClick={(e) => {
                                                    e.stopPropagation();
                                                    handleTranslateCV(visualCv);
                                                  }}
                                                  disabled={translatingId === visualCv.id || !targetLang[visualCv.id]}
                                                  className="col-span-1 text-blue-700 bg-blue-50 border border-blue-200 hover:bg-blue-100 p-1 rounded-lg disabled:opacity-50 transition-colors shadow-sm text-[10px] font-bold flex items-center justify-center gap-1"
                                                  title="Translate CV"
                                                >
                                                  {translatingId === visualCv.id ? (
                                                    <Loader2 size={12} className="animate-spin" />
                                                  ) : (
                                                    <Languages size={12} />
                                                  )}
                                                  Translate
                                                </button>
                                            </div>


                                            <div className="h-px bg-slate-100 my-2"></div>

                                            <h5 className="text-[11px] font-bold uppercase tracking-wider text-emerald-600 mb-1">
                                              Render CV
                                            </h5>
                                            <button
                                              onClick={(e) => {
                                                e.stopPropagation();
                                                handleRenderCV(visualCv);
                                              }}
                                              disabled={
                                                renderingId === visualCv.id ||
                                                adaptingId === visualCv.id
                                              }
                                              className="flex items-center justify-center gap-2 w-full px-4 py-2 border border-emerald-200 bg-emerald-50 text-emerald-800 rounded-lg hover:bg-emerald-100 transition-all shadow-sm focus:ring-2 focus:ring-emerald-500 font-semibold text-xs disabled:opacity-50 disabled:cursor-not-allowed mb-1"
                                            >
                                              {renderingId === visualCv.id ? (
                                                <Loader2
                                                  size={16}
                                                  className="animate-spin"
                                                />
                                              ) : (
                                                <BrainCircuit size={16} />
                                              )}
                                              Render CV
                                            </button>
                                            <div className="grid grid-cols-3 gap-1.5 w-full">
                                              <button
                                                onClick={(e) => {
                                                  e.stopPropagation();
                                                  handlePreview(visualCv);
                                                }}
                                                className="flex items-center gap-1.5 p-1.5 justify-center border border-slate-200 rounded-lg text-slate-600 hover:bg-slate-50 transition-colors shadow-sm text-[10px] font-medium disabled:opacity-50 disabled:cursor-not-allowed disabled:bg-slate-50"
                                                title="View CV"
                                              >
                                                <Eye size={12} /> View
                                              </button>
                                              <button
                                                onClick={(e) => {
                                                  e.stopPropagation();
                                                  handleDownloadDocx(visualCv);
                                                }}
                                                className="flex items-center gap-1.5 p-1.5 justify-center border border-blue-200 bg-blue-50 text-blue-700 rounded-lg hover:bg-blue-100 transition-colors shadow-sm text-[10px] font-medium disabled:opacity-50 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400 disabled:border-slate-200"
                                                title="Download Word DOCX"
                                              >
                                                <FileText size={12} /> Word
                                              </button>
                                              <button
                                                onClick={(e) => {
                                                  e.stopPropagation();
                                                  handleDownloadPdf(visualCv);
                                                }}
                                                className="flex items-center gap-1.5 p-1.5 justify-center border border-red-200 bg-red-50 text-red-700 rounded-lg hover:bg-red-100 transition-colors shadow-sm text-[10px] font-medium disabled:opacity-50 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400 disabled:border-slate-200"
                                                title="Download PDF"
                                              >
                                                <Download size={12} /> PDF
                                              </button>
                                            </div>

                                            <div className="grid grid-cols-3 gap-1.5 w-full mt-1.5">
                                                <select
                                                  value={targetLang[visualCv.id] || ""}
                                                  onChange={(e) => {
                                                    e.stopPropagation();
                                                    setTargetLang((prev) => ({
                                                      ...prev,
                                                      [visualCv.id]: e.target.value,
                                                    }));
                                                  }}
                                                  onClick={(e) => e.stopPropagation()}
                                                  className="col-span-2 text-[10px] bg-slate-50 border border-slate-200 rounded-lg outline-none text-slate-700 px-2 py-1 cursor-pointer w-full focus:border-blue-300 focus:ring-1 focus:ring-blue-100 font-medium"
                                                >
                                                  <option value="">Language...</option>
                                                  <option value="French">French</option>
                                                  <option value="Spanish">Spanish</option>
                                                  <option value="Arabic">Arabic</option>
                                                  <option value="German">German</option>
                                                </select>
                                                <button
                                                  onClick={(e) => {
                                                    e.stopPropagation();
                                                    handleTranslateCV(visualCv);
                                                  }}
                                                  disabled={translatingId === visualCv.id || !targetLang[visualCv.id]}
                                                  className="col-span-1 text-blue-700 bg-blue-50 border border-blue-200 hover:bg-blue-100 p-1 rounded-lg disabled:opacity-50 transition-colors shadow-sm text-[10px] font-bold flex items-center justify-center gap-1"
                                                  title="Translate CV"
                                                >
                                                  {translatingId === visualCv.id ? (
                                                    <Loader2 size={12} className="animate-spin" />
                                                  ) : (
                                                    <Languages size={12} />
                                                  )}
                                                  Translate
                                                </button>
                                            </div>


                                          </div>
                                        );
                                      })()}
                                    </div>
                                  </div>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>

                      {matchTotalPages > 1 && (
                        <div className="flex items-center justify-between pt-4 mt-2 border-t border-slate-200">
                          <p className="text-sm text-slate-500">
                            Showing{" "}
                            <span className="font-medium text-slate-900">
                              {(matchCurrentPage - 1) * matchesPerPage + 1}
                            </span>{" "}
                            to{" "}
                            <span className="font-medium text-slate-900">
                              {Math.min(
                                matchCurrentPage * matchesPerPage,
                                filteredMatches.length,
                              )}
                            </span>{" "}
                            of{" "}
                            <span className="font-medium text-slate-900">
                              {filteredMatches.length}
                            </span>{" "}
                            results
                          </p>
                          <div className="flex items-center gap-2">
                            <button
                              disabled={matchCurrentPage === 1}
                              onClick={() =>
                                setMatchCurrentPage((p) => Math.max(1, p - 1))
                              }
                              className="py-1.5 px-3 border border-slate-200 rounded-lg text-slate-600 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-sm font-medium"
                            >
                              Previous
                            </button>
                            <div className="flex items-center gap-1 hidden sm:flex">
                              {Array.from({
                                length: Math.min(5, matchTotalPages),
                              }).map((_, i) => {
                                let pageNum = i + 1;
                                if (matchTotalPages > 5) {
                                  if (matchCurrentPage > 3) {
                                    pageNum = Math.min(
                                      matchCurrentPage - 2 + i,
                                      matchTotalPages,
                                    );
                                  }
                                }
                                return (
                                  <button
                                    key={pageNum}
                                    onClick={() => setMatchCurrentPage(pageNum)}
                                    className={clsx(
                                      "w-8 h-8 flex items-center justify-center rounded-lg text-sm font-medium transition-colors",
                                      matchCurrentPage === pageNum
                                        ? "bg-blue-600 text-white"
                                        : "text-slate-600 hover:bg-slate-100",
                                    )}
                                  >
                                    {pageNum}
                                  </button>
                                );
                              })}
                            </div>
                            <button
                              disabled={matchCurrentPage === matchTotalPages}
                              onClick={() =>
                                setMatchCurrentPage((p) =>
                                  Math.min(matchTotalPages, p + 1),
                                )
                              }
                              className="py-1.5 px-3 border border-slate-200 rounded-lg text-slate-600 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-sm font-medium"
                            >
                              Next
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
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
              {/* Modal Header Control Bar */}
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
      {/* Regenerate CV Modal */}
      {cvToRegenerate && (
        <RegenerateCVModal
          cv={cvToRegenerate}
          onClose={() => setCvToRegenerate(null)}
          onRegenerate={confirmRegenerate}
        />
      )}
      {/* Floating Action Bar for Bulk Actions */}
      <AnimatePresence>
        {selectedMatchIds.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 100 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 100 }}
            className="fixed bottom-8 left-1/2 -translate-x-1/2 z-40 bg-slate-900 shadow-2xl rounded-2xl px-6 py-4 flex items-center gap-6 border border-slate-700/50 backdrop-blur-md"
          >
            <div className="flex items-center gap-3 border-r border-slate-700 pr-6">
              <div className="bg-blue-500 text-white min-w-8 h-8 px-2 rounded-full flex items-center justify-center font-bold text-sm shadow-inner overflow-hidden whitespace-nowrap">
                {selectedMatchIds.length}
              </div>
              <span className="text-white font-medium text-sm whitespace-nowrap">
                Candidates Selected
              </span>
              <button
                onClick={() => setSelectedMatchIds([])}
                className="text-slate-400 hover:text-white text-sm underline ml-2 transition-colors whitespace-nowrap"
              >
                Clear
              </button>
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={handleBulkAdapt}
                className="flex items-center gap-2 bg-indigo-500/20 hover:bg-indigo-500/30 border border-indigo-500/30 text-indigo-300 px-4 py-2 rounded-lg text-sm font-medium transition-all focus:ring-2 focus:ring-indigo-500 focus:outline-none whitespace-nowrap"
              >
                <Wand2 size={16} /> Bulk Adapt
              </button>
              <button
                onClick={handleBulkRender}
                className="flex items-center gap-2 bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-500/30 text-emerald-300 px-4 py-2 rounded-lg text-sm font-medium transition-all focus:ring-2 focus:ring-emerald-500 focus:outline-none whitespace-nowrap"
              >
                <BrainCircuit size={16} /> Bulk Render
              </button>
              <button
                onClick={handleBulkGenerate}
                className="flex items-center gap-2 bg-blue-600 hover:bg-blue-500 text-white px-5 py-2 rounded-lg text-sm font-medium transition-all shadow-lg shadow-blue-500/20 focus:ring-2 focus:ring-blue-500 focus:outline-none whitespace-nowrap"
              >
                <Download size={16} /> Download Package
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
