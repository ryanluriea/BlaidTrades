/**
 * Execution Routing Tests
 * 
 * Proves the canonical routing rules are correctly implemented:
 * - VIRTUAL: backtest, SIM, SHADOW allowed; LIVE blocked
 * - SIMULATION (SIM): backtest, SIM, SHADOW allowed; LIVE blocked  
 * - LIVE: all modes allowed
 */

import { describe, it, expect } from "vitest";
import {
  isValidModeForAccount,
  getValidModesForAccount,
  isValidProviderForAccount,
  getValidProvidersForAccount,
  getExecutionRouting,
  shouldBlockExecution,
  getDataFeedMode,
  getAccountDefaults,
  type AccountType,
  type ExecutionMode,
  type AccountProvider,
} from "../executionRouting";

describe("Mode Validation by Account Type", () => {
  describe("VIRTUAL accounts", () => {
    it("allows BACKTEST_ONLY mode", () => {
      expect(isValidModeForAccount("VIRTUAL", "BACKTEST_ONLY")).toBe(true);
    });

    it("allows SIM_LIVE mode", () => {
      expect(isValidModeForAccount("VIRTUAL", "SIM_LIVE")).toBe(true);
    });

    it("allows SHADOW mode", () => {
      expect(isValidModeForAccount("VIRTUAL", "SHADOW")).toBe(true);
    });

    it("BLOCKS LIVE mode", () => {
      expect(isValidModeForAccount("VIRTUAL", "LIVE")).toBe(false);
    });

    it("returns correct valid modes list", () => {
      const modes = getValidModesForAccount("VIRTUAL");
      expect(modes).toContain("BACKTEST_ONLY");
      expect(modes).toContain("SIM_LIVE");
      expect(modes).toContain("SHADOW");
      expect(modes).not.toContain("LIVE");
    });
  });

  describe("SIM (Simulation) accounts", () => {
    it("allows BACKTEST_ONLY mode", () => {
      expect(isValidModeForAccount("SIM", "BACKTEST_ONLY")).toBe(true);
    });

    it("allows SIM_LIVE mode", () => {
      expect(isValidModeForAccount("SIM", "SIM_LIVE")).toBe(true);
    });

    it("allows SHADOW mode", () => {
      expect(isValidModeForAccount("SIM", "SHADOW")).toBe(true);
    });

    it("BLOCKS LIVE mode", () => {
      expect(isValidModeForAccount("SIM", "LIVE")).toBe(false);
    });

    it("returns correct valid modes list", () => {
      const modes = getValidModesForAccount("SIM");
      expect(modes).toContain("BACKTEST_ONLY");
      expect(modes).toContain("SIM_LIVE");
      expect(modes).toContain("SHADOW");
      expect(modes).not.toContain("LIVE");
    });
  });

  describe("LIVE accounts", () => {
    it("allows BACKTEST_ONLY mode", () => {
      expect(isValidModeForAccount("LIVE", "BACKTEST_ONLY")).toBe(true);
    });

    it("allows SIM_LIVE mode", () => {
      expect(isValidModeForAccount("LIVE", "SIM_LIVE")).toBe(true);
    });

    it("allows SHADOW mode", () => {
      expect(isValidModeForAccount("LIVE", "SHADOW")).toBe(true);
    });

    it("allows LIVE mode", () => {
      expect(isValidModeForAccount("LIVE", "LIVE")).toBe(true);
    });

    it("returns all modes in valid modes list", () => {
      const modes = getValidModesForAccount("LIVE");
      expect(modes).toContain("BACKTEST_ONLY");
      expect(modes).toContain("SIM_LIVE");
      expect(modes).toContain("SHADOW");
      expect(modes).toContain("LIVE");
    });
  });
});

