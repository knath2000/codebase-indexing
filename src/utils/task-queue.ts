/**
 * Simple async task queue implementation
 * Provides serial execution of tasks with configurable concurrency
 * Alternative to p-queue for controlling file system event processing
 */

export interface QueueMetrics {
  pending: number;
  running: number;
  completed: number;
  failed: number;
}

export interface QueueTask<T = any> {
  id: string;
  fn: () => Promise<T>;
  resolve: (value: T) => void;
  reject: (error: Error) => void;
}

export class TaskQueue {
  private tasks: QueueTask[] = [];
  private running = 0;
  private metrics: QueueMetrics = {
    pending: 0,
    running: 0,
    completed: 0,
    failed: 0
  };

  constructor(private concurrency: number = 1) {}

  /**
   * Add a task to the queue
   */
  async add<T>(taskFn: () => Promise<T>, taskId?: string): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const task: QueueTask<T> = {
        id: taskId || `task-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        fn: taskFn,
        resolve,
        reject
      };

      this.tasks.push(task);
      this.metrics.pending = this.tasks.length;
      
      // Start processing if we have capacity
      if (this.running < this.concurrency) {
        setImmediate(() => this.processNext());
      }
    });
  }

  /**
   * Process the next task in the queue
   */
  private async processNext(): Promise<void> {
    if (this.running >= this.concurrency || this.tasks.length === 0) {
      return;
    }

    const task = this.tasks.shift();
    if (!task) return;

    this.running++;
    this.metrics.running = this.running;
    this.metrics.pending = this.tasks.length;

    try {
      const result = await task.fn();
      task.resolve(result);
      this.metrics.completed++;
    } catch (error) {
      task.reject(error instanceof Error ? error : new Error(String(error)));
      this.metrics.failed++;
    } finally {
      this.running--;
      this.metrics.running = this.running;
      
      // Process next task if any are waiting
      if (this.tasks.length > 0) {
        setImmediate(() => this.processNext());
      }
    }
  }

  /**
   * Get current queue metrics
   */
  getMetrics(): QueueMetrics {
    return {
      ...this.metrics,
      pending: this.tasks.length,
      running: this.running
    };
  }

  /**
   * Clear all pending tasks
   */
  clear(): void {
    // Reject all pending tasks
    for (const task of this.tasks) {
      task.reject(new Error('Queue cleared'));
    }
    
    this.tasks = [];
    this.metrics.pending = 0;
  }

  /**
   * Wait for all current tasks to complete
   */
  async drain(): Promise<void> {
    return new Promise<void>((resolve) => {
      const checkDrained = () => {
        if (this.tasks.length === 0 && this.running === 0) {
          resolve();
        } else {
          setTimeout(checkDrained, 10);
        }
      };
      checkDrained();
    });
  }

  /**
   * Check if queue is idle (no pending or running tasks)
   */
  isIdle(): boolean {
    return this.tasks.length === 0 && this.running === 0;
  }
}

/**
 * Debounced task execution
 * Ensures that rapid successive calls to the same task only execute once
 */
export class DebouncedTaskQueue extends TaskQueue {
  private debouncedTasks = new Map<string, NodeJS.Timeout>();

  constructor(
    concurrency: number = 1,
    private debounceMs: number = 300
  ) {
    super(concurrency);
  }

  /**
   * Add a debounced task - if the same taskId is added multiple times
   * within the debounce window, only the last one will execute
   */
  async addDebounced<T>(
    taskFn: () => Promise<T>,
    taskId: string
  ): Promise<T> {
    // Clear existing timeout for this task
    const existingTimeout = this.debouncedTasks.get(taskId);
    if (existingTimeout) {
      clearTimeout(existingTimeout);
    }

    return new Promise<T>((resolve, reject) => {
      // Set new timeout
      const timeout = setTimeout(() => {
        this.debouncedTasks.delete(taskId);
        
        // Add to regular queue
        this.add(taskFn, taskId)
          .then(resolve)
          .catch(reject);
      }, this.debounceMs);

      this.debouncedTasks.set(taskId, timeout);
    });
  }

  /**
   * Clear all debounced tasks
   */
  clearDebounced(): void {
    for (const [taskId, timeout] of this.debouncedTasks) {
      clearTimeout(timeout);
    }
    this.debouncedTasks.clear();
  }

  /**
   * Override clear to also clear debounced tasks
   */
  clear(): void {
    super.clear();
    this.clearDebounced();
  }
}