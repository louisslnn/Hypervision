const http = require("http");
const WebSocket = require("ws");

const PORT = Number.parseInt(process.env.PORT || "9001", 10);

const server = http.createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("SecureWatch signaling server\n");
});

const wss = new WebSocket.Server({ server });
const rooms = new Map();

function getRoom(roomId) {
  if (!rooms.has(roomId)) {
    rooms.set(roomId, new Map());
  }
  return rooms.get(roomId);
}

function broadcast(roomId, message, excludeId) {
  const room = rooms.get(roomId);
  if (!room) return;

  const payload = JSON.stringify(message);
  for (const [clientId, client] of room.entries()) {
    if (clientId === excludeId) continue;
    if (client.readyState === WebSocket.OPEN) {
      client.send(payload);
    }
  }
}

function removeClient(roomId, clientId) {
  const room = rooms.get(roomId);
  if (!room) return;

  room.delete(clientId);
  if (room.size === 0) {
    rooms.delete(roomId);
    return;
  }

  broadcast(roomId, { type: "peer-left", roomId, clientId, peerCount: room.size }, clientId);
}

wss.on("connection", (ws) => {
  ws.on("message", (data) => {
    let message;
    try {
      message = JSON.parse(data.toString());
    } catch {
      return;
    }

    if (!message || typeof message.type !== "string") return;

    if (message.type === "join") {
      const { roomId, clientId } = message;
      if (!roomId || !clientId) return;

      ws.roomId = roomId;
      ws.clientId = clientId;

      const room = getRoom(roomId);
      room.set(clientId, ws);

      ws.send(
        JSON.stringify({
          type: "joined",
          roomId,
          clientId,
          peerCount: room.size
        })
      );

      broadcast(roomId, { type: "peer-joined", roomId, clientId, peerCount: room.size }, clientId);
      return;
    }

    if (message.type === "signal") {
      const { roomId, clientId, payload } = message;
      if (!roomId || !clientId || !payload) return;

      broadcast(roomId, { type: "signal", roomId, clientId, payload }, clientId);
      return;
    }

    if (message.type === "leave") {
      const { roomId, clientId } = message;
      if (!roomId || !clientId) return;
      removeClient(roomId, clientId);
    }
  });

  ws.on("close", () => {
    if (ws.roomId && ws.clientId) {
      removeClient(ws.roomId, ws.clientId);
    }
  });
});

server.listen(PORT, () => {
  console.log(`[securewatch-signaling] listening on ws://localhost:${PORT}`);
});
