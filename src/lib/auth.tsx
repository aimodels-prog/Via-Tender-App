import React, { createContext, useContext, useEffect, useMemo, useState } from "react";

export type AppRole = "Admin" | "User";

export interface AppUser {
  id: string;
  name: string;
  email: string;
  role: AppRole;
  status: "Active" | "Inactive";
  lastLogin?: string | null;
}

interface AuthContextValue {
  currentUser: AppUser | null;
  isAdmin: boolean;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<{ success: boolean; error?: string }>;
  emergencyLogin: (email: string, password: string) => Promise<{ success: boolean; error?: string }>;
  register: (values: {
    name: string;
    email: string;
    password: string;
  }) => Promise<{ success: boolean; error?: string }>;
  logout: () => void;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function normalizeUser(user: any): AppUser {
  return {
    id: String(user.id),
    name: user.name || user.fullName || "User",
    email: user.email || "",
    role: user.role === "Admin" ? "Admin" : "User",
    status: user.status === "Inactive" ? "Inactive" : "Active",
    lastLogin: user.lastLogin || null,
  };
}

async function authRequest(url: string, body?: any) {
  const response = await fetch(url, {
    method: body ? "POST" : "GET",
    credentials: "include",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    return { success: false, error: data.error || `Request failed: ${response.status}` };
  }
  return { success: true, ...data };
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [currentUser, setCurrentUser] = useState<AppUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const refreshUser = async () => {
    setIsLoading(true);
    const result = await authRequest("/api/auth/me");
    setCurrentUser(result.user ? normalizeUser(result.user) : null);
    window.dispatchEvent(new Event("authChanged"));
    setIsLoading(false);
  };

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const portalToken = params.get("portal_token");
    if (portalToken) {
      const cleanUrl = new URL(window.location.href);
      cleanUrl.searchParams.delete("portal_token");
      window.location.replace(`/auth/portal/callback?portal_token=${encodeURIComponent(portalToken)}&returnTo=${encodeURIComponent(cleanUrl.toString())}`);
      return;
    }
    refreshUser();
  }, []);

  const login = async (email: string, password: string) => {
    const result = await authRequest("/api/auth/login", { email, password });
    if (!result.success) return { success: false, error: result.error };
    setCurrentUser(normalizeUser(result.user));
    window.dispatchEvent(new Event("authChanged"));
    window.dispatchEvent(new Event("settingsUpdated"));
    return { success: true };
  };

  const emergencyLogin = async (email: string, password: string) => {
    const result = await authRequest("/api/auth/emergency-login", { email, password });
    if (!result.success) return { success: false, error: result.error };
    setCurrentUser(normalizeUser(result.user));
    window.dispatchEvent(new Event("authChanged"));
    window.dispatchEvent(new Event("settingsUpdated"));
    return { success: true };
  };

  const register = async (values: { name: string; email: string; password: string }) => {
    const name = values.name.trim();
    const email = values.email.trim().toLowerCase();
    const password = values.password;

    if (!name) return { success: false, error: "Full name is required." };
    if (!email) return { success: false, error: "Email address is required." };
    if (password.length < 6) {
      return { success: false, error: "Password must be at least 6 characters." };
    }

    const result = await authRequest("/api/auth/register", { name, email, password });
    if (!result.success) return { success: false, error: result.error };
    setCurrentUser(normalizeUser(result.user));
    window.dispatchEvent(new Event("authChanged"));
    return { success: true };
  };

  const logout = () => {
    setCurrentUser(null);
    window.dispatchEvent(new Event("authChanged"));
    fetch("/api/auth/logout", { method: "POST", credentials: "include" })
      .then((response) => response.json().catch(() => ({})))
      .then((data) => {
        window.location.replace(data.redirectTo || "https://portal.via-int.com");
      })
      .catch((error) => {
        console.error("Logout request failed:", error);
        window.location.replace("https://portal.via-int.com");
      });
  };

  const value = useMemo<AuthContextValue>(
    () => ({
      currentUser,
      isAdmin: currentUser?.role === "Admin",
      isAuthenticated: !!currentUser,
      isLoading,
      login,
      emergencyLogin,
      register,
      logout,
      refreshUser,
    }),
    [currentUser, isLoading],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used inside AuthProvider");
  }
  return context;
}
