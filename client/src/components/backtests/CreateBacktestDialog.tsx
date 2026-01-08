import { useState } from "react";
import { useCreateBacktest, useRunBacktest } from "@/hooks/useBacktests";
import type { Bot } from "@/hooks/useBots";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { Loader2 } from "lucide-react";

interface CreateBacktestDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  bots: Bot[];
}

export function CreateBacktestDialog({ open, onOpenChange, bots }: CreateBacktestDialogProps) {
  const createBacktest = useCreateBacktest();
  const runBacktest = useRunBacktest();
  const [formData, setFormData] = useState({
    name: "",
    bot_id: "",
    instrument: "ES",
    start_date: "",
    end_date: "",
    initial_capital: 50000,
  });

  const isLoading = createBacktest.isPending || runBacktest.isPending;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    // Create the backtest first
    const backtest = await createBacktest.mutateAsync({
      name: formData.name,
      bot_id: formData.bot_id,
      instrument: formData.instrument,
      start_date: formData.start_date,
      end_date: formData.end_date,
      initial_capital: formData.initial_capital,
      status: "pending",
    });

    // Then run it
    await runBacktest.mutateAsync(backtest.id);

    setFormData({
      name: "",
      bot_id: "",
      instrument: "ES",
      start_date: "",
      end_date: "",
      initial_capital: 50000,
    });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>New Backtest</DialogTitle>
          <DialogDescription>
            Run a historical simulation to test your bot's strategy.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="name">Backtest Name</Label>
              <Input
                id="name"
                placeholder="e.g., TrendFollower Q4 2024"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="bot">Select Bot</Label>
              <Select
                value={formData.bot_id}
                onValueChange={(v) => setFormData({ ...formData, bot_id: v })}
              >
                <SelectTrigger id="bot">
                  <SelectValue placeholder="Choose a bot..." />
                </SelectTrigger>
                <SelectContent>
                  {bots.map((bot) => (
                    <SelectItem key={bot.id} value={bot.id}>
                      {bot.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

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

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="start_date">Start Date</Label>
                <Input
                  id="start_date"
                  type="date"
                  value={formData.start_date}
                  onChange={(e) => setFormData({ ...formData, start_date: e.target.value })}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="end_date">End Date</Label>
                <Input
                  id="end_date"
                  type="date"
                  value={formData.end_date}
                  onChange={(e) => setFormData({ ...formData, end_date: e.target.value })}
                  required
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="initial_capital">Initial Capital ($)</Label>
              <Input
                id="initial_capital"
                type="number"
                min={1000}
                step={1000}
                value={formData.initial_capital}
                onChange={(e) => setFormData({ ...formData, initial_capital: parseInt(e.target.value) || 50000 })}
              />
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button 
              type="submit" 
              disabled={isLoading || !formData.name || !formData.bot_id || !formData.start_date || !formData.end_date}
            >
              {isLoading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              {isLoading ? "Running..." : "Run Backtest"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
