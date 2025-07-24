import { HealthStatus, ServiceHealth, Config } from '../types.js';
import { VoyageClient } from '../clients/voyage-client.js';
import { QdrantVectorClient } from '../clients/qdrant-client.js';
import type { RateLimiter } from '../middleware/rate-limit.js';

export class HealthMonitorService {
  private config: Config;
  private startTime: Date;
  private voyageClient: VoyageClient;
  private qdrantClient: QdrantVectorClient;
  private lastHealthCheck: Date;
  private healthCheckInterval: NodeJS.Timeout | null = null;
  private rateLimiter?: RateLimiter;

  constructor(config: Config, voyageClient: VoyageClient, qdrantClient: QdrantVectorClient) {
    this.config = config;
    this.startTime = new Date();
    this.voyageClient = voyageClient;
    this.qdrantClient = qdrantClient;
    this.lastHealthCheck = new Date();

    // Start periodic health checks
    this.startHealthChecks();
  }

  /**
   * Get comprehensive health status
   */
  async getHealthStatus(): Promise<HealthStatus> {
    console.log('🏥 [HealthMonitor] Performing health check...');

    const [qdrantHealth, voyageHealth, fileWatcherHealth] = await Promise.allSettled([
      this.checkQdrantHealth(),
      this.checkVoyageHealth(),
      this.checkFileWatcherHealth()
    ]);

    const services = {
      qdrant: qdrantHealth.status === 'fulfilled' ? qdrantHealth.value : this.getFailedServiceHealth('Qdrant check failed'),
      voyage: voyageHealth.status === 'fulfilled' ? voyageHealth.value : this.getFailedServiceHealth('Voyage check failed'),
      fileWatcher: fileWatcherHealth.status === 'fulfilled' ? fileWatcherHealth.value : this.getFailedServiceHealth('File watcher check failed')
    };

    // Determine overall status
    const serviceStatuses = Object.values(services).map(s => s.status);
    let overallStatus: 'healthy' | 'degraded' | 'unhealthy';

    if (serviceStatuses.every(s => s === 'healthy')) {
      overallStatus = 'healthy';
    } else if (serviceStatuses.some(s => s === 'unhealthy')) {
      overallStatus = 'unhealthy';
    } else {
      overallStatus = 'degraded';
    }

    const metrics = await this.getSystemMetrics();

    const healthStatus: HealthStatus = {
      status: overallStatus,
      timestamp: new Date(),
      services,
      metrics,
      version: '1.0.0', // TODO: Get from package.json
      mcpSchemaVersion: this.config.mcpSchemaVersion
    };

    this.lastHealthCheck = new Date();
    console.log(`✅ [HealthMonitor] Health check complete: ${overallStatus}`);

    return healthStatus;
  }

  /**
   * Check Qdrant service health
   */
  private async checkQdrantHealth(): Promise<ServiceHealth> {
    const startTime = Date.now();
    
    try {
      const isConnected = await this.qdrantClient.testConnection();
      const latency = Date.now() - startTime;

      if (!isConnected) {
        return {
          status: 'unhealthy',
          latency,
          lastCheck: new Date(),
          message: 'Qdrant connection test failed'
        };
      }

      // Additional health checks
      try {
        await this.qdrantClient.getCollectionInfo();
        return {
          status: 'healthy',
          latency,
          lastCheck: new Date(),
          message: 'Qdrant operational'
        };
      } catch (collectionError) {
        return {
          status: 'degraded',
          latency,
          lastCheck: new Date(),
          message: 'Qdrant connected but collection not found'
        };
      }

    } catch (error) {
      return {
        status: 'unhealthy',
        latency: Date.now() - startTime,
        lastCheck: new Date(),
        message: `Qdrant error: ${error instanceof Error ? error.message : String(error)}`
      };
    }
  }

  /**
   * Check Voyage AI service health
   */
  private async checkVoyageHealth(): Promise<ServiceHealth> {
    const startTime = Date.now();
    
    try {
      const isConnected = await this.voyageClient.testConnection();
      const latency = Date.now() - startTime;

      return {
        status: isConnected ? 'healthy' : 'unhealthy',
        latency,
        lastCheck: new Date(),
        message: isConnected ? 'Voyage AI operational' : 'Voyage AI connection failed'
      };

    } catch (error) {
      return {
        status: 'unhealthy',
        latency: Date.now() - startTime,
        lastCheck: new Date(),
        message: `Voyage AI error: ${error instanceof Error ? error.message : String(error)}`
      };
    }
  }

