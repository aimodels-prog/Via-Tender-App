import React from "react";
import { useTasks } from "../lib/TasksContext";
import { ConfirmTenderModal } from "./ConfirmTenderModal";
import { api } from "../lib/api";

export function GlobalModals() {
  const { pendingTender, setPendingTender, updateTask } = useTasks();

  const confirmSaveTender = async (confirmedTender: any) => {
    try {
      const taskId = confirmedTender._taskId;
      delete confirmedTender._taskId;

      await api.saveTender(confirmedTender);

      if (taskId) {
        updateTask(taskId, {
          message: `Success! Tender ${confirmedTender.name} ingested.`,
        });
      }

      await setPendingTender(null);
      // Dispatch an event so Tenders.tsx can re-fetch if it is mounted
      window.dispatchEvent(new Event("tenders-updated"));
    } catch (err) {
      console.error("Failed to save tender:", err);
    }
  };

  return (
    <>
      {pendingTender && (
        <ConfirmTenderModal
          tender={pendingTender}
          onSave={confirmSaveTender}
          onCancel={async () => {
            if (pendingTender._taskId) {
              updateTask(pendingTender._taskId, {
                status: "error",
                message: "Tender insertion cancelled by user.",
              });
            }
            await setPendingTender(null);
          }}
        />
      )}
    </>
  );
}
