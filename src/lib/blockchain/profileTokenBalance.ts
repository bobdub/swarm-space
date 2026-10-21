// Profile Token Balance Tracking - Track user ownership of various profile tokens
import { openDB } from "../store";

export interface ProfileTokenHolding {
  userId: string;
  tokenId: string;
  ticker: string;
  creatorUserId: string;
  amount: number;
  lastUpdated: string;
}

const HOLDINGS_STORE = "profileTokenHoldings";

export async function getProfileTokenHolding(
  userId: string,
  tokenId: string
): Promise<ProfileTokenHolding | null> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(HOLDINGS_STORE, "readonly");
    const key = `${userId}-${tokenId}`;
    const request = tx.objectStore(HOLDINGS_STORE).get(key);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
  });
}

export async function saveProfileTokenHolding(holding: ProfileTokenHolding): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(HOLDINGS_STORE, "readwrite");
    const key = `${holding.userId}-${holding.tokenId}`;
    const request = tx.objectStore(HOLDINGS_STORE).put({ ...holding, id: key });
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

export async function getUserProfileTokenHoldings(userId: string): Promise<ProfileTokenHolding[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(HOLDINGS_STORE, "readonly");
    const request = tx.objectStore(HOLDINGS_STORE).getAll();
    request.onsuccess = () => {
      const all = request.result as ProfileTokenHolding[];
      const userHoldings = all.filter((h) => h.userId === userId);
      resolve(userHoldings);
    };
    request.onerror = () => reject(request.error);
  });
}

export async function addProfileTokens(params: {
  userId: string;
  tokenId: string;
  ticker: string;
  creatorUserId: string;
  amount: number;
}): Promise<void> {
  const existing = await getProfileTokenHolding(params.userId, params.tokenId);
  
  const holding: ProfileTokenHolding = {
    userId: params.userId,
    tokenId: params.tokenId,
    ticker: params.ticker,
    creatorUserId: params.creatorUserId,
    amount: existing ? existing.amount + params.amount : params.amount,
    lastUpdated: new Date().toISOString(),
  };

  await saveProfileTokenHolding(holding);
  console.log(`[Token Holdings] Added ${params.amount} ${params.ticker} to ${params.userId}`);
}

/** Both ownership records commit together; transfers never change circulating supply. */
export async function transferProfileTokens(from: string, to: string, tokenId: string, amount: number): Promise<void> {
  if (from === to || !Number.isFinite(amount) || amount <= 0) throw new Error("Invalid creator-token transfer");
  const db = await openDB();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(HOLDINGS_STORE, "readwrite");
    const store = tx.objectStore(HOLDINGS_STORE);
    const sender = store.get(`${from}-${tokenId}`);
    const receiver = store.get(`${to}-${tokenId}`);
    let failure: Error | undefined;
    const commit = () => {
      if (sender.readyState !== "done" || receiver.readyState !== "done") return;
      const source = sender.result as ProfileTokenHolding | undefined;
      const target = receiver.result as ProfileTokenHolding | undefined;
      if (!source || !Number.isFinite(source.amount) || source.amount < amount) {
        failure = new Error("Insufficient Native creator tokens"); tx.abort(); return;
      }
      const lastUpdated = new Date().toISOString();
      store.put({ ...source, id: `${from}-${tokenId}`, amount: Math.round((source.amount - amount) * 1e6) / 1e6, lastUpdated });
      store.put({ ...source, ...target, userId: to, id: `${to}-${tokenId}`, amount: Math.round(((target?.amount ?? 0) + amount) * 1e6) / 1e6, lastUpdated });
    };
    sender.onsuccess = commit;
    receiver.onsuccess = commit;
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(failure ?? tx.error ?? new Error("Creator-token transfer cancelled"));
    tx.onerror = () => reject(tx.error ?? new Error("Creator-token transfer failed"));
  });
}