describe("Execution Routing", () => {
  describe("VIRTUAL accounts route to internal", () => {
    it("BACKTEST routes to INTERNAL_SIM_FILLS", () => {
      expect(getExecutionRouting("VIRTUAL", "BACKTEST_ONLY")).toBe("INTERNAL_SIM_FILLS");
    });

    it("SIM_LIVE routes to INTERNAL_SIM_FILLS", () => {
      expect(getExecutionRouting("VIRTUAL", "SIM_LIVE")).toBe("INTERNAL_SIM_FILLS");
    });

    it("SHADOW routes to INTERNAL_SIM_FILLS", () => {
      expect(getExecutionRouting("VIRTUAL", "SHADOW")).toBe("INTERNAL_SIM_FILLS");
    });

    it("LIVE is BLOCKED", () => {
      expect(getExecutionRouting("VIRTUAL", "LIVE")).toBe("BLOCKED");
    });
  });

  describe("SIM accounts route to internal", () => {
    it("BACKTEST routes to INTERNAL_SIM_FILLS", () => {
      expect(getExecutionRouting("SIM", "BACKTEST_ONLY")).toBe("INTERNAL_SIM_FILLS");
    });

    it("SIM_LIVE routes to INTERNAL_SIM_FILLS", () => {
      expect(getExecutionRouting("SIM", "SIM_LIVE")).toBe("INTERNAL_SIM_FILLS");
    });

    it("SHADOW routes to INTERNAL_SIM_FILLS", () => {
      expect(getExecutionRouting("SIM", "SHADOW")).toBe("INTERNAL_SIM_FILLS");
    });

    it("LIVE is BLOCKED", () => {
      expect(getExecutionRouting("SIM", "LIVE")).toBe("BLOCKED");
    });
  });

  describe("LIVE accounts", () => {
    it("BACKTEST routes to INTERNAL_SIM_FILLS", () => {
      expect(getExecutionRouting("LIVE", "BACKTEST_ONLY")).toBe("INTERNAL_SIM_FILLS");
    });

    it("SIM_LIVE routes to INTERNAL_SIM_FILLS", () => {
      expect(getExecutionRouting("LIVE", "SIM_LIVE")).toBe("INTERNAL_SIM_FILLS");
    });

    it("SHADOW routes to INTERNAL_SIM_FILLS (not broker)", () => {
      expect(getExecutionRouting("LIVE", "SHADOW")).toBe("INTERNAL_SIM_FILLS");
    });

    it("LIVE routes to BROKER_FILLS (only this case)", () => {
      expect(getExecutionRouting("LIVE", "LIVE")).toBe("BROKER_FILLS");
    });
  });
});

describe("Provider Validation", () => {
  describe("VIRTUAL accounts", () => {
    it("must use INTERNAL provider", () => {
      expect(isValidProviderForAccount("VIRTUAL", "INTERNAL")).toBe(true);
    });

    it("cannot use IRONBEAM", () => {
      expect(isValidProviderForAccount("VIRTUAL", "IRONBEAM")).toBe(false);
    });

    it("cannot use TRADOVATE", () => {
      expect(isValidProviderForAccount("VIRTUAL", "TRADOVATE")).toBe(false);
    });
  });

  describe("SIM accounts", () => {
    it("must use INTERNAL provider", () => {
      expect(isValidProviderForAccount("SIM", "INTERNAL")).toBe(true);
    });

    it("cannot use IRONBEAM", () => {
      expect(isValidProviderForAccount("SIM", "IRONBEAM")).toBe(false);
    });
  });

  describe("LIVE accounts", () => {
    it("cannot use INTERNAL provider", () => {
      expect(isValidProviderForAccount("LIVE", "INTERNAL")).toBe(false);
    });

    it("can use IRONBEAM", () => {
      expect(isValidProviderForAccount("LIVE", "IRONBEAM")).toBe(true);
    });

    it("can use TRADOVATE", () => {
      expect(isValidProviderForAccount("LIVE", "TRADOVATE")).toBe(true);
    });

    it("can use OTHER", () => {
      expect(isValidProviderForAccount("LIVE", "OTHER")).toBe(true);
    });
  });
});

describe("Execution Blocking", () => {
  it("blocks LIVE mode on VIRTUAL account with reason", () => {
    const result = shouldBlockExecution("VIRTUAL", "LIVE");
    expect(result.blocked).toBe(true);
    expect(result.reason).toContain("not allowed");
  });

  it("blocks LIVE mode on SIM account with reason", () => {
    const result = shouldBlockExecution("SIM", "LIVE");
    expect(result.blocked).toBe(true);
    expect(result.reason).toContain("not allowed");
  });

  it("does not block LIVE mode on LIVE account", () => {
    const result = shouldBlockExecution("LIVE", "LIVE");
    expect(result.blocked).toBe(false);
    expect(result.reason).toBeUndefined();
  });

  it("does not block SIM_LIVE on any account type", () => {
    expect(shouldBlockExecution("VIRTUAL", "SIM_LIVE").blocked).toBe(false);
    expect(shouldBlockExecution("SIM", "SIM_LIVE").blocked).toBe(false);
    expect(shouldBlockExecution("LIVE", "SIM_LIVE").blocked).toBe(false);
  });
});

