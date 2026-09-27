import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import Auth from "./pages/Auth";
import Controller from "./pages/Controller";
import EliteMission from "./pages/EliteMission";
import Home from "./pages/Home";
import AndroidFiles from "./pages/AndroidFiles";
import Demo from "./pages/Demo";
import DemoAdmin from "./pages/DemoAdmin";

function Router() {
  // make sure to consider if you need authentication for certain routes
  return (
    <Switch>
      <Route path={"/"} component={Home} />
      <Route path={"/core/controller"} component={Controller} />
      <Route path={"/core/elite"} component={EliteMission} />
      <Route path={"/android/files"} component={AndroidFiles} />
      <Route path={"/demo"} component={Demo} />
      <Route path={"/core/demo-requests"} component={DemoAdmin} />
      {/* Account system is Google OAuth only (no password) — one sign-in
          screen for all legacy auth paths. */}
      <Route path={"/login"} component={Auth} />
      <Route path={"/register"} component={Auth} />
      <Route path={"/forgot-password"} component={Auth} />
      <Route path={"/404"} component={NotFound} />
      {/* Final fallback route */}
      <Route component={NotFound} />
    </Switch>
  );
}

// NOTE: About Theme
// - First choose a default theme according to your design style (dark or light bg), than change color palette in index.css
//   to keep consistent foreground/background color across components
// - If you want to make theme switchable, pass `switchable` ThemeProvider and use `useTheme` hook

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider
        defaultTheme="light"
        // switchable
      >
        <TooltipProvider>
          <Toaster />
          <Router />
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
