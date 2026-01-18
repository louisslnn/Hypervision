import { GameDoc, SyncAdapter } from "./types";

import {
  ensureAnonymousAuth,
  doc,
  getFirebaseServices,
  httpsCallable,
  onSnapshot
} from "@/lib/firebase";

type CreateGameResponse = {
  gameId: string;
};

export class FirebaseSyncAdapter implements SyncAdapter {
  async createGame(): Promise<{ gameId: string }> {
    await ensureAnonymousAuth();
    const { functions } = getFirebaseServices();
    const call = httpsCallable(functions, "createGame");
    const result = await call();
    return result.data as CreateGameResponse;
  }

  async joinGame(gameId: string): Promise<void> {
    await ensureAnonymousAuth();
    const { functions } = getFirebaseServices();
    const call = httpsCallable(functions, "joinGame");
    await call({ gameId });
  }

  async submitMove(gameId: string, uci: string, expectedVersion: number): Promise<void> {
    await ensureAnonymousAuth();
    const { functions } = getFirebaseServices();
    const call = httpsCallable(functions, "submitMove");
    await call({ gameId, uci, expectedVersion });
  }

  subscribeToGame(gameId: string, onUpdate: (game: GameDoc) => void): () => void {
    const { firestore } = getFirebaseServices();
    const gameRef = doc(firestore, "games", gameId);
    return onSnapshot(gameRef, (snapshot) => {
      const data = snapshot.data();
      if (data) {
        onUpdate(data as GameDoc);
      }
    });
  }
}
