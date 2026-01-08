import { useState } from "react";
import { toast } from "sonner";

export interface DryRunResult {
  ok: boolean;
  provider: string;
  reason_codes: string[];
  validated_fields: Record<string, boolean>;
  proof_json: Record<string, unknown>;
  errors?: string[];
}

export function useBrokerDryRun() {
  const [isLoading, setIsLoading] = useState(false);
  const [result, setResult] = useState<DryRunResult | null>(null);

  const runDryValidation = async (params: {
    provider: "IRONBEAM" | "TRADOVATE";
    symbol: string;
    side: "BUY" | "SELL";
    qty: number;
    order_type: "MARKET" | "LIMIT" | "STOP";
    account_id: string;
    broker_account_id?: string;
  }): Promise<DryRunResult | null> => {
    setIsLoading(true);
    try {
      const response = await fetch("/api/broker/dry-run", {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(params),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ reason_codes: ['NETWORK_ERROR'] }));
        const result: DryRunResult = {
          ok: false,
          provider: params.provider,
          reason_codes: errorData.reason_codes || ['REQUEST_FAILED'],
          validated_fields: {},
          proof_json: {},
          errors: [errorData.error || 'Request failed'],
        };
        setResult(result);
        toast.error(`Dry-run FAILED: ${result.reason_codes.join(", ")}`);
        return result;
      }

      const data = await response.json();
      setResult(data);

      if (data.ok) {
        toast.success("Broker dry-run validation PASSED");
      } else {
        toast.error(`Dry-run FAILED: ${data.reason_codes.join(", ")}`);
      }

      return data;
    } catch (err) {
      toast.error("Failed to run broker dry-run validation");
      return null;
    } finally {
      setIsLoading(false);
    }
  };

  return {
    runDryValidation,
    isLoading,
    result,
  };
}
