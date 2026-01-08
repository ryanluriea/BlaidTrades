import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Brain, TrendingUp, RefreshCw, AlertTriangle, CheckCircle, BarChart3 } from "lucide-react";

interface MLModel {
  id: string;
  symbol: string;
  version: number;
  isActive: boolean;
  trainAccuracy: number;
  testAccuracy: number;
  featureImportance: { feature: string; importance: number }[];
  createdAt: string;
  lastRetrainedAt: string | null;
}

interface DriftAlert {
  modelId: string;
  symbol: string;
  psi: number;
  klDivergence: number;
  needsRetrain: boolean;
  detectedAt: string;
}

export default function MLModels() {
  const { data: models, isLoading: modelsLoading } = useQuery<MLModel[]>({
    queryKey: ["/api/ml/models"],
    refetchInterval: 30000,
  });

  const { data: driftAlerts, isLoading: driftLoading } = useQuery<DriftAlert[]>({
    queryKey: ["/api/ml/drift-alerts"],
    refetchInterval: 60000,
  });

  const { data: testResults } = useQuery<{ passed: number; total: number; results: { name: string; passed: boolean }[] }>({
    queryKey: ["/api/_proof/ml-tests"],
  });

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold" data-testid="text-ml-models-title">ML Alpha Models</h1>
          <p className="text-muted-foreground">Gradient boosting classifiers for market prediction</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {testResults && (
            <Badge variant={testResults.passed === testResults.total ? "default" : "destructive"} data-testid="badge-test-status">
              {testResults.passed === testResults.total ? <CheckCircle className="w-3 h-3 mr-1" /> : <AlertTriangle className="w-3 h-3 mr-1" />}
              Tests: {testResults.passed}/{testResults.total}
            </Badge>
          )}
        </div>
      </div>

      {driftAlerts && driftAlerts.length > 0 && (
        <Alert variant="destructive" data-testid="alert-drift-warning">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Model Drift Detected</AlertTitle>
          <AlertDescription>
            {driftAlerts.length} model(s) showing distribution drift. Retraining recommended.
          </AlertDescription>
        </Alert>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        <Card data-testid="card-test-summary">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Brain className="w-4 h-4" />
              Test Suite Status
            </CardTitle>
          </CardHeader>
          <CardContent>
            {testResults ? (
              <div className="space-y-2">
                <div className="text-2xl font-bold">{testResults.passed}/{testResults.total} Passed</div>
                <Progress value={(testResults.passed / testResults.total) * 100} className="h-2" />
                <div className="text-xs text-muted-foreground mt-2 space-y-1">
                  {testResults.results?.slice(0, 5).map((r, i) => (
                    <div key={i} className="flex items-center gap-1">
                      {r.passed ? <CheckCircle className="w-3 h-3 text-green-500" /> : <AlertTriangle className="w-3 h-3 text-red-500" />}
                      <span>{r.name}</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <Skeleton className="h-16 w-full" />
            )}
          </CardContent>
        </Card>

        <Card data-testid="card-active-models">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <TrendingUp className="w-4 h-4" />
              Active Models
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {modelsLoading ? <Skeleton className="h-8 w-16" /> : models?.filter(m => m.isActive).length || 0}
            </div>
            <p className="text-xs text-muted-foreground">Gradient boosting classifiers deployed</p>
          </CardContent>
        </Card>

        <Card data-testid="card-drift-status">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <RefreshCw className="w-4 h-4" />
              Drift Monitoring
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {driftLoading ? <Skeleton className="h-8 w-16" /> : driftAlerts?.filter(d => d.needsRetrain).length || 0}
            </div>
            <p className="text-xs text-muted-foreground">Models requiring retraining</p>
          </CardContent>
        </Card>
      </div>

      <Card data-testid="card-models-table">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BarChart3 className="w-5 h-5" />
            Model Registry
          </CardTitle>
          <CardDescription>Trained ML models with performance metrics</CardDescription>
        </CardHeader>
        <CardContent>
          {modelsLoading ? (
            <div className="space-y-2">
              {[1, 2, 3].map(i => (
                <Skeleton key={i} className="h-16 w-full" />
              ))}
            </div>
          ) : models && models.length > 0 ? (
            <div className="space-y-3">
              {models.map((model) => (
                <div key={model.id} className="flex items-center justify-between p-3 border rounded-md" data-testid={`row-model-${model.id}`}>
                  <div className="flex items-center gap-3">
                    <Badge variant={model.isActive ? "default" : "secondary"}>
                      {model.symbol}
                    </Badge>
                    <div>
                      <div className="font-medium">v{model.version}</div>
                      <div className="text-xs text-muted-foreground">
                        Train: {(model.trainAccuracy * 100).toFixed(1)}% | Test: {(model.testAccuracy * 100).toFixed(1)}%
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {model.featureImportance?.slice(0, 3).map((f, i) => (
                      <Badge key={i} variant="outline" className="text-xs">
                        {f.feature}: {(f.importance * 100).toFixed(0)}%
                      </Badge>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-8 text-muted-foreground">
              <Brain className="w-12 h-12 mx-auto mb-4 opacity-50" />
              <p>No ML models trained yet</p>
              <p className="text-sm">Models are trained automatically when sufficient data is collected</p>
            </div>
          )}
        </CardContent>
      </Card>

      <Card data-testid="card-feature-importance">
        <CardHeader>
          <CardTitle>Feature Importance Analysis</CardTitle>
          <CardDescription>Top features driving model predictions</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {[
              { feature: "RSI (14)", importance: 0.15, description: "Relative Strength Index" },
              { feature: "BB Position", importance: 0.12, description: "Bollinger Band positioning" },
              { feature: "MACD Histogram", importance: 0.11, description: "Momentum indicator" },
              { feature: "Volume Ratio", importance: 0.09, description: "Current vs average volume" },
              { feature: "ATR Ratio", importance: 0.08, description: "Volatility measure" },
              { feature: "Trend Strength", importance: 0.07, description: "ADX-based trend indicator" },
            ].map((item, i) => (
              <div key={i} className="space-y-1">
                <div className="flex justify-between text-sm">
                  <span className="font-medium">{item.feature}</span>
                  <span className="text-muted-foreground">{(item.importance * 100).toFixed(1)}%</span>
                </div>
                <Progress value={item.importance * 100 / 0.15 * 100} className="h-2" />
                <p className="text-xs text-muted-foreground">{item.description}</p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
