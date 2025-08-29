import { useEffect, useRef } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { App as CapApp } from "@capacitor/app";
import Index from "./pages/Index";
import Auth from "./pages/Auth";
import QRLogin from "./pages/QRLogin";
import NotFound from "./pages/NotFound";
import { useDynamicBackground } from "@/hooks/useDynamicBackground";

const queryClient = new QueryClient();

const App = () => {
  const { backgroundUrl } = useDynamicBackground();
  const backOnce = useRef(false);

  // Android Back button behavior (Capacitor)
  useEffect(() => {
    let listener: any = null;
    
    const setupListener = async () => {
      listener = await CapApp.addListener("backButton", () => {
        if (window.history.length > 1) {
          window.history.back();
          return;
        }
        if (backOnce.current) {
          CapApp.exitApp();
        } else {
          backOnce.current = true;
          // Show toast "Press back again to exit" - handled by individual components
          setTimeout(() => (backOnce.current = false), 1500);
        }
      });
    };
    
    setupListener();
    
    return () => { 
      if (listener) {
        listener.remove(); 
      }
    };
  }, []);
  
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <div 
          className="min-h-dvh max-h-dvh overflow-y-auto overscroll-contain"
          style={backgroundUrl ? {
            backgroundImage: `url(${backgroundUrl})`,
            backgroundSize: 'cover',
            backgroundPosition: 'center',
            backgroundRepeat: 'no-repeat',
            backgroundAttachment: 'fixed'
          } : {
            background: 'linear-gradient(45deg, #ffd700 0%, #9370db 20%, #87ceeb 40%, #e5e5e5 60%, #ffa500 80%, #ffd700 100%)'
          }}
        >
          <div className="min-h-dvh bg-black/20">
            <Toaster />
            <Sonner />
            <BrowserRouter>
              <Routes>
                <Route path="/" element={<Index />} />
                <Route path="/auth" element={<Auth />} />
                <Route path="/qr-login" element={<QRLogin />} />
                {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
                <Route path="*" element={<NotFound />} />
              </Routes>
            </BrowserRouter>
          </div>
        </div>
      </TooltipProvider>
    </QueryClientProvider>
  );
};

export default App;
