import axios from "axios";

const BASE = process.env.REACT_APP_BACKEND_URL;
export const API = `${BASE}/api`;

export const api = axios.create({ baseURL: API, withCredentials: true });

export const PROGRAM_COLORS = [
  { bg: "#DBEAFE", border: "#3B82F6", text: "#1E40AF" },
  { bg: "#DCFCE7", border: "#22C55E", text: "#166534" },
  { bg: "#FEF3C7", border: "#F59E0B", text: "#92400E" },
  { bg: "#F3E8FF", border: "#A855F7", text: "#6B21A8" },
  { bg: "#FFE4E6", border: "#F43F5E", text: "#9F1239" },
  { bg: "#CFFAFE", border: "#06B6D4", text: "#155E75" },
  { bg: "#FCE7F3", border: "#EC4899", text: "#9D174D" },
  { bg: "#E0E7FF", border: "#6366F1", text: "#3730A3" },
  { bg: "#D1FAE5", border: "#10B981", text: "#065F46" },
  { bg: "#FFEDD5", border: "#F97316", text: "#9A3412" },
];

export function programColor(id) {
  if (!id) return PROGRAM_COLORS[0];
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % 997;
  return PROGRAM_COLORS[h % PROGRAM_COLORS.length];
}
