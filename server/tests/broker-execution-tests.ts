import { BrokerExecutionBridge, getBrokerExecutionBridge, type BotStage, type OrderRequest } from "../execution/broker-execution-bridge";

interface TestResult {
  name: string;
  passed: boolean;
  duration: number;
  error?: string;
  details?: any;
}

function createMockOrderRequest(stage?: BotStage): OrderRequest {
  return {
    symbol: "MES",
    side: "BUY",
    quantity: 1,
    orderType: "MARKET",
    timeInForce: "DAY",
    botId: "test-bot-123",
    botStage: stage,
  };
}

async function testNonLiveStagesAlwaysSimulate(): Promise<TestResult> {
  const start = Date.now();
  try {
    const bridge = new BrokerExecutionBridge();
    const nonLiveStages: BotStage[] = ["LAB", "TRIALS", "PAPER", "SHADOW", "CANARY"];
    const results: { stage: BotStage; isSimulation: boolean }[] = [];

    for (const stage of nonLiveStages) {
      const shouldSim = bridge.shouldUseSimulation(stage);
      results.push({ stage, isSimulation: shouldSim });
      
      if (!shouldSim) {
        throw new Error(`Stage ${stage} should use simulation but returned false`);
      }
    }

    return {
      name: "Non-LIVE Stages Always Simulate",
      passed: true,
      duration: Date.now() - start,
      details: { stages: results },
    };
  } catch (error) {
    return {
      name: "Non-LIVE Stages Always Simulate",
      passed: false,
      duration: Date.now() - start,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function testLiveStageWithoutAuth(): Promise<TestResult> {
  const start = Date.now();
  try {
    const bridge = new BrokerExecutionBridge();
    
    const shouldSim = bridge.shouldUseSimulation("LIVE");
    
    if (!shouldSim) {
      throw new Error("LIVE stage without auth should use simulation");
    }

    return {
      name: "LIVE Stage Without Auth Uses Simulation",
      passed: true,
      duration: Date.now() - start,
      details: { shouldSimulate: shouldSim },
    };
  } catch (error) {
    return {
      name: "LIVE Stage Without Auth Uses Simulation",
      passed: false,
      duration: Date.now() - start,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function testOrderPlacementStageGating(): Promise<TestResult> {
  const start = Date.now();
  try {
    const bridge = new BrokerExecutionBridge();
    const testCases: { stage: BotStage | undefined; expectSimulation: boolean }[] = [
      { stage: undefined, expectSimulation: true },
      { stage: "LAB", expectSimulation: true },
      { stage: "TRIALS", expectSimulation: true },
      { stage: "PAPER", expectSimulation: true },
      { stage: "SHADOW", expectSimulation: true },
      { stage: "CANARY", expectSimulation: true },
      { stage: "LIVE", expectSimulation: true },
    ];

    const results: { stage: string; simulated: boolean; expected: boolean }[] = [];

    for (const tc of testCases) {
      const request = createMockOrderRequest(tc.stage);
      const response = await bridge.placeOrder(request);
      
      const isSimulated = response.orderId.startsWith("sim_") || 
                          response.orderId.startsWith("twap_") ||
                          response.orderId.startsWith("vwap_");
      
      results.push({ 
        stage: tc.stage || "undefined", 
        simulated: isSimulated, 
        expected: tc.expectSimulation 
      });

      if (isSimulated !== tc.expectSimulation) {
        throw new Error(`Stage ${tc.stage}: expected simulation=${tc.expectSimulation}, got ${isSimulated}`);
      }
    }

    return {
      name: "Order Placement Stage Gating",
      passed: true,
      duration: Date.now() - start,
      details: { testCases: results },
    };
  } catch (error) {
    return {
      name: "Order Placement Stage Gating",
      passed: false,
      duration: Date.now() - start,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function testExecutionModeTransparency(): Promise<TestResult> {
  const start = Date.now();
  try {
    const bridge = new BrokerExecutionBridge();
    
    const paperMode = bridge.getExecutionMode("PAPER");
    if (paperMode.mode !== "SIMULATION") {
      throw new Error(`PAPER stage should report SIMULATION mode, got ${paperMode.mode}`);
    }

    const liveMode = bridge.getExecutionMode("LIVE");
    if (liveMode.mode !== "SIMULATION") {
      throw new Error(`LIVE stage without auth should report SIMULATION mode, got ${liveMode.mode}`);
    }
    if (!liveMode.reason) {
      throw new Error("LIVE stage should provide a reason for simulation mode");
    }

    return {
      name: "Execution Mode Transparency",
      passed: true,
      duration: Date.now() - start,
      details: { 
        paperMode, 
        liveMode,
      },
    };
  } catch (error) {
    return {
      name: "Execution Mode Transparency",
      passed: false,
      duration: Date.now() - start,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function testGlobalSimulationOverride(): Promise<TestResult> {
  const start = Date.now();
  try {
    const originalEnv = process.env.BROKER_EXECUTION_MODE;
    
    try {
      process.env.BROKER_EXECUTION_MODE = "SIMULATION";
      
      const bridge = new BrokerExecutionBridge();
      
      const liveMode = bridge.getExecutionMode("LIVE");
      if (liveMode.mode !== "SIMULATION") {
        throw new Error(`Global override should force SIMULATION, got ${liveMode.mode}`);
      }
      if (!liveMode.reason?.includes("forced") && !liveMode.reason?.includes("override")) {
        console.log(`Reason: ${liveMode.reason}`);
      }

      return {
        name: "Global Simulation Override",
        passed: true,
        duration: Date.now() - start,
        details: { liveMode },
      };
    } finally {
      if (originalEnv === undefined) {
        delete process.env.BROKER_EXECUTION_MODE;
      } else {
        process.env.BROKER_EXECUTION_MODE = originalEnv;
      }
    }
  } catch (error) {
    return {
      name: "Global Simulation Override",
      passed: false,
      duration: Date.now() - start,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function testTWAPStageExecution(): Promise<TestResult> {
  const start = Date.now();
  try {
    const bridge = new BrokerExecutionBridge();
    
    const twapResult = await bridge.executeTWAP(
      "MES",
      "BUY",
      2,
      6150,
      { durationMinutes: 30, slices: 10 },
      "test-bot",
      "PAPER"
    );

    if (!twapResult.isSimulation) {
      throw new Error("PAPER stage TWAP should be simulated");
    }
    if (!twapResult.id.startsWith("twap_")) {
      throw new Error(`Invalid TWAP order ID: ${twapResult.id}`);
    }

    return {
      name: "TWAP Stage Execution",
      passed: true,
      duration: Date.now() - start,
      details: { 
        orderId: twapResult.id,
        isSimulation: twapResult.isSimulation,
        slices: twapResult.slices.length,
      },
    };
  } catch (error) {
    return {
      name: "TWAP Stage Execution",
      passed: false,
      duration: Date.now() - start,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function testVWAPStageExecution(): Promise<TestResult> {
  const start = Date.now();
  try {
    const bridge = new BrokerExecutionBridge();
    
    const vwapResult = await bridge.executeVWAP(
      "MNQ",
      "SELL",
      3,
      22000,
      { durationMinutes: 60, maxParticipation: 0.15 },
      "test-bot",
      "SHADOW"
    );

    if (!vwapResult.isSimulation) {
      throw new Error("SHADOW stage VWAP should be simulated");
    }
    if (!vwapResult.id.startsWith("vwap_")) {
      throw new Error(`Invalid VWAP order ID: ${vwapResult.id}`);
    }

    return {
      name: "VWAP Stage Execution",
      passed: true,
      duration: Date.now() - start,
      details: { 
        orderId: vwapResult.id,
        isSimulation: vwapResult.isSimulation,
      },
    };
  } catch (error) {
    return {
      name: "VWAP Stage Execution",
      passed: false,
      duration: Date.now() - start,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function testAuthFailureMetrics(): Promise<TestResult> {
  const start = Date.now();
  try {
    const bridge = getBrokerExecutionBridge();
    
    const authMetrics = bridge.getAuthMetrics();
    
    if (typeof authMetrics.totalAttempts !== "number") {
      throw new Error("Auth metrics should track total attempts");
    }
    if (typeof authMetrics.failedAttempts !== "number") {
      throw new Error("Auth metrics should track failed attempts");
    }
    if (typeof authMetrics.consecutiveFailures !== "number") {
      throw new Error("Auth metrics should track consecutive failures");
    }
    if (authMetrics.lastAttempt !== null && !(authMetrics.lastAttempt instanceof Date)) {
      throw new Error("Auth metrics lastAttempt should be Date or null");
    }
    if (authMetrics.lastSuccess !== null && !(authMetrics.lastSuccess instanceof Date)) {
      throw new Error("Auth metrics lastSuccess should be Date or null");  
    }
    if (authMetrics.lastFailureReason !== null && typeof authMetrics.lastFailureReason !== "string") {
      throw new Error("Auth metrics lastFailureReason should be string or null");
    }

    return {
      name: "Auth Failure Metrics",
      passed: true,
      duration: Date.now() - start,
      details: { 
        authMetrics,
        usingSingleton: true,
      },
    };
  } catch (error) {
    return {
      name: "Auth Failure Metrics",
      passed: false,
      duration: Date.now() - start,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function runBrokerExecutionTests(): Promise<{
  passed: number;
  failed: number;
  results: TestResult[];
}> {
  console.log("\n=== Running Broker Execution Tests ===\n");

  const tests = [
    testNonLiveStagesAlwaysSimulate,
    testLiveStageWithoutAuth,
    testOrderPlacementStageGating,
    testExecutionModeTransparency,
    testGlobalSimulationOverride,
    testTWAPStageExecution,
    testVWAPStageExecution,
    testAuthFailureMetrics,
  ];

  const results: TestResult[] = [];
  let passed = 0;
  let failed = 0;

  for (const test of tests) {
    const result = await test();
    results.push(result);

    if (result.passed) {
      passed++;
      console.log(`[PASS] ${result.name} (${result.duration}ms)`);
    } else {
      failed++;
      console.log(`[FAIL] ${result.name}: ${result.error}`);
    }
  }

  console.log(`\n=== Results: ${passed}/${tests.length} passed ===\n`);

  return { passed, failed, results };
}
