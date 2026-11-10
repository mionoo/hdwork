import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";

import ProtectedRoute from "@/components/ProtectedRoute";
import AppSidebar from "@/components/AppSidebar";
import { OrderCompletionProvider } from "@/contexts/OrderCompletionContext";
import { AuthProvider } from "@/contexts/AuthContext";
import DashboardPage from "@/pages/DashboardPage";
import AttendancePage from "@/pages/AttendancePage";
import LoginPage from "@/pages/LoginPage";
import BreakoutRoomPage, { RoomOrdersRoute } from "@/pages/BreakoutRoomPage";
import OrderDetailPage from "@/pages/OrderDetailPage";
import TeamPage from "@/pages/TeamPage";
import ReportsPage from "@/pages/ReportsPage";
import UserManagementPage from "@/pages/UserManagementPage";
import GroupManagementPage from "@/pages/GroupManagementPage";
import { NetworkToolsRoute } from "@/components/WorkspaceOutlet";

function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <OrderCompletionProvider>
          <Routes>
            <Route path="/login" element={<LoginPage />} />

            <Route element={<ProtectedRoute />}>
              <Route element={<AppSidebar />}>
                <Route path="/dashboard" element={<DashboardPage />} />
                <Route path="/attendance" element={<AttendancePage />} />
                <Route path="/breakout-room" element={<BreakoutRoomPage />} />
                <Route path="/orders" element={<RoomOrdersRoute />} />
                <Route path="/orders/:id" element={<OrderDetailPage />} />
                <Route path="/team" element={<TeamPage />} />
                <Route path="/reports" element={<ReportsPage />} />
                <Route path="/users" element={<UserManagementPage />} />
                <Route path="/groups" element={<GroupManagementPage />} />
                <Route path="/network-tools" element={<NetworkToolsRoute />} />
              </Route>
            </Route>

            <Route path="/" element={<Navigate to="/breakout-room" replace />} />
          </Routes>
        </OrderCompletionProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}

export default App;
