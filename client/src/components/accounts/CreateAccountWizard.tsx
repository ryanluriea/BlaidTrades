import { useState, useEffect } from "react";
import { useCreateAccount } from "@/hooks/useAccounts";
import { useLinkBrokerAccount, useBrokerAccountsByIntegration } from "@/hooks/useBrokerAccounts";
import { useIntegrations, useVerifyIntegration, useSyncBrokerAccounts } from "@/hooks/useIntegrations";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
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
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Loader2, Info, CheckCircle2, XCircle, AlertTriangle, Link2, RefreshCw, ChevronLeft, ChevronRight, FlaskConical, LineChart, Zap } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { RiskSettingsForm, getDefaultRiskSettings, type RiskSettings } from "./RiskSettingsForm";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

interface CreateAccountWizardProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type SourceType = "VIRTUAL" | "SIM" | "BROKER";
type WizardStep = "source" | "broker" | "configure";

// Industry-standard account source options
const SOURCE_OPTIONS: { 
  value: SourceType; 
  title: string; 
  subtitle: string;
  icon: typeof FlaskConical;
  bullets: string[];
}[] = [
  {
    value: "VIRTUAL",
    title: "Sandbox",
    subtitle: "Strategy testing & evolution",
    icon: FlaskConical,
    bullets: [
      "Live or historical data",
      "Not performance-valid",
      "Cannot be promoted",
    ],
  },
  {
    value: "SIM",
    title: "Paper Trading",
    subtitle: "Realistic execution simulation",
    icon: LineChart,
    bullets: [
      "Live market data",
      "Enforces risk rules",
      "Promotion eligible",
    ],
  },
  {
    value: "BROKER",
    title: "Live Trading",
    subtitle: "Real broker execution",
    icon: Zap,
    bullets: [
      "Verified broker required",
      "Real fills & balance",
      "Kill-switch protected",
    ],
  },
];

