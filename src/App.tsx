import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import Index from "./pages/Index";
import Auth from "./pages/Auth";
import QRLogin from "./pages/QRLogin";
import NotFound from "./pages/NotFound";
import { useDynamicBackground } from "@/hooks/useDynamicBackground";

const queryClient = new QueryClient();

const App = () => {
  const { backgroundUrl } = useDynamicBackground();
  
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <div 
          className="min-h-screen"
          style={backgroundUrl ? {
            backgroundImage: `url(${backgroundUrl})`,
            backgroundSize: 'cover',
            backgroundPosition: 'center',
            backgroundRepeat: 'no-repeat',
            backgroundAttachment: 'fixed'
          } : {
            background: 'linear-gradient(135deg, hsl(220 60% 25%), hsl(220 70% 35%))'
          }}
        >
          <div className="min-h-screen bg-black/20">
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