  /**
   * Check file watcher service health
   */
  private async checkFileWatcherHealth(): Promise<ServiceHealth> {
    // For now, assume file watcher is healthy if the process is running
    // In a real implementation, you'd check the actual watcher status
    return {
      status: 'healthy',
      latency: 0,
      lastCheck: new Date(),
      message: 'File watcher operational'
    };
  }

  /**
   * Set rate limiter instance for metrics collection
   */
  public setRateLimiter(rateLimiter: RateLimiter): void {
    this.rateLimiter = rateLimiter;
  }

  /**
   * Get system metrics including rate limiting metrics
   */
  private async getSystemMetrics(): Promise<{
    uptime: number;
    memoryUsage: number;
    cpuUsage?: number;
    diskUsage?: number;
    rateLimit?: {
      totalRequests: number;
      rejectedRequests: number;
      activeBuckets: number;
      rejectionRate: number;
    };
  }> {
    const uptime = Date.now() - this.startTime.getTime();
    
    // Get memory usage
    const memoryUsage = process.memoryUsage();
    const memoryUsageMB = Math.round(memoryUsage.heapUsed / 1024 / 1024);

    const metrics: any = {
      uptime: Math.round(uptime / 1000), // Convert to seconds
      memoryUsage: memoryUsageMB
      // CPU and disk usage would require additional libraries
    };

    // Add rate limiting metrics if available
    if (this.rateLimiter) {
      const rateLimitMetrics = this.rateLimiter.getMetrics();
      metrics.rateLimit = {
        ...rateLimitMetrics,
        rejectionRate: rateLimitMetrics.totalRequests > 0 
          ? Math.round((rateLimitMetrics.rejectedRequests / rateLimitMetrics.totalRequests) * 100) / 100
          : 0
      };
    }

    return metrics;
  }

  /**
   * Create a failed service health object
   */
  private getFailedServiceHealth(message: string): ServiceHealth {
    return {
      status: 'unhealthy',
      lastCheck: new Date(),
      message
    };
  }

  /**
   * Start periodic health checks
   */
  private startHealthChecks(): void {
    // Run health checks every 5 minutes
    this.healthCheckInterval = setInterval(async () => {
      try {
        await this.getHealthStatus();
      } catch (error) {
        console.error('❌ [HealthMonitor] Periodic health check failed:', error);
      }
    }, 5 * 60 * 1000);

    console.log('🏥 [HealthMonitor] Started periodic health checks (5 min intervals)');
  }

  /**
   * Stop periodic health checks
   */
  stopHealthChecks(): void {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
      console.log('🏥 [HealthMonitor] Stopped periodic health checks');
    }
  }

  /**
   * Get simple health status for quick checks
   */
  async getSimpleHealth(): Promise<{ status: string; timestamp: Date }> {
    try {
      const health = await this.getHealthStatus();
      return {
        status: health.status,
        timestamp: health.timestamp
      };
    } catch (error) {
      return {
        status: 'unhealthy',
        timestamp: new Date()
      };
    }
  }

  /**
   * Check if the service is ready to serve requests
   */
  async isReady(): Promise<boolean> {
    try {
      const health = await this.getHealthStatus();
      return health.status !== 'unhealthy';
    } catch (error) {
      return false;
    }
  }

  /**
   * Check if the service is alive (basic liveness check)
   */
  isAlive(): boolean {
    // Basic check - if we can execute this function, the service is alive
    return true;
  }

  /**
   * Get detailed service statistics
   */
  async getDetailedStats(): Promise<{
    health: HealthStatus;
    performance: {
      averageResponseTime: number;
      requestCount: number;
      errorRate: number;
    };
    resources: {
      memoryUsage: number;
      uptime: number;
      lastHealthCheck: Date;
    };
  }> {
    const health = await this.getHealthStatus();
    
    return {
      health,
      performance: {
        averageResponseTime: 0, // TODO: Implement performance tracking
        requestCount: 0, // TODO: Implement request counting
        errorRate: 0 // TODO: Implement error rate tracking
      },
      resources: {
        memoryUsage: health.metrics.memoryUsage,
        uptime: health.metrics.uptime,
        lastHealthCheck: this.lastHealthCheck
      }
    };
  }

  /**
   * Get health summary for logging/monitoring
   */
  getHealthSummary(): string {
    const uptime = Math.round((Date.now() - this.startTime.getTime()) / 1000);
    const memory = Math.round(process.memoryUsage().heapUsed / 1024 / 1024);
    
    return `Uptime: ${uptime}s, Memory: ${memory}MB, Last Check: ${this.lastHealthCheck.toISOString()}`;
  }

  /**
   * Cleanup resources
   */
  destroy(): void {
    this.stopHealthChecks();
    console.log('🏥 [HealthMonitor] Destroyed health monitor');
  }
} 