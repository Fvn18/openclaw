/**
 * 智能模型切换器 - MINIMAX / Deepseek 自动切换
 *
 * 功能：
 * 1. 检测 MINIMAX API 限额状态
 * 2. MINIMAX 限额时自动切换到 Deepseek
 * 3. 动态间隔检测 MINIMAX 恢复状态
 * 4. MINIMAX 恢复后自动切回
 */

import type { OpenClawConfig } from "../config/config.js";
import type { ModelProviderConfig } from "../config/types.js";
import { log } from "../agents/pi-embedded-runner/logger.js";

export type ProviderStatus = "available" | "rate_limited" | "error" | "unknown";

export type ProviderHealth = {
  provider: string;
  status: ProviderStatus;
  lastChecked: number;
  lastError?: string;
  retryAfter?: number;
  usagePercent?: number;
};

export type SwitcherConfig = {
  primary: string;
  fallback: string;
  checkIntervalMs: number;
  maxBackoffMs: number;
  quotaThreshold: number;
};

const DEFAULT_CONFIG: SwitcherConfig = {
  primary: "minimax",
  fallback: "deepseek",
  checkIntervalMs: 60000, // 1分钟基础检测间隔
  maxBackoffMs: 300000, // 最大5分钟间隔
  quotaThreshold: 95, // 95%使用量视为限额
};

class ModelSwitcher {
  private config: SwitcherConfig;
  private healthMap = new Map<string, ProviderHealth>();
  private currentProvider: string;
  private checkTimer?: NodeJS.Timeout;
  private backoffMs: number;
  private isRunning = false;

  constructor(config: Partial<SwitcherConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.currentProvider = this.config.primary;
    this.backoffMs = this.config.checkIntervalMs;
  }

  /**
   * 启动自动切换监控
   */
  start(): void {
    if (this.isRunning) return;
    this.isRunning = true;
    this.scheduleCheck();
    log.info(
      `[ModelSwitcher] 启动监控 - 主模型: ${this.config.primary}, 备用: ${this.config.fallback}`,
    );
  }

  /**
   * 停止监控
   */
  stop(): void {
    this.isRunning = false;
    if (this.checkTimer) {
      clearTimeout(this.checkTimer);
      this.checkTimer = undefined;
    }
    log.info("[ModelSwitcher] 停止监控");
  }

  /**
   * 获取当前使用的模型提供商
   */
  getCurrentProvider(): string {
    return this.currentProvider;
  }

  /**
   * 获取提供商健康状态
   */
  getHealth(provider: string): ProviderHealth | undefined {
    return this.healthMap.get(provider);
  }

  /**
   * 强制切换到指定提供商
   */
  forceSwitch(provider: string): void {
    if (provider !== this.currentProvider) {
      log.info(`[ModelSwitcher] 手动切换: ${this.currentProvider} -> ${provider}`);
      this.currentProvider = provider;
      this.backoffMs = this.config.checkIntervalMs; // 重置退避
    }
  }

  /**
   * 检查主提供商是否可用
   */
  private async checkPrimaryHealth(): Promise<ProviderHealth> {
    const health = await this.checkProviderHealth(this.config.primary);
    this.healthMap.set(this.config.primary, health);
    return health;
  }

