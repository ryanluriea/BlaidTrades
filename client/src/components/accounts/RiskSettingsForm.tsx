import { useState, useEffect } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Card, CardContent } from "@/components/ui/card";
import { ChevronDown, Calculator, AlertTriangle, CheckCircle } from "lucide-react";
import { RISK_TIER_PRESETS } from "@/lib/riskEngine";
import { useSizingPreview, formatRiskPercent } from "@/hooks/useRiskEngine";
import { cn } from "@/lib/utils";

export interface RiskSettings {
  risk_tier: "conservative" | "moderate" | "aggressive" | "custom";
  risk_percent_per_trade: number;
  max_risk_dollars_per_trade: number | null;
  max_contracts_per_trade: number;
  max_contracts_per_symbol: number;
  max_total_exposure_contracts: number;
  max_daily_loss_percent: number;
  max_daily_loss_dollars: number | null;
}

interface RiskSettingsFormProps {
  value: RiskSettings;
  onChange: (settings: RiskSettings) => void;
  accountEquity: number;
  compact?: boolean;
}

const TIER_LABELS = {
  conservative: "Conservative",
  moderate: "Moderate",
  aggressive: "Aggressive",
  custom: "Custom",
};

export function getDefaultRiskSettings(tier: string = "moderate"): RiskSettings {
  const preset = RISK_TIER_PRESETS[tier] || RISK_TIER_PRESETS.moderate;
  return {
    risk_tier: tier as RiskSettings["risk_tier"],
    risk_percent_per_trade: preset.risk_percent_per_trade,
    max_risk_dollars_per_trade: preset.max_risk_dollars_per_trade ?? null,
    max_contracts_per_trade: preset.max_contracts_per_trade,
    max_contracts_per_symbol: preset.max_contracts_per_symbol,
    max_total_exposure_contracts: preset.max_total_exposure_contracts,
    max_daily_loss_percent: preset.max_daily_loss_percent,
    max_daily_loss_dollars: preset.max_daily_loss_dollars ?? null,
  };
}

function settingsMatchPreset(settings: RiskSettings, tier: string): boolean {
  if (tier === "custom") return false;
  const preset = RISK_TIER_PRESETS[tier];
  if (!preset) return false;
  
  return (
    Math.abs(settings.risk_percent_per_trade - preset.risk_percent_per_trade) < 0.0001 &&
    settings.max_contracts_per_trade === preset.max_contracts_per_trade &&
    settings.max_contracts_per_symbol === preset.max_contracts_per_symbol &&
    settings.max_total_exposure_contracts === preset.max_total_exposure_contracts &&
    Math.abs(settings.max_daily_loss_percent - preset.max_daily_loss_percent) < 0.0001
  );
}

