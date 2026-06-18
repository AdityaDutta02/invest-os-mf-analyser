import { Routes, Route } from "react-router-dom";
import { Layout } from "./components/Layout";
import { AnalyseView } from "./screens/AnalyseView";
import { CompareView } from "./screens/CompareView";
import { ScreenView } from "./screens/ScreenView";
import { UploadView } from "./screens/UploadView";

export function AppRoutes() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<AnalyseView />} />
        <Route path="/compare" element={<CompareView />} />
        <Route path="/screen" element={<ScreenView />} />
        <Route path="/upload" element={<UploadView />} />
      </Route>
    </Routes>
  );
}
