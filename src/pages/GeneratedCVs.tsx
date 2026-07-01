import React, { useState, useEffect, useRef } from "react";
import JSZip from "jszip";
import {
  FileCheck,
  Download,
  Trash2,
  Search,
  Eye,
  FileText,
  X,
  Award,
  CheckCircle2,
  Printer,
  RefreshCw,
  Loader2,
  ChevronDown,
  ChevronUp,
  ArrowUpAZ,
  ArrowDownZA,
  Languages,
  BrainCircuit,
  Wand2,
} from "lucide-react";
import { api } from "../lib/api";
import { generateReformatedCV } from "../lib/pdf";
import { RegenerateCVModal } from "../components/RegenerateCVModal";
import { ModeAuditPanel } from "../components/ModeAuditPanel";
import { motion, AnimatePresence } from "motion/react";
import clsx from "clsx";
import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";
import {
  translateExpertData,
  renderExpertData,
  adaptExpertData,
} from "../lib/gemini";

pdfjs.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

import { useTasks } from "../lib/TasksContext";
import ConfirmModal from "../components/ConfirmModal";

import ReactQuill from "react-quill-new";
import "react-quill-new/dist/quill.snow.css";
import { generateCVHtml } from "../lib/htmlCV";
import { downloadHtmlAsPdf, downloadHtmlAsDocx } from "../lib/exportHtml";
import { buildModeAudit, resolveCvExpert } from "../lib/cvModes";
import { useAuth } from "../lib/auth";

