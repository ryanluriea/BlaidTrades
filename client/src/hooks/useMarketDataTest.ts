import { useState } from "react";
import { toast } from "sonner";

export interface MarketDataTestResult {
  ok: boolean;
  type: "live" | "historical";
  provider: string | null;
  symbol: string;
  data: Record<string, unknown> | null;
  error?: string;
  proof_json: Record<string, unknown>;
}

export function useMarketDataTest() {
  const [isLoading, setIsLoading] = useState(false);
  const [liveResult, setLiveResult] = useState<MarketDataTestResult | null>(null);
  const [historicalResult, setHistoricalResult] = useState<MarketDataTestResult | null>(null);

  const testLive = async (symbol: string = "AAPL"): Promise<MarketDataTestResult | null> => {
    setIsLoading(true);
    try {
      const response = await fetch(`/api/market-data-test?type=live&symbol=${symbol}`, {
        credentials: "include",
      });

      if (!response.ok) {
        toast.error("Live data test failed");
        return null;
      }

      const result = await response.json();
      const testResult = result.data || result;
      setLiveResult(testResult);

      if (testResult.ok) {
        toast.success("Live data test passed");
      } else {
        toast.error(testResult.error || "Live data test failed");
      }

      return testResult;
    } catch (err) {
      toast.error("Failed to test live data");
      return null;
    } finally {
      setIsLoading(false);
    }
  };

  const testHistorical = async (symbol: string = "AAPL", days: number = 30): Promise<MarketDataTestResult | null> => {
    setIsLoading(true);
    try {
      const response = await fetch(`/api/market-data-test?type=historical&symbol=${symbol}&days=${days}`, {
        credentials: "include",
      });

      if (!response.ok) {
        toast.error("Historical data test failed");
        return null;
      }

      const result = await response.json();
      const testResult = result.data || result;
      setHistoricalResult(testResult);

      if (testResult.ok) {
        toast.success("Historical data test passed");
      } else {
        toast.error(testResult.error || "Historical data test failed");
      }

      return testResult;
    } catch (err) {
      toast.error("Failed to test historical data");
      return null;
    } finally {
      setIsLoading(false);
    }
  };

  return {
    testLive,
    testHistorical,
    isLoading,
    liveResult,
    historicalResult,
  };
}
