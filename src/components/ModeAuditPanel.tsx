import clsx from "clsx";

export function ModeAuditPanel({ cv }: { cv: any }) {
  const audit = cv?.modeAudit;
  const mode = cv?.mode || (cv?.isRendered ? "RENDER" : cv?.isAdapted ? "ADAPT" : "NORMAL");
  const changes = audit?.protectedFactChanges || [];

  return (
    <div
      className={clsx(
        "border-b px-6 py-3 text-xs",
        mode === "RENDER"
          ? "bg-red-50 border-red-100 text-red-800"
          : mode === "ADAPT"
            ? "bg-amber-50 border-amber-100 text-amber-800"
            : "bg-green-50 border-green-100 text-green-800",
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="font-semibold">
          Mode: {mode === "NORMAL" ? "Normal CV" : mode === "ADAPT" ? "Adapt CV" : "Render CV"}
        </div>
        <div className="font-medium">
          Protected fact changes: {changes.length}
        </div>
      </div>
      {changes.length > 0 && (
        <div className="mt-2 grid grid-cols-1 md:grid-cols-2 gap-1">
          {changes.slice(0, 6).map((change: any, index: number) => (
            <div key={`${change.field}-${index}`} className="truncate">
              <span className="font-semibold">{change.field}:</span>{" "}
              <span>{String(change.before || "blank")}</span>
              <span>{" -> "}</span>
              <span>{String(change.after || "blank")}</span>
            </div>
          ))}
          {changes.length > 6 && <div className="font-semibold">+{changes.length - 6} more changes</div>}
        </div>
      )}
    </div>
  );
}
