import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  ReactNode,
} from "react";
import { api } from "./api";
import { useAuth } from "./auth";

export type TaskType = "UPLOAD" | "MATCH" | "GENERATE";

export interface AppTask {
  id: string;
  type: TaskType;
  title: string;
  percent: number;
  eta: number;
  status: "running" | "completed" | "error";
  error?: string;
  message?: string;
}

interface TasksContextType {
  tasks: AppTask[];
  addTask: (task: Omit<AppTask, "id" | "status" | "percent" | "eta">) => string;
  updateTask: (id: string, updates: Partial<AppTask>) => void;
  removeTask: (id: string) => void;
  clearCompleted: () => void;
  pendingTender: any | null;
  setPendingTender: (tender: any | null) => Promise<void>;
}

const TasksContext = createContext<TasksContextType | undefined>(undefined);

export function TasksProvider({ children }: { children: ReactNode }) {
  const { isAuthenticated, isLoading } = useAuth();
  const [tasks, setTasks] = useState<AppTask[]>([]);
  const [pendingTender, setPendingTenderState] = useState<any | null>(null);

  const loadPendingTender = useCallback(async () => {
    if (!isAuthenticated) {
      setPendingTenderState(null);
      return;
    }

    try {
      setPendingTenderState(await api.getUserState("pendingTender", null));
    } catch (error: any) {
      if (!String(error?.message || "").toLowerCase().includes("authentication")) {
        console.warn("Pending tender draft could not be loaded:", error);
      }
    }
  }, [isAuthenticated]);

  useEffect(() => {
    if (isLoading) return;
    loadPendingTender();
  }, [isLoading, loadPendingTender]);

  const setPendingTender = useCallback(async (tender: any | null) => {
    setPendingTenderState(tender);
    if (tender) await api.saveUserState("pendingTender", tender);
    else await api.deleteUserState("pendingTender");
  }, []);

  const addTask = useCallback((
    task: Omit<AppTask, "id" | "status" | "percent" | "eta">,
  ) => {
    const id = `task_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const newTask: AppTask = {
      ...task,
      id,
      status: "running",
      percent: 0,
      eta: 0,
    };
    setTasks((prev) => [...prev, newTask]);
    return id;
  }, []);

  const updateTask = useCallback((id: string, updates: Partial<AppTask>) => {
    setTasks((prev) =>
      prev.map((t) => (t.id === id ? { ...t, ...updates } : t)),
    );
  }, []);

  const removeTask = useCallback((id: string) => {
    setTasks((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const clearCompleted = useCallback(() => {
    setTasks((prev) => prev.filter((t) => t.status === "running"));
  }, []);

  return (
    <TasksContext.Provider
      value={{
        tasks,
        addTask,
        updateTask,
        removeTask,
        clearCompleted,
        pendingTender,
        setPendingTender,
      }}
    >
      {children}
    </TasksContext.Provider>
  );
}

export function useTasks() {
  const context = useContext(TasksContext);
  if (context === undefined) {
    throw new Error("useTasks must be used within a TasksProvider");
  }
  return context;
}
