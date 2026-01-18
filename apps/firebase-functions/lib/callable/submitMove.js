import { Timestamp } from "firebase-admin/firestore";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { getDb } from "../shared/firebase.js";
import { logInfo } from "../shared/logger.js";
import { validateAndApplyMove } from "../shared/validateMove.js";
export const submitMove = onCall(async (request) => {
    const uid = request.auth?.uid;
    if (!uid) {
        throw new HttpsError("unauthenticated", "Authentication required");
    }
    const { gameId, uci, expectedVersion } = request.data;
    if (!gameId || !uci || expectedVersion === undefined) {
        throw new HttpsError("invalid-argument", "gameId, uci, and expectedVersion required");
    }
    const db = getDb();
    const gameRef = db.collection("games").doc(gameId);
    const movesRef = gameRef.collection("moves");
    const result = await db.runTransaction(async (transaction) => {
        const snapshot = await transaction.get(gameRef);
        if (!snapshot.exists) {
            throw new HttpsError("not-found", "Game not found");
        }
        const data = snapshot.data();
        if (!data) {
            throw new HttpsError("failed-precondition", "Game data missing");
        }
        if (data.version !== expectedVersion) {
            throw new HttpsError("failed-precondition", "Version mismatch");
        }
        const playerColor = data.whiteUid === uid ? "w" : data.blackUid === uid ? "b" : null;
        if (!playerColor) {
            throw new HttpsError("permission-denied", "Player not in game");
        }
        if (data.turn !== playerColor) {
            throw new HttpsError("failed-precondition", "Not your turn");
        }
        const moveResult = await validateAndApplyMove(data.fen, uci);
        if (!moveResult.ok) {
            throw new HttpsError("failed-precondition", moveResult.reason);
        }
        const now = Timestamp.now();
        const nextVersion = data.version + 1;
        const moveId = `move_${nextVersion}`;
        transaction.update(gameRef, {
            fen: moveResult.fen,
            moveNumber: moveResult.moveNumber,
            turn: moveResult.turn,
            version: nextVersion,
            updatedAt: now
        });
        transaction.set(movesRef.doc(moveId), {
            idx: nextVersion,
            by: playerColor,
            uci: moveResult.move.uci,
            san: moveResult.move.san,
            fenAfter: moveResult.fen,
            createdAt: now
        });
        return {
            fen: moveResult.fen,
            version: nextVersion,
            turn: moveResult.turn
        };
    });
    logInfo("submitMove", { gameId, uid, uci });
    return result;
});
