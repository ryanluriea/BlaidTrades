import { useState } from "react";
import { useCreateBot } from "@/hooks/useBots";
import { useActiveArchetypes, useCreateBotFromArchetype } from "@/hooks/useArchetypes";
import { useQueryClient } from "@tanstack/react-query";
import { useAccounts } from "@/hooks/useAccounts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
import { Loader2, Search, CheckCircle, Layers, Wrench, Database } from "lucide-react";
import { DegradedBanner } from "@/components/ui/degraded-banner";
import { toast } from "sonner";
import http from "@/lib/http";

interface CreateBotDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CreateBotDialog({ open, onOpenChange }: CreateBotDialogProps) {
  const [activeTab, setActiveTab] = useState<"archetype" | "custom">("archetype");
  
  // Custom bot state
  const createBot = useCreateBot();
  const [formData, setFormData] = useState({
    name: "",
    description: "",
    instrument: "ES",
    timeframe: "5m",
    max_position_size: 3,
    max_daily_loss: 500,
    stop_loss_ticks: 20,
    risk_percent_per_trade: 0.5,
  });

  // Archetype bot state
  const [archetypeName, setArchetypeName] = useState("");
  const [archetypeDescription, setArchetypeDescription] = useState("");
  const [selectedArchetypeId, setSelectedArchetypeId] = useState<string>("");
  const [selectedAccountId, setSelectedAccountId] = useState<string>("");
  const [mode, setMode] = useState<"BACKTEST_ONLY" | "SIM_LIVE" | "SHADOW">("BACKTEST_ONLY");
  const [searchQuery, setSearchQuery] = useState("");
  const [isSeedingArchetypes, setIsSeedingArchetypes] = useState(false);

  const { data: archetypesRaw, isLoading: archetypesLoading, isError: archetypesError } = useActiveArchetypes();
  const { data: accountsRaw, isLoading: accountsLoading, isError: accountsError } = useAccounts();
  const archetypes = archetypesRaw ?? [];
  const accounts = accountsRaw ?? [];
  const createFromArchetype = useCreateBotFromArchetype();

  const queryClient = useQueryClient();
  const isAccountsDegraded = accountsError || (!accountsLoading && !accountsRaw);
  const isArchetypesDegraded = archetypesError || (!archetypesLoading && !archetypesRaw);
  const isArchetypesEmpty = !archetypesLoading && !archetypesError && archetypes.length === 0;

  const selectedArchetype = archetypes.find(a => a.id === selectedArchetypeId);

  const handleSeedArchetypes = async () => {
    setIsSeedingArchetypes(true);
    try {
      const response = await http.post<{ success: boolean; data?: { inserted: number }; error_code?: string }>("/api/archetypes/seed");
      if (!response.ok || !response.data?.success) {
        if (response.status === 401 || (response.data as any)?.error_code === "AUTH_REQUIRED") {
          throw new Error("Session expired - please sign in again");
        }
        throw new Error("Failed to seed archetypes");
      }
      const inserted = response.data.data?.inserted ?? 0;
      toast.success(`Seeded ${inserted} archetypes`);
      queryClient.invalidateQueries({ queryKey: ["all-archetypes"] });
      queryClient.invalidateQueries({ queryKey: ["active-archetypes"] });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to seed archetypes");
    } finally {
      setIsSeedingArchetypes(false);
    }
  };