  /**
   * 检查提供商健康状态
   */
  private async checkProviderHealth(provider: string): Promise<ProviderHealth> {
    try {
      // 根据不同提供商调用对应的检查方法
      if (provider === "minimax") {
        return await this.checkMinimaxHealth();
      } else if (provider === "deepseek") {
        return await this.checkDeepseekHealth();
      }

      return {
        provider,
        status: "unknown",
        lastChecked: Date.now(),
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      return {
        provider,
        status: "error",
        lastChecked: Date.now(),
        lastError: errorMsg,
      };
    }
  }

  /**
   * 检查 MINIMAX 健康状态
   */
  private async checkMinimaxHealth(): Promise<ProviderHealth> {
    const apiKey = process.env.MINIMAX_API_KEY;
    if (!apiKey) {
      return {
        provider: "minimax",
        status: "error",
        lastChecked: Date.now(),
        lastError: "未配置 MINIMAX_API_KEY",
      };
    }

    try {
      // 调用 MINIMAX 使用量查询 API
      const response = await fetch(
        "https://api.minimaxi.com/v1/api/openplatform/coding_plan/remains",
        {
          method: "GET",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
        },
      );

      if (!response.ok) {
        if (response.status === 429) {
          return {
            provider: "minimax",
            status: "rate_limited",
            lastChecked: Date.now(),
            retryAfter: Date.now() + 60000,
          };
        }
        throw new Error(`HTTP ${response.status}`);
      }

      const data = (await response.json()) as {
        base_resp?: { status_code: number; status_msg: string };
        data?: {
          used?: number;
          total?: number;
          remaining?: number;
          reset_at?: string;
        };
      };

      if (data.base_resp?.status_code !== 0) {
        return {
          provider: "minimax",
          status: "error",
          lastChecked: Date.now(),
          lastError: data.base_resp?.status_msg || "API 错误",
        };
      }

      const usage = data.data;
      if (!usage) {
        return {
          provider: "minimax",
          status: "unknown",
          lastChecked: Date.now(),
        };
      }

      const used = usage.used ?? 0;
      const total = usage.total ?? 1;
      const remaining = usage.remaining ?? 0;
      const usagePercent = (used / total) * 100;

      // 检查是否接近限额
      if (usagePercent >= this.config.quotaThreshold || remaining <= 0) {
        return {
          provider: "minimax",
          status: "rate_limited",
          lastChecked: Date.now(),
          usagePercent,
          retryAfter: usage.reset_at ? new Date(usage.reset_at).getTime() : Date.now() + 3600000,
        };
      }

      return {
        provider: "minimax",
        status: "available",
        lastChecked: Date.now(),
        usagePercent,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      return {
        provider: "minimax",
        status: "error",
        lastChecked: Date.now(),
        lastError: errorMsg,
      };
    }
  }

  /**
   * 检查 Deepseek 健康状态
   */
  private async checkDeepseekHealth(): Promise<ProviderHealth> {
    const apiKey = process.env.DEEPSEEK_API_KEY;
    if (!apiKey) {
      return {
        provider: "deepseek",
        status: "error",
        lastChecked: Date.now(),
        lastError: "未配置 DEEPSEEK_API_KEY",
      };
    }

    try {
      // Deepseek 简单的余额查询
      const response = await fetch("https://api.deepseek.com/v1/user/balance", {
        method: "GET",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
      });

      if (!response.ok) {
        if (response.status === 429) {
          return {
            provider: "deepseek",
            status: "rate_limited",
            lastChecked: Date.now(),
            retryAfter: Date.now() + 60000,
          };
        }
        throw new Error(`HTTP ${response.status}`);
      }

      return {
        provider: "deepseek",
        status: "available",
        lastChecked: Date.now(),
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      return {
        provider: "deepseek",
        status: "error",
        lastChecked: Date.now(),
        lastError: errorMsg,
      };
    }
  }

  /**
   * 执行健康检查并处理切换逻辑
   */
  private async performCheck(): Promise<void> {
    if (!this.isRunning) return;

    try {
      // 检查主提供商状态
      const primaryHealth = await this.checkPrimaryHealth();

      log.debug(`[ModelSwitcher] ${this.config.primary} 状态: ${primaryHealth.status}`);

      // 当前使用主模型，但主模型不可用
      if (this.currentProvider === this.config.primary) {
        if (primaryHealth.status === "rate_limited" || primaryHealth.status === "error") {
          // 切换到备用
          log.warn(
            `[ModelSwitcher] ${this.config.primary} 不可用 (${primaryHealth.status})，切换到 ${this.config.fallback}`,
          );
          this.currentProvider = this.config.fallback;
          // 增加退避时间
          this.backoffMs = Math.min(this.backoffMs * 1.5, this.config.maxBackoffMs);
        } else {
          // 主模型正常，重置退避
          this.backoffMs = this.config.checkIntervalMs;
        }
      } else {
        // 当前使用备用模型，检查主模型是否恢复
        if (primaryHealth.status === "available") {
          log.info(`[ModelSwitcher] ${this.config.primary} 已恢复，切回主模型`);
          this.currentProvider = this.config.primary;
          this.backoffMs = this.config.checkIntervalMs;
        } else {
          // 主模型仍未恢复，继续增加退避
          this.backoffMs = Math.min(this.backoffMs * 1.5, this.config.maxBackoffMs);
        }
      }
    } catch (error) {
      log.error(`[ModelSwitcher] 检查失败: ${error}`);
    }

    // 安排下一次检查
    this.scheduleCheck();
  }

  /**
   * 安排下一次检查
   */
  private scheduleCheck(): void {
    if (!this.isRunning) return;

    this.checkTimer = setTimeout(() => {
      void this.performCheck();
    }, this.backoffMs);

    log.debug(`[ModelSwitcher] 下次检查将在 ${Math.round(this.backoffMs / 1000)} 秒后`);
  }
}

// 单例实例
let globalSwitcher: ModelSwitcher | undefined;

export function getModelSwitcher(config?: Partial<SwitcherConfig>): ModelSwitcher {
  if (!globalSwitcher) {
    globalSwitcher = new ModelSwitcher(config);
  }
  return globalSwitcher;
}

export function resetModelSwitcher(): void {
  if (globalSwitcher) {
    globalSwitcher.stop();
    globalSwitcher = undefined;
  }
}

export { ModelSwitcher };
