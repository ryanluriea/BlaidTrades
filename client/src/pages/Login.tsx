import { useState, useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Loader2, TrendingUp, BarChart3, Eye, EyeOff, Shield, Zap, Activity } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);
  const [loading, setLoading] = useState(false);
  const { signIn } = useAuth();
  const { toast } = useToast();

  useEffect(() => {
    const saved = localStorage.getItem("blaidtrades_remember_email");
    if (saved) {
      setEmail(saved);
      setRememberMe(true);
    }
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      if (rememberMe) {
        localStorage.setItem("blaidtrades_remember_email", email);
      } else {
        localStorage.removeItem("blaidtrades_remember_email");
      }
      
      await signIn(email, password, rememberMe);
    } catch (error: any) {
      toast({
        title: "Authentication Failed",
        description: error.message || "Invalid credentials. Please try again.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex bg-background">
      <div className="hidden lg:flex lg:w-1/2 relative overflow-hidden bg-background">
        <div className="absolute inset-0 bg-grid opacity-30" />
        
        <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-transparent to-primary/10" />

        <div className="relative z-10 flex flex-col justify-center p-12 lg:p-16">
          <div className="space-y-10">
            <div>
              <h1 className="text-4xl lg:text-5xl font-semibold tracking-tight text-foreground">
                Bl<span className="italic text-emerald-500">ai</span>dTrades
              </h1>
              <p className="mt-2 text-base text-muted-foreground tracking-wide">
                AUTONOMOUS TRADING INFRASTRUCTURE
              </p>
            </div>

            <div className="space-y-6 pt-4">
              <div className="flex items-start gap-4">
                <div className="flex-shrink-0 w-10 h-10 rounded-md bg-primary/10 border border-primary/20 flex items-center justify-center">
                  <TrendingUp className="w-5 h-5 text-primary" />
                </div>
                <div className="pt-1">
                  <p className="text-sm font-medium text-foreground">Research → Sim → Live</p>
                  <p className="text-xs text-muted-foreground mt-0.5">End-to-end strategy lifecycle</p>
                </div>
              </div>
              
              <div className="flex items-start gap-4">
                <div className="flex-shrink-0 w-10 h-10 rounded-md bg-primary/10 border border-primary/20 flex items-center justify-center">
                  <BarChart3 className="w-5 h-5 text-primary" />
                </div>
                <div className="pt-1">
                  <p className="text-sm font-medium text-foreground">Continuous Backtesting</p>
                  <p className="text-xs text-muted-foreground mt-0.5">Automated evolution & optimization</p>
                </div>
              </div>
              
              <div className="flex items-start gap-4">
                <div className="flex-shrink-0 w-10 h-10 rounded-md bg-primary/10 border border-primary/20 flex items-center justify-center">
                  <Eye className="w-5 h-5 text-primary" />
                </div>
                <div className="pt-1">
                  <p className="text-sm font-medium text-foreground">Full Observability</p>
                  <p className="text-xs text-muted-foreground mt-0.5">Every decision fully traceable</p>
                </div>
              </div>

              <div className="flex items-start gap-4">
                <div className="flex-shrink-0 w-10 h-10 rounded-md bg-primary/10 border border-primary/20 flex items-center justify-center">
                  <Shield className="w-5 h-5 text-primary" />
                </div>
                <div className="pt-1">
                  <p className="text-sm font-medium text-foreground">Institutional Controls</p>
                  <p className="text-xs text-muted-foreground mt-0.5">Maker-checker governance</p>
                </div>
              </div>
            </div>

            <div className="pt-6 border-t border-border/50">
              <div className="flex items-center gap-6 text-xs text-muted-foreground">
                <div className="flex items-center gap-1.5">
                  <Activity className="w-3.5 h-3.5 text-profit" />
                  <span>CME Futures</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <Zap className="w-3.5 h-3.5 text-primary" />
                  <span>Real-time Execution</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="flex-1 flex items-center justify-center p-6 bg-background relative">
        <div className="absolute inset-0 bg-grid opacity-20 lg:hidden" />
        
        <div className="w-full max-w-sm relative z-10">
          <div className="lg:hidden text-center mb-8">
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">
              Bl<span className="italic text-emerald-500">ai</span>dTrades
            </h1>
            <p className="text-xs text-muted-foreground mt-1 tracking-wide">
              AUTONOMOUS TRADING INFRASTRUCTURE
            </p>
          </div>

          <Card className="border-border/60 bg-card/80 backdrop-blur-sm">
            <CardContent className="pt-6">
              <div className="mb-6">
                <h2 className="text-lg font-semibold text-foreground">Sign in</h2>
                <p className="text-sm text-muted-foreground mt-0.5">
                  Access your trading dashboard
                </p>
              </div>

              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="email" className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                    Email
                  </Label>
                  <Input
                    id="email"
                    type="email"
                    placeholder="trader@example.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    autoComplete="email"
                    required
                    className="h-10 bg-background border-border/60 text-foreground placeholder:text-muted-foreground/50 font-mono text-sm"
                    data-testid="input-email"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="password" className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                    Password
                  </Label>
                  <div className="relative">
                    <Input
                      id="password"
                      type={showPassword ? "text" : "password"}
                      placeholder="Enter password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      autoComplete="current-password"
                      required
                      className="h-10 bg-background border-border/60 text-foreground placeholder:text-muted-foreground/50 font-mono text-sm pr-10"
                      data-testid="input-password"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                      data-testid="button-toggle-password"
                    >
                      {showPassword ? (
                        <EyeOff className="w-4 h-4" />
                      ) : (
                        <Eye className="w-4 h-4" />
                      )}
                    </button>
                  </div>
                </div>

                <div className="flex items-center justify-between pt-1">
                  <div className="flex items-center space-x-2">
                    <Checkbox 
                      id="remember-me" 
                      checked={rememberMe}
                      onCheckedChange={(checked) => setRememberMe(checked === true)}
                      className="border-border data-[state=checked]:bg-primary data-[state=checked]:border-primary"
                      data-testid="checkbox-remember-me"
                    />
                    <Label 
                      htmlFor="remember-me" 
                      className="text-xs text-muted-foreground cursor-pointer select-none"
                    >
                      Remember me
                    </Label>
                  </div>
                  <button 
                    type="button"
                    className="text-xs text-muted-foreground hover:text-primary transition-colors"
                    onClick={() => toast({
                      title: "Password Reset",
                      description: "Contact your administrator to reset your password.",
                    })}
                    data-testid="link-forgot-password"
                  >
                    Forgot password?
                  </button>
                </div>

                <Button 
                  type="submit" 
                  className="w-full h-10 mt-2" 
                  disabled={loading}
                  data-testid="button-signin"
                >
                  {loading ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Authenticating...
                    </>
                  ) : (
                    "Sign In"
                  )}
                </Button>
              </form>
            </CardContent>
          </Card>

          <div className="flex items-center justify-center gap-2 mt-6">
            <Shield className="w-3.5 h-3.5 text-muted-foreground/60" />
            <p className="text-xs text-muted-foreground/60">
              Enterprise-grade security
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
