import { BrowserRouter, Routes, Route } from "react-router-dom";
import Sidebar from "@/components/Sidebar";
import Footer from "@/components/Footer";
import RequireAuth from "@/components/RequireAuth";
import { Toaster } from "@/components/ui/sonner";
import { AuthProvider } from "@/context/AuthContext";
import { ThemeProvider } from "@/context/ThemeContext";
import Dashboard from "@/pages/Dashboard";
import Attendance from "@/pages/Attendance";
import CalendarPage from "@/pages/CalendarPage";
import Programs from "@/pages/Programs";
import Sow from "@/pages/SOW";
import Help from "@/pages/Help";
import Login from "@/pages/Login";
import ChangePassword from "@/pages/ChangePassword";
import AuditLog from "@/pages/AuditLog";
import Settings from "@/pages/Settings";

function Shell({ children }) {
  return (
    <div className="min-h-screen bg-background">
      <Sidebar />
      <main className="app-content ml-64 min-h-screen">
        <div className="mx-auto max-w-7xl px-8 py-8">
          <div className="fade-in">{children}</div>
          <Footer />
        </div>
      </main>
    </div>
  );
}

function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <BrowserRouter>
          <Toaster position="top-right" richColors />
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/viewer" element={<Login viewer />} />
            <Route path="/change-password" element={<ChangePassword />} />
            <Route path="/" element={<RequireAuth><Shell><Dashboard /></Shell></RequireAuth>} />
            <Route path="/attendance" element={<RequireAuth><Shell><Attendance /></Shell></RequireAuth>} />
            <Route path="/calendar" element={<RequireAuth><Shell><CalendarPage /></Shell></RequireAuth>} />
            <Route path="/programs" element={<RequireAuth><Shell><Programs /></Shell></RequireAuth>} />
            <Route path="/sow" element={<RequireAuth><Shell><Sow /></Shell></RequireAuth>} />
            <Route path="/help" element={<RequireAuth><Shell><Help /></Shell></RequireAuth>} />
            <Route path="/audit" element={<RequireAuth adminOnly><Shell><AuditLog /></Shell></RequireAuth>} />
            <Route path="/settings" element={<RequireAuth adminOnly><Shell><Settings /></Shell></RequireAuth>} />
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </ThemeProvider>
  );
}

export default App;
