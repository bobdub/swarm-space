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
