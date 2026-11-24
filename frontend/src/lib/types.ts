export interface User {
  id: number;
  username: string;
  full_name: string;
  email: string | null;
  is_verified: boolean;
  role: "admin" | "analyst";
  created_at: string | null;
}

export interface LlmStatus {
  configured: boolean;
  base_url: string;
  primary_model: string;
  fallback_model: string;
  available_models: string[];
}

export interface HealthResponse {
  status: string;
  service: string;
  ml_model_loaded: boolean;
  gee_initialized: boolean;
  llm: LlmStatus;
  green_target: number;
  trees_per_hectare: number;
}

export interface AlertItem {
  id: number;
  location: string;
  latitude: number | null;
  longitude: number | null;
  risk_level: "HIGH" | "MEDIUM" | "LOW" | string;
  status: "open" | "investigating" | "resolved";
  notes: string;
  ndvi: number | null;
  vegetation_loss: number | null;
  email_status: string | null;
  created_at: string | null;
}

export interface AnalysisSummary {
  id: number;
  location: string;
  latitude: number | null;
  longitude: number | null;
  geometry_type: string;
  risk_level: string;
  confidence: number | null;
  current_ndvi: number | null;
  vegetation_loss: number | null;
  coverage_percent: number | null;
  rainfall: number | null;
  ai_model: string | null;
  created_at: string | null;
}

export interface WatchlistItem {
  id: number;
  name: string;
  latitude: number | null;
  longitude: number | null;
  boundingbox: number[] | null;
  geojson: GeoJsonPolygon | null;
  target_coverage: number;
  last_risk: string | null;
  last_ndvi: number | null;
  last_checked_at: string | null;
  created_at: string | null;
}

export interface DashboardData {
  user: User;
  stats: {
    total_alerts: number;
    open_alerts: number;
    high_risk_count: number;
    medium_risk_count: number;
    low_risk_count: number;
    total_analyses: number;
    watchlist_count: number;
    green_target: number;
  };
  llm: LlmStatus;
  recent_alerts: AlertItem[];
  recent_analyses: AnalysisSummary[];
  watchlists: WatchlistItem[];
}

export interface LocationSuggestion {
  name: string;
  latitude: number;
  longitude: number;
  boundingbox?: number[] | null;
}

export interface GeoJsonPolygon {
  type: "Polygon";
  coordinates: number[][][];
}

export interface LandCoverClass {
  code?: number;
  class_code?: number;
  name: string;
  area_m2: number;
  area_hectares: number;
  percentage: number;
}

export interface AnnualLossPoint {
  year: number;
  loss_area_m2: number;
  loss_area_hectares: number;
}

export interface MonthlyNdviPoint {
  month: string;
  ndvi: number | null;
  image_count: number;
}

export interface RiskAssessment {
  risk_level: "HIGH" | "MEDIUM" | "LOW" | "UNKNOWN";
  confidence: number | null;
  probabilities: Record<string, number>;
  factors: string[];
  source: string;
}

export interface TreeData {
  coverage_gap: number | null;
  minimum_trees: number | null;
  target: number;
}

export interface StructuredBriefing {
  headline: string;
  summary: string;
  key_signals: string[];
  recommended_actions: string[];
  data_caveat: string;
}

export interface AiBriefingResult {
  briefing: string;
  structured?: StructuredBriefing | null;
  model_used: string;
  language: "en" | "bn";
  fallback_used: boolean;
  error: string | null;
}

export interface AnalyzeResponse {
  analysis_id: number;
  location: {
    name: string;
    latitude: number;
    longitude: number;
    boundingbox: number[] | null;
    boundary_type: string;
  };
  analysis: {
    current_ndvi: number | null;
    previous_ndvi: number | null;
    current_evi: number | null;
    previous_evi: number | null;
    current_nbr: number | null;
    previous_nbr: number | null;
    dnbr: number | null;
    yoy_ndvi: number | null;
    yoy_ndvi_change: number | null;
    monthly_ndvi: MonthlyNdviPoint[];
    ndvi_tile_url: string | null;
    landcover_tile_url: string | null;
    hansen_loss_tile_url: string | null;
    landcover_classes: LandCoverClass[];
    vegetation_loss: number | null;
    rainfall: number | null;
    ndvi_change: number | null;
    current_image_count: number;
    previous_image_count: number;
    total_area_m2: number | null;
    current_coverage_percent: number | null;
    analysis_start: string;
    analysis_end: string;
    previous_start: string;
    previous_end: string;
    geometry_type: string;
    historical_forest_loss: {
      dataset: string;
      baseline_forest_area_hectares: number;
      total_forest_loss_hectares: number;
      historical_loss_percent: number | null;
      recent_5_year_loss_hectares: number;
      annual_loss: AnnualLossPoint[];
    };
  };
  risk: RiskAssessment;
  explanations: Record<string, string>;
  tree_data: TreeData;
  ai: AiBriefingResult | null;
  alert: AlertItem | null;
  email_status: string;
}

export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
  model_used?: string;
}
