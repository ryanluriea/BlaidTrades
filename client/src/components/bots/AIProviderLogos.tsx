/**
 * AI PROVIDER LOGOS - Shows which AI providers a bot uses
 * 
 * Rules per spec:
 * - Show up to 3 monochrome logos
 * - Only if actually used
 * - Overflow → "+N"
 * - NO logos if unused
 */

import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useBotAIProviders, useBotAIUsage } from '@/hooks/useAITelemetry';
import { useState } from 'react';

interface AIProviderLogosProps {
  botId: string;
  className?: string;
}

// Provider logo SVGs (monochrome)
const PROVIDER_ICONS: Record<string, React.ReactNode> = {
  lovable: (
    <svg viewBox="0 0 24 24" className="w-4 h-4 fill-current">
      <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
    </svg>
  ),
  openai: (
    <svg viewBox="0 0 24 24" className="w-4 h-4 fill-current">
      <path d="M22.2819 9.8211a5.9847 5.9847 0 0 0-.5157-4.9108 6.0462 6.0462 0 0 0-6.5098-2.9A6.0651 6.0651 0 0 0 4.9807 4.1818a5.9847 5.9847 0 0 0-3.9977 2.9 6.0462 6.0462 0 0 0 .7427 7.0966 5.98 5.98 0 0 0 .511 4.9107 6.051 6.051 0 0 0 6.5146 2.9001A5.9847 5.9847 0 0 0 13.2599 24a6.0557 6.0557 0 0 0 5.7718-4.2058 5.9894 5.9894 0 0 0 3.9977-2.9001 6.0557 6.0557 0 0 0-.7475-7.0729z" />
    </svg>
  ),
  anthropic: (
    <svg viewBox="0 0 24 24" className="w-4 h-4 fill-current">
      <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z" />
    </svg>
  ),
  groq: (
    <svg viewBox="0 0 24 24" className="w-4 h-4 fill-current">
      <circle cx="12" cy="12" r="10" strokeWidth="2" stroke="currentColor" fill="none" />
      <path d="M8 12l4 4 4-4" stroke="currentColor" strokeWidth="2" fill="none" />
    </svg>
  ),
  grok: (
    <svg viewBox="0 0 24 24" className="w-4 h-4">
      <path 
        d="M12 3C7.03 3 3 7.03 3 12c0 2.76 1.24 5.23 3.19 6.89l-.01.01c.18.15.37.29.56.43L18.89 7.18C17.23 4.74 14.77 3 12 3zm6.81 4.11L6.66 19.26c.17.11.35.21.53.31C8.77 20.47 10.33 21 12 21c4.97 0 9-4.03 9-9 0-1.97-.64-3.78-1.72-5.26l-.47.37z"
        fill="currentColor"
      />
      <path d="M3 21L21 3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" fill="none" />
    </svg>
  ),
  xai: (
    <svg viewBox="0 0 24 24" className="w-4 h-4">
      <path 
        d="M12 3C7.03 3 3 7.03 3 12c0 2.76 1.24 5.23 3.19 6.89l-.01.01c.18.15.37.29.56.43L18.89 7.18C17.23 4.74 14.77 3 12 3zm6.81 4.11L6.66 19.26c.17.11.35.21.53.31C8.77 20.47 10.33 21 12 21c4.97 0 9-4.03 9-9 0-1.97-.64-3.78-1.72-5.26l-.47.37z"
        fill="currentColor"
      />
      <path d="M3 21L21 3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" fill="none" />
    </svg>
  ),
  perplexity: (
    <svg viewBox="0 0 24 24" className="w-4 h-4">
      <path 
        d="M12 2L12 8M12 16L12 22M2 8H8L12 12L16 8H22M2 16H8L12 12L16 16H22M8 8V16M16 8V16" 
        stroke="currentColor" 
        strokeWidth="1.5" 
        strokeLinecap="square" 
        strokeLinejoin="miter"
        fill="none"
      />
    </svg>
  ),
  gemini: (
    <svg viewBox="0 0 24 24" className="w-4 h-4 fill-current">
      <path d="M12 2L4 6v12l8 4 8-4V6l-8-4zm0 18l-6-3V7l6-3 6 3v10l-6 3z" />
    </svg>
  ),
  rule_based: (
    <svg viewBox="0 0 24 24" className="w-4 h-4 fill-current">
      <path d="M3 3h18v18H3V3zm2 2v14h14V5H5zm2 2h10v2H7V7zm0 4h10v2H7v-2zm0 4h6v2H7v-2z" />
    </svg>
  ),
};

export function AIProviderLogos({ botId, className = '' }: AIProviderLogosProps) {
  const { data: providers, isLoading } = useBotAIProviders(botId);
  const { data: usage } = useBotAIUsage(botId);
  const [windowType, setWindowType] = useState<'lifetime' | '7d' | '24h'>('lifetime');

  // Don't show anything if no AI usage
  if (isLoading || !providers || providers.length === 0) {
    return null;
  }

  const displayProviders = providers.slice(0, 3);
  const overflow = providers.length - 3;
  const totalCost = providers.reduce((sum, p) => sum + p.cost, 0);
  const totalCalls = providers.reduce((sum, p) => sum + p.calls, 0);

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className={`flex items-center gap-0.5 ${className}`}>
          {displayProviders.map((p) => (
            <span 
              key={p.provider}
              className="text-muted-foreground/70 hover:text-muted-foreground transition-colors"
            >
              {PROVIDER_ICONS[p.provider] || PROVIDER_ICONS.rule_based}
            </span>
          ))}
          {overflow > 0 && (
            <span className="text-xs text-muted-foreground ml-0.5">+{overflow}</span>
          )}
        </div>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="w-64 p-3">
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="font-medium text-sm">AI Usage</span>
            <div className="flex gap-1">
              {(['24h', '7d', 'lifetime'] as const).map((w) => (
                <button
                  key={w}
                  onClick={() => setWindowType(w)}
                  className={`text-xs px-1.5 py-0.5 rounded ${
                    windowType === w 
                      ? 'bg-primary/20 text-primary' 
                      : 'text-muted-foreground hover:bg-muted'
                  }`}
                >
                  {w}
                </button>
              ))}
            </div>
          </div>

          {/* Provider breakdown */}
          <div className="space-y-1.5">
            {providers.map((p) => (
              <div key={p.provider} className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-1.5">
                  <span className="text-muted-foreground">
                    {PROVIDER_ICONS[p.provider] || PROVIDER_ICONS.rule_based}
                  </span>
                  <span className="capitalize">{p.provider.replace('_', ' ')}</span>
                </div>
                <div className="text-muted-foreground">
                  {Math.round((p.calls / totalCalls) * 100)}%
                  <span className="mx-1">·</span>
                  {p.calls} calls
                </div>
              </div>
            ))}
          </div>

          {/* Totals */}
          <div className="pt-2 border-t border-border/50 space-y-1">
            <div className="flex justify-between text-xs">
              <span className="text-muted-foreground">Total Calls</span>
              <span>{totalCalls.toLocaleString()}</span>
            </div>
            {totalCost > 0 && (
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground">Total Cost</span>
                <span>${totalCost.toFixed(2)}</span>
              </div>
            )}
            {usage?.fallback_rate !== undefined && usage.fallback_rate > 0 && (
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground">Fallback Rate</span>
                <span>{(usage.fallback_rate * 100).toFixed(1)}%</span>
              </div>
            )}
          </div>
        </div>
      </TooltipContent>
    </Tooltip>
  );
}
