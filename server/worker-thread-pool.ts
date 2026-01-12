/**
 * Worker Thread Pool for CPU-Heavy Operations
 * 
 * Industry-standard implementation for offloading CPU-intensive work:
 * - Backtesting calculations
 * - Monte Carlo simulations
 * - Feature engineering
 * - Strategy scoring
 * 
 * Keeps main event loop latency <5ms for real-time quote processing
 */

import { Worker, isMainThread, parentPort, workerData } from "worker_threads";
import { EventEmitter } from "events";
import os from "os";
import path from "path";
import { latencyTracker } from "./latency-tracker";

export type TaskType = 
  | "BACKTEST_SCORING"
  | "MONTE_CARLO"
  | "FEATURE_ENGINEERING"
  | "STRATEGY_OPTIMIZATION"
  | "RISK_CALCULATION"
  | "VOLUME_ANALYSIS";

export interface WorkerTask<T = unknown> {
  id: string;
  type: TaskType;
  payload: T;
  priority: "HIGH" | "NORMAL" | "LOW";
  createdAt: number;
  timeout?: number;
}

export interface WorkerResult<T = unknown> {
  taskId: string;
  success: boolean;
  result?: T;
  error?: string;
  durationMs: number;
  workerId: number;
}

interface PooledWorker {
  worker: Worker;
  id: number;
  busy: boolean;
  tasksProcessed: number;
  lastTaskAt: number;
  currentTask?: string;
}

const DEFAULT_POOL_SIZE = Math.max(2, Math.min(os.cpus().length - 1, 4));
const DEFAULT_TASK_TIMEOUT_MS = 30000;
const WORKER_IDLE_TIMEOUT_MS = 300000;

class WorkerThreadPool extends EventEmitter {
  private workers: PooledWorker[] = [];
  private taskQueue: Map<string, { task: WorkerTask; resolve: (r: WorkerResult) => void; reject: (e: Error) => void }> = new Map();
  private pendingQueue: WorkerTask[] = [];
  private poolSize: number;
  private initialized = false;
  private shutdownRequested = false;
  private idleCheckInterval: NodeJS.Timeout | null = null;

  private metrics = {
    tasksQueued: 0,
    tasksCompleted: 0,
    tasksFailed: 0,
    tasksTimedOut: 0,
    avgDurationMs: 0,
    p99DurationMs: 0,
    peakQueueDepth: 0,
    durations: [] as number[],
  };

  constructor(poolSize: number = DEFAULT_POOL_SIZE) {
    super();
    this.poolSize = poolSize;
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;

    console.log(`[WORKER_POOL] Initializing with ${this.poolSize} workers...`);

    for (let i = 0; i < this.poolSize; i++) {
      await this.spawnWorker(i);
    }

    this.idleCheckInterval = setInterval(() => this.checkIdleWorkers(), 60000);
    this.initialized = true;
    console.log(`[WORKER_POOL] Initialized successfully`);
  }

  private async spawnWorker(id: number): Promise<PooledWorker> {
    const workerPath = path.resolve(__dirname, "worker-thread-executor.js");
    
    const worker = new Worker(workerPath, {
      workerData: { workerId: id },
    });

    const pooledWorker: PooledWorker = {
      worker,
      id,
      busy: false,
      tasksProcessed: 0,
      lastTaskAt: Date.now(),
    };

    worker.on("message", (result: WorkerResult) => {
      this.handleWorkerResult(pooledWorker, result);
    });

    worker.on("error", (error) => {
      console.error(`[WORKER_POOL] Worker ${id} error:`, error.message);
      this.handleWorkerError(pooledWorker, error);
    });

    worker.on("exit", (code) => {
      if (!this.shutdownRequested && code !== 0) {
        console.warn(`[WORKER_POOL] Worker ${id} exited unexpectedly (code=${code}), respawning...`);
        this.respawnWorker(id);
      }
    });

    this.workers.push(pooledWorker);
    return pooledWorker;
  }

  private async respawnWorker(id: number): Promise<void> {
    const index = this.workers.findIndex(w => w.id === id);
    if (index !== -1) {
      this.workers.splice(index, 1);
    }
    await this.spawnWorker(id);
  }

