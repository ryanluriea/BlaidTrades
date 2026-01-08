import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
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
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Loader2, AlertTriangle, Eye, EyeOff, Key } from "lucide-react";
import { useUpsertIntegration, type Integration } from "@/hooks/useIntegrations";

interface AddIntegrationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  kind: 'MARKET_DATA' | 'BROKER' | 'AI_LLM' | 'ALT_DATA' | 'OPS_ALERTS';
  editIntegration?: Integration | null;
}

const MARKET_DATA_PROVIDERS = [
  { value: 'DATABENTO', label: 'Databento', description: 'Real-time and historical futures data' },
  { value: 'POLYGON', label: 'Polygon.io', description: 'Stocks, forex, crypto data' },
  { value: 'ALPHAVANTAGE', label: 'AlphaVantage', description: 'Research backup / historical data' },
];

const BROKER_PROVIDERS = [
  { value: 'IRONBEAM', label: 'Ironbeam', description: 'Futures broker' },
  { value: 'TRADOVATE', label: 'Tradovate', description: 'Futures broker with API access' },
];

const AI_LLM_PROVIDERS = [
  { value: 'OPENROUTER', label: 'OpenRouter', description: 'Multi-model routing with cost controls' },
  { value: 'OPENAI', label: 'OpenAI', description: 'GPT-4, GPT-5 models' },
  { value: 'ANTHROPIC', label: 'Anthropic', description: 'Claude models' },
  { value: 'GEMINI', label: 'Google Gemini', description: 'Gemini Pro/Flash' },
];

const ALT_DATA_PROVIDERS = [
  { value: 'MARKETAUX', label: 'MarketAux', description: 'News headlines + sentiment' },
  { value: 'FINNHUB', label: 'Finnhub', description: 'Market data + news + sentiment' },
  { value: 'UNUSUAL_WHALES', label: 'Unusual Whales', description: 'Options flow + dark pool' },
  { value: 'NEWS_API', label: 'News API', description: 'General news aggregator' },
];

const OPS_ALERTS_PROVIDERS = [
  { value: 'TWILIO', label: 'Twilio', description: 'SMS alerts for critical events' },
  { value: 'DISCORD', label: 'Discord', description: 'Webhook notifications' },
  { value: 'SLACK', label: 'Slack', description: 'Workspace notifications' },
];

const PROVIDER_MAP: Record<string, typeof MARKET_DATA_PROVIDERS> = {
  MARKET_DATA: MARKET_DATA_PROVIDERS,
  BROKER: BROKER_PROVIDERS,
  AI_LLM: AI_LLM_PROVIDERS,
  ALT_DATA: ALT_DATA_PROVIDERS,
  OPS_ALERTS: OPS_ALERTS_PROVIDERS,
};

const KIND_LABELS: Record<string, string> = {
  MARKET_DATA: 'Market Data Provider',
  BROKER: 'Broker',
  AI_LLM: 'AI/LLM Provider',
  ALT_DATA: 'Alternative Data',
  OPS_ALERTS: 'Ops/Alerts',
};

