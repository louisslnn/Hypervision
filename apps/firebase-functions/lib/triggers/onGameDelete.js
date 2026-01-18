import { onDocumentDeleted } from "firebase-functions/v2/firestore";
import { logInfo } from "../shared/logger.js";
export const onGameDelete = onDocumentDeleted("games/{gameId}", (event) => {
    logInfo("onGameDelete", { gameId: event.params.gameId });
});
