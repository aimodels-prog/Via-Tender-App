import React, { useState, useEffect } from "react";
import {
  Upload,
  Search,
  FileText,
  Plus,
  Loader2,
  Calendar,
  Building2,
  Target,
  Settings2,
  ChevronDown,
  ChevronUp,
  UserCog,
  Trash2,
  ArrowUpAZ,
  ArrowDownZA,
  CheckCircle,
  AlertCircle,
  Pencil,
} from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "motion/react";
import clsx from "clsx";
import { api, extractTenderTextFromFile } from "../lib/api";
import { parseTenderPdfFiles, parseTenderText } from "../lib/gemini";
import { BrandingModal } from "../components/BrandingModal";
import { ConfirmTenderModal } from "../components/ConfirmTenderModal";
import { ConfigRequirementsModal } from "../components/ConfigRequirementsModal";
import { EditTenderModal } from "../components/EditTenderModal";
import { useTasks } from "../lib/TasksContext";
import ConfirmModal from "../components/ConfirmModal";
import { useAuth } from "../lib/auth";

const isCloseToDeadline = (deadlineStr: string) => {
  if (!deadlineStr) return false;
  const deadline = new Date(deadlineStr);
  const now = new Date();
  const diffDays = Math.ceil(
    (deadline.getTime() - now.getTime()) / (1000 * 3600 * 24),
  );
  return diffDays >= 0 && diffDays <= 7;
};

const estimateTenderParsingSeconds = (files: File[]) => {
  const totalMb = files.reduce((sum, file) => sum + file.size / (1024 * 1024), 0);
  const pdfCount = files.filter((file) => file.name.toLowerCase().endsWith(".pdf")).length;
  const base = 25;
  const fileCost = files.length * 12;
  const sizeCost = totalMb * 2.5;
  const pdfCost = pdfCount * 18;
  return Math.max(45, Math.ceil(base + fileCost + sizeCost + pdfCost));
};

const formatEtaMessage = (seconds: number) => {
  if (!Number.isFinite(seconds) || seconds <= 0) return "Calculating...";
  if (seconds < 60) return `~${Math.ceil(seconds)}s`;
  const minutes = Math.floor(seconds / 60);
  const remaining = Math.ceil(seconds % 60);
  return remaining ? `~${minutes}m ${remaining}s` : `~${minutes}m`;
};

