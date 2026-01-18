"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type WebRtcRole = "host" | "join";
export type WebRtcStatus = "idle" | "connecting" | "connected" | "disconnected" | "error";

export type OutboundCollabMessage = {
  type: string;
  payload?: Record<string, unknown>;
};

export type CollabMessage = OutboundCollabMessage & {
  senderId: string;
};

export interface UseWebRtcCollabOptions {
  enabled: boolean;
  serverUrl: string;
  roomId: string;
  role: WebRtcRole;
  localStream?: MediaStream | null;
  onMessage?: (message: CollabMessage) => void;
}

export interface UseWebRtcCollabResult {
  status: WebRtcStatus;
  peerConnected: boolean;
  dataChannelOpen: boolean;
  remoteStream: MediaStream | null;
  clientId: string;
  lastError: string | null;
  sendMessage: (message: OutboundCollabMessage) => void;
  connect: () => void;
  disconnect: () => void;
}

type SignalPayload = RTCSessionDescriptionInit | RTCIceCandidateInit;

type SignalMessage =
  | { type: "join"; roomId: string; clientId: string; role: WebRtcRole }
  | { type: "signal"; roomId: string; clientId: string; payload: SignalPayload }
  | { type: "leave"; roomId: string; clientId: string };

type SignalEvent =
  | { type: "joined"; roomId: string; clientId: string; peerCount: number }
  | { type: "peer-joined"; roomId: string; clientId: string; peerCount: number }
  | { type: "peer-left"; roomId: string; clientId: string; peerCount: number }
  | { type: "signal"; roomId: string; clientId: string; payload: SignalPayload };

const ICE_SERVERS: RTCConfiguration["iceServers"] = [
  { urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] }
];

function createClientId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `client-${Math.random().toString(36).slice(2, 10)}-${Date.now()}`;
}

function safeParseMessage(data: string): SignalEvent | null {
  try {
    return JSON.parse(data) as SignalEvent;
  } catch {
    return null;
  }
}

function syncLocalStream(pc: RTCPeerConnection, stream: MediaStream | null) {
  const senders = pc.getSenders();
  const tracks = stream ? stream.getTracks() : [];
  const kinds = new Set(tracks.map((track) => track.kind));

  tracks.forEach((track) => {
    const sender = senders.find((existing) => existing.track?.kind === track.kind);
    if (sender) {
      sender.replaceTrack(track).catch(() => undefined);
    } else if (stream) {
      pc.addTrack(track, stream);
    }
  });

  senders.forEach((sender) => {
    if (sender.track && !kinds.has(sender.track.kind)) {
      try {
        pc.removeTrack(sender);
      } catch {
        // Ignore sender removal errors.
      }
    }
  });
}

