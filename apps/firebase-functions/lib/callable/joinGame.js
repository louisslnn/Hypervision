import { Timestamp } from "firebase-admin/firestore";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { getDb } from "../shared/firebase.js";
import { logInfo } from "../shared/logger.js";
export const joinGame = onCall(async (request) => {
    const uid = request.auth?.uid;
    if (!uid) {
        throw new HttpsError("unauthenticated", "Authentication required");
    }
    const gameId = request.data?.gameId;
    if (!gameId) {
        throw new HttpsError("invalid-argument", "gameId is required");
    }
    const db = getDb();
    const gameRef = db.collection("games").doc(gameId);
    const result = await db.runTransaction(async (transaction) => {
        const snapshot = await transaction.get(gameRef);
        if (!snapshot.exists) {
            throw new HttpsError("not-found", "Game not found");
        }
        const data = snapshot.data();
        if (!data) {
            throw new HttpsError("failed-precondition", "Game data missing");
        }
        const now = Timestamp.now();
        let color = "w";
        if (!data.whiteUid) {
            transaction.update(gameRef, {
                whiteUid: uid,
                updatedAt: now
            });
            color = "w";
        }
        else if (!data.blackUid) {
            transaction.update(gameRef, {
                blackUid: uid,
                status: "active",
                updatedAt: now
            });
            color = "b";
        }
        else if (data.whiteUid === uid) {
            color = "w";
        }
        else if (data.blackUid === uid) {
            color = "b";
        }
        else {
            throw new HttpsError("failed-precondition", "Game already full");
        }
        return { gameId, color };
    });
    logInfo("joinGame", { gameId, uid });
    return result;
});
