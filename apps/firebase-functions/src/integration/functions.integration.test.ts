import { initializeApp, deleteApp } from "firebase/app";
import { getAuth, signInAnonymously, connectAuthEmulator } from "firebase/auth";
import { connectFirestoreEmulator, getFirestore, doc, getDoc } from "firebase/firestore";
import { connectFunctionsEmulator, getFunctions, httpsCallable } from "firebase/functions";
import { describe, expect, it } from "vitest";

const PROJECT_ID = "hypervision-demo";

function createClient(name: string) {
  const app = initializeApp({ projectId: PROJECT_ID, apiKey: "demo-key" }, name);
  const auth = getAuth(app);
  const firestore = getFirestore(app);
  const functions = getFunctions(app);

  const authPort = Number(process.env.AUTH_EMULATOR_PORT ?? 9099);
  const firestorePort = Number(process.env.FIRESTORE_EMULATOR_PORT ?? 8085);
  const functionsPort = Number(process.env.FUNCTIONS_EMULATOR_PORT ?? 5001);

  connectAuthEmulator(auth, `http://localhost:${authPort}`, { disableWarnings: true });
  connectFirestoreEmulator(firestore, "localhost", firestorePort);
  connectFunctionsEmulator(functions, "localhost", functionsPort);

  return { app, auth, firestore, functions };
}

describe("functions integration", () => {
  it("creates, joins, and submits moves with version control", async () => {
    const clientA = createClient("clientA");
    const clientB = createClient("clientB");

    await signInAnonymously(clientA.auth);
    await signInAnonymously(clientB.auth);

    const createGame = httpsCallable(clientA.functions, "createGame");
    const joinGame = httpsCallable(clientB.functions, "joinGame");
    const submitMove = httpsCallable(clientA.functions, "submitMove");

    const created = await createGame();
    const gameId = (created.data as { gameId: string }).gameId;
    expect(gameId).toBeTruthy();

    await joinGame({ gameId });

    await submitMove({ gameId, uci: "e2e4", expectedVersion: 0 });

    const gameDoc = await getDoc(doc(clientA.firestore, "games", gameId));
    const gameData = gameDoc.data();
    expect(gameData?.version).toBe(1);

    await expect(submitMove({ gameId, uci: "d2d4", expectedVersion: 0 })).rejects.toBeTruthy();

    await deleteApp(clientA.app);
    await deleteApp(clientB.app);
  });
});
