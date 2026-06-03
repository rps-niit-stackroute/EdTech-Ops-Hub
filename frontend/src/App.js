import { BrowserRouter, Routes, Route } from "react-router-dom";
import Sidebar from "@/components/Sidebar";
import Footer from "@/components/Footer";
import { Toaster } from "@/components/ui/sonner";
import { AuthProvider } from "@/context/AuthContext";
import Dashboard from "@/pages/Dashboard";
import Attendance from "@/pages/Attendance";
import CalendarPage from "@/pages/CalendarPage";
import Programs from "@/pages/Programs";
import SOW from "@/pages/SOW";
import Login from "@/pages/Login";
import ChangePassword from "@/pages/ChangePassword";
import AuditLog from "@/pages/AuditLog";
import Settings from "@/pages/Settings";

function Shell({ children }) {
  return (
    <div className="min-h-screen bg-[#f8f9fa]">
      <Sidebar />
      <main className="ml-64 min-h-screen">
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
    <AuthProvider>
      <BrowserRouter>
        <Toaster position="top-right" richColors />
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/viewer" element={<Login viewer />} />
          <Route path="/change-password" element={<ChangePassword />} />
          <Route path="/" element={<Shell><Dashboard /></Shell>} />
          <Route path="/attendance" element={<Shell><Attendance /></Shell>} />
          <Route path="/calendar" element={<Shell><CalendarPage /></Shell>} />
          <Route path="/programs" element={<Shell><Programs /></Shell>} />
          <Route path="/sow" element={<Shell><SOW /></Shell>} />
          <Route path="/audit" element={<Shell><AuditLog /></Shell>} />
          <Route path="/settings" element={<Shell><Settings /></Shell>} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}

export default App;