export default function Tenders() {
  const { isAdmin } = useAuth();
  const navigate = useNavigate();
  const [tenders, setTenders] = useState<any[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("All Status");
  const [selectedTenderForBranding, setSelectedTenderForBranding] = useState<
    any | null
  >(null);
  const [selectedTenderForConfig, setSelectedTenderForConfig] = useState<
    any | null
  >(null);
  const [selectedTenderForEditing, setSelectedTenderForEditing] = useState<
    any | null
  >(null);

  const { tasks, addTask, updateTask, pendingTender, setPendingTender } =
    useTasks();

  const [matchRates, setMatchRates] = useState<Record<string, string>>({});

  const isUploading = tasks.some(
    (t) => t.type === "UPLOAD" && t.status === "running",
  );

  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [sortConfig, setSortConfig] = useState<{
    key: string;
    direction: "asc" | "desc";
  } | null>(null);
  const [columnFilters, setColumnFilters] = useState<Record<string, string>>(
    {},
  );
  const [activeColumnMenu, setActiveColumnMenu] = useState<string | null>(null);
  const activeColumnMenuRef = React.useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetchTenders();
    const handleUpdate = () => fetchTenders();
    window.addEventListener("tenders-updated", handleUpdate);
    return () => window.removeEventListener("tenders-updated", handleUpdate);
  }, [tasks]);

  useEffect(() => {
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

  const handleDeleteTender = async (tenderId: string) => {
    await api.deleteTender(tenderId);
    fetchTenders();
  };

  const fetchTenders = async () => {
    try {
      const data = await api.getTenders();
      const allMatches = await api.getMatches();

      const rates: Record<string, string> = {};

      data.forEach((tender: any) => {
        const tenderMatches = allMatches.filter(
          (m: any) => m.tenderId === tender.id,
        );
        const positions = tender.positions || [];

        let matchedCount = 0;

        if (positions.length === 0) {
          rates[tender.id] = "-";
          if (tenderMatches.length > 0) {
            matchedCount = new Set(tenderMatches.map((m: any) => m.positionId))
              .size;
          }
        } else {
          // Count positions that have at least one match
          const matchedPositions = new Set(
            tenderMatches.map((m: any) => m.positionId),
          );
          matchedCount = matchedPositions.size;
          const rate = Math.round((matchedCount / positions.length) * 100);
          rates[tender.id] = `${rate}% ( ${matchedCount}/${positions.length} )`;
        }

        // Compute Status
        if (tenderMatches.length === 0) {
          tender.status = "Tender Extraction Completed";
        } else if (positions.length > 0 && matchedCount === positions.length) {
          tender.status = "Matching Completed";
        } else {
          tender.status = "Matching Partial";
        }
      });

      setTenders(data);
      setMatchRates(rates);
    } catch (err) {
      console.error(err);
    }
  };

  const filteredTenders = tenders
    .filter((t) => {
      const matchesSearch =
        t.name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        t.client?.toLowerCase().includes(searchQuery.toLowerCase());
      if (!matchesSearch) return false;

      if (statusFilter !== "All Status" && t.status !== statusFilter) {
        return false;
      }

      // Column filters
      for (const [key, value] of Object.entries(columnFilters)) {
        if (!value) continue;

        const v = String(value).toLowerCase();
        let tenderVal = "";

        if (key === "internal_code")
          tenderVal = (
            t.internal_code ||
            t.id?.toString().substring(0, 8) ||
            "UNKNOWN"
          ).toUpperCase();
        else if (key === "name")
          tenderVal = (t.name || "Untitled Tender").toLowerCase();
        else if (key === "client")
          tenderVal = (t.client || "Confidential Authority").toLowerCase();
        else if (key === "type")
          tenderVal = (
            t.project_sector && t.project_sector.length > 0
              ? t.project_sector.join(", ")
              : t.tender_format || "GEN-X1"
          ).toLowerCase();
        else if (key === "status")
          tenderVal = (t.status || "OPEN").toLowerCase();
        else if (key === "matchRate")
          tenderVal = (matchRates[t.id] || "-").toLowerCase();

        if (!tenderVal.includes(v)) return false;
      }

      return true;
    })
    .sort((a, b) => {
      if (!sortConfig) return 0;
      const { key, direction } = sortConfig;
      const mod = direction === "asc" ? 1 : -1;

      let aVal: any = "";
      let bVal: any = "";

      if (key === "internal_code") {
        aVal = a.internal_code || a.id?.toString().substring(0, 8) || "";
        bVal = b.internal_code || b.id?.toString().substring(0, 8) || "";
      } else if (key === "name") {
        aVal = a.name || "";
        bVal = b.name || "";
      } else if (key === "client") {
        aVal = a.client || "";
        bVal = b.client || "";
      } else if (key === "type") {
        aVal = a.tender_format || "";
        bVal = b.tender_format || "";
      } else if (key === "status") {
        aVal = a.status || "";
        bVal = b.status || "";
      } else if (key === "matchRate") {
        aVal = matchRates[a.id] || "";
        bVal = matchRates[b.id] || "";
      } else if (key === "lastMatched") {
        aVal = new Date(a.last_matched_at || 0).getTime();
        bVal = new Date(b.last_matched_at || 0).getTime();
      } else if (key === "deadline") {
        aVal = new Date(a.deadline || 0).getTime();
        bVal = new Date(b.deadline || 0).getTime();
      } else if (key === "created") {
        aVal = new Date(a.created_at || 0).getTime();
        bVal = new Date(b.created_at || 0).getTime();
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

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const fileList = Array.from(files) as File[];
    e.target.value = ""; // Clear value to allow same file reselection

    const taskId = addTask({
      type: "UPLOAD",
      title: "Tender Parsing Integration",
      message:
        fileList.length > 1
          ? `Extracting text from ${fileList.length} tender documents...`
          : "Extracting text from tender document...",
    });

    const estimatedSeconds = estimateTenderParsingSeconds(fileList);
    const startedAt = Date.now();
    const allPdf = fileList.every((file) => file.name.toLowerCase().endsWith('.pdf'));
    const progressStages = [
      { at: 0.15, text: "Extracting text from uploaded document pages..." },
      { at: 0.38, text: "Selecting relevant tender, TOR, staffing, and evaluation pages..." },
      { at: 0.62, text: "AI is extracting tender fields and personnel requirements..." },
      { at: 0.82, text: "Merging roles, tables, duties, and qualification requirements..." },
      { at: 0.92, text: "Preparing human verification review..." },
    ];
    let lastStageIndex = -1;
    const interval = setInterval(() => {
      const elapsedSeconds = Math.max(1, Math.floor((Date.now() - startedAt) / 1000));
      const ratio = elapsedSeconds / estimatedSeconds;
      const percent = Math.min(92, Math.max(5, Math.round(ratio * 90)));
      const eta = Math.max(8, Math.ceil(estimatedSeconds - elapsedSeconds));
      const stageIndex = progressStages.reduce((current, stage, index) => (ratio >= stage.at ? index : current), 0);
      const stageMessage = progressStages[stageIndex]?.text;
      if (stageIndex !== lastStageIndex) lastStageIndex = stageIndex;
      updateTask(taskId, {
        percent,
        eta,
        ...(stageMessage ? { message: stageMessage } : {}),
      });
    }, 1500);

    try {
      updateTask(taskId, {
        percent: 5,
        eta: estimatedSeconds,
        message:
          fileList.length > 1
            ? `Reading ${fileList.length} document(s). Estimated ${formatEtaMessage(estimatedSeconds)}.`
            : `Reading tender document. Estimated ${formatEtaMessage(estimatedSeconds)}.`,
      });
      let parsedTender: any;
      if (allPdf) {
        parsedTender = await parseTenderPdfFiles(fileList);
      } else {
        let combinedText = "";
        for (let i = 0; i < fileList.length; i++) {
          const text = await extractTenderTextFromFile(fileList[i]);
          combinedText += `--- TENDER DOC: ${fileList[i].name} ---\n${text}\n\n`;
        }
        parsedTender = await parseTenderText(combinedText);
      }

      updateTask(taskId, {
        status: "completed",
        percent: 100,
        eta: 0,
        message: "AI Extraction complete. Please verify in the popup.",
      });

      clearInterval(interval);
      await setPendingTender({
        ...parsedTender,
        _taskId: taskId, // Store task ID to finish it later
      });
    } catch (err: any) {
      clearInterval(interval);
      console.error(err);
      updateTask(taskId, {
        status: "error",
        message: err.message,
      });
    } finally {
      e.target.value = "";
    }
  };

  const handleSaveConfig = async (updatedTender: any) => {
    await api.updateTenderRequirements(
      updatedTender.id,
      updatedTender.requirements,
    );
    fetchTenders();
  };

  return (
    <div className="space-y-6 max-w-full w-full mx-auto pb-32">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-slate-900">Tenders</h2>
          <p className="text-sm text-slate-500 mt-1">
            Manage project tenders and requirements
          </p>
        </div>

        <label
          className={clsx(
            "flex justify-center items-center gap-2 px-4 py-2.5 bg-[#2563eb] hover:bg-blue-700 rounded-lg text-sm font-medium text-white transition-colors cursor-pointer shadow-sm w-full sm:w-auto",
            isUploading && "opacity-50 cursor-not-allowed",
          )}
        >
          {isUploading ? (
            <Loader2 size={16} className="animate-spin" />
          ) : (
            <Plus size={16} />
          )}
          {isUploading ? "Uploading..." : "Upload Tender Documents"}
          <input
            type="file"
            multiple
            className="hidden"
            onChange={handleUpload}
            disabled={isUploading}
          />
        </label>
      </div>

      {/* Filters & Search */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-4 bg-white p-4 rounded-xl border border-slate-200">
        <div className="relative flex-1 min-w-0">
          <Search
            className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 shrink-0"
            size={16}
          />
          <input
            type="text"
            placeholder="Search tenders by name, client, or long queries..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 bg-white border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 min-w-0 transition-all shadow-sm placeholder:text-slate-400"
          />
        </div>
        <div className="flex flex-col sm:flex-row items-center gap-3 w-full sm:w-auto shrink-0">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="w-full sm:w-auto border border-slate-300 rounded-lg px-3 py-2.5 text-sm bg-white outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all shadow-sm cursor-pointer min-w-0 sm:min-w-[160px] text-ellipsis overflow-hidden"
          >
            <option>All Status</option>
            <option>Tender Extraction Processing</option>
            <option>Tender Extraction Completed</option>
            <option>Tender Extraction Failed</option>
            <option>Matching Processing</option>
            <option>Matching Completed</option>
            <option>Matching Failed</option>
            <option>Matching Partial</option>
          </select>
          <select className="w-full sm:w-auto border border-slate-300 rounded-lg px-3 py-2.5 text-sm bg-white outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all shadow-sm cursor-pointer min-w-0 sm:min-w-[140px] text-ellipsis overflow-hidden">
            <option>All Types</option>
          </select>
        </div>
      </div>

      {/* Table Container */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden flex flex-col">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse min-w-[1200px]">
            <thead>
              <tr className="border-b border-slate-200 bg-[#fafafa]">
                <th className="px-6 py-4 font-semibold text-[11px] uppercase tracking-wider text-slate-500 whitespace-nowrap w-16">
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      className="rounded border-slate-300 text-blue-600 focus:ring-blue-500 w-4 h-4 cursor-pointer"
                    />
                  </div>
                </th>
                {renderColumnHeader("internal_code", "INTERNAL CODE")}
                {renderColumnHeader("name", "TENDER DETAILS")}
                {renderColumnHeader("client", "CLIENT")}
                {renderColumnHeader("type", "TYPE")}
                {renderColumnHeader("status", "STATUS")}
                {renderColumnHeader("matchRate", "MATCH RATE")}
                {renderColumnHeader("lastMatched", "LAST MATCHED")}
                {renderColumnHeader("deadline", "DEADLINE")}
                {renderColumnHeader("created", "CREATED")}
                <th className="px-6 py-4 font-semibold text-[11px] uppercase tracking-wider text-slate-500 whitespace-nowrap">
                  ACTIONS
                </th>
              </tr>
            </thead>
            <tbody>
              {filteredTenders.length > 0 ? (
                filteredTenders.map((tender) => (
                  <tr
                    key={tender.id}
                    className="border-b border-slate-100 hover:bg-slate-50 transition-colors group cursor-pointer"
                    onClick={() => navigate(`/tenders/${tender.id}/details`)}
                  >
                    <td
                      className="px-6 py-4"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <input
                        type="checkbox"
                        className="rounded border-slate-300 text-blue-600 focus:ring-blue-500 w-4 h-4 cursor-pointer"
                      />
                    </td>
                    <td className="px-6 py-4">
                      <span className="text-sm font-medium text-slate-900">
                        {tender.internal_code
                          ? tender.internal_code
                          : `#${tender.id?.toString().substring(0, 8).toUpperCase() || "UNKNOWN"}`}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-sm text-slate-600 max-w-[400px] whitespace-normal break-words">
                      <div>
                        {tender.name ||
                          tender.tender_title ||
                          "Untitled Tender"}
                      </div>
                    </td>
                    <td className="px-6 py-4 text-sm text-slate-600 truncate max-w-[300px]">
                      {tender.client || "Confidential Authority"}
                    </td>
                    <td className="px-6 py-4 text-sm text-slate-600">
                      {tender.project_sector && tender.project_sector.length > 0
                        ? tender.project_sector.join(", ")
                        : tender.tender_format || "GEN-X1"}
                    </td>
                    <td className="px-6 py-4">
                      {tender.status === "Matching Completed" ? (
                        <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-xs font-medium bg-emerald-50 text-emerald-700 border border-emerald-100/50">
                          <CheckCircle size={12} className="text-emerald-500" />
                          {tender.status}
                        </span>
                      ) : tender.status?.includes("Partial") ||
                        tender.status === "Tender Extraction Completed" ||
                        tender.status?.includes("Processing") ? (
                        <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-xs font-medium bg-amber-50 text-amber-700 border border-amber-100/50">
                          <div
                            className={clsx(
                              "w-1.5 h-1.5 rounded-full bg-amber-500",
                              tender.status?.includes("Processing") &&
                                "animate-pulse",
                            )}
                          ></div>
                          {tender.status}
                        </span>
                      ) : tender.status?.includes("Failed") ? (
                        <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-xs font-medium bg-red-50 text-red-700 border border-red-100/50">
                          <span className="w-1.5 h-1.5 rounded-full bg-red-500"></span>
                          {tender.status}
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-xs font-medium bg-slate-100 text-slate-600 border border-slate-200">
                          <span className="w-1.5 h-1.5 rounded-full bg-slate-400"></span>
                          {tender.status || "Tender Extraction Completed"}
                        </span>
                      )}
                    </td>
                    <td className="px-6 py-4 text-sm text-slate-600">
                      {matchRates[tender.id] || "-"}
                    </td>
                    <td className="px-6 py-4 text-sm text-slate-600">
                      {tender.last_matched_at
                        ? (() => {
                            const d = new Date(tender.last_matched_at);
                            const pad = (num: number) =>
                              num.toString().padStart(2, "0");
                            return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
                          })()
                        : "-"}
                    </td>
                    <td className="px-6 py-4 text-sm text-slate-600">
                      {tender.deadline ? (
                        <div className="flex items-center gap-2">
                          <span
                            className={
                              isCloseToDeadline(tender.deadline)
                                ? "text-red-600 font-medium"
                                : ""
                            }
                          >
                            {new Date(tender.deadline).toLocaleDateString()}
                          </span>
                          {isCloseToDeadline(tender.deadline) && (
                            <span className="text-[10px] font-bold uppercase tracking-wider bg-red-100 text-red-600 px-1.5 py-0.5 rounded flex items-center gap-1">
                              <AlertCircle size={10} /> Soon
                            </span>
                          )}
                        </div>
                      ) : (
                        "TBA"
                      )}
                    </td>
                    <td className="px-6 py-4 text-sm text-slate-600">
                      {tender.created_at
                        ? new Date(tender.created_at).toLocaleDateString()
                        : "-"}
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        <Link
                          to={`/tenders/${tender.id}`}
                          className="text-blue-600 hover:underline text-sm font-medium"
                        >
                          Match
                        </Link>
                        <button
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            setSelectedTenderForEditing(tender);
                          }}
                          className="text-slate-400 hover:text-blue-600 transition-colors"
                          title="Edit Tender Details"
                        >
                          <Pencil size={16} />
                        </button>
                        <button
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            setSelectedTenderForConfig(tender);
                          }}
                          className="text-slate-400 hover:text-blue-600 transition-colors"
                          title="Configure Requirements & Quota"
                        >
                          <UserCog size={16} />
                        </button>
                        <button
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            setSelectedTenderForBranding(tender);
                          }}
                          className="text-slate-400 hover:text-blue-600 transition-colors"
                          title="Configure Branding"
                        >
                          <Settings2 size={16} />
                        </button>
                        {isAdmin && (
                          <button
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              setConfirmDeleteId(tender.id);
                            }}
                            className="text-slate-400 hover:text-red-600 transition-colors"
                            title="Delete Tender"
                          >
                            <Trash2 size={16} />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={10} className="px-6 py-24 text-center bg-white">
                    <div className="flex flex-col items-center justify-center">
                      <div className="w-16 h-16 bg-slate-50 border border-slate-100 rounded-2xl flex items-center justify-center mb-4">
                        <Upload className="text-slate-400" size={24} />
                      </div>
                      <h3 className="text-base font-semibold text-slate-900 mb-1">
                        No tenders uploaded
                      </h3>
                      <p className="text-sm text-slate-500 max-w-sm mx-auto mb-6">
                        Upload one or multiple documents simultaneously (e.g.,
                        Primary + Scope/TOR) for a single tender. The AI will
                        consolidate roles and requirements from all uploaded
                        documents before the matching process.
                      </p>
                      <label
                        className={clsx(
                          "flex justify-center items-center gap-2 px-4 py-2 bg-blue-50 text-blue-600 hover:bg-blue-100 rounded-lg text-sm font-medium transition-colors cursor-pointer w-auto",
                          isUploading && "opacity-50 cursor-not-allowed",
                        )}
                      >
                        {isUploading ? (
                          <Loader2 size={16} className="animate-spin" />
                        ) : (
                          <Plus size={16} />
                        )}
                        {isUploading ? "Uploading..." : "Browse Files"}
                        <input
                          type="file"
                          multiple
                          className="hidden"
                          onChange={handleUpload}
                          disabled={isUploading}
                        />
                      </label>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
      <>
        <ConfirmModal
          isOpen={!!confirmDeleteId}
          title="Delete Tender"
          message="Are you sure you want to delete this Tender? Matches will also be deleted. This action cannot be undone."
          confirmText="Delete"
          isDestructive={true}
          onConfirm={() => {
            if (confirmDeleteId) handleDeleteTender(confirmDeleteId);
            setConfirmDeleteId(null);
          }}
          onCancel={() => setConfirmDeleteId(null)}
        />
        {selectedTenderForBranding && (
          <BrandingModal
            tender={selectedTenderForBranding}
            onClose={() => setSelectedTenderForBranding(null)}
            onSave={fetchTenders}
          />
        )}

        {selectedTenderForConfig && (
          <ConfigRequirementsModal
            tender={selectedTenderForConfig}
            onClose={() => setSelectedTenderForConfig(null)}
            onSave={handleSaveConfig}
          />
        )}

        {selectedTenderForEditing && (
          <EditTenderModal
            isOpen={true}
            tender={selectedTenderForEditing}
            onClose={() => setSelectedTenderForEditing(null)}
            onSave={fetchTenders}
          />
        )}
      </>
    </div>
  );
}

const shimmer = `
  @keyframes shimmer {
    0% { transform: translateX(-100%); }
    100% { transform: translateX(200%); }
  }
`;
