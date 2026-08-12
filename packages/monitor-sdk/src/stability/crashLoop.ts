import { MONITOR_SCHEMA_VERSION } from "../types";
import type { Breadcrumb, MonitorContext } from "../types";

type CrashSnapshot = {
  pageUrl: string;
  replayData: string;
  breadcrumbs: Breadcrumb[];
};

function getSnapshot(ctx: MonitorContext): CrashSnapshot {
  return {
    pageUrl: window.location.href,
    replayData: ctx.getRecordScreenData(),
    breadcrumbs: ctx.getBehaviorState(),
  };
}

export default function crashLoop(ctx: MonitorContext): () => void {
  if (typeof Worker === "undefined") {
    console.warn("[monitor-sdk] Web Worker is not supported");

    return () => {};
  }

  let worker: Worker | null = null;

  /**
   * Worker 运行在独立环境中，不能直接访问：
   *
   * - ctx
   * - createEventBase
   * - lazyReportBatch
   *
   * 因此它需要自己创建 Event 和 Batch，
   * 并通过 fetch 直接发送给后端。
   */
  const workerCode = `
    const HEARTBEAT_INTERVAL = 5000;
    const CRASH_TIMEOUT = 15000;

    let schemaVersion = 2;

    let reportUrl = '';
    let appId = '';
    let projectName = '';
    let userId = '';

    let pageUrl = '';
    let latestReplayData = '';
    let latestBreadcrumbs = [];

    let pageHidden = false;
    let crashed = false;
    let intervalId = null;

    let lastResponseTime = performance.now();

    function createId() {
      if (
        typeof crypto !== 'undefined' &&
        typeof crypto.randomUUID === 'function'
      ) {
        return crypto.randomUUID();
      }

      return (
        Date.now().toString(36) +
        '-' +
        Math.random().toString(36).slice(2)
      );
    }

    function updateConfig(data) {
      if (typeof data.schemaVersion === 'number') {
        schemaVersion = data.schemaVersion;
      }

      if (typeof data.reportUrl === 'string') {
        reportUrl = data.reportUrl;
      }

      if (typeof data.appId === 'string') {
        appId = data.appId;
      }

      if (typeof data.projectName === 'string') {
        projectName = data.projectName;
      }

      if (typeof data.userId === 'string') {
        userId = data.userId;
      }
    }

    function updateSnapshot(data) {
      if (typeof data.pageUrl === 'string') {
        pageUrl = data.pageUrl;
      }

      if (typeof data.replayData === 'string') {
        latestReplayData = data.replayData;
      }

      if (Array.isArray(data.breadcrumbs)) {
        latestBreadcrumbs = data.breadcrumbs;
      }
    }

    function stopHeartbeat() {
      if (intervalId === null) {
        return;
      }

      clearInterval(intervalId);
      intervalId = null;
    }

    function reportCrash(
      reason,
      unresponsiveDuration
    ) {
      if (crashed || !reportUrl) {
        return;
      }

      crashed = true;
      stopHeartbeat();

      const timestamp = Date.now();
      const eventId = createId();
      const batchId = createId();

      const crashEvent = {
        schemaVersion,
        eventId,

        category: 'stability',
        eventType: 'crash',
        level: 'error',

        timestamp,
        pageUrl,

        breadcrumbs: latestBreadcrumbs,

        payload: {
          message:
            reason === 'heartbeat-timeout'
              ? '主线程长时间无响应'
              : '页面发生崩溃',

          metrics: {
            timeout: CRASH_TIMEOUT,
            unresponsiveDuration
          }
        }
      };

      if (userId) {
        crashEvent.userId = userId;
      }

      if (latestReplayData) {
        crashEvent.replayData =
          latestReplayData;
      }

      const reportPayload = {
        schemaVersion,
        batchId,
        sentAt: timestamp,

        app: {
          id: appId,
          name: projectName
        },

        events: [crashEvent],
        sendType: 'fetch'
      };

      fetch(reportUrl, {
        method: 'POST',

        headers: {
          'Content-Type': 'application/json'
        },

        body: JSON.stringify(reportPayload)
      })
        .catch((error) => {
          console.error(
            '[monitor-sdk] Failed to report crash:',
            error
          );
        })
        .finally(() => {
          close();
        });
    }

    function checkCrash() {
      /**
       * 后台标签页会被浏览器主动节流，
       * 不能把后台计时器延迟误判成崩溃。
       */
      if (pageHidden || crashed) {
        return;
      }

      const now = performance.now();

      const unresponsiveDuration =
        now - lastResponseTime;

      if (
        unresponsiveDuration < CRASH_TIMEOUT
      ) {
        return;
      }

      reportCrash(
        'heartbeat-timeout',
        unresponsiveDuration
      );
    }

    function sendHeartbeat() {
      if (pageHidden || crashed) {
        return;
      }

      postMessage({
        type: 'heartbeat'
      });
    }

    onmessage = (event) => {
      const data = event.data || {};
      const type = data.type;

      if (type === 'init') {
        updateConfig(data);
        updateSnapshot(data);

        pageHidden = Boolean(data.hidden);
        lastResponseTime = performance.now();

        return;
      }

      if (type === 'heartbeat-response') {
        updateSnapshot(data);

        lastResponseTime = performance.now();

        return;
      }

      if (type === 'visibility-change') {
        updateSnapshot(data);

        pageHidden = Boolean(data.hidden);

        /**
         * 页面重新可见时重新开始计时，
         * 避免把后台停留时间算进崩溃时间。
         */
        lastResponseTime = performance.now();

        if (!pageHidden) {
          sendHeartbeat();
        }

        return;
      }

      if (type === 'shutdown') {
        stopHeartbeat();
        close();
      }
    };

    intervalId = setInterval(() => {
      checkCrash();

      if (!crashed) {
        sendHeartbeat();
      }
    }, HEARTBEAT_INTERVAL);
  `;

  const workerBlob = new Blob([workerCode], {
    type: "application/javascript",
  });

  const workerUrl = URL.createObjectURL(workerBlob);

  worker = new Worker(workerUrl);

  /**
   * Worker 创建后就可以释放 Blob URL。
   * 已创建的 Worker 不受影响。
   */
  URL.revokeObjectURL(workerUrl);

  const postWorkerMessage = (
    type: string,
    extra: Record<string, unknown> = {},
  ): void => {
    if (!worker) {
      return;
    }

    try {
      worker.postMessage({
        type,
        ...getSnapshot(ctx),
        ...extra,
      });
    } catch (error) {
      console.warn("[monitor-sdk] Failed to send crash snapshot:", error);

      worker.postMessage({
        type,
        pageUrl: window.location.href,
        replayData: "",
        breadcrumbs: [],
        ...extra,
      });
    }
  };

  const { url, appId, projectName, userId } = ctx.getConfig();

  worker.onmessage = (event: MessageEvent<{ type?: string }>) => {
    if (event.data?.type !== "heartbeat") {
      return;
    }

    /**
     * 主线程能够执行到这里，说明主线程还活着。
     * 同时把最新 Breadcrumb 和录屏快照同步给 Worker。
     */
    postWorkerMessage("heartbeat-response");
  };

  postWorkerMessage("init", {
    schemaVersion: MONITOR_SCHEMA_VERSION,
    reportUrl: url,
    appId,
    projectName,
    userId,
    hidden: document.hidden,
  });

  ctx.on(
    document,
    "visibilitychange",
    () => {
      postWorkerMessage("visibility-change", {
        hidden: document.hidden,
      });
    },
    { capture: true },
  );

  const stopWorker = (): void => {
    if (!worker) {
      return;
    }

    const currentWorker = worker;
    worker = null;

    try {
      currentWorker.postMessage({
        type: "shutdown",
      });
    } finally {
      /**
       * 页面正常卸载时不应该产生 Crash Event。
       */
      currentWorker.terminate();
    }
  };

  ctx.on(window, "pagehide", stopWorker, {
    once: true,
    capture: true,
  });

  return stopWorker;
}