export function useWebRtcCollab(options: UseWebRtcCollabOptions): UseWebRtcCollabResult {
  const { enabled, serverUrl, roomId, role, localStream = null, onMessage } = options;

  const clientIdRef = useRef<string>(createClientId());
  const wsRef = useRef<WebSocket | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const dataChannelRef = useRef<RTCDataChannel | null>(null);
  const roleRef = useRef<WebRtcRole>(role);
  const localStreamRef = useRef<MediaStream | null>(localStream);
  const makingOfferRef = useRef(false);

  const [status, setStatus] = useState<WebRtcStatus>("idle");
  const [peerConnected, setPeerConnected] = useState(false);
  const [dataChannelOpen, setDataChannelOpen] = useState(false);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);

  const sendSignal = useCallback(
    (payload: SignalPayload) => {
      const ws = wsRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) return;

      const message: SignalMessage = {
        type: "signal",
        roomId,
        clientId: clientIdRef.current,
        payload
      };

      ws.send(JSON.stringify(message));
    },
    [roomId]
  );

  const setupDataChannel = useCallback(
    (channel: RTCDataChannel) => {
      dataChannelRef.current = channel;

      channel.onopen = () => {
        setDataChannelOpen(true);
      };

      channel.onclose = () => {
        setDataChannelOpen(false);
      };

      channel.onmessage = (event) => {
        if (!onMessage) return;
        try {
          const message = JSON.parse(event.data) as CollabMessage;
          if (message.senderId === clientIdRef.current) return;
          onMessage(message);
        } catch {
          // Ignore malformed messages.
        }
      };
    },
    [onMessage]
  );

  const createPeerConnection = useCallback(() => {
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        sendSignal(event.candidate.toJSON());
      }
    };

    pc.onconnectionstatechange = () => {
      const state = pc.connectionState;
      if (state === "connected") {
        setPeerConnected(true);
      } else if (state === "disconnected" || state === "failed" || state === "closed") {
        setPeerConnected(false);
      }
    };

    pc.ontrack = (event) => {
      const track = event.track;
      setRemoteStream((prev) => {
        const nextStream = prev ? new MediaStream(prev) : new MediaStream();
        nextStream.addTrack(track);
        return nextStream;
      });
    };

    pc.ondatachannel = (event) => {
      setupDataChannel(event.channel);
    };

    pc.onnegotiationneeded = async () => {
      if (roleRef.current !== "host") return;
      if (makingOfferRef.current) return;

      try {
        makingOfferRef.current = true;
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        if (pc.localDescription) {
          sendSignal(pc.localDescription.toJSON());
        }
      } catch (err) {
        setLastError(err instanceof Error ? err.message : "Failed to create offer");
        setStatus("error");
      } finally {
        makingOfferRef.current = false;
      }
    };

    return pc;
  }, [sendSignal, setupDataChannel]);

  const connect = useCallback(() => {
    if (!serverUrl || !roomId) {
      setStatus("error");
      setLastError("Missing signaling server URL or room ID.");
      return;
    }

    if (wsRef.current || pcRef.current) return;

    roleRef.current = role;
    localStreamRef.current = localStream;

    setStatus("connecting");
    setLastError(null);

    const ws = new WebSocket(serverUrl);
    wsRef.current = ws;

    const pc = createPeerConnection();
    pcRef.current = pc;

    if (role === "host") {
      const channel = pc.createDataChannel("securewatch-collab");
      setupDataChannel(channel);
    }

    if (role === "host" && localStreamRef.current) {
      syncLocalStream(pc, localStreamRef.current);
    }

    ws.onopen = () => {
      const message: SignalMessage = {
        type: "join",
        roomId,
        clientId: clientIdRef.current,
        role
      };

      ws.send(JSON.stringify(message));
      setStatus("connected");
    };

    ws.onmessage = async (event) => {
      const message = safeParseMessage(event.data);
      if (!message || !pcRef.current) return;

      if (message.type === "peer-joined" && roleRef.current === "host") {
        try {
          makingOfferRef.current = true;
          const offer = await pcRef.current.createOffer();
          await pcRef.current.setLocalDescription(offer);
          if (pcRef.current.localDescription) {
            sendSignal(pcRef.current.localDescription.toJSON());
          }
        } catch (err) {
          setLastError(err instanceof Error ? err.message : "Failed to create offer");
          setStatus("error");
        } finally {
          makingOfferRef.current = false;
        }
        return;
      }

      if (message.type === "signal") {
        const payload = message.payload;
        if (!payload) return;

        if ("type" in payload) {
          const description = payload as RTCSessionDescriptionInit;
          if (description.type === "offer") {
            await pcRef.current.setRemoteDescription(description);
            const answer = await pcRef.current.createAnswer();
            await pcRef.current.setLocalDescription(answer);
            if (pcRef.current.localDescription) {
              sendSignal(pcRef.current.localDescription.toJSON());
            }
          } else if (description.type === "answer") {
            await pcRef.current.setRemoteDescription(description);
          }
        } else if ("candidate" in payload) {
          try {
            await pcRef.current.addIceCandidate(payload);
          } catch (err) {
            setLastError(err instanceof Error ? err.message : "Failed to add ICE candidate");
          }
        }
      }
    };

    ws.onerror = () => {
      setStatus("error");
      setLastError("Signaling server connection error.");
    };

    ws.onclose = () => {
      setStatus("disconnected");
      setPeerConnected(false);
      setDataChannelOpen(false);
      setRemoteStream(null);
      if (dataChannelRef.current) {
        dataChannelRef.current.close();
        dataChannelRef.current = null;
      }
      if (pcRef.current) {
        pcRef.current.close();
        pcRef.current = null;
      }
      wsRef.current = null;
    };
  }, [createPeerConnection, localStream, role, roomId, sendSignal, serverUrl, setupDataChannel]);

  const disconnect = useCallback(() => {
    if (wsRef.current) {
      const leaveMessage: SignalMessage = {
        type: "leave",
        roomId,
        clientId: clientIdRef.current
      };
      if (wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify(leaveMessage));
      }
      wsRef.current.close();
      wsRef.current = null;
    }

    if (dataChannelRef.current) {
      dataChannelRef.current.close();
      dataChannelRef.current = null;
    }

    if (pcRef.current) {
      pcRef.current.getSenders().forEach((sender) => {
        try {
          pcRef.current?.removeTrack(sender);
        } catch {
          // Ignore sender removal errors.
        }
      });
      pcRef.current.close();
      pcRef.current = null;
    }

    setPeerConnected(false);
    setDataChannelOpen(false);
    setRemoteStream(null);
    setStatus("disconnected");
  }, [roomId]);

  const sendMessage = useCallback((message: OutboundCollabMessage) => {
    const channel = dataChannelRef.current;
    if (!channel || channel.readyState !== "open") return;

    const payload: CollabMessage = {
      ...message,
      senderId: clientIdRef.current
    };

    channel.send(JSON.stringify(payload));
  }, []);

  useEffect(() => {
    roleRef.current = role;
  }, [role]);

  useEffect(() => {
    localStreamRef.current = localStream;
    if (pcRef.current && roleRef.current === "host") {
      syncLocalStream(pcRef.current, localStream ?? null);
    }
  }, [localStream]);

  useEffect(() => {
    if (enabled) {
      connect();
      return () => {
        disconnect();
      };
    }

    disconnect();
    return undefined;
  }, [connect, disconnect, enabled]);

  return {
    status,
    peerConnected,
    dataChannelOpen,
    remoteStream,
    clientId: clientIdRef.current,
    lastError,
    sendMessage,
    connect,
    disconnect
  };
}
