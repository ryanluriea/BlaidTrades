import { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { 
  Database, 
  Building2, 
  Brain, 
  Key, 
  GitBranch, 
  FileText,
  Phone,
  LayoutGrid,
} from "lucide-react";
import { IntegrationOverview } from "./IntegrationOverview";
import { LiveStackSummary } from "./LiveStackSummary";
import { MarketDataSection } from "./MarketDataSection";
import { BrokersSection } from "./BrokersSection";
import { LLMProvidersSection } from "./LLMProvidersSection";
import { OpsAlertsSection } from "./OpsAlertsSection";
import { CredentialsVault } from "./CredentialsVault";
import { RoutingPriority } from "./RoutingPriority";
import { ConnectionAuditLogs } from "./ConnectionAuditLogs";
import { MarketDataProofPanel } from "./MarketDataProofPanel";

export function ConnectionsTab() {
  const [activeSubTab, setActiveSubTab] = useState("overview");

  return (
    <div className="space-y-4">
      <Tabs value={activeSubTab} onValueChange={setActiveSubTab}>
        <TabsList className="w-full overflow-x-auto flex">
          <TabsTrigger value="overview" className="flex-1 min-w-0 text-xs px-2">
            <LayoutGrid className="w-3 h-3 sm:mr-1" />
            <span className="hidden sm:inline">Overview</span>
          </TabsTrigger>
          <TabsTrigger value="market-data" className="flex-1 min-w-0 text-xs px-2">
            <Database className="w-3 h-3 sm:mr-1" />
            <span className="hidden sm:inline">Data</span>
          </TabsTrigger>
          <TabsTrigger value="brokers" className="flex-1 min-w-0 text-xs px-2">
            <Building2 className="w-3 h-3 sm:mr-1" />
            <span className="hidden sm:inline">Brokers</span>
          </TabsTrigger>
          <TabsTrigger value="llm" className="flex-1 min-w-0 text-xs px-2">
            <Brain className="w-3 h-3 sm:mr-1" />
            <span className="hidden sm:inline">AI</span>
          </TabsTrigger>
          <TabsTrigger value="ops-alerts" className="flex-1 min-w-0 text-xs px-2">
            <Phone className="w-3 h-3 sm:mr-1" />
            <span className="hidden sm:inline">Alerts</span>
          </TabsTrigger>
          <TabsTrigger value="vault" className="flex-1 min-w-0 text-xs px-2">
            <Key className="w-3 h-3 sm:mr-1" />
            <span className="hidden sm:inline">Vault</span>
          </TabsTrigger>
          <TabsTrigger value="audit" className="flex-1 min-w-0 text-xs px-2">
            <FileText className="w-3 h-3 sm:mr-1" />
            <span className="hidden sm:inline">Audit</span>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="overview">
          <div className="space-y-4">
            <LiveStackSummary />
            <IntegrationOverview />
          </div>
        </TabsContent>

        <TabsContent value="market-data">
          <div className="space-y-4">
            <MarketDataSection />
            <MarketDataProofPanel />
          </div>
        </TabsContent>

        <TabsContent value="brokers">
          <BrokersSection />
        </TabsContent>

        <TabsContent value="llm">
          <LLMProvidersSection />
        </TabsContent>

        <TabsContent value="ops-alerts">
          <OpsAlertsSection />
        </TabsContent>

        <TabsContent value="vault">
          <CredentialsVault />
        </TabsContent>

        <TabsContent value="routing">
          <RoutingPriority />
        </TabsContent>

        <TabsContent value="audit">
          <ConnectionAuditLogs />
        </TabsContent>
      </Tabs>
    </div>
  );
}
