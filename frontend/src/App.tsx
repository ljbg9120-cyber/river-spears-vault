import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import Background from "./components/Background";
import Player from "./components/Player";
import Shell from "./components/Shell";
import { Spinner, ToastProvider } from "./components/ui";
import { useAuth } from "./lib/store";
import Appearance from "./pages/Appearance";
import Auth from "./pages/Auth";
import Landing from "./pages/Landing";
import Library from "./pages/Library";
import Profile from "./pages/Profile";
import SharePage from "./pages/SharePage";
import Shares from "./pages/Shares";
import TrackPage from "./pages/TrackPage";
import Feedback from "./pages/Feedback";
import Playback from "./pages/Playback";
import Showcase from "./pages/Showcase";

function Protected({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const loc = useLocation();
  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center text-muted">
        <Spinner size={28} />
      </div>
    );
  }
  if (!user) return <Navigate to="/login" state={{ from: loc.pathname }} replace />;
  return <>{children}</>;
}

/**
 * Note: the routes are deliberately NOT wrapped in <AnimatePresence mode="wait">.
 * Each page animates itself in instead; pages handle their own entrance.
 */
export default function App() {
  const { theme, user, loading } = useAuth();

  return (
    <ToastProvider>
      <Background theme={theme} />

      <Routes>
        {/* Standalone pages: their own chrome, no app shell. */}
        <Route path="/s/:token" element={<SharePage />} />
        <Route path="/login" element={<Auth mode="login" />} />
        <Route path="/signup" element={<Auth mode="signup" />} />

        <Route
          path="*"
          element={
            <Shell>
              <Routes>
                <Route
                  path="/"
                  element={
                    loading ? (
                      <div className="flex min-h-[50vh] items-center justify-center text-muted">
                        <Spinner size={28} />
                      </div>
                    ) : user ? (
                      <Navigate to="/library" replace />
                    ) : (
                      <Landing />
                    )
                  }
                />
                <Route
                  path="/library"
                  element={
                    <Protected>
                      <Library />
                    </Protected>
                  }
                />
                <Route
                  path="/feedback"
                  element={<Protected><Feedback /></Protected>}
                />
                <Route
                  path="/playback"
                  element={<Protected><Playback /></Protected>}
                />
                {/* Public on purpose: the point is that anyone can hear it. */}
                <Route path="/showcase" element={<Showcase />} />
                <Route
                  path="/shares"
                  element={
                    <Protected>
                      <Shares />
                    </Protected>
                  }
                />
                <Route
                  path="/appearance"
                  element={
                    <Protected>
                      <Appearance />
                    </Protected>
                  }
                />
                <Route path="/track/:id" element={<TrackPage />} />
                <Route path="/u/:handle" element={<Profile />} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </Shell>
          }
        />
      </Routes>

      <Player />
    </ToastProvider>
  );
}
