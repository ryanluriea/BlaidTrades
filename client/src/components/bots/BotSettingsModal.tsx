import { useState, useEffect, useMemo } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useToast } from "@/hooks/use-toast";
import { useUpdateBot, Bot } from "@/hooks/useBots";
import { useHealthSummary } from "@/hooks/useHealthSummary";
import { 
  Settings2, 
  Shield, 
  Zap, 
  Brain, 
  TrendingUp, 
  AlertTriangle,
  Loader2,
  Save,
  RotateCcw,
  X,
  Eye,
  Lock,
  Pause,
  Power
} from "lucide-react";

interface BotSettingsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  bot: Bot;
}

// Default configs for reference
const DEFAULT_RISK_CONFIG = {
  max_daily_loss: 500,
  stop_loss_ticks: 20,
  max_position_size: 1,
  max_contracts_per_trade: 2,
  risk_percent_per_trade: 0.5,
  max_risk_dollars_per_trade: 100,
};

const AVAILABLE_REGIMES = ["trending", "ranging", "volatile", "quiet", "breakout", "mean_reversion"];

export function BotSettingsModal({ open, onOpenChange, bot }: BotSettingsModalProps) {
  const { toast } = useToast();
  const updateBot = useUpdateBot();
  const { data: healthSummary } = useHealthSummary();
  
  const [activeTab, setActiveTab] = useState("execution");
  const [isSaving, setIsSaving] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  
  // Parse existing configs (camelCase from Bot type)
  const existingRiskConfig = (bot.riskConfig as Record<string, any>) || {};
  const existingStrategyConfig = (bot.strategyConfig as Record<string, any>) || {};
  
  // Form state
  const [formData, setFormData] = useState({
    // Execution & Mode
    mode: bot.mode,
    evolution_mode: bot.evolutionMode,
    status: bot.status,
    
    // Risk & Capital
    max_daily_loss: existingRiskConfig.max_daily_loss ?? DEFAULT_RISK_CONFIG.max_daily_loss,
    stop_loss_ticks: existingRiskConfig.stop_loss_ticks ?? DEFAULT_RISK_CONFIG.stop_loss_ticks,
    max_position_size: existingRiskConfig.max_position_size ?? DEFAULT_RISK_CONFIG.max_position_size,
    max_contracts_per_trade: bot.maxContractsPerTrade ?? existingRiskConfig.max_contracts_per_trade ?? DEFAULT_RISK_CONFIG.max_contracts_per_trade,
    risk_percent_per_trade: bot.riskPercentPerTrade ?? existingRiskConfig.risk_percent_per_trade ?? DEFAULT_RISK_CONFIG.risk_percent_per_trade,
    max_risk_dollars_per_trade: existingRiskConfig.max_risk_dollars_per_trade ?? DEFAULT_RISK_CONFIG.max_risk_dollars_per_trade,
    
    // Strategy Parameters
    instrument: existingStrategyConfig.instrument || "ES",
    timeframe: existingStrategyConfig.timeframe || "5m",
    entry_threshold: existingStrategyConfig.entry_threshold ?? 0.6,
    exit_threshold: existingStrategyConfig.exit_threshold ?? 0.4,
    
    // Lifecycle & Promotion
    best_regimes: bot.bestRegimes || [],
    avoid_regimes: bot.avoidRegimes || [],
    auto_promotion_enabled: existingStrategyConfig.auto_promotion_enabled ?? true,
    promotion_min_trades: existingStrategyConfig.promotion_min_trades ?? 30,
    promotion_min_win_rate: existingStrategyConfig.promotion_min_win_rate ?? 0.45,
    
    // Safety & Ops
    emergency_stop_on_daily_loss: existingRiskConfig.emergency_stop_on_daily_loss ?? true,
    news_blackout_enabled: existingStrategyConfig.news_blackout_enabled ?? false,
    news_blackout_minutes_before: existingStrategyConfig.news_blackout_minutes_before ?? 15,
    news_blackout_minutes_after: existingStrategyConfig.news_blackout_minutes_after ?? 5,
    
    // Source & AI
    ai_reasoning_enabled: existingStrategyConfig.ai_reasoning_enabled ?? true,
    source_weights: existingStrategyConfig.source_weights || {},
  });
  
  // Track changes
  const hasChanges = useMemo(() => {
    return JSON.stringify(formData) !== JSON.stringify({
      mode: bot.mode,
      evolution_mode: bot.evolutionMode,
      status: bot.status,
      max_daily_loss: existingRiskConfig.max_daily_loss ?? DEFAULT_RISK_CONFIG.max_daily_loss,
      stop_loss_ticks: existingRiskConfig.stop_loss_ticks ?? DEFAULT_RISK_CONFIG.stop_loss_ticks,
      max_position_size: existingRiskConfig.max_position_size ?? DEFAULT_RISK_CONFIG.max_position_size,
      max_contracts_per_trade: bot.maxContractsPerTrade ?? existingRiskConfig.max_contracts_per_trade ?? DEFAULT_RISK_CONFIG.max_contracts_per_trade,
      risk_percent_per_trade: bot.riskPercentPerTrade ?? existingRiskConfig.risk_percent_per_trade ?? DEFAULT_RISK_CONFIG.risk_percent_per_trade,
      max_risk_dollars_per_trade: existingRiskConfig.max_risk_dollars_per_trade ?? DEFAULT_RISK_CONFIG.max_risk_dollars_per_trade,
      instrument: existingStrategyConfig.instrument || "ES",
      timeframe: existingStrategyConfig.timeframe || "5m",
      entry_threshold: existingStrategyConfig.entry_threshold ?? 0.6,
      exit_threshold: existingStrategyConfig.exit_threshold ?? 0.4,
      best_regimes: bot.bestRegimes || [],
      avoid_regimes: bot.avoidRegimes || [],
      auto_promotion_enabled: existingStrategyConfig.auto_promotion_enabled ?? true,
      promotion_min_trades: existingStrategyConfig.promotion_min_trades ?? 30,
      promotion_min_win_rate: existingStrategyConfig.promotion_min_win_rate ?? 0.45,
      emergency_stop_on_daily_loss: existingRiskConfig.emergency_stop_on_daily_loss ?? true,
      news_blackout_enabled: existingStrategyConfig.news_blackout_enabled ?? false,
      news_blackout_minutes_before: existingStrategyConfig.news_blackout_minutes_before ?? 15,
      news_blackout_minutes_after: existingStrategyConfig.news_blackout_minutes_after ?? 5,
      ai_reasoning_enabled: existingStrategyConfig.ai_reasoning_enabled ?? true,
      source_weights: existingStrategyConfig.source_weights || {},
    });
  }, [formData, bot, existingRiskConfig, existingStrategyConfig]);
  
  // Check if system health allows saving
  const systemHealthOk = !healthSummary || healthSummary.overall !== "RED";
  const isLiveOrCanary = bot.mode === "LIVE" || (bot as any).stage === "CANARY" || (bot as any).stage === "LIVE";
  
  const updateField = (field: string, value: any) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };
  
  const handleSave = async (restart = false) => {
    if (!systemHealthOk) {
      toast({ title: "Cannot save", description: "System health is degraded", variant: "destructive" });
      return;
    }
    
    setIsSaving(true);
    try {
      // Build updated configs
      const updatedRiskConfig = {
        ...existingRiskConfig,
        max_daily_loss: formData.max_daily_loss,
        stop_loss_ticks: formData.stop_loss_ticks,
        max_position_size: formData.max_position_size,
        max_contracts_per_trade: formData.max_contracts_per_trade,
        risk_percent_per_trade: formData.risk_percent_per_trade,
        max_risk_dollars_per_trade: formData.max_risk_dollars_per_trade,
        emergency_stop_on_daily_loss: formData.emergency_stop_on_daily_loss,
      };
      
      const updatedStrategyConfig = {
        ...existingStrategyConfig,
        instrument: formData.instrument,
        timeframe: formData.timeframe,
        entry_threshold: formData.entry_threshold,
        exit_threshold: formData.exit_threshold,
        auto_promotion_enabled: formData.auto_promotion_enabled,
        promotion_min_trades: formData.promotion_min_trades,
        promotion_min_win_rate: formData.promotion_min_win_rate,
        news_blackout_enabled: formData.news_blackout_enabled,
        news_blackout_minutes_before: formData.news_blackout_minutes_before,
        news_blackout_minutes_after: formData.news_blackout_minutes_after,
        ai_reasoning_enabled: formData.ai_reasoning_enabled,
        source_weights: formData.source_weights,
      };
      
      // Update bot (camelCase for API)
      await updateBot.mutateAsync({
        id: bot.id,
        mode: formData.mode as any,
        evolutionMode: formData.evolution_mode as any,
        riskConfig: updatedRiskConfig,
        strategyConfig: updatedStrategyConfig,
        maxContractsPerTrade: formData.max_contracts_per_trade,
        riskPercentPerTrade: formData.risk_percent_per_trade,
        bestRegimes: formData.best_regimes,
        avoidRegimes: formData.avoid_regimes,
      });
      
      toast({ title: "Settings saved", description: restart ? "Bot will restart with new settings" : "Changes applied" });
      onOpenChange(false);
    } catch (error: any) {
      toast({ title: "Failed to save", description: error.message, variant: "destructive" });
    } finally {
      setIsSaving(false);
    }
  };
  
  const toggleRegime = (regime: string, list: "best" | "avoid") => {
    const field = list === "best" ? "best_regimes" : "avoid_regimes";
    const current = formData[field] as string[];
    if (current.includes(regime)) {
      updateField(field, current.filter(r => r !== regime));
    } else {
      updateField(field, [...current, regime]);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] p-0">
        <DialogHeader className="p-4 pb-2 border-b border-border">
          <DialogTitle className="flex items-center gap-2">
            <Settings2 className="w-5 h-5" />
            Bot Settings: {bot.name}
            {isLiveOrCanary && (
              <Badge variant="destructive" className="ml-2 text-xs">
                <AlertTriangle className="w-3 h-3 mr-1" />
                LIVE
              </Badge>
            )}
          </DialogTitle>
        </DialogHeader>
        
        {!systemHealthOk && (
          <Alert variant="destructive" className="mx-4 mt-2">
            <AlertTriangle className="w-4 h-4" />
            <AlertDescription>
              System health is degraded. Saving is blocked until issues are resolved.
            </AlertDescription>
          </Alert>
        )}
        
        <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1">
          <div className="px-4">
            <TabsList className="w-full justify-start h-auto flex-wrap gap-1 bg-transparent p-0">
              <TabsTrigger value="execution" className="text-xs data-[state=active]:bg-secondary">
                <Zap className="w-3 h-3 mr-1" />
                Execution
              </TabsTrigger>
              <TabsTrigger value="risk" className="text-xs data-[state=active]:bg-secondary">
                <Shield className="w-3 h-3 mr-1" />
                Risk
              </TabsTrigger>
              <TabsTrigger value="strategy" className="text-xs data-[state=active]:bg-secondary">
                <TrendingUp className="w-3 h-3 mr-1" />
                Strategy
              </TabsTrigger>
              <TabsTrigger value="sources" className="text-xs data-[state=active]:bg-secondary">
                <Brain className="w-3 h-3 mr-1" />
                Sources
              </TabsTrigger>
              <TabsTrigger value="lifecycle" className="text-xs data-[state=active]:bg-secondary">
                <TrendingUp className="w-3 h-3 mr-1" />
                Lifecycle
              </TabsTrigger>
              <TabsTrigger value="safety" className="text-xs data-[state=active]:bg-secondary">
                <AlertTriangle className="w-3 h-3 mr-1" />
                Safety
              </TabsTrigger>
            </TabsList>
          </div>
          
          <ScrollArea className="h-[400px] px-4 py-3">
            {/* Execution & Mode */}
            <TabsContent value="execution" className="mt-0 space-y-4">
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label>Execution Mode</Label>
                  <Select 
                    value={formData.mode} 
                    onValueChange={(v) => updateField("mode", v)}
                    disabled={isLiveOrCanary}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="BACKTEST_ONLY">Backtest Only</SelectItem>
                      <SelectItem value="SIM_LIVE">SIM (Paper)</SelectItem>
                      <SelectItem value="SHADOW">Shadow</SelectItem>
                      <SelectItem value="LIVE">Live</SelectItem>
                    </SelectContent>
                  </Select>
                  {isLiveOrCanary && (
                    <p className="text-xs text-muted-foreground">Mode changes require manual promotion for live bots</p>
                  )}
                </div>
                
                <div className="space-y-2">
                  <Label>Evolution Mode</Label>
                  <Select 
                    value={formData.evolution_mode} 
                    onValueChange={(v) => updateField("evolution_mode", v)}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="auto">Auto Evolution</SelectItem>
                      <SelectItem value="locked">Locked</SelectItem>
                      <SelectItem value="paused">Paused</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                
                <Separator />
                
                <div className="space-y-2">
                  <Label>Quick Actions</Label>
                  <div className="flex flex-wrap gap-2">
                    <Button variant="outline" size="sm" className="h-8">
                      <Pause className="w-3 h-3 mr-1" />
                      Pause Bot
                    </Button>
                    <Button variant="outline" size="sm" className="h-8">
                      <Lock className="w-3 h-3 mr-1" />
                      Lock Config
                    </Button>
                    <Button variant="destructive" size="sm" className="h-8">
                      <Power className="w-3 h-3 mr-1" />
                      Kill Bot
                    </Button>
                  </div>
                </div>
              </div>
            </TabsContent>
            
            {/* Risk & Capital */}
            <TabsContent value="risk" className="mt-0 space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label>Max Daily Loss ($)</Label>
                  <Input 
                    type="number" 
                    value={formData.max_daily_loss}
                    onChange={(e) => updateField("max_daily_loss", Number(e.target.value))}
                  />
                </div>
                
                <div className="space-y-2">
                  <Label>Stop Loss (ticks)</Label>
                  <Input 
                    type="number" 
                    value={formData.stop_loss_ticks}
                    onChange={(e) => updateField("stop_loss_ticks", Number(e.target.value))}
                  />
                </div>
                
                <div className="space-y-2">
                  <Label>Max Position Size</Label>
                  <Input 
                    type="number" 
                    value={formData.max_position_size}
                    onChange={(e) => updateField("max_position_size", Number(e.target.value))}
                  />
                </div>
                
                <div className="space-y-2">
                  <Label>Max Contracts per Trade</Label>
                  <Input 
                    type="number" 
                    value={formData.max_contracts_per_trade}
                    onChange={(e) => updateField("max_contracts_per_trade", Number(e.target.value))}
                  />
                </div>
                
                <div className="space-y-2">
                  <Label>Risk % per Trade</Label>
                  <div className="flex items-center gap-2">
                    <Slider 
                      value={[formData.risk_percent_per_trade * 100]}
                      onValueChange={([v]) => updateField("risk_percent_per_trade", v / 100)}
                      min={0.1}
                      max={5}
                      step={0.1}
                      className="flex-1"
                    />
                    <span className="text-sm font-mono w-12">{(formData.risk_percent_per_trade * 100).toFixed(1)}%</span>
                  </div>
                </div>
                
                <div className="space-y-2">
                  <Label>Max Risk $ per Trade</Label>
                  <Input 
                    type="number" 
                    value={formData.max_risk_dollars_per_trade}
                    onChange={(e) => updateField("max_risk_dollars_per_trade", Number(e.target.value))}
                  />
                </div>
              </div>
            </TabsContent>
            
            {/* Strategy Parameters */}
            <TabsContent value="strategy" className="mt-0 space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label>Instrument</Label>
                  <Select 
                    value={formData.instrument} 
                    onValueChange={(v) => updateField("instrument", v)}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ES">ES (E-mini S&P)</SelectItem>
                      <SelectItem value="MES">MES (Micro E-mini S&P)</SelectItem>
                      <SelectItem value="NQ">NQ (E-mini Nasdaq)</SelectItem>
                      <SelectItem value="MNQ">MNQ (Micro E-mini Nasdaq)</SelectItem>
                      <SelectItem value="YM">YM (E-mini Dow)</SelectItem>
                      <SelectItem value="RTY">RTY (E-mini Russell)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                
                <div className="space-y-2">
                  <Label>Timeframe</Label>
                  <Select 
                    value={formData.timeframe} 
                    onValueChange={(v) => updateField("timeframe", v)}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="1m">1 Minute</SelectItem>
                      <SelectItem value="5m">5 Minutes</SelectItem>
                      <SelectItem value="15m">15 Minutes</SelectItem>
                      <SelectItem value="1h">1 Hour</SelectItem>
                      <SelectItem value="4h">4 Hours</SelectItem>
                      <SelectItem value="1d">1 Day</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                
                <div className="space-y-2">
                  <Label>Entry Threshold</Label>
                  <div className="flex items-center gap-2">
                    <Slider 
                      value={[formData.entry_threshold * 100]}
                      onValueChange={([v]) => updateField("entry_threshold", v / 100)}
                      min={10}
                      max={100}
                      step={5}
                      className="flex-1"
                    />
                    <span className="text-sm font-mono w-12">{(formData.entry_threshold * 100).toFixed(0)}%</span>
                  </div>
                </div>
                
                <div className="space-y-2">
                  <Label>Exit Threshold</Label>
                  <div className="flex items-center gap-2">
                    <Slider 
                      value={[formData.exit_threshold * 100]}
                      onValueChange={([v]) => updateField("exit_threshold", v / 100)}
                      min={10}
                      max={100}
                      step={5}
                      className="flex-1"
                    />
                    <span className="text-sm font-mono w-12">{(formData.exit_threshold * 100).toFixed(0)}%</span>
                  </div>
                </div>
              </div>
            </TabsContent>
            
            {/* Sources & AI */}
            <TabsContent value="sources" className="mt-0 space-y-4">
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <Label>AI Reasoning</Label>
                    <p className="text-xs text-muted-foreground">Enable AI-powered trade reasoning</p>
                  </div>
                  <Switch 
                    checked={formData.ai_reasoning_enabled}
                    onCheckedChange={(v) => updateField("ai_reasoning_enabled", v)}
                  />
                </div>
                
                <Separator />
                
                <div className="space-y-2">
                  <Label>Source Weights (Coming Soon)</Label>
                  <p className="text-xs text-muted-foreground">
                    Configure weights for different data sources like price action, indicators, and AI signals.
                  </p>
                  <div className="p-4 bg-muted/30 rounded text-center text-sm text-muted-foreground">
                    Source weight configuration will be available in a future update.
                  </div>
                </div>
              </div>
            </TabsContent>
            
            {/* Lifecycle & Promotion */}
            <TabsContent value="lifecycle" className="mt-0 space-y-4">
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <Label>Auto-Promotion</Label>
                    <p className="text-xs text-muted-foreground">Automatically promote when criteria met</p>
                  </div>
                  <Switch 
                    checked={formData.auto_promotion_enabled}
                    onCheckedChange={(v) => updateField("auto_promotion_enabled", v)}
                  />
                </div>
                
                {formData.auto_promotion_enabled && (
                  <div className="grid gap-4 sm:grid-cols-2 pl-4 border-l-2 border-primary/20">
                    <div className="space-y-2">
                      <Label>Min Trades</Label>
                      <Input 
                        type="number" 
                        value={formData.promotion_min_trades}
                        onChange={(e) => updateField("promotion_min_trades", Number(e.target.value))}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Min Win Rate</Label>
                      <div className="flex items-center gap-2">
                        <Slider 
                          value={[formData.promotion_min_win_rate * 100]}
                          onValueChange={([v]) => updateField("promotion_min_win_rate", v / 100)}
                          min={30}
                          max={80}
                          step={1}
                          className="flex-1"
                        />
                        <span className="text-sm font-mono w-12">{(formData.promotion_min_win_rate * 100).toFixed(0)}%</span>
                      </div>
                    </div>
                  </div>
                )}
                
                <Separator />
                
                <div className="space-y-2">
                  <Label>Best Regimes (allow trading)</Label>
                  <div className="flex flex-wrap gap-1.5">
                    {AVAILABLE_REGIMES.map((regime) => (
                      <Badge
                        key={regime}
                        variant={(formData.best_regimes as string[]).includes(regime) ? "default" : "outline"}
                        className="cursor-pointer capitalize"
                        onClick={() => toggleRegime(regime, "best")}
                      >
                        {regime.replace("_", " ")}
                      </Badge>
                    ))}
                  </div>
                </div>
                
                <div className="space-y-2">
                  <Label>Avoid Regimes (skip trading)</Label>
                  <div className="flex flex-wrap gap-1.5">
                    {AVAILABLE_REGIMES.map((regime) => (
                      <Badge
                        key={regime}
                        variant={(formData.avoid_regimes as string[]).includes(regime) ? "destructive" : "outline"}
                        className="cursor-pointer capitalize"
                        onClick={() => toggleRegime(regime, "avoid")}
                      >
                        {regime.replace("_", " ")}
                      </Badge>
                    ))}
                  </div>
                </div>
              </div>
            </TabsContent>
            
            {/* Safety & Ops */}
            <TabsContent value="safety" className="mt-0 space-y-4">
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <Label>Emergency Stop on Daily Loss</Label>
                    <p className="text-xs text-muted-foreground">Halt trading if daily loss limit hit</p>
                  </div>
                  <Switch 
                    checked={formData.emergency_stop_on_daily_loss}
                    onCheckedChange={(v) => updateField("emergency_stop_on_daily_loss", v)}
                  />
                </div>
                
                <Separator />
                
                <div className="flex items-center justify-between">
                  <div>
                    <Label>News Blackout</Label>
                    <p className="text-xs text-muted-foreground">Pause trading around major news events</p>
                  </div>
                  <Switch 
                    checked={formData.news_blackout_enabled}
                    onCheckedChange={(v) => updateField("news_blackout_enabled", v)}
                  />
                </div>
                
                {formData.news_blackout_enabled && (
                  <div className="grid gap-4 sm:grid-cols-2 pl-4 border-l-2 border-warning/20">
                    <div className="space-y-2">
                      <Label>Minutes Before</Label>
                      <Input 
                        type="number" 
                        value={formData.news_blackout_minutes_before}
                        onChange={(e) => updateField("news_blackout_minutes_before", Number(e.target.value))}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Minutes After</Label>
                      <Input 
                        type="number" 
                        value={formData.news_blackout_minutes_after}
                        onChange={(e) => updateField("news_blackout_minutes_after", Number(e.target.value))}
                      />
                    </div>
                  </div>
                )}
              </div>
            </TabsContent>
          </ScrollArea>
        </Tabs>
        
        <DialogFooter className="p-4 pt-2 border-t border-border gap-2">
          {hasChanges && (
            <Button variant="ghost" size="sm" onClick={() => setShowPreview(!showPreview)}>
              <Eye className="w-3 h-3 mr-1" />
              {showPreview ? "Hide" : "Preview"} Changes
            </Button>
          )}
          <div className="flex-1" />
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            <X className="w-4 h-4 mr-1" />
            Cancel
          </Button>
          <Button 
            variant="outline" 
            onClick={() => handleSave(false)}
            disabled={!hasChanges || !systemHealthOk || isSaving}
          >
            {isSaving ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Save className="w-4 h-4 mr-1" />}
            Save
          </Button>
          <Button 
            onClick={() => handleSave(true)}
            disabled={!hasChanges || !systemHealthOk || isSaving}
          >
            {isSaving ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <RotateCcw className="w-4 h-4 mr-1" />}
            Save & Restart
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
