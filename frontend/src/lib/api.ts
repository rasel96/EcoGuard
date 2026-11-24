import type {
  AiBriefingResult,
  AlertItem,
  AnalyzeResponse,
  ChatTurn,
  DashboardData,
  GeoJsonPolygon,
  HealthResponse,
  LocationSuggestion,
  User,
  WatchlistItem,
} from "./types";

const API_BASE = (
  process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:5000"
).replace(/\/$/, "");

const TOKEN_STORAGE_KEY = "ecoguard_api_token";

export function getStoredToken(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(TOKEN_STORAGE_KEY);
}

export function setStoredToken(token: string | null): void {
  if (typeof window === "undefined") return;
  if (token) {
    window.localStorage.setItem(TOKEN_STORAGE_KEY, token);
  } else {
    window.localStorage.removeItem(TOKEN_STORAGE_KEY);
  }
}

async function apiFetch<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const token = getStoredToken();
  const headers = new Headers(options.headers || {});
  if (!headers.has("Content-Type") && options.body) {
    headers.set("Content-Type", "application/json");
  }
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
    credentials: "include",
  });

  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const errBody = await res.json();
      if (errBody?.error) message = errBody.error;
    } catch {
      // ignore non-JSON body
    }
    throw new Error(message);
  }

  return res.json() as Promise<T>;
}

export const api = {
  health: () => apiFetch<HealthResponse>("/api/v1/health"),

  login: async (emailOrUsername: string, password: string) => {
    const res = await apiFetch<{ token: string; user: User }>("/api/v1/auth/login", {
      method: "POST",
      body: JSON.stringify({ email_or_username: emailOrUsername, password }),
    });
    setStoredToken(res.token);
    return res;
  },

  signup: async (payload: {
    full_name: string;
    username: string;
    email: string;
    password: string;
  }) => {
    const res = await apiFetch<{
      user: User;
      token: string | null;
      requires_verification: boolean;
    }>("/api/v1/auth/signup", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    if (res.token) setStoredToken(res.token);
    return res;
  },

  me: () => apiFetch<{ user: User }>("/api/v1/auth/me"),

  logout: async () => {
    try {
      await apiFetch<{ logged_out: boolean }>("/api/v1/auth/logout", {
        method: "POST",
      });
    } catch {
      // Ignore network/expiry errors on logout
    } finally {
      setStoredToken(null);
    }
  },

  dashboard: () => apiFetch<DashboardData>("/api/v1/dashboard"),

  suggestLocations: (q: string) =>
    apiFetch<{ suggestions: LocationSuggestion[] }>(
      `/api/v1/locations/suggest?q=${encodeURIComponent(q)}`
    ),

  analyze: (payload: {
    location?: string;
    geojson?: GeoJsonPolygon | null;
    include_extended?: boolean;
    include_ai?: boolean;
    language?: "en" | "bn";
    model?: string;
  }) =>
    apiFetch<AnalyzeResponse>("/api/v1/analyze", {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  aiBriefing: (payload: {
    location: string;
    analysis: unknown;
    risk: unknown;
    tree_data: unknown;
    language: "en" | "bn";
    model: string;
  }) =>
    apiFetch<AiBriefingResult>("/api/v1/ai/briefing", {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  aiChat: (payload: {
    question: string;
    context: unknown;
    history: ChatTurn[];
    language: "en" | "bn";
    model: string;
  }) =>
    apiFetch<{
      reply: string;
      model_used: string;
      language: "en" | "bn";
      fallback_used: boolean;
      error: string | null;
    }>("/api/v1/ai/chat", {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  listWatchlists: () => apiFetch<{ watchlists: WatchlistItem[] }>("/api/v1/watchlists"),

  addWatchlist: (payload: {
    name: string;
    latitude?: number | null;
    longitude?: number | null;
    boundingbox?: number[] | null;
    geojson?: GeoJsonPolygon | null;
    target_coverage?: number;
  }) =>
    apiFetch<{ watchlist: WatchlistItem }>("/api/v1/watchlists", {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  deleteWatchlist: (id: number) =>
    apiFetch<{ deleted: boolean }>(`/api/v1/watchlists/${id}`, {
      method: "DELETE",
    }),

  listAlerts: (filters?: { status?: string; risk_level?: string }) => {
    const params = new URLSearchParams();
    if (filters?.status) params.set("status", filters.status);
    if (filters?.risk_level) params.set("risk_level", filters.risk_level);
    const qs = params.toString() ? `?${params.toString()}` : "";
    return apiFetch<{ alerts: AlertItem[] }>(`/api/v1/alerts${qs}`);
  },

  updateAlert: (id: number, payload: { status?: string; notes?: string }) =>
    apiFetch<{ alert: AlertItem }>(`/api/v1/alerts/${id}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    }),

  downloadAlertsCsv: async () => {
    const token = getStoredToken();
    const res = await fetch(`${API_BASE}/api/v1/alerts/export.csv`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      credentials: "include",
    });
    if (!res.ok) throw new Error("Failed to export alerts CSV");
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "ecoguard_alerts.csv";
    a.click();
    URL.revokeObjectURL(url);
  },

  downloadPdfReport: async (payload: {
    location: string;
    analysis: unknown;
    risk: unknown;
    tree_data: unknown;
    ai_briefing: string;
  }) => {
    const token = getStoredToken();
    const res = await fetch(`${API_BASE}/api/v1/reports/pdf`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      credentials: "include",
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error("Failed to generate PDF report");
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `ecoguard_report_${payload.location.replace(/[^a-z0-9]/gi, "_").slice(0, 32)}.pdf`;
    a.click();
    URL.revokeObjectURL(url);
  },
};