  // Filter archetypes by search
  const filteredArchetypes = archetypes.filter(arch => 
    arch.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    arch.category.toLowerCase().includes(searchQuery.toLowerCase()) ||
    (arch.description?.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  // Group by category
  const groupedArchetypes = filteredArchetypes.reduce((acc, arch) => {
    const category = arch.category || "other";
    if (!acc[category]) acc[category] = [];
    acc[category].push(arch);
    return acc;
  }, {} as Record<string, typeof archetypes>);

  const resetForm = () => {
    setFormData({
      name: "",
      description: "",
      instrument: "ES",
      timeframe: "5m",
      max_position_size: 3,
      max_daily_loss: 500,
      stop_loss_ticks: 20,
      risk_percent_per_trade: 0.5,
    });
    setArchetypeName("");
    setArchetypeDescription("");
    setSelectedArchetypeId("");
    setSelectedAccountId("");
    setMode("BACKTEST_ONLY");
    setSearchQuery("");
  };

  const handleCustomSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    await createBot.mutateAsync({
      name: formData.name,
      description: formData.description,
      strategyConfig: {
        instrument: formData.instrument,
        timeframe: formData.timeframe,
      },
      riskConfig: {
        maxPositionSize: formData.max_position_size,
        maxDailyLoss: formData.max_daily_loss,
        stopLossTicks: formData.stop_loss_ticks,
        riskPercentPerTrade: formData.risk_percent_per_trade / 100,
        maxContractsPerTrade: formData.max_position_size,
      },
    } as any);

    resetForm();
    onOpenChange(false);
  };

  const handleArchetypeCreate = () => {
    if (!archetypeName || !selectedArchetypeId) return;

    createFromArchetype.mutate(
      {
        archetypeId: selectedArchetypeId,
        name: archetypeName,
        description: archetypeDescription,
        accountId: selectedAccountId && selectedAccountId !== "none" ? selectedAccountId : undefined,
        mode,
      },
      {
        onSuccess: () => {
          resetForm();
          onOpenChange(false);
        },
      }
    );
  };

  const isPending = createBot.isPending || createFromArchetype.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[550px] max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>Create New Bot</DialogTitle>
          <DialogDescription>
            Start from a strategy template or configure from scratch.
          </DialogDescription>
        </DialogHeader>

        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as typeof activeTab)} className="flex-1 overflow-hidden flex flex-col">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="archetype" className="gap-1.5">
              <Layers className="w-4 h-4" />
              From Archetype
            </TabsTrigger>
            <TabsTrigger value="custom" className="gap-1.5">
              <Wrench className="w-4 h-4" />
              Custom
            </TabsTrigger>
          </TabsList>

          {/* Archetype Tab */}
          <TabsContent value="archetype" className="flex-1 overflow-hidden flex flex-col mt-4 space-y-3">
            {/* Archetype Search & Selection */}
            <div className="space-y-2">
              <Label>Strategy Archetype</Label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input 
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search archetypes..."
                  className="pl-9"
                />
              </div>
              <ScrollArea className="h-36 border rounded-lg">
                {archetypesLoading ? (
                  <div className="p-4 text-center text-muted-foreground">Loading...</div>
                ) : (
                  <div className="p-2 space-y-3">
                    {Object.entries(groupedArchetypes).map(([category, arches]) => (
                      <div key={category}>
                        <h4 className="text-xs font-semibold uppercase text-muted-foreground px-2 mb-1">
                          {category}
                        </h4>
                        <div className="space-y-1">
                          {arches.map(arch => (
                            <button
                              key={arch.id}
                              type="button"
                              onClick={() => setSelectedArchetypeId(arch.id)}
                              className={`w-full text-left p-2 rounded-md transition-colors ${
                                selectedArchetypeId === arch.id 
                                  ? "bg-primary/10 border border-primary/30" 
                                  : "hover:bg-muted/50"
                              }`}
                            >
                              <div className="flex items-center justify-between">
                                <span className="font-medium text-sm">{arch.name}</span>
                                {selectedArchetypeId === arch.id && (
                                  <CheckCircle className="w-4 h-4 text-primary" />
                                )}
                              </div>
                              <p className="text-xs text-muted-foreground line-clamp-1">
                                {arch.description}
                              </p>
                              {arch.tags && (
                                <div className="flex gap-1 mt-1">
                                  {(arch.tags as string[]).slice(0, 3).map(tag => (
                                    <Badge key={tag} variant="outline" className="text-[10px] px-1 py-0">
                                      {tag}
                                    </Badge>
                                  ))}
                                </div>
                              )}
                            </button>
                          ))}
                        </div>
                      </div>
                    ))}
                    {filteredArchetypes.length === 0 && (
                      <div className="text-center py-4 space-y-2">
                        <p className="text-muted-foreground text-sm">
                          {isArchetypesEmpty 
                            ? "No archetypes available (seed required)" 
                            : "No archetypes match your search"}
                        </p>
                        {isArchetypesEmpty && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={handleSeedArchetypes}
                            disabled={isSeedingArchetypes}
                            data-testid="button-seed-archetypes"
                          >
                            {isSeedingArchetypes ? (
                              <>
                                <Loader2 className="w-3 h-3 mr-1.5 animate-spin" />
                                Seeding...
                              </>
                            ) : (
                              <>
                                <Database className="w-3 h-3 mr-1.5" />
                                Seed Archetypes
                              </>
                            )}
                          </Button>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </ScrollArea>
            </div>

            {/* Bot Name */}
            <div className="space-y-2">
              <Label>Bot Name</Label>
              <Input 
                value={archetypeName} 
                onChange={(e) => setArchetypeName(e.target.value)} 
                placeholder={selectedArchetype ? `My ${selectedArchetype.name}` : "My Bot"}
              />
            </div>

            {/* Mode & Account Selection */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Initial Mode</Label>
                <Select value={mode} onValueChange={(v) => setMode(v as typeof mode)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="BACKTEST_ONLY">Backtest Only</SelectItem>
                    <SelectItem value="SIM_LIVE">SIM Live</SelectItem>
                    <SelectItem value="SHADOW">Shadow</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Account (optional)</Label>
                <Select value={selectedAccountId} onValueChange={setSelectedAccountId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select account" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">None</SelectItem>
                    {accounts.map(acc => (
                      <SelectItem key={acc.id} value={acc.id}>
                        {acc.name} ({acc.accountType})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Config Preview */}
            {selectedArchetype && (
              <div className="p-2 rounded-lg bg-muted/50 text-xs">
                <p className="font-medium mb-1">Default Config (v{selectedArchetype.version || 1})</p>
                <pre className="text-muted-foreground overflow-auto max-h-16">
                  {JSON.stringify(selectedArchetype.defaultConfigJson, null, 2)}
                </pre>
              </div>
            )}

            <DialogFooter className="pt-2">
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button 
                onClick={handleArchetypeCreate} 
                disabled={!archetypeName || !selectedArchetypeId || isPending}
              >
                {isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                Create Bot
              </Button>
            </DialogFooter>
          </TabsContent>

          {/* Custom Tab */}
          <TabsContent value="custom" className="flex-1 overflow-auto mt-4">
            <form onSubmit={handleCustomSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="name">Bot Name</Label>
                <Input
                  id="name"
                  placeholder="e.g., TrendFollower-v1"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  required
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="description">Description</Label>
                <Textarea
                  id="description"
                  placeholder="Describe the bot's strategy..."
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  rows={2}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="instrument">Instrument</Label>
                  <Select
                    value={formData.instrument}
                    onValueChange={(v) => setFormData({ ...formData, instrument: v })}
                  >
                    <SelectTrigger id="instrument">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ES">ES (E-mini S&P 500)</SelectItem>
                      <SelectItem value="NQ">NQ (E-mini Nasdaq)</SelectItem>
                      <SelectItem value="CL">CL (Crude Oil)</SelectItem>
                      <SelectItem value="GC">GC (Gold)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="timeframe">Timeframe</Label>
                  <Select
                    value={formData.timeframe}
                    onValueChange={(v) => setFormData({ ...formData, timeframe: v })}
                  >
                    <SelectTrigger id="timeframe">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="1m">1 minute</SelectItem>
                      <SelectItem value="5m">5 minutes</SelectItem>
                      <SelectItem value="15m">15 minutes</SelectItem>
                      <SelectItem value="1h">1 hour</SelectItem>
                      <SelectItem value="4h">4 hours</SelectItem>
                      <SelectItem value="1d">Daily</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="risk_percent">Risk % per Trade</Label>
                  <Input
                    id="risk_percent"
                    type="number"
                    min={0.1}
                    max={2}
                    step={0.1}
                    value={formData.risk_percent_per_trade}
                    onChange={(e) => setFormData({ ...formData, risk_percent_per_trade: parseFloat(e.target.value) || 0.5 })}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="max_position">Max Contracts</Label>
                  <Input
                    id="max_position"
                    type="number"
                    min={1}
                    max={10}
                    value={formData.max_position_size}
                    onChange={(e) => setFormData({ ...formData, max_position_size: parseInt(e.target.value) || 1 })}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="stop_ticks">Stop (ticks)</Label>
                  <Input
                    id="stop_ticks"
                    type="number"
                    min={1}
                    value={formData.stop_loss_ticks}
                    onChange={(e) => setFormData({ ...formData, stop_loss_ticks: parseInt(e.target.value) || 20 })}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="max_loss">Max Daily Loss ($)</Label>
                  <Input
                    id="max_loss"
                    type="number"
                    min={100}
                    step={100}
                    value={formData.max_daily_loss}
                    onChange={(e) => setFormData({ ...formData, max_daily_loss: parseInt(e.target.value) || 500 })}
                  />
                </div>
              </div>

              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={isPending || !formData.name}>
                  {isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                  Create Bot
                </Button>
              </DialogFooter>
            </form>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
