import { FeatureEngineer, normalizeFeatures, splitTrainTest } from "../ml/feature-engineering";
import { GradientBoostingClassifier } from "../ml/gradient-boosting";
import { DQNAgent, TradingEnvironment } from "../ml/rl-dqn-agent";
import { PPOAgent, ContinuousTradingEnv } from "../ml/rl-ppo-agent";
import { portfolioOptimizer } from "../portfolio/portfolio-optimizer";
import { twapAlgorithm } from "../execution/twap-algorithm";
import { vwapAlgorithm } from "../execution/vwap-algorithm";
import type { LiveBar } from "../live-data-service";

interface TestResult {
  name: string;
  passed: boolean;
  duration: number;
  error?: string;
  details?: any;
}

function generateMockBars(count: number): LiveBar[] {
  const bars: LiveBar[] = [];
  let price = 5000;
  const startTime = new Date();
  startTime.setHours(startTime.getHours() - count);

  for (let i = 0; i < count; i++) {
    const change = (Math.random() - 0.5) * 20;
    const open = price;
    const close = price + change;
    const high = Math.max(open, close) + Math.random() * 10;
    const low = Math.min(open, close) - Math.random() * 10;
    const volume = Math.floor(1000 + Math.random() * 5000);

    bars.push({
      symbol: "MES",
      timeframe: "1m",
      time: new Date(startTime.getTime() + i * 60000),
      open,
      high,
      low,
      close,
      volume,
    });

    price = close;
  }

  return bars;
}