export function CreateAccountWizard({ open, onOpenChange }: CreateAccountWizardProps) {
  const createAccount = useCreateAccount();
  const linkBrokerAccount = useLinkBrokerAccount();
  const { data: integrations, isLoading: loadingIntegrations } = useIntegrations();
  const verifyIntegration = useVerifyIntegration();
  const syncBrokerAccounts = useSyncBrokerAccounts();

  const [step, setStep] = useState<WizardStep>("source");
  const [sourceType, setSourceType] = useState<SourceType>("SIM");
  const [selectedIntegrationId, setSelectedIntegrationId] = useState<string | null>(null);
  const [selectedBrokerAccountId, setSelectedBrokerAccountId] = useState<string | null>(null);
  const [accountName, setAccountName] = useState("");
  const [initialBalance, setInitialBalance] = useState(50000);
  const [allowSharedBots, setAllowSharedBots] = useState(false);
  const [riskSettings, setRiskSettings] = useState<RiskSettings>(getDefaultRiskSettings("moderate"));

  const { data: brokerAccounts, isLoading: loadingBrokerAccounts } = useBrokerAccountsByIntegration(selectedIntegrationId);

  // Filter broker integrations
  const brokerIntegrations = integrations?.filter(i => i.kind === "BROKER") || [];
  const selectedIntegration = brokerIntegrations.find(i => i.id === selectedIntegrationId);
  const selectedBrokerAccount = brokerAccounts?.find(ba => ba.id === selectedBrokerAccountId);

  // Reset wizard when closed
  useEffect(() => {
    if (!open) {
      setTimeout(() => {
        setStep("source");
        setSourceType("SIM");
        setSelectedIntegrationId(null);
        setSelectedBrokerAccountId(null);
        setAccountName("");
        setInitialBalance(50000);
        setAllowSharedBots(false);
        setRiskSettings(getDefaultRiskSettings("moderate"));
      }, 200);
    }
  }, [open]);

  // Auto-populate account name based on broker account
  useEffect(() => {
    if (selectedBrokerAccount && !accountName) {
      setAccountName(selectedBrokerAccount.broker_account_name);
    }
  }, [selectedBrokerAccount, accountName]);

  const handleVerify = async (integrationId: string) => {
    await verifyIntegration.mutateAsync(integrationId);
  };

  const handleSyncAccounts = async (integrationId: string) => {
    await syncBrokerAccounts.mutateAsync(integrationId);
  };

  const handleSubmit = async () => {
    if (sourceType === "BROKER") {
      if (!selectedBrokerAccountId || !selectedIntegrationId) return;
      
      await linkBrokerAccount.mutateAsync({
        name: accountName,
        broker_account_id: selectedBrokerAccountId,
        broker_connection_id: selectedIntegrationId,
        initial_balance: initialBalance,
        risk_tier: riskSettings.risk_tier === "custom" ? "moderate" : riskSettings.risk_tier,
        risk_percent_per_trade: riskSettings.risk_percent_per_trade,
        max_risk_dollars_per_trade: riskSettings.max_risk_dollars_per_trade,
        max_contracts_per_trade: riskSettings.max_contracts_per_trade,
        max_contracts_per_symbol: riskSettings.max_contracts_per_symbol,
        max_total_exposure_contracts: riskSettings.max_total_exposure_contracts,
        max_daily_loss_percent: riskSettings.max_daily_loss_percent,
        max_daily_loss_dollars: riskSettings.max_daily_loss_dollars,
      });
    } else {
      await createAccount.mutateAsync({
        name: accountName,
        account_type: sourceType,
        initial_balance: initialBalance,
        current_balance: initialBalance,
        risk_tier: riskSettings.risk_tier === "custom" ? "moderate" : riskSettings.risk_tier,
        provider: "INTERNAL",
        allow_shared_bots: allowSharedBots,
        risk_percent_per_trade: riskSettings.risk_percent_per_trade,
        max_risk_dollars_per_trade: riskSettings.max_risk_dollars_per_trade,
        max_contracts_per_trade: riskSettings.max_contracts_per_trade,
        max_contracts_per_symbol: riskSettings.max_contracts_per_symbol,
        max_total_exposure_contracts: riskSettings.max_total_exposure_contracts,
        max_daily_loss_percent: riskSettings.max_daily_loss_percent,
        max_daily_loss_dollars: riskSettings.max_daily_loss_dollars,
      });
    }

    onOpenChange(false);
  };

  const canProceedFromSource = sourceType !== null;
  const canProceedFromBroker = sourceType !== "BROKER" || (selectedBrokerAccountId !== null);
  const canSubmit = accountName.trim().length > 0 && (
    sourceType !== "BROKER" || (selectedBrokerAccountId !== null && selectedIntegrationId !== null)
  );

  const isPending = createAccount.isPending || linkBrokerAccount.isPending;

  const getStepTitle = () => {
    switch (step) {
      case "source": return "Choose Account Source";
      case "broker": return "Connect Broker";
      case "configure": return "Configure Account";
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px] max-h-[90vh]">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <DialogTitle>Add Trading Account</DialogTitle>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Info className="h-4 w-4 text-muted-foreground cursor-help" />
                </TooltipTrigger>
                <TooltipContent side="right" className="max-w-[280px]">
                  <p className="text-xs">
                    <strong>Virtual vs Simulation:</strong> Virtual (Sandbox) is for experimentation — results are not performance-valid and cannot be promoted. Simulation (Paper) is performance-accurate with realistic execution and can be promoted after audit.
                  </p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
          <DialogDescription>{getStepTitle()}</DialogDescription>
        </DialogHeader>

        {/* Step indicator - only show broker step for BROKER source type */}
        {(() => {
          const steps = sourceType === "BROKER" 
            ? ["source", "broker", "configure"] 
            : ["source", "configure"];
          const currentIdx = steps.indexOf(step);
          return (
            <div className="flex items-center gap-2 mb-3">
              {steps.map((s, idx) => (
                <div key={s} className="flex items-center gap-2">
                  <div
                    className={cn(
                      "w-6 h-6 rounded-full flex items-center justify-center text-xs font-medium",
                      step === s
                        ? "bg-primary text-primary-foreground"
                        : idx < currentIdx
                        ? "bg-primary/20 text-primary"
                        : "bg-muted text-muted-foreground"
                    )}
                  >
                    {idx + 1}
                  </div>
                  {idx < steps.length - 1 && (
                    <div className={cn(
                      "w-6 h-0.5",
                      idx < currentIdx ? "bg-primary" : "bg-muted"
                    )} />
                  )}
                </div>
              ))}
            </div>
          );
        })()}

        <ScrollArea className="max-h-[55vh] pr-4">
          {/* STEP 1: Source Selection */}
          {step === "source" && (
            <div className="space-y-3">
              <RadioGroup
                value={sourceType}
                onValueChange={(v) => setSourceType(v as SourceType)}
                className="grid gap-2"
              >
                {SOURCE_OPTIONS.map((option) => {
                  const Icon = option.icon;
                  const isSelected = sourceType === option.value;
                  const isDisabled = option.value === "BROKER" && brokerIntegrations.length === 0;
                  
                  return (
                    <TooltipProvider key={option.value}>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Label
                            htmlFor={option.value}
                            className={cn(
                              "group relative flex items-center gap-3 px-4 py-3 rounded-xl border-2 cursor-pointer transition-all duration-200",
                              isSelected
                                ? "border-primary bg-primary/5 shadow-[0_0_0_1px_hsl(var(--primary)/0.2)]"
                                : "border-transparent bg-muted/30 hover:bg-muted/50 hover:border-muted-foreground/20",
                              isDisabled && "opacity-50 cursor-not-allowed"
                            )}
                          >
                            <RadioGroupItem 
                              value={option.value} 
                              id={option.value}
                              disabled={isDisabled}
                              className="sr-only"
                            />
                            
                            {/* Icon */}
                            <div className={cn(
                              "flex-shrink-0 w-9 h-9 rounded-lg flex items-center justify-center transition-colors",
                              isSelected 
                                ? "bg-primary text-primary-foreground" 
                                : "bg-muted text-muted-foreground group-hover:bg-muted-foreground/20"
                            )}>
                              <Icon className="w-4 h-4" />
                            </div>
                            
                            {/* Content */}
                            <div className="flex-1 min-w-0">
                              <div className="font-semibold text-sm leading-tight">{option.title}</div>
                              <div className="text-xs text-muted-foreground">{option.subtitle}</div>
                            </div>
                          </Label>
                        </TooltipTrigger>
                        <TooltipContent side="left" className="max-w-[180px] p-2">
                          <ul className="text-[11px] space-y-0.5">
                            {option.bullets.map((bullet, idx) => (
                              <li key={idx} className="flex items-start gap-1.5">
                                <span className="text-muted-foreground">•</span>
                                <span>{bullet}</span>
                              </li>
                            ))}
                          </ul>
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  );
                })}
              </RadioGroup>

              {sourceType === "BROKER" && brokerIntegrations.length === 0 && (
                <Alert variant="destructive" className="py-2">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  <AlertDescription className="text-xs">
                    No broker connected. Configure in <strong>System Status → Connections</strong>.
                  </AlertDescription>
                </Alert>
              )}
            </div>
          )}

          {/* STEP 2: Broker Connection */}
          {step === "broker" && (
            <div className="space-y-4">
              {sourceType === "BROKER" ? (
                <>
                  <div className="space-y-2">
                    <Label>Select Broker Connection</Label>
                    {loadingIntegrations ? (
                      <div className="flex items-center gap-2 text-muted-foreground">
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Loading connections...
                      </div>
                    ) : brokerIntegrations.length === 0 ? (
                      <Alert variant="destructive">
                        <XCircle className="h-4 w-4" />
                        <AlertDescription>
                          No broker integrations configured. Add a broker in Settings → Connections first.
                        </AlertDescription>
                      </Alert>
                    ) : (
                      <div className="space-y-2">
                        {brokerIntegrations.map((integration) => (
                          <div
                            key={integration.id}
                            className={cn(
                              "flex items-center justify-between p-3 rounded-lg border cursor-pointer transition-colors",
                              selectedIntegrationId === integration.id
                                ? "border-primary bg-primary/5"
                                : "border-border hover:border-muted-foreground/50"
                            )}
                            onClick={() => setSelectedIntegrationId(integration.id)}
                          >
                            <div className="flex items-center gap-3">
                              <div
                                className={cn(
                                  "w-3 h-3 rounded-full",
                                  integration.status === "VERIFIED" || integration.status === "CONNECTED"
                                    ? "bg-green-500"
                                    : integration.status === "ERROR" || integration.status === "DISCONNECTED"
                                    ? "bg-red-500"
                                    : "bg-yellow-500"
                                )}
                              />
                              <div>
                                <div className="font-medium">{integration.label}</div>
                                <div className="text-xs text-muted-foreground">
                                  {integration.provider} • {integration.status}
                                  {integration.last_verified_at && (
                                    <> • Verified {new Date(integration.last_verified_at).toLocaleDateString()}</>
                                  )}
                                </div>
                              </div>
                            </div>
                            <div className="flex items-center gap-2">
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleVerify(integration.id);
                                }}
                                disabled={verifyIntegration.isPending}
                              >
                                {verifyIntegration.isPending ? (
                                  <Loader2 className="w-4 h-4 animate-spin" />
                                ) : (
                                  <CheckCircle2 className="w-4 h-4" />
                                )}
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleSyncAccounts(integration.id);
                                }}
                                disabled={syncBrokerAccounts.isPending}
                              >
                                {syncBrokerAccounts.isPending ? (
                                  <Loader2 className="w-4 h-4 animate-spin" />
                                ) : (
                                  <RefreshCw className="w-4 h-4" />
                                )}
                              </Button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {selectedIntegrationId && (
                    <div className="space-y-2">
                      <Label>Select Broker Account</Label>
                      {loadingBrokerAccounts ? (
                        <div className="flex items-center gap-2 text-muted-foreground">
                          <Loader2 className="w-4 h-4 animate-spin" />
                          Loading accounts...
                        </div>
                      ) : !brokerAccounts || brokerAccounts.length === 0 ? (
                        <Alert>
                          <AlertTriangle className="h-4 w-4" />
                          <AlertDescription>
                            No accounts found. Click the refresh button above to sync accounts from the broker.
                          </AlertDescription>
                        </Alert>
                      ) : (
                        <div className="space-y-2">
                          {brokerAccounts.map((account) => (
                            <div
                              key={account.id}
                              className={cn(
                                "flex items-center justify-between p-3 rounded-lg border cursor-pointer transition-colors",
                                selectedBrokerAccountId === account.id
                                  ? "border-primary bg-primary/5"
                                  : "border-border hover:border-muted-foreground/50"
                              )}
                              onClick={() => setSelectedBrokerAccountId(account.id)}
                            >
                              <div>
                                <div className="font-medium flex items-center gap-2">
                                  {account.broker_account_name}
                                  <Badge
                                    variant={account.broker_env === "LIVE" ? "destructive" : "secondary"}
                                    className="text-xs"
                                  >
                                    {account.broker_env}
                                  </Badge>
                                </div>
                                <div className="text-xs text-muted-foreground">
                                  ID: {account.broker_account_ref} • {account.currency}
                                  {account.permissions_json?.trade === false && " • Read-only"}
                                </div>
                              </div>
                              {selectedBrokerAccountId === account.id && (
                                <CheckCircle2 className="w-5 h-5 text-primary" />
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {selectedBrokerAccount?.broker_env === "DEMO" && (
                    <Alert>
                      <Info className="h-4 w-4" />
                      <AlertDescription>
                        This is a <strong>DEMO</strong> account. Trades will not use real money.
                      </AlertDescription>
                    </Alert>
                  )}
                </>
              ) : (
                <div className="text-center py-8 text-muted-foreground">
                  <p>No broker connection needed for {sourceType} accounts.</p>
                  <p className="text-sm mt-2">Click Next to configure your account.</p>
                </div>
              )}
            </div>
          )}

          {/* STEP 3: Configuration */}
          {step === "configure" && (
            <div className="space-y-5">
              {/* Account Info Section */}
              <div className="space-y-3">
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="name" className="text-xs font-medium text-muted-foreground">Account Name</Label>
                    <Input
                      id="name"
                      placeholder={sourceType === "BROKER" ? selectedBrokerAccount?.broker_account_name || "My Account" : "e.g., Paper Trading"}
                      value={accountName}
                      onChange={(e) => setAccountName(e.target.value)}
                      className="h-9"
                      required
                    />
                  </div>
                  
                  {sourceType !== "BROKER" && (
                    <div className="space-y-1.5">
                      <Label htmlFor="initial_balance" className="text-xs font-medium text-muted-foreground">Starting Balance</Label>
                      <div className="relative">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">$</span>
                        <Input
                          id="initial_balance"
                          type="number"
                          min={1000}
                          step={1000}
                          value={initialBalance}
                          onChange={(e) => setInitialBalance(parseInt(e.target.value) || 50000)}
                          className="h-9 pl-7"
                        />
                      </div>
                    </div>
                  )}
                </div>

                {sourceType === "BROKER" && selectedBrokerAccount && (
                  <div className="flex items-center gap-3 p-2.5 bg-muted/40 rounded-lg">
                    <div className="w-8 h-8 rounded-md bg-primary/10 flex items-center justify-center">
                      <Link2 className="w-4 h-4 text-primary" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate">{selectedIntegration?.provider}</div>
                      <div className="text-xs text-muted-foreground">{selectedBrokerAccount.broker_account_ref} • {selectedBrokerAccount.broker_env}</div>
                    </div>
                    <Badge variant={selectedBrokerAccount.broker_env === "LIVE" ? "destructive" : "secondary"} className="text-[10px]">
                      {selectedBrokerAccount.broker_env}
                    </Badge>
                  </div>
                )}

                {(sourceType === "VIRTUAL" || sourceType === "SIM") && (
                  <div className="flex items-center justify-between py-2">
                    <div className="flex items-center gap-2">
                      <Label htmlFor="allow_shared_bots" className="text-sm cursor-pointer">
                        Share equity across bots
                      </Label>
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Info className="w-3.5 h-3.5 text-muted-foreground cursor-help" />
                          </TooltipTrigger>
                          <TooltipContent side="right" className="max-w-[240px]">
                            <p className="text-xs"><strong>OFF (default):</strong> Each bot gets its own isolated sandbox starting at this balance.</p>
                            <p className="text-xs mt-1"><strong>ON:</strong> All bots share one equity pool — trades affect each other's available capital.</p>
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    </div>
                    <Switch
                      id="allow_shared_bots"
                      checked={allowSharedBots}
                      onCheckedChange={setAllowSharedBots}
                    />
                  </div>
                )}
              </div>

              {/* Risk Settings Section */}
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <div className="h-px flex-1 bg-border" />
                  <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Risk Settings</span>
                  <div className="h-px flex-1 bg-border" />
                </div>
                <RiskSettingsForm
                  value={riskSettings}
                  onChange={setRiskSettings}
                  accountEquity={initialBalance}
                  compact
                />
              </div>
            </div>
          )}
        </ScrollArea>

        <DialogFooter className="pt-4 gap-2">
          {step !== "source" && (
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                if (step === "configure") {
                  setStep(sourceType === "BROKER" ? "broker" : "source");
                } else {
                  setStep("source");
                }
              }}
            >
              <ChevronLeft className="w-4 h-4 mr-1" />
              Back
            </Button>
          )}
          <div className="flex-1" />
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          {step !== "configure" ? (
            <Button
              type="button"
              onClick={() => {
                if (step === "source") {
                  setStep(sourceType === "BROKER" ? "broker" : "configure");
                } else {
                  setStep("configure");
                }
              }}
              disabled={step === "source" ? !canProceedFromSource : !canProceedFromBroker}
            >
              Next
              <ChevronRight className="w-4 h-4 ml-1" />
            </Button>
          ) : (
            <Button
              type="button"
              onClick={handleSubmit}
              disabled={isPending || !canSubmit}
            >
              {isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              {sourceType === "BROKER" ? "Link Account" : "Create Account"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