  async submitTask<T, R>(task: Omit<WorkerTask<T>, "id" | "createdAt">): Promise<WorkerResult<R>> {
    if (!this.initialized) {
      await this.initialize();
    }

    const fullTask: WorkerTask<T> = {
      ...task,
      id: `task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      createdAt: Date.now(),
      timeout: task.timeout ?? DEFAULT_TASK_TIMEOUT_MS,
    };

    this.metrics.tasksQueued++;
    
    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        this.taskQueue.delete(fullTask.id);
        this.metrics.tasksTimedOut++;
        reject(new Error(`Task ${fullTask.id} timed out after ${fullTask.timeout}ms`));
      }, fullTask.timeout!);

      this.taskQueue.set(fullTask.id, {
        task: fullTask,
        resolve: (r) => {
          clearTimeout(timeoutId);
          resolve(r as WorkerResult<R>);
        },
        reject: (e) => {
          clearTimeout(timeoutId);
          reject(e);
        },
      });

      const availableWorker = this.workers.find(w => !w.busy);
      if (availableWorker) {
        this.assignTaskToWorker(availableWorker, fullTask);
      } else {
        this.pendingQueue.push(fullTask);
        if (this.pendingQueue.length > this.metrics.peakQueueDepth) {
          this.metrics.peakQueueDepth = this.pendingQueue.length;
        }
      }
    });
  }

  private assignTaskToWorker(worker: PooledWorker, task: WorkerTask): void {
    worker.busy = true;
    worker.currentTask = task.id;
    worker.worker.postMessage(task);
    
    latencyTracker.recordEventLoopStart(`worker-task-${task.id}`);
  }

  private handleWorkerResult(worker: PooledWorker, result: WorkerResult): void {
    worker.busy = false;
    worker.tasksProcessed++;
    worker.lastTaskAt = Date.now();
    worker.currentTask = undefined;

    const pending = this.taskQueue.get(result.taskId);
    if (pending) {
      this.taskQueue.delete(result.taskId);
      
      if (result.success) {
        this.metrics.tasksCompleted++;
      } else {
        this.metrics.tasksFailed++;
      }

      this.metrics.durations.push(result.durationMs);
      if (this.metrics.durations.length > 1000) {
        this.metrics.durations.shift();
      }
      this.updateLatencyMetrics();

      latencyTracker.recordEventLoopEnd(`worker-task-${result.taskId}`, result.durationMs);
      pending.resolve(result);
    }

    this.processNextPendingTask(worker);
  }

  private handleWorkerError(worker: PooledWorker, error: Error): void {
    if (worker.currentTask) {
      const pending = this.taskQueue.get(worker.currentTask);
      if (pending) {
        this.taskQueue.delete(worker.currentTask);
        this.metrics.tasksFailed++;
        pending.reject(error);
      }
    }
    worker.busy = false;
    worker.currentTask = undefined;
  }

  private processNextPendingTask(worker: PooledWorker): void {
    if (this.pendingQueue.length > 0 && !worker.busy) {
      const highPriority = this.pendingQueue.findIndex(t => t.priority === "HIGH");
      const index = highPriority !== -1 ? highPriority : 0;
      const nextTask = this.pendingQueue.splice(index, 1)[0];
      this.assignTaskToWorker(worker, nextTask);
    }
  }

  private updateLatencyMetrics(): void {
    if (this.metrics.durations.length === 0) return;

    const sum = this.metrics.durations.reduce((a, b) => a + b, 0);
    this.metrics.avgDurationMs = sum / this.metrics.durations.length;

    const sorted = [...this.metrics.durations].sort((a, b) => a - b);
    const p99Index = Math.floor(sorted.length * 0.99);
    this.metrics.p99DurationMs = sorted[p99Index] || sorted[sorted.length - 1];
  }

  private checkIdleWorkers(): void {
    const now = Date.now();
    for (const worker of this.workers) {
      if (!worker.busy && now - worker.lastTaskAt > WORKER_IDLE_TIMEOUT_MS) {
        console.log(`[WORKER_POOL] Worker ${worker.id} idle for ${WORKER_IDLE_TIMEOUT_MS}ms`);
      }
    }
  }

  getMetrics() {
    return {
      ...this.metrics,
      poolSize: this.poolSize,
      busyWorkers: this.workers.filter(w => w.busy).length,
      idleWorkers: this.workers.filter(w => !w.busy).length,
      pendingTasks: this.pendingQueue.length,
      activeTaskCount: this.taskQueue.size,
    };
  }

  async shutdown(): Promise<void> {
    this.shutdownRequested = true;
    
    if (this.idleCheckInterval) {
      clearInterval(this.idleCheckInterval);
    }

    console.log(`[WORKER_POOL] Shutting down ${this.workers.length} workers...`);
    
    await Promise.all(
      this.workers.map(w => w.worker.terminate())
    );

    this.workers = [];
    this.taskQueue.clear();
    this.pendingQueue = [];
    this.initialized = false;
    
    console.log(`[WORKER_POOL] Shutdown complete`);
  }
}

export const workerPool = new WorkerThreadPool(
  parseInt(process.env.WORKER_POOL_SIZE || String(DEFAULT_POOL_SIZE), 10)
);