async function testFeatureEngineering(): Promise<TestResult> {
  const start = Date.now();
  try {
    const bars = generateMockBars(200);
    const engineer = new FeatureEngineer();
    const features = engineer.extractFeatures(bars, 5);

    if (features.length === 0) {
      throw new Error("No features extracted");
    }

    const firstFeature = features[0];
    const featureCount = Object.keys(firstFeature.features).length;

    if (featureCount < 20) {
      throw new Error(`Insufficient features: ${featureCount}`);
    }

    const { normalized } = normalizeFeatures(features);
    if (normalized.length !== features.length) {
      throw new Error("Normalization changed sample count");
    }

    const { train, test } = splitTrainTest(features, 0.8);
    if (train.length + test.length !== features.length) {
      throw new Error("Train/test split lost samples");
    }

    return {
      name: "Feature Engineering",
      passed: true,
      duration: Date.now() - start,
      details: { featureCount, samples: features.length, trainSize: train.length, testSize: test.length },
    };
  } catch (error) {
    return {
      name: "Feature Engineering",
      passed: false,
      duration: Date.now() - start,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function testGradientBoosting(): Promise<TestResult> {
  const start = Date.now();
  try {
    const bars = generateMockBars(1000);
    const engineer = new FeatureEngineer();
    const features = engineer.extractFeatures(bars, 5);

    const classifier = new GradientBoostingClassifier({
      numTrees: 10,
      maxDepth: 3,
      learningRate: 0.1,
      minSamplesLeaf: 5,
      subsampleRatio: 0.8,
    });

    const model = classifier.train(features);

    if (!model.id) throw new Error("Model has no ID");
    if (model.trainMetrics.accuracy < 0 || model.trainMetrics.accuracy > 1) {
      throw new Error(`Invalid accuracy: ${model.trainMetrics.accuracy}`);
    }

    const testFeature = features[features.length - 1].features;
    const prediction = classifier.predict(model, testFeature);

    if (prediction.probability < 0 || prediction.probability > 1) {
      throw new Error(`Invalid probability: ${prediction.probability}`);
    }

    const importance = classifier.getFeatureImportance(model);
    if (importance.length === 0) {
      throw new Error("No feature importance calculated");
    }

    return {
      name: "Gradient Boosting Classifier",
      passed: true,
      duration: Date.now() - start,
      details: {
        trainAccuracy: model.trainMetrics.accuracy.toFixed(4),
        testAccuracy: model.testMetrics.accuracy.toFixed(4),
        topFeature: importance[0]?.feature,
        topImportance: importance[0]?.importance.toFixed(4),
      },
    };
  } catch (error) {
    return {
      name: "Gradient Boosting Classifier",
      passed: false,
      duration: Date.now() - start,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function testDQNAgent(): Promise<TestResult> {
  const start = Date.now();
  try {
    const agent = new DQNAgent({
      stateSize: 10,
      actionSize: 3,
      hiddenLayers: [16, 8],
      learningRate: 0.01,
      epsilonStart: 1.0,
      epsilonEnd: 0.1,
      epsilonDecay: 0.99,
      batchSize: 8,
      memorySize: 100,
      targetUpdateFreq: 10,
    });

    const state = Array(10).fill(0).map(() => Math.random());
    const action = agent.selectAction(state);

    if (action < 0 || action >= 3) {
      throw new Error(`Invalid action: ${action}`);
    }

    const qValues = agent.getQValues(state);
    if (qValues.length !== 3) {
      throw new Error(`Invalid Q-values length: ${qValues.length}`);
    }

    for (let i = 0; i < 20; i++) {
      const nextState = Array(10).fill(0).map(() => Math.random());
      agent.storeExperience({
        state,
        action: Math.floor(Math.random() * 3),
        reward: Math.random() - 0.5,
        nextState,
        done: i === 19,
      });
    }

    const loss = agent.train();
    if (isNaN(loss)) {
      throw new Error("Training produced NaN loss");
    }

    return {
      name: "DQN Agent",
      passed: true,
      duration: Date.now() - start,
      details: {
        action,
        qValues: qValues.map(q => q.toFixed(4)),
        memorySize: agent.getMemorySize(),
        epsilon: agent.getEpsilon().toFixed(4),
        loss: loss.toFixed(6),
      },
    };
  } catch (error) {
    return {
      name: "DQN Agent",
      passed: false,
      duration: Date.now() - start,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function testTradingEnvironment(): Promise<TestResult> {
  const start = Date.now();
  try {
    const bars = generateMockBars(500);
    const env = new TradingEnvironment(bars);
    
    const initialState = env.reset();
    if (initialState.length !== 30) {
      throw new Error(`Invalid state size: ${initialState.length}`);
    }

    let totalReward = 0;
    let steps = 0;
    let done = false;

    while (!done && steps < 100) {
      const action = Math.floor(Math.random() * 3);
      const result = env.step(action);
      totalReward += result.reward;
      done = result.done;
      steps++;
    }

    return {
      name: "Trading Environment",
      passed: true,
      duration: Date.now() - start,
      details: {
        steps,
        totalReward: totalReward.toFixed(4),
        finalPnL: env.getFinalPnL().toFixed(2),
        stateSize: initialState.length,
      },
    };
  } catch (error) {
    return {
      name: "Trading Environment",
      passed: false,
      duration: Date.now() - start,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function testTWAPAlgorithm(): Promise<TestResult> {
  const start = Date.now();
  try {
    const order = twapAlgorithm.createOrder("MES", "BUY", 100, 5000, {
      durationMinutes: 10,
      numSlices: 5,
    });

    if (!order.id) throw new Error("Order has no ID");
    if (order.slices.length !== 5) throw new Error(`Expected 5 slices, got ${order.slices.length}`);
    if (order.totalQuantity !== 100) throw new Error("Incorrect total quantity");

    const sliceTotalQty = order.slices.reduce((sum, s) => sum + s.quantity, 0);
    if (sliceTotalQty !== 100) throw new Error(`Slices don't sum to total: ${sliceTotalQty}`);

    await twapAlgorithm.executeSlice(order.id, order.slices[0].id, 5001);
    const updatedOrder = twapAlgorithm.getOrder(order.id);

    if (!updatedOrder) throw new Error("Order not found after execution");
    if (updatedOrder.executedQuantity !== order.slices[0].quantity) {
      throw new Error("Executed quantity mismatch");
    }

    const quality = twapAlgorithm.getExecutionQuality(order.id);
    if (!quality) throw new Error("No execution quality available");

    twapAlgorithm.cancelOrder(order.id);

    return {
      name: "TWAP Algorithm",
      passed: true,
      duration: Date.now() - start,
      details: {
        orderId: order.id,
        slices: order.slices.length,
        slippage: (quality.slippage * 100).toFixed(4) + "%",
        completionRate: (quality.completionRate * 100).toFixed(1) + "%",
      },
    };
  } catch (error) {
    return {
      name: "TWAP Algorithm",
      passed: false,
      duration: Date.now() - start,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function testVWAPAlgorithm(): Promise<TestResult> {
  const start = Date.now();
  try {
    const bars = generateMockBars(1000);
    const volumeProfile = vwapAlgorithm.buildVolumeProfile("MES", bars);

    if (volumeProfile.length === 0) throw new Error("Empty volume profile");

    const totalWeight = volumeProfile.reduce((sum, b) => sum + b.volumeWeight, 0);
    if (Math.abs(totalWeight - 1) > 0.001) {
      throw new Error(`Volume weights don't sum to 1: ${totalWeight}`);
    }

    const vwap = vwapAlgorithm.calculateVWAP(bars.slice(-100));
    if (vwap <= 0) throw new Error(`Invalid VWAP: ${vwap}`);

    const order = vwapAlgorithm.createOrder("MES", "SELL", 50, vwap, {
      durationMinutes: 15,
      bucketSizeMinutes: 5,
    });

    if (!order.id) throw new Error("Order has no ID");
    if (order.slices.length === 0) throw new Error("No slices generated");

    await vwapAlgorithm.executeSlice(order.id, order.slices[0].id, vwap * 0.999, 1000);
    const quality = vwapAlgorithm.getExecutionQuality(order.id);

    if (!quality) throw new Error("No execution quality available");

    vwapAlgorithm.cancelOrder(order.id);

    return {
      name: "VWAP Algorithm",
      passed: true,
      duration: Date.now() - start,
      details: {
        volumeProfileBuckets: volumeProfile.length,
        calculatedVWAP: vwap.toFixed(2),
        slices: order.slices.length,
        slippage: (quality.slippage * 100).toFixed(4) + "%",
      },
    };
  } catch (error) {
    return {
      name: "VWAP Algorithm",
      passed: false,
      duration: Date.now() - start,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function testPPOAgent(): Promise<TestResult> {
  const start = Date.now();
  try {
    const agent = new PPOAgent({
      stateSize: 30,
      actionSize: 2,
      hiddenLayers: [16, 8],
      learningRate: 0.001,
      epochs: 2,
      miniBatchSize: 8,
    });

    const state = Array(30).fill(0).map(() => Math.random() - 0.5);
    const { action, logProb, value } = agent.selectAction(state);

    if (action.length !== 2) throw new Error(`Invalid action size: ${action.length}`);
    if (isNaN(logProb)) throw new Error("LogProb is NaN");
    if (isNaN(value)) throw new Error("Value is NaN");

    for (let i = 0; i < 40; i++) {
      const s = Array(30).fill(0).map(() => Math.random() - 0.5);
      const { action: a, logProb: lp, value: v } = agent.selectAction(s);
      agent.storeExperience({
        state: s,
        action: a,
        reward: Math.random() - 0.5,
        value: v,
        logProb: lp,
        done: i === 39,
      });
    }

    const { policyLoss, valueLoss, entropy } = agent.train();

    if (isNaN(policyLoss)) throw new Error("Policy loss is NaN");
    if (isNaN(valueLoss)) throw new Error("Value loss is NaN");

    const bars = generateMockBars(500);
    const env = new ContinuousTradingEnv(bars, 5);
    const envState = env.reset();

    if (envState.length !== 30) throw new Error(`Invalid env state size: ${envState.length}`);

    let totalReward = 0;
    let done = false;
    let steps = 0;

    while (!done && steps < 100) {
      const { action: a } = agent.selectAction(envState);
      const { reward, done: d } = env.step(a);
      totalReward += reward;
      done = d;
      steps++;
    }

    return {
      name: "PPO Agent",
      passed: true,
      duration: Date.now() - start,
      details: {
        actionSize: action.length,
        bufferCleared: agent.getBufferSize() === 0,
        policyLoss: policyLoss.toFixed(4),
        valueLoss: valueLoss.toFixed(4),
        envSteps: steps,
      },
    };
  } catch (error) {
    return {
      name: "PPO Agent",
      passed: false,
      duration: Date.now() - start,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function testPortfolioOptimizer(): Promise<TestResult> {
  const start = Date.now();
  try {
    const mockReturns = [
      { botId: "bot1", botName: "Bot 1", symbol: "MES", returns: [0.01, -0.005, 0.02, 0.015, -0.01], avgReturn: 0.006, volatility: 0.012, sharpe: 0.5 },
      { botId: "bot2", botName: "Bot 2", symbol: "MNQ", returns: [0.015, 0.01, -0.01, 0.02, 0.005], avgReturn: 0.008, volatility: 0.011, sharpe: 0.73 },
      { botId: "bot3", botName: "Bot 3", symbol: "MCL", returns: [-0.005, 0.025, 0.01, -0.015, 0.02], avgReturn: 0.007, volatility: 0.016, sharpe: 0.44 },
    ];

    const corrMatrix = portfolioOptimizer.calculateCorrelationMatrix(mockReturns);

    if (corrMatrix.matrix.length !== 3) throw new Error("Invalid correlation matrix size");
    if (corrMatrix.matrix[0][0] !== 1) throw new Error("Diagonal should be 1");

    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) {
        if (Math.abs(corrMatrix.matrix[i][j] - corrMatrix.matrix[j][i]) > 0.0001) {
          throw new Error("Correlation matrix not symmetric");
        }
      }
    }

    const result = portfolioOptimizer.optimizePortfolio(mockReturns, corrMatrix);

    if (result.allocations.length !== 3) throw new Error("Wrong number of allocations");

    const totalWeight = result.allocations.reduce((sum, a) => sum + a.weight, 0);
    if (Math.abs(totalWeight - 1) > 0.1) {
      throw new Error(`Weights don't sum to ~1: ${totalWeight}`);
    }

    if (result.efficientFrontier.length === 0) {
      throw new Error("No efficient frontier generated");
    }

    return {
      name: "Portfolio Optimizer",
      passed: true,
      duration: Date.now() - start,
      details: {
        portfolioReturn: (result.metrics.expectedReturn * 100).toFixed(2) + "%",
        portfolioVol: (result.metrics.volatility * 100).toFixed(2) + "%",
        sharpe: result.metrics.sharpe.toFixed(3),
        diversificationRatio: result.metrics.diversificationRatio.toFixed(3),
        frontierPoints: result.efficientFrontier.length,
      },
    };
  } catch (error) {
    return {
      name: "Portfolio Optimizer",
      passed: false,
      duration: Date.now() - start,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function runAllMLTests(): Promise<{
  passed: number;
  failed: number;
  total: number;
  results: TestResult[];
  summary: string;
}> {
  console.log("[ML_TESTS] Starting comprehensive ML/RL test suite...\n");
  
  const results: TestResult[] = [];

  results.push(await testFeatureEngineering());
  results.push(await testGradientBoosting());
  results.push(await testDQNAgent());
  results.push(await testPPOAgent());
  results.push(await testTradingEnvironment());
  results.push(await testTWAPAlgorithm());
  results.push(await testVWAPAlgorithm());
  results.push(await testPortfolioOptimizer());

  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;
  const total = results.length;

  console.log("\n[ML_TESTS] ============ TEST RESULTS ============\n");
  
  for (const result of results) {
    const status = result.passed ? "PASS" : "FAIL";
    const icon = result.passed ? "[OK]" : "[X]";
    console.log(`${icon} ${result.name}: ${status} (${result.duration}ms)`);
    
    if (result.passed && result.details) {
      console.log(`    Details: ${JSON.stringify(result.details)}`);
    }
    if (!result.passed && result.error) {
      console.log(`    Error: ${result.error}`);
    }
  }

  const summary = `\n[ML_TESTS] ============ SUMMARY ============\nPassed: ${passed}/${total}\nFailed: ${failed}/${total}\nStatus: ${failed === 0 ? "ALL TESTS PASSED" : "SOME TESTS FAILED"}`;
  console.log(summary);

  return { passed, failed, total, results, summary };
}