describe("Data Feed Mode", () => {
  it("BACKTEST defaults to HISTORICAL_DATA", () => {
    expect(getDataFeedMode("BACKTEST_ONLY")).toBe("HISTORICAL_DATA");
  });

  it("SIM_LIVE defaults to LIVE_DATA", () => {
    expect(getDataFeedMode("SIM_LIVE")).toBe("LIVE_DATA");
  });

  it("SHADOW defaults to LIVE_DATA", () => {
    expect(getDataFeedMode("SHADOW")).toBe("LIVE_DATA");
  });

  it("LIVE defaults to LIVE_DATA", () => {
    expect(getDataFeedMode("LIVE")).toBe("LIVE_DATA");
  });

  it("bot override takes precedence", () => {
    expect(getDataFeedMode("SIM_LIVE", null, "HISTORICAL_DATA")).toBe("HISTORICAL_DATA");
  });

  it("account override works when no bot override", () => {
    expect(getDataFeedMode("SIM_LIVE", "HISTORICAL_DATA")).toBe("HISTORICAL_DATA");
  });
});

describe("Account Defaults", () => {
  it("VIRTUAL defaults to INTERNAL provider and shared bots", () => {
    const defaults = getAccountDefaults("VIRTUAL");
    expect(defaults.provider).toBe("INTERNAL");
    expect(defaults.allow_shared_bots).toBe(true);
  });

  it("SIM defaults to INTERNAL provider and no shared bots", () => {
    const defaults = getAccountDefaults("SIM");
    expect(defaults.provider).toBe("INTERNAL");
    expect(defaults.allow_shared_bots).toBe(false);
  });

  it("LIVE defaults to broker provider and no shared bots", () => {
    const defaults = getAccountDefaults("LIVE");
    expect(defaults.provider).not.toBe("INTERNAL");
    expect(defaults.allow_shared_bots).toBe(false);
  });
});

describe("Live Data in Paper Trading (Critical Requirement)", () => {
  it("SIM_LIVE can use LIVE_DATA while routing internally", () => {
    const dataFeed = getDataFeedMode("SIM_LIVE");
    const routing = getExecutionRouting("VIRTUAL", "SIM_LIVE");
    
    expect(dataFeed).toBe("LIVE_DATA");
    expect(routing).toBe("INTERNAL_SIM_FILLS");
  });

  it("SHADOW can use LIVE_DATA while routing internally", () => {
    const dataFeed = getDataFeedMode("SHADOW");
    const routingVirtual = getExecutionRouting("VIRTUAL", "SHADOW");
    const routingSim = getExecutionRouting("SIM", "SHADOW");
    const routingLive = getExecutionRouting("LIVE", "SHADOW");
    
    expect(dataFeed).toBe("LIVE_DATA");
    expect(routingVirtual).toBe("INTERNAL_SIM_FILLS");
    expect(routingSim).toBe("INTERNAL_SIM_FILLS");
    expect(routingLive).toBe("INTERNAL_SIM_FILLS");
  });

  it("Only LIVE mode on LIVE account routes to broker", () => {
    // This is the ONLY combination that should route to broker
    expect(getExecutionRouting("LIVE", "LIVE")).toBe("BROKER_FILLS");
    
    // All other combinations should NOT route to broker
    const accountTypes: AccountType[] = ["VIRTUAL", "SIM", "LIVE"];
    const modes: ExecutionMode[] = ["BACKTEST_ONLY", "SIM_LIVE", "SHADOW", "LIVE"];
    
    for (const accType of accountTypes) {
      for (const mode of modes) {
        if (accType === "LIVE" && mode === "LIVE") continue; // Skip the valid case
        const routing = getExecutionRouting(accType, mode);
        expect(routing).not.toBe("BROKER_FILLS");
      }
    }
  });
});
