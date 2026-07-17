import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Landing } from "./routes/Landing";
import { FarmerStatus } from "./routes/farmer/FarmerStatus";
import { FarmerProjectDetail } from "./routes/farmer/FarmerProjectDetail";
import { FarmerEnrollments } from "./routes/farmer/FarmerEnrollments";
import { AnalystHome } from "./routes/analyst/AnalystHome";
import { AnalystOp } from "./routes/analyst/AnalystOp";
import { AnalystSampling } from "./routes/analyst/AnalystSampling";
import { AnalystStatusMap } from "./routes/analyst/AnalystStatusMap";
import { AnalystQa } from "./routes/analyst/AnalystQa";
import { AdminStatus } from "./routes/admin/AdminStatus";
import { AdminEnrollments } from "./routes/admin/AdminEnrollments";
import { PasswordGate } from "./components/PasswordGate";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/farmer/:opCode" element={<FarmerStatus />} />
        <Route path="/farmer/:opCode/project/:projectYearId" element={<FarmerProjectDetail />} />
        <Route path="/farmer/:opCode/enrollments" element={<FarmerEnrollments />} />

        <Route
          path="/analyst"
          element={
            <PasswordGate area="analyst">
              <AnalystHome />
            </PasswordGate>
          }
        />
        <Route
          path="/analyst/op/:opCode"
          element={
            <PasswordGate area="analyst">
              <AnalystOp />
            </PasswordGate>
          }
        />
        <Route
          path="/analyst/sampling"
          element={
            <PasswordGate area="analyst">
              <AnalystSampling />
            </PasswordGate>
          }
        />
        <Route
          path="/analyst/status-map"
          element={
            <PasswordGate area="analyst">
              <AnalystStatusMap />
            </PasswordGate>
          }
        />
        <Route
          path="/analyst/qa"
          element={
            <PasswordGate area="analyst">
              <AnalystQa />
            </PasswordGate>
          }
        />

        <Route
          path="/admin"
          element={
            <PasswordGate area="admin">
              <AdminStatus />
            </PasswordGate>
          }
        />
        <Route
          path="/admin/enrollments"
          element={
            <PasswordGate area="admin">
              <AdminEnrollments />
            </PasswordGate>
          }
        />
      </Routes>
    </BrowserRouter>
  );
}
