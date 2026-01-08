import { useQuery } from "@tanstack/react-query";
import { http } from "@/lib/http";
import { STANDARD_SYMBOLS, MICRO_SYMBOLS, ALL_SYMBOLS } from "@shared/symbolConstants";

export type SymbolClassPreference = "MICRO" | "STANDARD" | "ALL";

export function useSymbolPreference() {
  const { data, isLoading } = useQuery<{ success: boolean; data: { symbolClass: string } }>({
    queryKey: ["/api/preferences/symbol"],
    queryFn: async () => {
      const response = await http.get<{ success: boolean; data: { symbolClass: string } }>("/api/preferences/symbol");
      if (!response.ok) throw new Error("Failed to fetch symbol preference");
      return response.data;
    },
    staleTime: 60000,
    refetchInterval: 60000,
    retry: false,
  });

  const symbolClass = (data?.data?.symbolClass || "ALL") as SymbolClassPreference;

  const filteredSymbols = symbolClass === "MICRO" 
    ? MICRO_SYMBOLS 
    : symbolClass === "STANDARD" 
      ? STANDARD_SYMBOLS 
      : ALL_SYMBOLS;

  return {
    symbolClass,
    filteredSymbols,
    isLoading,
  };
}
