import type {
  AchievementDefinition,
  AchievementProgressRecord,
  QcmSeriesPoint,
} from "../types";
import { getAll, getAllByIndex, openDB, put, remove } from "./store";

const ACHIEVEMENT_DEFINITIONS_STORE = "achievementDefinitions";
const ACHIEVEMENT_PROGRESS_STORE = "achievementProgress";
const QCM_SAMPLES_STORE = "qcmSamples";

type TransactionMode = "readonly" | "readwrite";

type TransactionHandler<T> = (
  store: IDBObjectStore,
  transaction: IDBTransaction
) => T;

async function withStore<T>(
  storeName: string,
  mode: TransactionMode,
  handler: TransactionHandler<T>
): Promise<T> {
  const db = await openDB();
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const store = tx.objectStore(storeName);
    try {
      const result = handler(store, tx);
      tx.oncomplete = () => resolve(result);
      tx.onerror = () => reject(tx.error);
    } catch (err) {
      tx.abort();
      reject(err);
    }
  });
}

async function getByIndex<T>(
  storeName: string,
  indexName: string,
  key: IDBValidKey | IDBKeyRange
): Promise<T | undefined> {
  const db = await openDB();
  return new Promise<T | undefined>((resolve, reject) => {
    const tx = db.transaction(storeName, "readonly");
    const store = tx.objectStore(storeName);
    const index = store.index(indexName);
    const request = index.get(key);
    request.onsuccess = () => resolve(request.result as T | undefined);
    request.onerror = () => reject(request.error);
  });
}

export async function listAchievementDefinitions(): Promise<AchievementDefinition[]> {
  return getAll<AchievementDefinition>(ACHIEVEMENT_DEFINITIONS_STORE);
}

export async function getAchievementDefinition(
  id: string
): Promise<AchievementDefinition | undefined> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(ACHIEVEMENT_DEFINITIONS_STORE, "readonly");
    const request = tx.objectStore(ACHIEVEMENT_DEFINITIONS_STORE).get(id);
    request.onsuccess = () => resolve(request.result as AchievementDefinition | undefined);
    request.onerror = () => reject(request.error);
  });
}

export async function getAchievementDefinitionBySlug(
  slug: string
): Promise<AchievementDefinition | undefined> {
  return getByIndex<AchievementDefinition>(
    ACHIEVEMENT_DEFINITIONS_STORE,
    "slug",
    slug
  );
}

export async function saveAchievementDefinitions(
  definitions: AchievementDefinition[]
): Promise<void> {
  if (!definitions.length) return;
  await withStore(ACHIEVEMENT_DEFINITIONS_STORE, "readwrite", (store) => {
    for (const definition of definitions) {
      store.put(definition);
    }
    return undefined;
  });
}

export async function saveAchievementDefinition(
  definition: AchievementDefinition
): Promise<void> {
  await put(ACHIEVEMENT_DEFINITIONS_STORE, definition);
}

export async function removeAchievementDefinition(id: string): Promise<void> {
  await remove(ACHIEVEMENT_DEFINITIONS_STORE, id);
}

export async function listUserAchievementProgress(
  userId: string
): Promise<AchievementProgressRecord[]> {
  return getAllByIndex<AchievementProgressRecord>(
    ACHIEVEMENT_PROGRESS_STORE,
    "userId",
    userId
  );
}

export async function getAchievementProgressRecord(
  userId: string,
  achievementId: string
): Promise<AchievementProgressRecord | undefined> {
  return getByIndex<AchievementProgressRecord>(
    ACHIEVEMENT_PROGRESS_STORE,
    "userAchievement",
    `${userId}:${achievementId}`
  );
}

export async function saveAchievementProgressRecord(
  progress: AchievementProgressRecord
): Promise<void> {
  const record: AchievementProgressRecord = {
    ...progress,
    userAchievementKey: progress.userAchievementKey ?? `${progress.userId}:${progress.achievementId}`,
  };
  await put(ACHIEVEMENT_PROGRESS_STORE, record);
}

export async function markAchievementUnlocked(params: {
  id: string;
  userId: string;
  achievementId: string;
  unlockedAt?: string;
  meta?: Record<string, unknown>;
}): Promise<void> {
  const now = new Date().toISOString();
  await saveAchievementProgressRecord({
    id: params.id,
    userId: params.userId,
    achievementId: params.achievementId,
    unlocked: true,
    unlockedAt: params.unlockedAt ?? now,
    lastUpdated: now,
    meta: params.meta,
    progress: 1,
    progressLabel: "Unlocked",
  });
}

export async function upsertAchievementProgress(
  progress: AchievementProgressRecord
): Promise<void> {
  await saveAchievementProgressRecord(progress);
}

export async function listQcmSeriesPoints(
  userId: string,
  series: string
): Promise<QcmSeriesPoint[]> {
  const results = await getAllByIndex<QcmSeriesPoint>(
    QCM_SAMPLES_STORE,
    "userSeries",
    `${userId}:${series}`
  );
  return results.sort((a, b) => a.recordedAt.localeCompare(b.recordedAt));
}

export async function recordQcmSeriesPoints(
  points: QcmSeriesPoint[]
): Promise<void> {
  if (!points.length) return;
  await withStore(QCM_SAMPLES_STORE, "readwrite", (store) => {
    for (const point of points) {
      const record: QcmSeriesPoint = {
        ...point,
        userSeriesKey: point.userSeriesKey ?? `${point.userId}:${point.series}`,
      };
      store.put(record);
    }
    return undefined;
  });
}

export async function recordQcmPoint(point: QcmSeriesPoint): Promise<void> {
  await recordQcmSeriesPoints([point]);
}

export async function removeQcmPoint(id: string): Promise<void> {
  await remove(QCM_SAMPLES_STORE, id);
}

export async function clearQcmSeries(
  userId: string,
  series: string
): Promise<void> {
  const points = await listQcmSeriesPoints(userId, series);
  if (!points.length) return;
  await withStore(QCM_SAMPLES_STORE, "readwrite", (store) => {
    for (const point of points) {
      store.delete(point.id);
    }
    return undefined;
  });
}