export default function GeneratedCVs() {
  const { isAdmin } = useAuth();
  const [cvs, setCvs] = useState<any[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [previewCv, setPreviewCv] = useState<any | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [numPages, setNumPages] = useState<number | null>(null);
  const [cvToRegenerate, setCvToRegenerate] = useState<any | null>(null);
  const [translatingId, setTranslatingId] = useState<string | null>(null);
  const [renderingId, setRenderingId] = useState<string | null>(null);
  const [adaptingId, setAdaptingId] = useState<string | null>(null);
  const [targetLang, setTargetLang] = useState<{ [key: string]: string }>({});

  const [selectedCvIds, setSelectedCvIds] = useState<string[]>([]);
  const [operatingMode, setOperatingMode] = useState<
    "NORMAL" | "ADAPT" | "RENDER" | "ALL"
  >("ALL");

  // Rich Text Editor State
  const [isEditingRichText, setIsEditingRichText] = useState(false);
  const [richTextContent, setRichTextContent] = useState("");
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const [sortConfig, setSortConfig] = useState<{
    key: string;
    direction: "asc" | "desc";
  } | null>(null);
  const [columnFilters, setColumnFilters] = useState<Record<string, string>>(
    {},
  );
  const [activeColumnMenu, setActiveColumnMenu] = useState<string | null>(null);
  const activeColumnMenuRef = useRef<HTMLDivElement>(null);

  const { tasks, addTask, updateTask } = useTasks();

  const regeneratingIds = tasks
    .filter((t) => t.type === "GENERATE" && t.status === "running")
    .map((t) => t.message?.match(/ID: ([\w-]+)/)?.[1])
    .filter(Boolean);

  const confirmRegenerate = async (cvId: string, customBranding?: any) => {
    const cv = cvs.find((c) => c.id === cvId);
    if (!cv) return;

    setCvToRegenerate(null);

    const taskId = addTask({
      type: "GENERATE",
      title: `Rebuild CV: ${cv.expertName}`,
      message: `Rebuilding CV. ID: ${cv.id}`,
    });

    let p = 5;
    let eta = 15;
    const progressInterval = setInterval(() => {
      p += Math.floor(Math.random() * 8);
      eta -= 1;
      if (p > 95) p = 95;
      if (eta < 1) eta = 1;
      updateTask(taskId, { percent: p, eta });
    }, 1000);

    try {
      const experts = await api.getExperts();
      const baseExpert = experts.find(
        (e) => e.id === cv.expertId || e.name === cv.expertName,
      );
      const expert = resolveCvExpert(cv, baseExpert);
      const tender = await api.getTender(cv.tenderId);

      if (!expert) throw new Error("Expert data not found");

      updateTask(taskId, { message: "Rendering branded PDF...", percent: 80 });
      const doc = await generateReformatedCV({
        template: cv.template || "Specialized",
        branding: customBranding || tender?.branding,
        expert,
        position_title: cv.positionTitle || cv.positionId,
      });

      doc.save(
        `${cv.template || "Specialized"}_UPDATED_CV_${cv.expertName.split(" ").join("_")}.pdf`,
      );

      // Update the CV with the custom branding just in case we need it next time
      const cvsList = await api.getCVs();
      const dbcv = cvsList.find((c) => c.id === cvId);
      if (dbcv) {
        dbcv.customBranding = customBranding;
        await api.updateCV(dbcv); // Will need to build saveCV or rely on memory
      }

      clearInterval(progressInterval);
      updateTask(taskId, {
        status: "completed",
        percent: 100,
        eta: 0,
        message: "CV Rebuilt and Downloaded",
      });
      fetchCVs();
    } catch (err: any) {
      clearInterval(progressInterval);
      console.error(err);
      updateTask(taskId, { status: "error", message: err.message });
      alert("Regeneration failed: " + err.message);
    }
  };

  const handleRegenerate = (cv: any) => {
    setCvToRegenerate(cv);
  };

  const handleTranslateCV = async (cv: any) => {
    const lang = targetLang[cv.id];
    if (!lang) {
      alert("Please select a target language first.");
      return;
    }

    setTranslatingId(cv.id);
    try {
      const experts = await api.getExperts();
      const baseExpert = experts.find(
        (e) => e.id === cv.expertId || e.name === cv.expertName,
      );
      const expertToTranslate = resolveCvExpert(cv, baseExpert);
      const tender = await api.getTender(cv.tenderId);

      if (!expertToTranslate) {
        alert("Expert data missing. Cannot translate CV.");
        setTranslatingId(null);
        return;
      }

      const translatedExpert = await translateExpertData(expertToTranslate, lang);

      const doc = await generateReformatedCV({
        template: cv.template || "Specialized",
        branding: cv.customBranding || tender?.branding,
        expert: translatedExpert,
        position_title: cv.positionTitle || cv.positionId,
      });

      const expertName =
        translatedExpert.fullName || translatedExpert.name || "Expert";
      doc.save(`${cv.template || "Specialized"} - ${expertName} (${lang}).pdf`);
    } catch (err: any) {
      console.error(err);
      alert("Translation failed: " + err.message);
    } finally {
      setTranslatingId(null);
    }
  };

  const handleRenderCV = async (cv: any) => {
    setRenderingId(cv.id);
    try {
      const experts = await api.getExperts();
      const expert = experts.find(
        (e) => e.id === cv.expertId || e.name === cv.expertName,
      );
      const tender = await api.getTender(cv.tenderId);

      if (!expert) {
        alert("Expert data missing. Cannot render CV.");
        setRenderingId(null);
        return;
      }

      const renderedExpert = await renderExpertData(
        expert,
        tender,
        cv.positionTitle || cv.positionId,
      );

      const doc = await generateReformatedCV({
        template: cv.template || "General",
        branding: cv.customBranding || tender?.branding,
        expert: renderedExpert,
        position_title: cv.positionTitle || cv.positionId,
      });

      doc.save(
        `${cv.template || "General"} - ${renderedExpert.fullName || renderedExpert.name || "Expert"} (Rendered).pdf`,
      );

      // Update DB with the rendered AI profile
      const modeAudit = buildModeAudit("RENDER", expert, renderedExpert, tender, cv.positionTitle || cv.positionId);
      await api.updateCV({
        ...cv,
        mode: "RENDER",
        expertData: renderedExpert,
        modeAudit,
        modeHistory: [...(cv.modeHistory || []), modeAudit],
        customRichText: undefined,
        isAdapted: true,
        isRendered: true,
      });
      fetchCVs();
    } catch (err: any) {
      console.error(err);
      alert("Render failed: " + err.message);
    } finally {
      setRenderingId(null);
    }
  };

  const handleAdaptCV = async (cv: any) => {
    setAdaptingId(cv.id);
    try {
      const experts = await api.getExperts();
      const expert = experts.find(
        (e) => e.id === cv.expertId || e.name === cv.expertName,
      );
      const tender = await api.getTender(cv.tenderId);

      if (!expert) {
        alert("Expert data missing. Cannot adapt CV.");
        setAdaptingId(null);
        return;
      }

      const adaptedExpert = await adaptExpertData(
        expert,
        tender,
        cv.positionTitle || cv.positionId,
      );

      const doc = await generateReformatedCV({
        template: cv.template || "General",
        branding: cv.customBranding || tender?.branding,
        expert: adaptedExpert,
        position_title: cv.positionTitle || cv.positionId,
      });

      doc.save(
        `${cv.template || "General"} - ${adaptedExpert.fullName || adaptedExpert.name || "Expert"} (Adapted).pdf`,
      );

      // Update DB with the rendered AI profile
      const modeAudit = buildModeAudit("ADAPT", expert, adaptedExpert, tender, cv.positionTitle || cv.positionId);
      await api.updateCV({
        ...cv,
        mode: "ADAPT",
        expertData: adaptedExpert,
        modeAudit,
        modeHistory: [...(cv.modeHistory || []), modeAudit],
        customRichText: undefined,
        isAdapted: true,
        isRendered: false,
      });
      fetchCVs();
    } catch (err: any) {
      console.error(err);
      alert("Adapt failed: " + err.message);
    } finally {
      setAdaptingId(null);
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

      const experts = await api.getExperts();
      const baseExpert = experts.find(
        (e) => e.id === cv.expertId || e.name === cv.expertName,
      );
      const expert = resolveCvExpert(cv, baseExpert);

      if (!expert) {
        alert("Expert data missing. Cannot download CV.");
        return;
      }

      const { generateDocxCV } = await import("../lib/docx");
      const tender = await api.getTender(cv.tenderId);

      await generateDocxCV({
        template: cv.template || "Specialized",
        expert,
        branding: cv.customBranding || tender?.branding,
        position_title: cv.positionTitle || cv.positionId,
      });
    } catch (err: any) {
      console.error(err);
      alert("Download failed: " + err.message);
    }
  };

  const handleDownload = async (cv: any) => {
    try {
      if (cv.customRichText) {
        await downloadHtmlAsPdf(
          cv.customRichText,
          `CV_${cv.expertName || "Expert"}`,
        );
        return;
      }
      const experts = await api.getExperts();
      const baseExpert = experts.find(
        (e) => e.id === cv.expertId || e.name === cv.expertName,
      );
      const expert = resolveCvExpert(cv, baseExpert);
      const tender = await api.getTender(cv.tenderId);

      if (!expert) {
        alert("Expert data missing. Cannot download CV.");
        return;
      }

      const doc = await generateReformatedCV({
        template: cv.template || "Specialized",
        branding: cv.customBranding || tender?.branding,
        expert,
        position_title: cv.positionTitle || cv.positionId,
      });

      const expertName = cv.expertName || "Expert";
      doc.save(`${cv.template || "Specialized"} - ${expertName}.pdf`);
    } catch (err: any) {
      console.error(err);
      alert("Download failed: " + err.message);
    }
  };

  const handlePreview = async (cv: any) => {
    try {
      const experts = await api.getExperts();
      const baseExpert =
        experts.find((e) => e.id === cv.expertId || e.name === cv.expertName) ||
        {};
      const expert = resolveCvExpert(cv, baseExpert);
      const tender = await api.getTender(cv.tenderId);

      setPreviewCv({ ...cv, expertData: expert });

      const doc = await generateReformatedCV({
        template: cv.template || "Specialized",
        branding: cv.customBranding || tender?.branding,
        expert: expert,
        position_title: cv.positionTitle || cv.positionId,
      });

      const pdfBlob = doc.output("blob");
      const url = URL.createObjectURL(pdfBlob);
      setPreviewUrl(url);
    } catch (err: any) {
      console.error(err);
      alert("Preview failed: " + err.message);
    }
  };

  const handleDelete = async (cvId: string) => {
    await api.deleteCV(cvId);
    fetchCVs();
  };

  const closePreview = () => {
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
    }
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
        fetchCVs(); // reload
      }
      setIsEditingRichText(false);
      handlePreview(updatedPreviewCv);
    } catch (err: any) {
      alert("Error saving rich text: " + err.message);
    }
  };

  const fetchCVs = async () => {
    try {
      const data = await api.getCVs();
      setCvs(data);
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    fetchCVs();
    function handleClickOutside(event: MouseEvent) {
      if (
        activeColumnMenuRef.current &&
        !activeColumnMenuRef.current.contains(event.target as Node)
      ) {
        setActiveColumnMenu(null);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const filteredCVs = cvs
    .filter((cv) => {
      if (operatingMode === "NORMAL" && (cv.isAdapted || cv.isRendered))
        return false;
      if (operatingMode === "ADAPT" && (!cv.isAdapted || cv.isRendered))
        return false;
      if (operatingMode === "RENDER" && !cv.isRendered) return false;

      const searchString =
        `${cv.expertName || ""} ${cv.tenderName || ""} ${cv.positionTitle || ""} ${new Date(cv.timestamp || 0).toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" })}`.toLowerCase();
      const matchesSearch = searchString.includes(searchQuery.toLowerCase());
      if (!matchesSearch) return false;

      // Column filters
      for (const [key, value] of Object.entries(columnFilters)) {
        if (!value) continue;

        const v = String(value).toLowerCase();
        let cvVal = "";

        if (key === "docRef")
          cvVal = `cv_${(cv.expertName || "").split(" ")[0]}`.toLowerCase();
        else if (key === "expert")
          cvVal =
            `${cv.expertName || ""} ${cv.positionTitle || ""}`.toLowerCase();
        else if (key === "tender")
          cvVal = (cv.tenderName || "INTERNAL").toLowerCase();
        else if (key === "status") cvVal = "ready";
        else if (key === "generatedOn")
          cvVal = new Date(cv.timestamp || 0)
            .toLocaleDateString(undefined, {
              day: "2-digit",
              month: "short",
              year: "numeric",
            })
            .toLowerCase();

        if (!cvVal.includes(v)) return false;
      }

      return true;
    })
    .sort((a, b) => {
      if (!sortConfig) return 0;
      const { key, direction } = sortConfig;
      const mod = direction === "asc" ? 1 : -1;

      let aVal: any = "";
      let bVal: any = "";

      if (key === "docRef") {
        aVal = `cv_${(a.expertName || "").split(" ")[0]}`;
        bVal = `cv_${(b.expertName || "").split(" ")[0]}`;
      } else if (key === "expert") {
        aVal = a.expertName || "";
        bVal = b.expertName || "";
      } else if (key === "tender") {
        aVal = a.tenderName || "";
        bVal = b.tenderName || "";
      } else if (key === "status") {
        aVal = "ready";
        bVal = "ready";
      } else if (key === "generatedOn") {
        aVal = new Date(a.timestamp || 0).getTime();
        bVal = new Date(b.timestamp || 0).getTime();
      }

      if (typeof aVal === "string") aVal = aVal.toLowerCase();
      if (typeof bVal === "string") bVal = bVal.toLowerCase();

      if (aVal < bVal) return -1 * mod;
      if (aVal > bVal) return 1 * mod;
      return 0;
    });

  const renderColumnHeader = (id: string, label: string) => (
    <th
      key={id}
      className="px-6 py-4 font-semibold text-[11px] uppercase tracking-wider text-slate-500 whitespace-nowrap relative"
    >
      <div
        className="flex items-center gap-1 cursor-pointer hover:text-slate-700 select-none"
        onClick={(e) => {
          e.stopPropagation();
          setActiveColumnMenu(activeColumnMenu === id ? null : id);
        }}
      >
        {label}
        {sortConfig?.key === id ? (
          sortConfig.direction === "asc" ? (
            <ChevronUp size={12} className="text-blue-600" />
          ) : (
            <ChevronDown size={12} className="text-blue-600" />
          )
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
            <div className="px-3 py-2 text-xs font-semibold text-slate-500">
              Sort
            </div>
            <button
              className="w-full flex items-center gap-2 px-3 py-2 hover:bg-slate-50 text-sm font-medium text-slate-700 rounded-md transition-colors"
              onClick={() => {
                setSortConfig({ key: id, direction: "asc" });
                setActiveColumnMenu(null);
              }}
            >
              <ArrowUpAZ size={14} className="text-slate-400" />
              <span>Sort Ascending</span>
            </button>
            <button
              className="w-full flex items-center gap-2 px-3 py-2 hover:bg-slate-50 text-sm font-medium text-slate-700 rounded-md transition-colors"
              onClick={() => {
                setSortConfig({ key: id, direction: "desc" });
                setActiveColumnMenu(null);
              }}
            >
              <ArrowDownZA size={14} className="text-slate-400" />
              <span>Sort Descending</span>
            </button>
          </div>
          <div className="h-px bg-slate-100 my-1"></div>
          <div className="p-1 border-t border-slate-100">
            <div className="px-3 py-2 text-xs font-semibold text-slate-500">
              Filter
            </div>
            <div className="px-2 pb-2">
              <input
                type="text"
                placeholder={`Filter ${label}...`}
                value={columnFilters[id] || ""}
                onChange={(e) =>
                  setColumnFilters((prev) => ({
                    ...prev,
                    [id]: e.target.value,
                  }))
                }
                className="w-full px-3 py-1.5 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                autoFocus
              />
            </div>
            {columnFilters[id] && (
              <div className="px-2 pb-2">
                <button
                  className="w-full text-xs text-blue-600 hover:text-blue-700 font-medium py-1"
                  onClick={() =>
                    setColumnFilters((prev) => {
                      const n = { ...prev };
                      delete n[id];
                      return n;
                    })
                  }
                >
                  Clear Filter
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </th>
  );

  const handleBulkAdapt = async () => {
    const targets =
      selectedCvIds.length > 0
        ? cvs.filter((cv: any) => selectedCvIds.includes(cv.id))
        : [];

    if (targets.length === 0) return;

    if (
      !window.confirm(
        `You are about to adapt ${targets.length} CVs using the AI engine. This might take several minutes depending on the number of candidates. Do you want to proceed?`,
      )
    )
      return;

    const taskId = addTask({
      type: "GENERATE",
      title: "Bulk Match Adapt",
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
        const cv = targets[i];
        const expert = experts.find(
          (e: any) => e.id === cv.expertId || e.name === cv.expertName,
        );
        const tender = await api.getTender(cv.tenderId);
        if (expert) {
          updateTask(taskId, {
            message: `Adapting ${cv.expertName}... (${i + 1}/${targets.length})`,
          });
          const adaptedExpert = await adaptExpertData(
            expert,
            tender,
            cv.positionTitle || cv.positionId,
          );
          const modeAudit = buildModeAudit("ADAPT", expert, adaptedExpert, tender, cv.positionTitle || cv.positionId);
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

      fetchCVs();

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
      selectedCvIds.length > 0
        ? cvs.filter((cv: any) => selectedCvIds.includes(cv.id))
        : [];

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
        const cv = targets[i];
        const expert = experts.find(
          (e: any) => e.id === cv.expertId || e.name === cv.expertName,
        );
        const tender = await api.getTender(cv.tenderId);

        if (expert) {
          updateTask(taskId, {
            message: `Rendering ${cv.expertName || cv.expertId}... (${i + 1}/${targets.length})`,
          });
          const renderedExpert = await renderExpertData(
            expert,
            tender,
            cv.positionTitle || cv.positionId,
          );
          const modeAudit = buildModeAudit("RENDER", expert, renderedExpert, tender, cv.positionTitle || cv.positionId);
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

      fetchCVs();

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
      selectedCvIds.length > 0
        ? cvs.filter((cv: any) => selectedCvIds.includes(cv.id))
        : [];

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

      for (let i = 0; i < targets.length; i++) {
        const cv = targets[i];
        updateTask(taskId, {
          message: `Generating PDF for ${cv.expertName}... (${i + 1}/${targets.length})`,
        });

        if (cv.customRichText) {
          const docBlob = await downloadHtmlAsPdf(
            cv.customRichText,
            `CV_${cv.expertName}`,
            true,
          );
          zip.file(
            `CV_${cv.expertName.split(" ").join("_")}.pdf`,
            docBlob as Blob,
          );
        } else {
          const doc = await generateReformatedCV({
            template: cv.template || "General",
            branding: cv.customBranding,
            expert: cv.expertData,
            position_title: cv.positionTitle || cv.positionId,
          });
          const blob = doc.output("blob");
          zip.file(
            `${cv.template || "General"} - ${cv.expertName.split(" ").join("_")}.pdf`,
            blob,
          );
        }
      }

      updateTask(taskId, { message: "Zipping files..." });
      const content = await zip.generateAsync({ type: "blob" });
      const url = URL.createObjectURL(content);
      const a = document.createElement("a");
      a.href = url;
      a.download = `CV_Package_${new Date().getTime()}.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      clearInterval(interval);
      updateTask(taskId, {
        status: "completed",
        percent: 100,
        eta: 0,
        message: "Package Downloaded",
      });
    } catch (err: any) {
      clearInterval(interval);
      console.error(err);
      updateTask(taskId, { status: "error", message: err.message });
      alert("Failed to build package: " + err.message);
    }
  };

  return (
    <div className="space-y-6 max-w-full w-full mx-auto pb-32">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-slate-900">Generated CVs</h2>
          <p className="text-sm text-slate-500 mt-1">
            Generated Archive & Document Intelligence
          </p>
        </div>
      </div>

      {/* Filters & Search */}
      <div className="flex items-center gap-4 bg-white p-4 rounded-xl border border-slate-200">
        <div className="relative flex-1 max-w-sm">
          <Search
            className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
            size={16}
          />
          <input
            type="text"
            placeholder="Search documents..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-4 py-2 bg-white border border-slate-300 rounded-lg text-sm focus:outline-none focus:border-blue-500 outline-none"
          />
        </div>
        <div className="flex items-center gap-2 max-w-xs">
          <select
            value={operatingMode}
            onChange={(e) => {
              setOperatingMode(e.target.value as any);
              setSelectedCvIds([]);
            }}
            className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg text-sm focus:border-blue-500 outline-none cursor-pointer"
          >
            <option value="ALL">All Documents (Filter)</option>
            <option value="NORMAL">Normal CV</option>
            <option value="ADAPT">Adapt CV</option>
            <option value="RENDER">Render CV</option>
          </select>
        </div>
        <div className="flex items-center gap-2 ml-4">
          <div className="px-3 py-2 bg-blue-50 rounded-lg border border-blue-100">
            <span className="text-sm font-semibold text-blue-600">
              {filteredCVs.length} Documents
            </span>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden flex flex-col">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse min-w-[1000px]">
            <thead>
              <tr className="border-b border-slate-200 bg-[#fafafa]">
                <th className="py-3 px-6 w-12 text-center">
                  <input
                    type="checkbox"
                    className="w-4 h-4 cursor-pointer rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                    checked={
                      selectedCvIds.length > 0 &&
                      selectedCvIds.length === filteredCVs.length
                    }
                    onChange={(e) => {
                      if (e.target.checked)
                        setSelectedCvIds(filteredCVs.map((c: any) => c.id));
                      else setSelectedCvIds([]);
                    }}
                  />
                </th>
                {renderColumnHeader("docRef", "DOCUMENT REF")}
                {renderColumnHeader("expert", "EXPERT")}
                {renderColumnHeader("tender", "TENDER")}
                {renderColumnHeader("status", "STATUS")}
                {renderColumnHeader("generatedOn", "GENERATED ON")}
                <th className="px-6 py-4 font-semibold text-[11px] uppercase tracking-wider text-slate-500 whitespace-nowrap text-right">
                  ACTIONS
                </th>
              </tr>
            </thead>
            <tbody>
              {filteredCVs.length > 0 ? (
                filteredCVs.map((cv) => (
                  <tr
                    key={cv.id}
                    className="border-b border-slate-100 hover:bg-slate-50 transition-colors"
                  >
                    <td className="px-6 py-4 text-center">
                      <input
                        type="checkbox"
                        className="w-4 h-4 cursor-pointer rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                        checked={selectedCvIds.includes(cv.id)}
                        onChange={(e) => {
                          if (e.target.checked)
                            setSelectedCvIds((prev) => [...prev, cv.id]);
                          else
                            setSelectedCvIds((prev) =>
                              prev.filter((id) => id !== cv.id),
                            );
                        }}
                      />
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-lg bg-blue-50 flex items-center justify-center text-blue-600">
                          <FileText size={16} />
                        </div>
                        <div className="flex flex-col">
                          <span className="text-sm font-medium text-slate-900 truncate max-w-[150px]">
                            CV_{cv.expertName.split(" ")[0].toUpperCase()}
                          </span>
                          <span className="text-xs text-slate-500">
                            {cv.template || "STANDARD"} v2.1
                          </span>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex flex-col">
                        <span className="text-sm font-medium text-slate-900">
                          {cv.expertName}
                        </span>
                        <span className="text-xs text-blue-600 font-medium">
                          {cv.positionTitle || "Specialist"}
                        </span>
                      </div>
                    </td>
                    <td className="px-6 py-4 max-w-xs">
                      <span className="text-sm text-slate-600 break-words">
                        {cv.tenderName || "INTERNAL"}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-xs font-medium bg-emerald-50 text-emerald-700 border border-emerald-100">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                        Ready
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <span className="text-sm text-slate-600">
                        {new Date(cv.timestamp).toLocaleDateString(undefined, {
                          day: "2-digit",
                          month: "short",
                          year: "numeric",
                        })}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center justify-end gap-2">
                        <div className="flex items-center gap-1 mr-2 border border-slate-200 rounded-lg p-1 bg-white">
                          <select
                            value={targetLang[cv.id] || ""}
                            onChange={(e) =>
                              setTargetLang((prev) => ({
                                ...prev,
                                [cv.id]: e.target.value,
                              }))
                            }
                            className="text-xs bg-transparent outline-none text-slate-600 pl-1 cursor-pointer"
                          >
                            <option value="">Translate...</option>
                            <option value="French">French</option>
                            <option value="Spanish">Spanish</option>
                            <option value="Arabic">Arabic</option>
                            <option value="German">German</option>
                          </select>
                          <button
                            onClick={() => handleTranslateCV(cv)}
                            disabled={
                              translatingId === cv.id || !targetLang[cv.id]
                            }
                            className="text-blue-600 hover:bg-blue-50 p-1.5 rounded disabled:opacity-50 transition-colors"
                            title="Translate CV"
                          >
                            {translatingId === cv.id ? (
                              <Loader2 size={14} className="animate-spin" />
                            ) : (
                              <Languages size={14} />
                            )}
                          </button>
                        </div>
                        <button
                          onClick={() => handleAdaptCV(cv)}
                          disabled={
                            adaptingId === cv.id || renderingId === cv.id
                          }
                          className="text-indigo-700 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 rounded p-1.5 transition-colors flex items-center justify-center disabled:opacity-50"
                          title="Adapt CV"
                        >
                          {adaptingId === cv.id ? (
                            <Loader2 size={16} className="animate-spin" />
                          ) : (
                            <Wand2 size={16} />
                          )}
                        </button>
                        <button
                          onClick={() => handleRenderCV(cv)}
                          disabled={
                            renderingId === cv.id ||
                            adaptingId === cv.id
                          }
                          className="text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded p-1.5 transition-colors flex items-center justify-center disabled:opacity-50 disabled:cursor-not-allowed"
                          title="Render CV (Make 100% matched)"
                        >
                          {renderingId === cv.id ? (
                            <Loader2 size={16} className="animate-spin" />
                          ) : (
                            <BrainCircuit size={16} />
                          )}
                        </button>
                        <button
                          onClick={() => handlePreview(cv)}
                          className="text-slate-400 hover:text-blue-600 transition-colors p-2"
                          title="Preview"
                        >
                          <Eye size={18} />
                        </button>
                        <button
                          onClick={() => handleRegenerate(cv)}
                          disabled={regeneratingIds.includes(cv.id)}
                          className="text-slate-400 hover:text-blue-600 transition-colors p-2 disabled:opacity-50"
                          title="Regenerate"
                        >
                          {regeneratingIds.includes(cv.id) ? (
                            <Loader2
                              size={18}
                              className="animate-spin text-blue-600"
                            />
                          ) : (
                            <RefreshCw size={18} />
                          )}
                        </button>
                        <button
                          onClick={() => handleDownloadDocx(cv)}
                          className="text-blue-600 hover:bg-blue-50 rounded-lg p-2 transition-colors flex items-center justify-center"
                          title="Download Word (DOCX)"
                        >
                          <FileText size={18} />
                        </button>
                        <button
                          onClick={() => handleDownload(cv)}
                          className="text-red-500 hover:bg-red-50 rounded-lg p-2 transition-colors flex items-center justify-center"
                          title="Download PDF"
                        >
                          <Download size={18} />
                        </button>
                        {isAdmin && (
                          <button
                            onClick={() => setConfirmDeleteId(cv.id)}
                            className="text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg p-2 transition-colors flex items-center justify-center"
                            title="Delete CV"
                          >
                            <Trash2 size={18} />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td
                    colSpan={6}
                    className="px-6 py-16 text-center text-sm text-slate-500"
                  >
                    <div className="w-12 h-12 rounded-full bg-slate-50 border border-slate-200 flex items-center justify-center mx-auto mb-3">
                      <FileCheck size={24} className="text-slate-400" />
                    </div>
                    <p className="font-medium text-slate-900 mb-1">
                      No generated CVs in your archive
                    </p>
                    <p>
                      Run a match and trigger 'CV Generation' to see files here.
                    </p>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <ConfirmModal
        isOpen={!!confirmDeleteId}
        title="Delete Generated CV"
        message="Are you sure you want to delete this CV? This cannot be undone."
        confirmText="Delete"
        isDestructive={true}
        onConfirm={() => {
          if (confirmDeleteId) handleDelete(confirmDeleteId);
          setConfirmDeleteId(null);
        }}
        onCancel={() => setConfirmDeleteId(null)}
      />

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
                        onClick={() => handleDownload(previewCv)}
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
                            renderTextLayer={false}
                            renderAnnotationLayer={false}
                          />
                        </div>
                      ))}
                    </Document>
                  ) : (
                    <div className="flex flex-col items-center justify-center gap-3 mt-20">
                      <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
                      <p className="text-slate-500 font-medium">
                        Generating preview...
                      </p>
                    </div>
                  )}
                </div>
              )}
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Floating Action Bar for Bulk Actions */}
      <AnimatePresence>
        {selectedCvIds.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 100 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 100 }}
            className="fixed bottom-8 left-1/2 -translate-x-1/2 z-40 bg-slate-900 shadow-2xl rounded-2xl px-6 py-4 flex items-center gap-6 border border-slate-700/50 backdrop-blur-md"
          >
            <div className="flex items-center gap-3 border-r border-slate-700 pr-6">
              <div className="bg-blue-500 text-white min-w-8 h-8 px-2 rounded-full flex items-center justify-center font-bold text-sm shadow-inner overflow-hidden whitespace-nowrap">
                {selectedCvIds.length}
              </div>
              <span className="text-white font-medium text-sm whitespace-nowrap">
                CVs Selected
              </span>
              <button
                onClick={() => setSelectedCvIds([])}
                className="text-slate-400 hover:text-white text-sm underline ml-2 transition-colors whitespace-nowrap"
              >
                Clear
              </button>
            </div>
            <div className="flex items-center gap-3">
              {(operatingMode === "ALL" || operatingMode === "NORMAL") && (
                <button
                  onClick={handleBulkAdapt}
                  className="flex items-center gap-2 bg-indigo-500/20 hover:bg-indigo-500/30 border border-indigo-500/30 text-indigo-300 px-4 py-2 rounded-lg text-sm font-medium transition-all focus:ring-2 focus:ring-indigo-500 focus:outline-none whitespace-nowrap"
                >
                  <Wand2 size={16} />{" "}
                  {operatingMode === "NORMAL" ? "Adapt Selected" : "Bulk Adapt"}
                </button>
              )}
              {(operatingMode === "ALL" || operatingMode === "ADAPT") && (
                <button
                  onClick={handleBulkRender}
                  className="flex items-center gap-2 bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-500/30 text-emerald-300 px-4 py-2 rounded-lg text-sm font-medium transition-all focus:ring-2 focus:ring-emerald-500 focus:outline-none whitespace-nowrap"
                >
                  <BrainCircuit size={16} />{" "}
                  {operatingMode === "ADAPT"
                    ? "Render Selected"
                    : "Bulk Render"}
                </button>
              )}
              <button
                onClick={handleBulkGenerate}
                className="flex items-center gap-2 bg-blue-600 hover:bg-blue-500 text-white px-5 py-2 rounded-lg text-sm font-medium transition-all shadow-lg shadow-blue-500/20 focus:ring-2 focus:ring-blue-500 focus:outline-none whitespace-nowrap"
              >
                <Download size={16} /> {operatingMode === "RENDER" ? "Download Selected" : "Download Package"}
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {cvToRegenerate && (
        <RegenerateCVModal
          cv={cvToRegenerate}
          onClose={() => setCvToRegenerate(null)}
          onRegenerate={confirmRegenerate}
        />
      )}
    </div>
  );
}
