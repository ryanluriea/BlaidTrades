import { useState, useEffect } from "react";
import { useCreateAccount } from "@/hooks/useAccounts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, Info } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  ACCOUNT_TYPE_INFO,
  getAccountDefaults,
  getValidProvidersForAccount,
  PROVIDER_INFO,
  type AccountType,
  type AccountProvider,
} from "@/lib/executionRouting";
import { RiskSettingsForm, getDefaultRiskSettings, type RiskSettings } from "./RiskSettingsForm";
import { ScrollArea } from "@/components/ui/scroll-area";

interface CreateAccountDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CreateAccountDialog({ open, onOpenChange }: CreateAccountDialogProps) {
  const createAccount = useCreateAccount();
  const [formData, setFormData] = useState({
    name: "",
    account_type: "SIM" as AccountType,
    provider: "INTERNAL" as AccountProvider,
    broker: "" as string,
    initial_balance: 50000,
    allow_shared_bots: false,
  });
  const [riskSettings, setRiskSettings] = useState<RiskSettings>(getDefaultRiskSettings("moderate"));

  // Update provider and allow_shared_bots when account type changes
  useEffect(() => {
    const defaults = getAccountDefaults(formData.account_type);
    setFormData(prev => ({
      ...prev,
      provider: defaults.provider,
      allow_shared_bots: defaults.allow_shared_bots,
      broker: formData.account_type === "LIVE" ? (prev.broker || "") : "",
    }));
  }, [formData.account_type]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    await createAccount.mutateAsync({
      name: formData.name,
      account_type: formData.account_type,
      broker: formData.account_type === "LIVE" ? formData.broker : null,
      initial_balance: formData.initial_balance,
      current_balance: formData.initial_balance,
      risk_tier: riskSettings.risk_tier === "custom" ? "moderate" : riskSettings.risk_tier,
      provider: formData.provider,
      allow_shared_bots: formData.allow_shared_bots,
      risk_percent_per_trade: riskSettings.risk_percent_per_trade,
      max_risk_dollars_per_trade: riskSettings.max_risk_dollars_per_trade,
      max_contracts_per_trade: riskSettings.max_contracts_per_trade,
      max_contracts_per_symbol: riskSettings.max_contracts_per_symbol,
      max_total_exposure_contracts: riskSettings.max_total_exposure_contracts,
      max_daily_loss_percent: riskSettings.max_daily_loss_percent,
      max_daily_loss_dollars: riskSettings.max_daily_loss_dollars,
    });

    setFormData({
      name: "",
      account_type: "SIM",
      provider: "INTERNAL",
      broker: "",
      initial_balance: 50000,
      allow_shared_bots: false,
    });
    setRiskSettings(getDefaultRiskSettings("moderate"));
    onOpenChange(false);
  };

  const accountInfo = ACCOUNT_TYPE_INFO[formData.account_type];
  const validProviders = getValidProvidersForAccount(formData.account_type);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px] max-h-[90vh]">
        <DialogHeader>
          <DialogTitle>Add Trading Account</DialogTitle>
          <DialogDescription>
            Create a new trading account with auto-sizing risk settings.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <ScrollArea className="max-h-[60vh] pr-4">
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="name">Account Name</Label>
                <Input
                  id="name"
                  placeholder="e.g., Primary Sim Account"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  required
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="account_type">Account Type</Label>
                <Select
                  value={formData.account_type}
                  onValueChange={(v) => setFormData({ ...formData, account_type: v as AccountType })}
                >
                  <SelectTrigger id="account_type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="VIRTUAL">{ACCOUNT_TYPE_INFO.VIRTUAL.label}</SelectItem>
                    <SelectItem value="SIM">{ACCOUNT_TYPE_INFO.SIM.label}</SelectItem>
                    <SelectItem value="LIVE">{ACCOUNT_TYPE_INFO.LIVE.label}</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">{accountInfo.description}</p>
              </div>

              {formData.account_type === "LIVE" && (
                <div className="space-y-2">
                  <Label htmlFor="provider">Provider</Label>
                  <Select
                    value={formData.provider}
                    onValueChange={(v) => setFormData({ ...formData, provider: v as AccountProvider, broker: v.toLowerCase() })}
                  >
                    <SelectTrigger id="provider">
                      <SelectValue placeholder="Select provider..." />
                    </SelectTrigger>
                    <SelectContent>
                      {validProviders.map((provider) => (
                        <SelectItem key={provider} value={provider}>
                          {PROVIDER_INFO[provider].label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              <div className="space-y-2">
                <Label htmlFor="initial_balance">Initial Balance ($)</Label>
                <Input
                  id="initial_balance"
                  type="number"
                  min={1000}
                  step={1000}
                  value={formData.initial_balance}
                  onChange={(e) => setFormData({ ...formData, initial_balance: parseInt(e.target.value) || 50000 })}
                />
              </div>

              {(formData.account_type === "VIRTUAL" || formData.account_type === "SIM") && (
                <div className="flex items-center justify-between p-3 bg-muted/30 rounded-lg">
                  <div className="flex items-center gap-2">
                    <Label htmlFor="allow_shared_bots" className="cursor-pointer">
                      Allow Multiple Bots
                    </Label>
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Info className="w-3.5 h-3.5 text-muted-foreground" />
                        </TooltipTrigger>
                        <TooltipContent>
                          <p className="max-w-xs text-xs">
                            When enabled, multiple bots can trade on this account simultaneously (portfolio-style).
                          </p>
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  </div>
                  <Switch
                    id="allow_shared_bots"
                    checked={formData.allow_shared_bots}
                    onCheckedChange={(checked) => setFormData({ ...formData, allow_shared_bots: checked })}
                  />
                </div>
              )}

              {/* Risk Settings Section */}
              <div className="pt-2 border-t border-border">
                <h4 className="text-sm font-medium mb-3">Risk & Position Sizing</h4>
                <RiskSettingsForm
                  value={riskSettings}
                  onChange={setRiskSettings}
                  accountEquity={formData.initial_balance}
                />
              </div>
            </div>
          </ScrollArea>

          <DialogFooter className="pt-4">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={createAccount.isPending || !formData.name}>
              {createAccount.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Add Account
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}