import { Timestamp } from "firebase-admin/firestore";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { createInitialGameState } from "../shared/chessHelpers.js";
import { getDb } from "../shared/firebase.js";
import { logInfo } from "../shared/logger.js";
export const createGame = onCall(async (request) => {
    const uid = request.auth?.uid;
    if (!uid) {
        throw new HttpsError("unauthenticated", "Authentication required");
    }
    const db = getDb();
    const gameRef = db.collection("games").doc();
    const state = createInitialGameState();
    const now = Timestamp.now();
    await gameRef.set({
        createdAt: now,
        updatedAt: now,
        status: "waiting",
        variant: "standard",
        whiteUid: uid,
        blackUid: null,
        fen: state.fen,
        moveNumber: state.moveNumber,
        turn: state.turn,
        version: 0,
        result: "*"
    });
    logInfo("createGame", { gameId: gameRef.id, uid });
    return { gameId: gameRef.id };
});