export function RiskSettingsForm({ value, onChange, accountEquity, compact = false }: RiskSettingsFormProps) {
  const [isAdvancedOpen, setIsAdvancedOpen] = useState(false);
  const [previewStopTicks, setPreviewStopTicks] = useState(20);
  const [previewSymbol, setPreviewSymbol] = useState("ES");

  // Detect if current settings match a preset or should be "custom"
  useEffect(() => {
    if (value.risk_tier !== "custom") {
      if (!settingsMatchPreset(value, value.risk_tier)) {
        onChange({ ...value, risk_tier: "custom" });
      }
    }
  }, [value]);

  const handleTierChange = (tier: string) => {
    if (tier === "custom") {
      onChange({ ...value, risk_tier: "custom" });
    } else {
      const preset = RISK_TIER_PRESETS[tier];
      if (preset) {
        onChange({
          risk_tier: tier as RiskSettings["risk_tier"],
          risk_percent_per_trade: preset.risk_percent_per_trade,
          max_risk_dollars_per_trade: preset.max_risk_dollars_per_trade ?? null,
          max_contracts_per_trade: preset.max_contracts_per_trade,
          max_contracts_per_symbol: preset.max_contracts_per_symbol,
          max_total_exposure_contracts: preset.max_total_exposure_contracts,
          max_daily_loss_percent: preset.max_daily_loss_percent,
          max_daily_loss_dollars: preset.max_daily_loss_dollars ?? null,
        });
      }
    }
  };

  const sizing = useSizingPreview({
    accountEquity,
    accountRiskTier: value.risk_tier === "custom" ? "moderate" : value.risk_tier,
    accountRiskProfile: {
      risk_percent_per_trade: value.risk_percent_per_trade,
      max_risk_dollars_per_trade: value.max_risk_dollars_per_trade ?? undefined,
      max_contracts_per_trade: value.max_contracts_per_trade,
      max_contracts_per_symbol: value.max_contracts_per_symbol,
      max_total_exposure_contracts: value.max_total_exposure_contracts,
      max_daily_loss_percent: value.max_daily_loss_percent,
      max_daily_loss_dollars: value.max_daily_loss_dollars ?? undefined,
    },
    instrumentSymbol: previewSymbol,
    stopDistanceTicks: previewStopTicks,
  });

  const isBlocked = sizing?.contracts === 0;

  return (
    <div className="space-y-4">
      {/* Tier Preset Selector */}
      <div className="space-y-2">
        <Label>Risk Tier Preset</Label>
        <Select value={value.risk_tier} onValueChange={handleTierChange}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="conservative">Conservative (Low risk)</SelectItem>
            <SelectItem value="moderate">Moderate (Balanced)</SelectItem>
            <SelectItem value="aggressive">Aggressive (Higher risk)</SelectItem>
            <SelectItem value="custom">Custom Settings</SelectItem>
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          {value.risk_tier === "custom" 
            ? "Custom settings - adjust caps below" 
            : `Preset: ${(value.risk_percent_per_trade * 100).toFixed(2)}% risk, max ${value.max_contracts_per_trade} contracts`}
        </p>
      </div>

      {/* Quick Caps */}
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="max_contracts_per_trade" className="text-xs">Max Contracts/Trade</Label>
          <Input
            id="max_contracts_per_trade"
            type="text"
            inputMode="numeric"
            value={value.max_contracts_per_trade}
            onChange={(e) => {
              const val = e.target.value.replace(/[^0-9]/g, '');
              const num = parseInt(val) || 1;
              onChange({ ...value, max_contracts_per_trade: Math.min(100, Math.max(1, num)) });
            }}
            className="h-8"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="risk_percent" className="text-xs">Risk % per Trade</Label>
          <Input
            id="risk_percent"
            type="text"
            inputMode="decimal"
            value={(value.risk_percent_per_trade * 100).toFixed(2)}
            onChange={(e) => {
              const val = e.target.value.replace(/[^0-9.]/g, '');
              const num = parseFloat(val);
              if (!isNaN(num)) {
                onChange({ ...value, risk_percent_per_trade: Math.min(10, Math.max(0.01, num)) / 100 });
              }
            }}
            className="h-8"
          />
        </div>
      </div>

      {/* Sizing Preview */}
      <Card className="border-dashed">
        <CardContent className="p-3 space-y-3">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Calculator className="w-4 h-4" />
            Sizing Preview
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label className="text-xs">Symbol</Label>
              <Select value={previewSymbol} onValueChange={setPreviewSymbol}>
                <SelectTrigger className="h-7 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ES">ES (E-mini S&P)</SelectItem>
                  <SelectItem value="MES">MES (Micro E-mini)</SelectItem>
                  <SelectItem value="NQ">NQ (E-mini Nasdaq)</SelectItem>
                  <SelectItem value="MNQ">MNQ (Micro Nasdaq)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Stop (ticks)</Label>
              <Input
                type="number"
                min={1}
                max={100}
                value={previewStopTicks}
                onChange={(e) => setPreviewStopTicks(parseInt(e.target.value) || 20)}
                className="h-7 text-xs"
              />
            </div>
          </div>
          
          {sizing && (
            <div className="space-y-1.5 text-xs">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Equity → Risk $</span>
                <span className="font-mono">
                  ${accountEquity.toLocaleString()} × {formatRiskPercent(sizing.calculation_details?.risk_percent_used ?? 0)} = $
                  {Number.isFinite(sizing.risk_dollars) ? sizing.risk_dollars.toFixed(0) : "--"}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Risk $ ÷ $/Contract</span>
                <span className="font-mono">
                  ${Number.isFinite(sizing.risk_dollars) ? sizing.risk_dollars.toFixed(0) : "--"} ÷ $
                  {Number.isFinite(sizing.dollars_per_contract_at_stop) ? sizing.dollars_per_contract_at_stop.toFixed(0) : "--"} = 
                  {Number.isFinite(sizing.raw_contracts) ? sizing.raw_contracts.toFixed(2) : "--"}
                </span>
              </div>
              <div className="flex justify-between items-center pt-1 border-t border-border">
                <span className="font-medium">Final Contracts</span>
                <span className={cn("text-lg font-bold font-mono", isBlocked ? "text-destructive" : "text-primary")}>
                  {Number.isFinite(sizing.contracts) ? sizing.contracts : "--"}
                </span>
              </div>
              {sizing.capped_by && (
                <div className="flex items-center gap-1 text-warning">
                  <AlertTriangle className="w-3 h-3" />
                  Capped by: {sizing.capped_by.replace(/_/g, " ")}
                </div>
              )}
              {!isBlocked && !sizing.capped_by && (
                <div className="flex items-center gap-1 text-primary">
                  <CheckCircle className="w-3 h-3" />
                  Auto-sized based on equity
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Advanced Settings */}
      <Collapsible open={isAdvancedOpen} onOpenChange={setIsAdvancedOpen}>
        <CollapsibleTrigger className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors">
          <ChevronDown className={cn("w-4 h-4 transition-transform", isAdvancedOpen && "rotate-180")} />
          Advanced Risk Settings
        </CollapsibleTrigger>
        <CollapsibleContent className="pt-3 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Max Contracts/Symbol</Label>
              <Input
                type="number"
                min={1}
                max={100}
                value={value.max_contracts_per_symbol}
                onChange={(e) => onChange({ ...value, max_contracts_per_symbol: parseInt(e.target.value) || 1 })}
                className="h-8"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Max Total Exposure</Label>
              <Input
                type="number"
                min={1}
                max={200}
                value={value.max_total_exposure_contracts}
                onChange={(e) => onChange({ ...value, max_total_exposure_contracts: parseInt(e.target.value) || 1 })}
                className="h-8"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Max Daily Loss %</Label>
              <Input
                type="number"
                min={0.1}
                max={20}
                step={0.1}
                value={(value.max_daily_loss_percent * 100).toFixed(1)}
                onChange={(e) => onChange({ ...value, max_daily_loss_percent: (parseFloat(e.target.value) || 2) / 100 })}
                className="h-8"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Max Daily Loss $ (optional)</Label>
              <Input
                type="number"
                min={0}
                step={100}
                value={value.max_daily_loss_dollars ?? ""}
                placeholder="Auto from %"
                onChange={(e) => onChange({ ...value, max_daily_loss_dollars: e.target.value ? parseInt(e.target.value) : null })}
                className="h-8"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Max $ Risk per Trade (optional)</Label>
            <Input
              type="number"
              min={0}
              step={50}
              value={value.max_risk_dollars_per_trade ?? ""}
              placeholder="No limit (use % only)"
              onChange={(e) => onChange({ ...value, max_risk_dollars_per_trade: e.target.value ? parseInt(e.target.value) : null })}
              className="h-8"
            />
            <p className="text-xs text-muted-foreground">
              Hard cap on dollar risk regardless of equity
            </p>
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
