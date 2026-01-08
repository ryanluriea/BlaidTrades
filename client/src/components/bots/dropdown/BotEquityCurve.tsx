import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useBotEquityCurve } from "@/hooks/useBotDetails";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine } from "recharts";
import { TrendingUp } from "lucide-react";
import { DegradedBanner } from "@/components/ui/degraded-banner";

interface BotEquityCurveProps {
  botId: string;
  options?: {
    mode?: string;
    accountId?: string;
    startDate?: string;
    endDate?: string;
  };
}

export function BotEquityCurve({ botId, options }: BotEquityCurveProps) {
  const { data: curve, isLoading, isError } = useBotEquityCurve(botId, options);

  const isDegraded = isError || (!isLoading && curve === undefined);

  if (isLoading) {
    return (
      <Card>
        <CardHeader className="p-3 pb-2">
          <Skeleton className="h-4 w-24" />
        </CardHeader>
        <CardContent className="p-3 pt-0">
          <Skeleton className="h-32 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (isDegraded) {
    return (
      <Card>
        <CardHeader className="p-3 pb-2">
          <CardTitle className="text-xs flex items-center gap-1.5">
            <TrendingUp className="w-3.5 h-3.5" />
            Equity Curve
          </CardTitle>
        </CardHeader>
        <CardContent className="p-3 pt-0">
          <DegradedBanner message="Equity data unavailable" variant="inline" />
        </CardContent>
      </Card>
    );
  }

  const hasData = curve && curve.length > 0;

  return (
    <Card>
      <CardHeader className="p-3 pb-2">
        <CardTitle className="text-xs flex items-center gap-1.5">
          <TrendingUp className="w-3.5 h-3.5" />
          Equity Curve
        </CardTitle>
      </CardHeader>
      <CardContent className="p-3 pt-0">
        {hasData ? (
          <div className="h-32">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={curve}>
                <XAxis 
                  dataKey="date" 
                  tick={{ fontSize: 9 }}
                  tickFormatter={(value) => {
                    const date = new Date(value);
                    return `${date.getMonth() + 1}/${date.getDate()}`;
                  }}
                />
                <YAxis 
                  tick={{ fontSize: 9 }}
                  tickFormatter={(value) => `$${value.toFixed(0)}`}
                  width={50}
                />
                <Tooltip 
                  contentStyle={{ 
                    fontSize: 11, 
                    backgroundColor: 'hsl(var(--popover))',
                    border: '1px solid hsl(var(--border))',
                    borderRadius: 6
                  }}
                  formatter={(value: number) => [`$${value.toFixed(2)}`, 'Equity']}
                  labelFormatter={(label) => new Date(label).toLocaleDateString()}
                />
                <ReferenceLine y={0} stroke="hsl(var(--muted-foreground))" strokeDasharray="3 3" />
                <Line 
                  type="monotone" 
                  dataKey="equity" 
                  stroke="hsl(var(--primary))" 
                  strokeWidth={1.5}
                  dot={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <div className="h-32 flex items-center justify-center text-xs text-muted-foreground">
            No trades yet
          </div>
        )}
      </CardContent>
    </Card>
  );
}
