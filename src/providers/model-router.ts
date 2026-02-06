/**
 * 模型路由器 - 集成智能切换逻辑到模型选择流程
 */

import type { ModelRef } from "../agents/model-selection.js";
import type { OpenClawConfig } from "../config/config.js";
import { log } from "../agents/pi-embedded-runner/logger.js";
import { getModelSwitcher, type SwitcherConfig } from "./model-switcher.js";

export type RouterConfig = {
  enabled: boolean;
  primary: string;
  fallback: string;
  switcherConfig?: Partial<SwitcherConfig>;
};

const DEFAULT_ROUTER_CONFIG: RouterConfig = {
  enabled: true,
  primary: "minimax",
  fallback: "deepseek",
};

/**
 * 从配置中解析路由器配置
 */
export function resolveRouterConfig(config: OpenClawConfig): RouterConfig {
  const routerConfig = config.models?.router;

  if (!routerConfig) {
    return DEFAULT_ROUTER_CONFIG;
  }

  return {
    enabled: routerConfig.enabled !== false,
    primary: routerConfig.primary ?? DEFAULT_ROUTER_CONFIG.primary,
    fallback: routerConfig.fallback ?? DEFAULT_ROUTER_CONFIG.fallback,
    switcherConfig: {
      checkIntervalMs: routerConfig.checkIntervalMs,
      maxBackoffMs: routerConfig.maxBackoffMs,
      quotaThreshold: routerConfig.quotaThreshold,
    },
  };
}

/**
 * 根据当前切换器状态解析实际要使用的模型
 */
export function resolveRoutedModel(requestedModel: ModelRef, config: OpenClawConfig): ModelRef {
  const routerConfig = resolveRouterConfig(config);

  if (!routerConfig.enabled) {
    return requestedModel;
  }

  // 初始化切换器
  const switcher = getModelSwitcher({
    primary: routerConfig.primary,
    fallback: routerConfig.fallback,
    ...routerConfig.switcherConfig,
  });

  // 启动切换器（如果未启动）
  switcher.start();

  const currentProvider = switcher.getCurrentProvider();
  const requestedProvider = requestedModel.provider.toLowerCase();

  // 如果请求的提供商与当前可用提供商不同，进行切换
  if (requestedProvider === routerConfig.primary && currentProvider !== routerConfig.primary) {
    // 请求主模型但主模型不可用，切换到备用
    const fallbackModel = resolveFallbackModel(requestedModel, routerConfig.fallback, config);
    log.info(
      `[ModelRouter] 路由切换: ${requestedModel.provider}/${requestedModel.model} -> ${fallbackModel.provider}/${fallbackModel.model}`,
    );
    return fallbackModel;
  }

  return requestedModel;
}

/**
 * 解析备用模型
 */
function resolveFallbackModel(
  originalModel: ModelRef,
  fallbackProvider: string,
  config: OpenClawConfig,
): ModelRef {
  // 获取配置中的备用模型
  const fallbackModels = config.agents?.defaults?.model?.fallbacks;

  if (fallbackModels && fallbackModels.length > 0) {
    // 使用配置中的第一个备用模型
    const firstFallback = fallbackModels[0];
    if (firstFallback.includes("/")) {
      const [provider, model] = firstFallback.split("/", 2);
      return { provider, model };
    }
  }

  // 默认备用模型映射
  const defaultModelMap: Record<string, string> = {
    "MiniMax-M2.1": "deepseek-chat",
    "MiniMax-VL-01": "deepseek-chat",
    "MiniMax-M2.1-lightning": "deepseek-coder",
  };

  const fallbackModelId = defaultModelMap[originalModel.model] || "deepseek-chat";

  return {
    provider: fallbackProvider,
    model: fallbackModelId,
  };
}

/**
 * 获取当前路由状态报告
 */
export function getRouterStatus(config: OpenClawConfig): {
  enabled: boolean;
  currentProvider: string;
  primaryHealth?: string;
  fallbackHealth?: string;
} {
  const routerConfig = resolveRouterConfig(config);

  if (!routerConfig.enabled) {
    return { enabled: false, currentProvider: "direct" };
  }

  const switcher = getModelSwitcher();
  const primaryHealth = switcher.getHealth(routerConfig.primary);
  const fallbackHealth = switcher.getHealth(routerConfig.fallback);

  return {
    enabled: true,
    currentProvider: switcher.getCurrentProvider(),
    primaryHealth: primaryHealth?.status,
    fallbackHealth: fallbackHealth?.status,
  };
}

/**
 * 手动强制切换提供商
 */
export function forceProviderSwitch(provider: string, config: OpenClawConfig): boolean {
  const routerConfig = resolveRouterConfig(config);

  if (!routerConfig.enabled) {
    log.warn("[ModelRouter] 路由器未启用，无法切换");
    return false;
  }

  const switcher = getModelSwitcher();
  switcher.forceSwitch(provider);
  return true;
}
