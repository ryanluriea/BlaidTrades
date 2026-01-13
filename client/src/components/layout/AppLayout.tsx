import { useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { AlertBellButton } from "@/components/alerts/AlertBellButton";
import { HeaderClockBadge } from "@/components/layout/HeaderClockBadge";
import { UnifiedSystemsDropdown } from "@/components/layout/UnifiedSystemsDropdown";
import { StrategyLabGlobalDialog } from "@/components/layout/StrategyLabGlobalDialog";
import { SourcesSettingsDropdown } from "@/components/bots/SourcesSettingsDropdown";
import { CloudBackupButton } from "@/components/backup/CloudBackupButton";
import { FleetGovernorButton } from "@/components/layout/FleetGovernorButton";
import {
  Bot,
  Microscope,
  Wallet,
  Activity,
  Settings,
  Menu,
  X,
  Trophy,
  Brain,
} from "lucide-react";
import { PowerButton } from "@/components/power/PowerButton";

interface AppLayoutProps {
  children: React.ReactNode;
  title?: string;
  disableMainScroll?: boolean;
  headerContent?: React.ReactNode;
}

const navItems = [
  { href: "/bots", label: "Bots", icon: Bot },
  { href: "/strategy-lab", label: "Strategy Lab", icon: Microscope },
  { href: "/research-monitor", label: "AI Research", icon: Brain },
  { href: "/tournaments", label: "Tournaments", icon: Trophy },
  { href: "/operations", label: "Operations", icon: Activity },
  { href: "/accounts", label: "Accounts", icon: Wallet },
];

interface VersionInfo {
  version: string;
  buildTime: string;
  buildSha: string;
  environment: string;
  instance: string;
}

export function AppLayout({ children, title, disableMainScroll, headerContent }: AppLayoutProps) {
  const location = useLocation();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  
  const { data: versionInfo } = useQuery<VersionInfo>({
    queryKey: ["/api/version"],
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });

  return (
    <div className="h-screen overflow-hidden bg-background flex">
      {/* Sidebar - Desktop (Icon only, industry-standard thin) */}
      <aside className="hidden lg:flex h-full flex-col bg-sidebar w-12 border-r border-border/30">
        {/* Alert Bell at top */}
        <div className="h-12 flex items-center justify-center border-b border-border/20">
          <AlertBellButton />
        </div>

        {/* Nav Items */}
        <nav className="flex-1 overflow-y-auto py-2 px-1.5 space-y-0.5">
          {navItems.map((item) => {
            // Special handling: /training, /backtests, /system-status should highlight Operations
            const isActive =
              location.pathname === item.href ||
              location.pathname.startsWith(item.href + "/") ||
              (item.href === "/operations" && (
                location.pathname.startsWith("/backtests") ||
                location.pathname.startsWith("/training") ||
                location.pathname.startsWith("/system-status")
              ));
            return (
              <Link
                key={item.href}
                to={item.href}
                title={item.label}
                className={cn(
                  "flex items-center justify-center p-2 rounded-md transition-colors",
                  isActive
                    ? "bg-sidebar-primary text-sidebar-primary-foreground"
                    : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                )}
              >
                <item.icon className="w-4 h-4" />
              </Link>
            );
          })}
        </nav>

        {/* Cloud Backup and Settings at bottom */}
        <div className="p-1.5 border-t border-border/20 space-y-0.5">
          <CloudBackupButton variant="icon" />
          <Link
            to="/settings"
            title="Settings"
            className={cn(
              "flex items-center justify-center p-2 rounded-md transition-colors",
              location.pathname === "/settings"
                ? "bg-sidebar-primary text-sidebar-primary-foreground"
                : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
            )}
          >
            <Settings className="w-4 h-4" />
          </Link>
        </div>
      </aside>

      {/* Mobile Menu Overlay */}
      {mobileMenuOpen && (
        <div
          className="lg:hidden fixed inset-0 bg-background/80 backdrop-blur-sm z-40"
          onClick={() => setMobileMenuOpen(false)}
        />
      )}

      {/* Sidebar - Mobile */}
      <aside
        className={cn(
          "lg:hidden fixed inset-y-0 left-0 z-50 w-64 bg-sidebar transform transition-transform duration-300",
          mobileMenuOpen ? "translate-x-0" : "-translate-x-full"
        )}
      >
        <div className="h-16 flex items-center justify-between px-4">
          <Link to="/bots" className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center">
              <Bot className="w-5 h-5 text-primary-foreground" />
            </div>
            <span className="font-semibold text-sidebar-foreground">Bl<span className="italic text-emerald-500">ai</span>dTrades</span>
          </Link>
          <div className="flex items-center gap-1">
            <AlertBellButton />
            <Button variant="ghost" size="icon" onClick={() => setMobileMenuOpen(false)}>
              <X className="w-5 h-5" />
            </Button>
          </div>
        </div>

        <nav className="flex-1 overflow-y-auto py-4 px-2 space-y-1">
          {navItems.map((item) => {
            // Special handling: /training, /backtests, /system-status should highlight Operations
            const isActive =
              location.pathname === item.href ||
              location.pathname.startsWith(item.href + "/") ||
              (item.href === "/operations" && (
                location.pathname.startsWith("/backtests") ||
                location.pathname.startsWith("/training") ||
                location.pathname.startsWith("/system-status")
              ));
            return (
              <Link
                key={item.href}
                to={item.href}
                onClick={() => setMobileMenuOpen(false)}
                className={cn(
                  "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors",
                  isActive
                    ? "bg-sidebar-primary text-sidebar-primary-foreground"
                    : "text-sidebar-foreground hover:bg-sidebar-accent"
                )}
              >
                <item.icon className="w-5 h-5" />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>

        {/* Cloud Backup and Settings at bottom */}
        <div className="p-2 space-y-1">
          <div onClick={() => setMobileMenuOpen(false)}>
            <CloudBackupButton variant="full" />
          </div>
          <Link
            to="/settings"
            onClick={() => setMobileMenuOpen(false)}
            className={cn(
              "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors",
              location.pathname === "/settings"
                ? "bg-sidebar-primary text-sidebar-primary-foreground"
                : "text-sidebar-foreground hover:bg-sidebar-accent"
            )}
          >
            <Settings className="w-5 h-5" />
            <span>Settings</span>
          </Link>
        </div>
      </aside>

      {/* Main Content */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Top Bar - h-12 matches sidebar header height */}
        <header className="bg-card sticky top-0 z-50 flex-shrink-0 overflow-visible">
          <div className="h-12 flex items-center justify-between px-4 lg:px-6 gap-4">
            {/* Left side: Logo and title */}
            <div className="flex items-center gap-4 min-w-0 flex-shrink-0">
              <Button
                variant="ghost"
                size="icon"
                className="lg:hidden flex-shrink-0"
                onClick={() => setMobileMenuOpen(true)}
              >
                <Menu className="w-5 h-5" />
              </Button>
              <div className="flex flex-col min-w-0">
                <div className="flex items-center gap-2">
                  <h1 className="text-xl font-bold text-foreground whitespace-nowrap">
                    Bl<span className="italic text-emerald-500">ai</span>dTrades
                  </h1>
                  <div className="hidden md:block">
                    <SourcesSettingsDropdown />
                  </div>
                </div>
                {title && <span className="text-xs text-muted-foreground truncate">{title}</span>}
              </div>
            </div>
            
            {/* Custom header content from page */}
            {headerContent && (
              <div className="hidden lg:flex items-center min-w-0 flex-1 overflow-x-auto">
                {headerContent}
              </div>
            )}
            
            {/* Right side: Controls - horizontal layout with proper constraints */}
            <div className="flex items-center gap-2 flex-shrink-0">
              {/* Fleet Governor - accessible from all pages */}
              <FleetGovernorButton />
              {/* Unified AI & Systems dropdown */}
              <UnifiedSystemsDropdown className="hidden sm:flex" />
              <HeaderClockBadge symbol="ES" />
              <PowerButton />
            </div>
          </div>
        </header>

        {/* Page Content */}
        <main className={cn(
          "flex-1 pt-0 px-4 pb-4 lg:pt-0 lg:px-6 lg:pb-6 bg-grid",
          disableMainScroll ? "overflow-hidden flex flex-col" : "overflow-auto"
        )}>{children}</main>
      </div>
      
      {/* Global Strategy Lab Settings Dialog */}
      <StrategyLabGlobalDialog />
    </div>
  );
}
