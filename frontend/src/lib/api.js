import axios from "axios";

const BASE = process.env.REACT_APP_BACKEND_URL;
export const API = `${BASE}/api`;

export const api = axios.create({ baseURL: API, withCredentials: true });

// A 401 mid-session (expired token or an account revoked by an admin) should
// bounce back to the login screen rather than leave the page in a broken state.
api.interceptors.response.use(
  (res) => res,
  (err) => {
    const path = window.location.pathname;
    if (err.response?.status === 401 && path !== "/login" && path !== "/viewer") {
      window.location.href = "/login";
    }
    return Promise.reject(err);
  }
);

export const PROGRAM_COLORS = [
  { bg: "#DBEAFE", border: "#3B82F6", text: "#1E40AF" }, // blue
  { bg: "#DCFCE7", border: "#22C55E", text: "#166534" }, // green
  { bg: "#FEF3C7", border: "#F59E0B", text: "#92400E" }, // amber
  { bg: "#F3E8FF", border: "#A855F7", text: "#6B21A8" }, // purple
  { bg: "#FFE4E6", border: "#F43F5E", text: "#9F1239" }, // rose
  { bg: "#CFFAFE", border: "#06B6D4", text: "#155E75" }, // cyan
  { bg: "#FCE7F3", border: "#EC4899", text: "#9D174D" }, // pink
  { bg: "#E0E7FF", border: "#6366F1", text: "#3730A3" }, // indigo
  { bg: "#D1FAE5", border: "#10B981", text: "#065F46" }, // emerald
  { bg: "#FFEDD5", border: "#F97316", text: "#9A3412" }, // orange
  { bg: "#FEF9C3", border: "#EAB308", text: "#854D0E" }, // yellow
  { bg: "#E0F2FE", border: "#0EA5E9", text: "#075985" }, // sky
  { bg: "#EDE9FE", border: "#8B5CF6", text: "#5B21B6" }, // violet
  { bg: "#FEE2E2", border: "#EF4444", text: "#991B1B" }, // red
  { bg: "#CCFBF1", border: "#14B8A6", text: "#115E59" }, // teal
  { bg: "#FAE8FF", border: "#D946EF", text: "#86198F" }, // fuchsia
];

/**
 * Assigns each program a distinct color, deterministically, by sorted id —
 * a hash-mod assignment (the old approach) can and did put two different
 * programs on the same color by coincidence. Sorting ids and cycling through
 * the palette in order guarantees no collision as long as the number of
 * programs doesn't exceed the palette size, and stays stable across pages
 * and reloads since it only depends on the set of program ids, not fetch order.
 */
export function buildProgramColorMap(programs) {
  const ids = [...new Set(programs.map((p) => (typeof p === "string" ? p : p.id)))]
    .sort((a, b) => a.localeCompare(b));
  const map = {};
  ids.forEach((id, i) => { map[id] = PROGRAM_COLORS[i % PROGRAM_COLORS.length]; });
  return map;
}
