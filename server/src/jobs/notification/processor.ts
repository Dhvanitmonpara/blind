import redisClient from "../../services/redis.service.js";
import { io } from "../../app.js";
import { randomUUID } from "crypto";
import CircuitBreaker from "./circuiteBreaker.helper.js";
import Lock from "./lock.helper.js";
import NotificationService, {
  TRawNotificationWithMetadata,
} from "../../services/notification.service.js";
import config from "./config.js";
import {
  fetchPendingMessages,
  initializeStream,
  insertWithRetry,
  parseNotification,
  startCleanupTasks,
  stopCleanupTasks,
} from "./stream.helper.js";
import { RedisStreamEntry } from "../../utils/parseStreamEntry.js";

const CONSUMER_NAME = `consumer-${randomUUID().slice(0, 8)}`;
const LOCK_KEY = `lock:${config.STREAM_KEY}:notificationJob`;
const MAX_CONSUMER_IDLE_TIME = 3 * 60 * 1000; // 3 mins

const state = {
  lastActivityTimestamp: Date.now(),
  shutdownRequested: false,
  isWorkerRunning: false,
};

const lock = new Lock(redisClient, LOCK_KEY, 30);
const circuitBreaker = new CircuitBreaker();
const notificationService = new NotificationService(redisClient, io);

process.on("SIGINT", () => {
  state.shutdownRequested = true;
  state.isWorkerRunning = false;
});
process.on("SIGTERM", () => {
  state.shutdownRequested = true;
  state.isWorkerRunning = false;
});

const shouldStartConsumer = () => {
  return state.lastActivityTimestamp > Date.now() - MAX_CONSUMER_IDLE_TIME;
};

const startNotificationWorker = async () => {
  await initializeStream();
  startCleanupTasks({
    STREAM_KEY: config.STREAM_KEY,
    DLQ_STREAM: config.DLQ_STREAM,
  });

  let sleepDuration = 5000; // initial sleep 5s when idle

  try {
    while (shouldStartConsumer()) {
      if (circuitBreaker.circuitBreakerIsOpen()) {
        console.warn("Circuit breaker open. Cooling off...");
        await new Promise((res) =>
          setTimeout(res, circuitBreaker.COOLDOWN_PERIOD_MS)
        );
        continue;
      }

      if (state.shutdownRequested) {
        console.log("Shutdown in progress...");
        lock.stopHeartbeat();
        await lock.releaseLock();
        stopCleanupTasks();
        break;
      }

      const gotLock = await lock.acquireLock();
      if (!gotLock) {
        console.log("notificationWorker already running. Skipping.");
        await new Promise((res) => setTimeout(res, sleepDuration));
        continue;
      }

      lock.startHeartbeat();

      let notifications: TRawNotificationWithMetadata[] = [];

      // First try to recover pending messages
      const pending = await fetchPendingMessages(CONSUMER_NAME);
      if (pending.length > 0) {
        console.log("pending", pending.length, "messages found");
        if (pending.length > 0) console.log(pending[0]);
        notifications = pending.map(parseNotification);
      } else {
        // Otherwise fetch new messages (non-blocking)
        const response = (await redisClient.xreadgroup(
          "GROUP",
          config.GROUP_NAME,
          CONSUMER_NAME,
          "COUNT",
          config.BATCH_SIZE,
          "STREAMS",
          config.STREAM_KEY,
          ">"
        )) as [string, RedisStreamEntry[]][] | null;

        console.log(response);

        if (response && response.length > 0) {
          const [, messages] = response[0];
          notifications = messages
            .map((entry) => {
              try {
                return parseNotification(entry);
              } catch (e) {
                console.error("Malformed notification entry:", entry, e);
                return null;
              }
            })
            .filter((n): n is TRawNotificationWithMetadata => n !== null);
        }
      }

      if (notifications.length > 0) {
        // Update activity timestamp — new notifications are being processed
        state.lastActivityTimestamp = Date.now();

        const successIds = await insertWithRetry(
          notifications,
          notificationService,
          circuitBreaker
        );
        console.log(successIds.length, "notifications processed");

        if (successIds.length > 0) {
          await redisClient.xack(
            config.STREAM_KEY,
            config.GROUP_NAME,
            ...successIds
          );
        }

        sleepDuration = 1000; // traffic active → poll faster
      } else {
        // No notifications → increase sleep with max 60s
        sleepDuration = Math.min(sleepDuration * 2, 60000);
      }

      lock.stopHeartbeat();
      await lock.releaseLock();

      await new Promise((res) => setTimeout(res, sleepDuration));
    }

    // Outside loop - clean up on exit
    stopCleanupTasks();
  } catch (err) {
    console.error("Fatal stream processing error:", err);
    stopCleanupTasks();
  }
};

const notifyUserActivity = async () => {
  state.lastActivityTimestamp = Date.now();
  console.log(state.isWorkerRunning);
  if (state.isWorkerRunning) return;

  state.isWorkerRunning = true;
  state.shutdownRequested = false;

  try {
    console.log("started");
    await startNotificationWorker();
  } catch (e) {
    console.error("Notification worker failed:", e);
  } finally {
    state.isWorkerRunning = false;
  }
};

export { notifyUserActivity };
