import { BrowserRouter, Routes, Route } from "react-router-dom";
import Sidebar from "@/components/Sidebar";
import Footer from "@/components/Footer";
import { Toaster } from "@/components/ui/sonner";
import Dashboard from "@/pages/Dashboard";
import Attendance from "@/pages/Attendance";
import CalendarPage from "@/pages/CalendarPage";
import Programs from "@/pages/Programs";
import SOW from "@/pages/SOW";

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
    <BrowserRouter>
      <Toaster position="top-right" richColors />
      <Routes>
        <Route path="/" element={<Shell><Dashboard /></Shell>} />
        <Route path="/attendance" element={<Shell><Attendance /></Shell>} />
        <Route path="/calendar" element={<Shell><CalendarPage /></Shell>} />
        <Route path="/programs" element={<Shell><Programs /></Shell>} />
        <Route path="/sow" element={<Shell><SOW /></Shell>} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