export function AddIntegrationDialog({
  open,
  onOpenChange,
  kind,
  editIntegration,
}: AddIntegrationDialogProps) {
  const [provider, setProvider] = useState<string>("");
  const [label, setLabel] = useState("");
  const [isPrimary, setIsPrimary] = useState(false);
  const [isEnabled, setIsEnabled] = useState(false);
  const [showApiKey, setShowApiKey] = useState(false);
  
  // Credential fields
  const [apiKey, setApiKey] = useState("");
  const [apiSecret, setApiSecret] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [fromNumber, setFromNumber] = useState("");
  const [defaultModel, setDefaultModel] = useState("");
  const [fallbackModel, setFallbackModel] = useState("");
  const [maxCostPerDay, setMaxCostPerDay] = useState("");

  const upsertIntegration = useUpsertIntegration();

  const providers = PROVIDER_MAP[kind] || MARKET_DATA_PROVIDERS;

  useEffect(() => {
    if (editIntegration) {
      setProvider(editIntegration.provider);
      setLabel(editIntegration.label);
      setIsPrimary(editIntegration.is_primary);
      setIsEnabled(editIntegration.is_enabled);
      // Don't restore credentials - they're never sent to client
      resetCredentials();
    } else {
      setProvider("");
      setLabel("");
      setIsPrimary(false);
      setIsEnabled(false);
      resetCredentials();
    }
  }, [editIntegration, open]);

  const resetCredentials = () => {
    setApiKey("");
    setApiSecret("");
    setUsername("");
    setPassword("");
    setFromNumber("");
    setDefaultModel("");
    setFallbackModel("");
    setMaxCostPerDay("");
  };

  const handleSave = async () => {
    const credentials: Record<string, string> = {};
    
    if (apiKey) credentials.api_key = apiKey;
    if (apiSecret) credentials.api_secret = apiSecret;
    if (username) credentials.username = username;
    if (password) credentials.password = password;
    if (fromNumber) credentials.from_number = fromNumber;
    
    // Non-secret config goes to capabilities_json on backend
    const config: Record<string, string> = {};
    if (defaultModel) config.default_model = defaultModel;
    if (fallbackModel) config.fallback_model = fallbackModel;
    if (maxCostPerDay) config.max_cost_per_day_usd = maxCostPerDay;

    await upsertIntegration.mutateAsync({
      id: editIntegration?.id,
      kind,
      provider,
      label: label || `${provider} Connection`,
      is_primary: isPrimary,
      is_enabled: isEnabled,
      credentials: Object.keys(credentials).length > 0 ? credentials : undefined,
      config: Object.keys(config).length > 0 ? config : undefined,
    });

    onOpenChange(false);
  };

  const selectedProvider = providers.find(p => p.value === provider);

  const renderCredentialFields = () => {
    switch (provider) {
      case 'DATABENTO':
      case 'POLYGON':
      case 'ALPHAVANTAGE':
      case 'MARKETAUX':
      case 'FINNHUB':
      case 'UNUSUAL_WHALES':
      case 'NEWS_API':
        return (
          <div className="space-y-3">
            <div className="space-y-2">
              <Label>API Key</Label>
              <div className="relative">
                <Input
                  type={showApiKey ? "text" : "password"}
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder={editIntegration?.key_fingerprint || "Enter API key"}
                  className="pr-10 font-mono"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="absolute right-1 top-1 h-7 w-7 p-0"
                  onClick={() => setShowApiKey(!showApiKey)}
                >
                  {showApiKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </Button>
              </div>
            </div>
          </div>
        );

      case 'TWILIO':
        return (
          <div className="space-y-3">
            <div className="space-y-2">
              <Label>Account SID</Label>
              <Input
                type={showApiKey ? "text" : "password"}
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                className="font-mono"
              />
            </div>
            <div className="space-y-2">
              <Label>Auth Token</Label>
              <Input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter Auth Token"
                className="font-mono"
              />
            </div>
            <div className="space-y-2">
              <Label>From Number</Label>
              <Input
                value={fromNumber}
                onChange={(e) => setFromNumber(e.target.value)}
                placeholder="+1234567890"
              />
              <p className="text-xs text-muted-foreground">
                Twilio phone number to send SMS from
              </p>
            </div>
          </div>
        );

      case 'OPENROUTER':
        return (
          <div className="space-y-3">
            <div className="space-y-2">
              <Label>API Key</Label>
              <div className="relative">
                <Input
                  type={showApiKey ? "text" : "password"}
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder={editIntegration?.key_fingerprint || "sk-or-..."}
                  className="pr-10 font-mono"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="absolute right-1 top-1 h-7 w-7 p-0"
                  onClick={() => setShowApiKey(!showApiKey)}
                >
                  {showApiKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </Button>
              </div>
            </div>
            <div className="space-y-2">
              <Label>Default Model</Label>
              <Input
                value={defaultModel}
                onChange={(e) => setDefaultModel(e.target.value)}
                placeholder="anthropic/claude-3.5-sonnet"
              />
            </div>
            <div className="space-y-2">
              <Label>Fallback Model</Label>
              <Input
                value={fallbackModel}
                onChange={(e) => setFallbackModel(e.target.value)}
                placeholder="openai/gpt-4o"
              />
            </div>
            <div className="space-y-2">
              <Label>Max Cost/Day (USD)</Label>
              <Input
                type="number"
                step="0.01"
                value={maxCostPerDay}
                onChange={(e) => setMaxCostPerDay(e.target.value)}
                placeholder="10.00"
              />
            </div>
          </div>
        );

      case 'OPENAI':
      case 'ANTHROPIC':
      case 'GEMINI':
        return (
          <div className="space-y-3">
            <div className="space-y-2">
              <Label>API Key</Label>
              <div className="relative">
                <Input
                  type={showApiKey ? "text" : "password"}
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder={editIntegration?.key_fingerprint || "Enter API key"}
                  className="pr-10 font-mono"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="absolute right-1 top-1 h-7 w-7 p-0"
                  onClick={() => setShowApiKey(!showApiKey)}
                >
                  {showApiKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </Button>
              </div>
            </div>
          </div>
        );

      case 'IRONBEAM':
      case 'TRADOVATE':
        return (
          <div className="space-y-3">
            <div className="space-y-2">
              <Label>API Key / Client ID</Label>
              <Input
                type={showApiKey ? "text" : "password"}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder={editIntegration?.key_fingerprint || "Enter API key or Client ID"}
                className="font-mono"
              />
            </div>
            <div className="space-y-2">
              <Label>API Secret</Label>
              <Input
                type="password"
                value={apiSecret}
                onChange={(e) => setApiSecret(e.target.value)}
                placeholder="Enter API secret"
                className="font-mono"
              />
            </div>
            <Alert className="bg-muted/50">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription className="text-xs">
                <strong>Security:</strong> Credentials are encrypted and stored server-side only. 
                They are never exposed to the browser after entry.
              </AlertDescription>
            </Alert>
          </div>
        );

      case 'DISCORD':
      case 'SLACK':
        return (
          <div className="space-y-3">
            <div className="space-y-2">
              <Label>Webhook URL</Label>
              <Input
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder={provider === 'DISCORD' ? 'https://discord.com/api/webhooks/...' : 'https://hooks.slack.com/services/...'}
                className="font-mono"
              />
            </div>
          </div>
        );

      default:
        return (
          <div className="text-center py-4 text-muted-foreground text-sm">
            Select a provider to configure credentials
          </div>
        );
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {editIntegration ? 'Edit' : 'Add'} {KIND_LABELS[kind] || 'Integration'}
          </DialogTitle>
          <DialogDescription>
            Configure credentials and settings for this integration.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label>Provider</Label>
            <Select value={provider} onValueChange={setProvider} disabled={!!editIntegration}>
              <SelectTrigger>
                <SelectValue placeholder="Select provider" />
              </SelectTrigger>
              <SelectContent>
                {providers.map((p) => (
                  <SelectItem key={p.value} value={p.value}>
                    <div>
                      <span>{p.label}</span>
                      <span className="text-muted-foreground text-xs ml-2">— {p.description}</span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Label (optional)</Label>
            <Input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder={`My ${selectedProvider?.label || 'Connection'}`}
            />
          </div>

          {provider && (
            <>
              <div className="border-t border-border pt-4">
                <div className="flex items-center gap-2 mb-3">
                  <Key className="w-4 h-4 text-muted-foreground" />
                  <span className="text-sm font-medium">Credentials</span>
                </div>
                {renderCredentialFields()}
              </div>

              <div className="flex items-center justify-between pt-2">
                <Label htmlFor="primary" className="text-sm">Set as primary</Label>
                <Switch
                  id="primary"
                  checked={isPrimary}
                  onCheckedChange={setIsPrimary}
                />
              </div>

              <div className="flex items-center justify-between">
                <Label htmlFor="enabled" className="text-sm">Enable after saving</Label>
                <Switch
                  id="enabled"
                  checked={isEnabled}
                  onCheckedChange={setIsEnabled}
                />
              </div>
            </>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={handleSave}
            disabled={!provider || upsertIntegration.isPending}
          >
            {upsertIntegration.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            {editIntegration ? 'Update' : 'Save'} Integration
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
