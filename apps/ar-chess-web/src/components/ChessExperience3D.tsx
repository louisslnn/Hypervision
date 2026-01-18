"use client";

import {
  computeHomography,
  HomographyMatrix,
  invertHomography,
  InteractionState,
  reduceInteraction,
  syncCanvasToVideo
} from "@hypervision/ar-core";
import {
  buildCoachFeedback,
  buildCoachNarrative,
  createInitialGameState,
  MoveDTO,
  tryMove
} from "@hypervision/chess-domain";
import { ChessEngine } from "@hypervision/engine";
import { RoundedBox } from "@react-three/drei";
import { Canvas, useFrame } from "@react-three/fiber";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";

import { PerfHud } from "@/components/PerfHud";
import { defaultCalibration, ScreenPoint, screenToBoard, screenToSquare } from "@/lib/boardMapping";
import { useCamera } from "@/lib/useCamera";
import { useEngine } from "@/lib/useEngine";
import { useHandGestures } from "@/lib/useHandGestures";

const BOARD_POINTS = [
  { x: 0, y: 0 },
  { x: 1, y: 0 },
  { x: 1, y: 1 },
  { x: 0, y: 1 }
];

const CAMERA_FOV = 45;
const BOARD_SIZE = 1;
const SQUARE_SIZE = BOARD_SIZE / 8;
const BOARD_BORDER = 0.08;
const BOARD_BASE_THICKNESS = 0.12;
const BOARD_DECK_THICKNESS = 0.02;
const PIECE_BASE_Z = 0.025;

const PRACTICE_LEVELS = {
  beginner: {
    label: "Beginner",
    analysisMs: 80,
    replyMs: 120,
    skillLevel: 4,
    limitStrength: true,
    elo: 800
  },
  intermediate: {
    label: "Intermediate",
    analysisMs: 160,
    replyMs: 240,
    skillLevel: 10,
    limitStrength: true,
    elo: 1400
  },
  advanced: {
    label: "Advanced",
    analysisMs: 320,
    replyMs: 400,
    skillLevel: 18,
    limitStrength: false,
    elo: 2000
  }
} as const;

type PracticeLevel = keyof typeof PRACTICE_LEVELS;
type PracticeConfig = (typeof PRACTICE_LEVELS)[PracticeLevel];

type CoachState = {
  feedback: string;
  detail?: string;
  label: string;
  centipawnLoss: number;
  lineSan?: string[];
};

const FILES = ["a", "b", "c", "d", "e", "f", "g", "h"] as const;

const pieceGeometryCache = new Map<string, THREE.BufferGeometry>();

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function parseFen(fen: string): Map<string, string> {
  const pieces = new Map<string, string>();
  const placement = fen.split(" ")[0];
  if (!placement) {
    return pieces;
  }

  const rows = placement.split("/");
  rows.forEach((row, rowIndex) => {
    let colIndex = 0;
    for (const char of row) {
      if (Number.isNaN(Number(char))) {
        const square = `${FILES[colIndex]}${8 - rowIndex}`;
        pieces.set(square, char);
        colIndex += 1;
      } else {
        colIndex += Number(char);
      }
    }
  });

  return pieces;
}

function squareToBoardCenter(square: string): { x: number; y: number } | null {
  if (square.length !== 2) {
    return null;
  }
  const fileIndex = FILES.indexOf(square[0] as (typeof FILES)[number]);
  const rank = Number(square[1]);
  if (fileIndex < 0 || Number.isNaN(rank)) {
    return null;
  }
  const x = (fileIndex + 0.5) / 8;
  const y = (8 - rank + 0.5) / 8;
  return { x, y };
}

function computeBoardPose(
  homography: HomographyMatrix,
  width: number,
  height: number,
  fov: number
): THREE.Matrix4 {
  const fovRad = THREE.MathUtils.degToRad(fov);
  const f = (0.5 * height) / Math.tan(fovRad / 2);
  const cx = width / 2;
  const cy = height / 2;

  const K = new THREE.Matrix3().set(f, 0, cx, 0, f, cy, 0, 0, 1);
  const invK = new THREE.Matrix3().copy(K).invert();
  const H = new THREE.Matrix3().set(
    homography[0],
    homography[1],
    homography[2],
    homography[3],
    homography[4],
    homography[5],
    homography[6],
    homography[7],
    homography[8]
  );

  const B = new THREE.Matrix3().multiplyMatrices(invK, H);
  const b = B.elements;
  const b1 = new THREE.Vector3(b[0], b[1], b[2]);
  const b2 = new THREE.Vector3(b[3], b[4], b[5]);
  const b3 = new THREE.Vector3(b[6], b[7], b[8]);

  const scale = 1 / ((b1.length() + b2.length()) / 2 || 1);
  const r1 = b1.clone().multiplyScalar(scale);
  const r2 = b2.clone().multiplyScalar(scale);
  const t = b3.clone().multiplyScalar(scale);

  const r1n = r1.clone().normalize();
  const r2proj = r2.clone().sub(r1n.clone().multiplyScalar(r1n.dot(r2)));
  const r2n = r2proj.lengthSq() > 1e-6 ? r2proj.normalize() : r2.clone().normalize();
  const r3 = new THREE.Vector3().crossVectors(r1n, r2n).normalize();

  const pose = new THREE.Matrix4().set(
    r1n.x,
    r2n.x,
    r3.x,
    t.x,
    r1n.y,
    r2n.y,
    r3.y,
    t.y,
    r1n.z,
    r2n.z,
    r3.z,
    t.z,
    0,
    0,
    0,
    1
  );

  const cvToThree = new THREE.Matrix4().set(1, 0, 0, 0, 0, -1, 0, 0, 0, 0, -1, 0, 0, 0, 0, 1);
  pose.premultiply(cvToThree);

  return pose;
}

// ─────────────────────────────────────────────────────────────────────────────
// REALISTIC 3D CHESS PIECES using LatheGeometry
// ─────────────────────────────────────────────────────────────────────────────

function createPawnProfile(): THREE.Vector2[] {
  return [
    new THREE.Vector2(0, 0),
    new THREE.Vector2(0.35, 0),
    new THREE.Vector2(0.35, 0.05),
    new THREE.Vector2(0.25, 0.1),
    new THREE.Vector2(0.2, 0.15),
    new THREE.Vector2(0.18, 0.35),
    new THREE.Vector2(0.22, 0.4),
    new THREE.Vector2(0.22, 0.45),
    new THREE.Vector2(0.15, 0.5),
    new THREE.Vector2(0.18, 0.6),
    new THREE.Vector2(0.15, 0.7),
    new THREE.Vector2(0.1, 0.75),
    new THREE.Vector2(0, 0.8)
  ];
}

function createRookProfile(): THREE.Vector2[] {
  return [
    new THREE.Vector2(0, 0),
    new THREE.Vector2(0.4, 0),
    new THREE.Vector2(0.4, 0.06),
    new THREE.Vector2(0.28, 0.12),
    new THREE.Vector2(0.22, 0.2),
    new THREE.Vector2(0.2, 0.6),
    new THREE.Vector2(0.28, 0.65),
    new THREE.Vector2(0.32, 0.7),
    new THREE.Vector2(0.32, 0.85),
    new THREE.Vector2(0.25, 0.85),
    new THREE.Vector2(0.25, 0.78),
    new THREE.Vector2(0.15, 0.78),
    new THREE.Vector2(0.15, 0.85),
    new THREE.Vector2(0, 0.85)
  ];
}

function createKnightProfile(): THREE.Vector2[] {
  return [
    new THREE.Vector2(0, 0),
    new THREE.Vector2(0.38, 0),
    new THREE.Vector2(0.38, 0.06),
    new THREE.Vector2(0.26, 0.12),
    new THREE.Vector2(0.2, 0.2),
    new THREE.Vector2(0.18, 0.5),
    new THREE.Vector2(0.25, 0.55),
    new THREE.Vector2(0.28, 0.65),
    new THREE.Vector2(0.22, 0.85),
    new THREE.Vector2(0.15, 0.95),
    new THREE.Vector2(0.08, 1.0),
    new THREE.Vector2(0, 1.0)
  ];
}

function createBishopProfile(): THREE.Vector2[] {
  return [
    new THREE.Vector2(0, 0),
    new THREE.Vector2(0.38, 0),
    new THREE.Vector2(0.38, 0.06),
    new THREE.Vector2(0.26, 0.12),
    new THREE.Vector2(0.2, 0.2),
    new THREE.Vector2(0.15, 0.5),
    new THREE.Vector2(0.18, 0.55),
    new THREE.Vector2(0.2, 0.6),
    new THREE.Vector2(0.15, 0.75),
    new THREE.Vector2(0.12, 0.85),
    new THREE.Vector2(0.15, 0.9),
    new THREE.Vector2(0.1, 0.98),
    new THREE.Vector2(0.06, 1.02),
    new THREE.Vector2(0, 1.05)
  ];
}

function createQueenProfile(): THREE.Vector2[] {
  return [
    new THREE.Vector2(0, 0),
    new THREE.Vector2(0.42, 0),
    new THREE.Vector2(0.42, 0.06),
    new THREE.Vector2(0.3, 0.14),
    new THREE.Vector2(0.22, 0.25),
    new THREE.Vector2(0.18, 0.55),
    new THREE.Vector2(0.22, 0.6),
    new THREE.Vector2(0.25, 0.65),
    new THREE.Vector2(0.2, 0.8),
    new THREE.Vector2(0.28, 0.88),
    new THREE.Vector2(0.22, 0.95),
    new THREE.Vector2(0.28, 1.02),
    new THREE.Vector2(0.2, 1.1),
    new THREE.Vector2(0.12, 1.18),
    new THREE.Vector2(0.08, 1.22),
    new THREE.Vector2(0, 1.25)
  ];
}

function createKingProfile(): THREE.Vector2[] {
  return [
    new THREE.Vector2(0, 0),
    new THREE.Vector2(0.44, 0),
    new THREE.Vector2(0.44, 0.06),
    new THREE.Vector2(0.32, 0.14),
    new THREE.Vector2(0.24, 0.25),
    new THREE.Vector2(0.2, 0.55),
    new THREE.Vector2(0.24, 0.6),
    new THREE.Vector2(0.28, 0.65),
    new THREE.Vector2(0.22, 0.8),
    new THREE.Vector2(0.18, 0.9),
    new THREE.Vector2(0.22, 0.95),
    new THREE.Vector2(0.18, 1.05),
    new THREE.Vector2(0.12, 1.12),
    new THREE.Vector2(0.08, 1.15),
    new THREE.Vector2(0.08, 1.2),
    new THREE.Vector2(0.04, 1.2),
    new THREE.Vector2(0.04, 1.28),
    new THREE.Vector2(0, 1.28)
  ];
}

const PIECE_PROFILES: Record<string, () => THREE.Vector2[]> = {
  p: createPawnProfile,
  r: createRookProfile,
  n: createKnightProfile,
  b: createBishopProfile,
  q: createQueenProfile,
  k: createKingProfile
};

const PIECE_SCALE: Record<string, number> = {
  p: 0.7,
  r: 0.78,
  n: 0.74,
  b: 0.75,
  q: 0.72,
  k: 0.7
};

function getPieceGeometry(pieceType: string, squareSize: number) {
  const key = `${pieceType}-${squareSize}`;
  const cached = pieceGeometryCache.get(key);
  if (cached) {
    return cached;
  }

  const profileFn = PIECE_PROFILES[pieceType];
  let geometry: THREE.BufferGeometry;
  if (!profileFn) {
    geometry = new THREE.CylinderGeometry(
      squareSize * 0.2,
      squareSize * 0.24,
      squareSize * 0.5,
      16
    );
  } else {
    const profile = profileFn();
    const scale = (PIECE_SCALE[pieceType] || 0.7) * squareSize * 0.95;
    const scaledProfile = profile.map((p) => new THREE.Vector2(p.x * scale, p.y * scale));
    geometry = new THREE.LatheGeometry(scaledProfile, 28);
  }

  pieceGeometryCache.set(key, geometry);
  return geometry;
}

function ChessPiece3D({
  piece,
  targetPosition,
  isSelected,
  isDragging,
  isGhost,
  squareSize
}: {
  piece: string;
  targetPosition: [number, number, number];
  isSelected: boolean;
  isDragging: boolean;
  isGhost: boolean;
  squareSize: number;
}) {
  const groupRef = useRef<THREE.Group>(null);
  const targetRef = useRef(new THREE.Vector3(...targetPosition));
  const isWhite = piece === piece.toUpperCase();
  const pieceType = piece.toLowerCase();

  const geometry = useMemo(() => getPieceGeometry(pieceType, squareSize), [pieceType, squareSize]);

  useEffect(() => {
    targetRef.current.set(...targetPosition);
  }, [targetPosition]);

  useEffect(() => {
    if (!groupRef.current) {
      return;
    }
    if (!groupRef.current.userData.initialized) {
      groupRef.current.position.set(...targetPosition);
      groupRef.current.userData.initialized = true;
    }
  }, [targetPosition]);

  useFrame((state, delta) => {
    if (!groupRef.current) {
      return;
    }

    const speed = isDragging ? 18 : 10;
    const lerp = 1 - Math.exp(-speed * delta);
    groupRef.current.position.lerp(targetRef.current, lerp);

    const bob =
      !isDragging && isSelected ? Math.sin(state.clock.elapsedTime * 3) * squareSize * 0.08 : 0;
    groupRef.current.position.z = targetRef.current.z + bob;

    if (isDragging) {
      groupRef.current.rotation.x = THREE.MathUtils.lerp(groupRef.current.rotation.x, -0.2, lerp);
      groupRef.current.rotation.y = THREE.MathUtils.lerp(groupRef.current.rotation.y, 0.25, lerp);
    } else {
      groupRef.current.rotation.x = THREE.MathUtils.lerp(groupRef.current.rotation.x, 0, lerp);
      groupRef.current.rotation.y = THREE.MathUtils.lerp(groupRef.current.rotation.y, 0, lerp);
    }
  });

  const baseColor = isWhite ? "#f5efe6" : "#1b1b1d";
  const accentColor = isWhite ? "#d7c8b0" : "#44322a";
  const emissive = isSelected || isDragging ? "#e86b32" : "#000000";
  const emissiveIntensity = isSelected || isDragging ? 0.35 : 0.05;
  const opacity = isGhost ? 0.35 : 1;

  return (
    <group ref={groupRef}>
      <mesh geometry={geometry} castShadow receiveShadow>
        <meshStandardMaterial
          color={baseColor}
          emissive={emissive}
          emissiveIntensity={emissiveIntensity}
          metalness={0.2}
          roughness={0.45}
          transparent={isGhost}
          opacity={opacity}
        />
      </mesh>
      <mesh position={[0, 0, squareSize * 0.04]} castShadow receiveShadow>
        <cylinderGeometry args={[squareSize * 0.28, squareSize * 0.32, squareSize * 0.05, 24]} />
        <meshStandardMaterial
          color={accentColor}
          metalness={0.15}
          roughness={0.6}
          transparent={isGhost}
          opacity={opacity}
        />
      </mesh>
    </group>
  );
}

function BoardSquare3D({
  position,
  isDark,
  isHighlighted,
  isHovered,
  size
}: {
  position: [number, number, number];
  isDark: boolean;
  isHighlighted: boolean;
  isHovered: boolean;
  size: number;
}) {
  let color = isDark ? "#5a6a4f" : "#e2dac8";
  let emissive = "#000000";
  let emissiveIntensity = 0.05;

  if (isHighlighted) {
    color = "#e6b85f";
    emissive = "#9f5a24";
    emissiveIntensity = 0.2;
  }

  if (isHovered) {
    color = "#f1cf7a";
    emissive = "#b9732c";
    emissiveIntensity = 0.25;
  }

  return (
    <mesh position={position} receiveShadow castShadow>
      <boxGeometry args={[size * 0.98, size * 0.98, size * 0.08]} />
      <meshStandardMaterial
        color={color}
        emissive={emissive}
        emissiveIntensity={emissiveIntensity}
        roughness={0.85}
        metalness={0.05}
      />
    </mesh>
  );
}

function Cursor3D({
  position,
  isPinching,
  squareSize
}: {
  position: [number, number, number];
  isPinching: boolean;
  squareSize: number;
}) {
  const ringRef = useRef<THREE.Mesh>(null);

  useFrame((state) => {
    if (!ringRef.current) {
      return;
    }
    const pulse = 1 + Math.sin(state.clock.elapsedTime * 3) * 0.08;
    const scale = isPinching ? 0.7 : pulse;
    ringRef.current.scale.setScalar(scale);
  });

  return (
    <group position={position}>
      <mesh ref={ringRef}>
        <ringGeometry args={[squareSize * 0.28, squareSize * 0.38, 32]} />
        <meshBasicMaterial
          color={isPinching ? "#22c55e" : "#e86b32"}
          transparent
          opacity={0.85}
          side={THREE.DoubleSide}
        />
      </mesh>
      <mesh position={[0, 0, squareSize * 0.03]}>
        <sphereGeometry args={[squareSize * 0.08, 16, 16]} />
        <meshBasicMaterial color={isPinching ? "#22c55e" : "#e86b32"} />
      </mesh>
    </group>
  );
}

function BoardBase() {
  const totalSize = BOARD_SIZE + BOARD_BORDER * 2;
  const deckZ = -BOARD_DECK_THICKNESS / 2;
  const baseZ = deckZ - BOARD_BASE_THICKNESS / 2;

  return (
    <group>
      <RoundedBox
        args={[totalSize, totalSize, BOARD_BASE_THICKNESS]}
        radius={0.04}
        smoothness={4}
        position={[0.5, 0.5, baseZ]}
        castShadow
        receiveShadow
      >
        <meshStandardMaterial color="#4b2f24" metalness={0.1} roughness={0.85} />
      </RoundedBox>
      <mesh position={[0.5, 0.5, deckZ]} receiveShadow>
        <boxGeometry args={[BOARD_SIZE + 0.02, BOARD_SIZE + 0.02, BOARD_DECK_THICKNESS]} />
        <meshStandardMaterial color="#6a412d" metalness={0.08} roughness={0.75} />
      </mesh>
    </group>
  );
}

function getDragState(state: InteractionState) {
  if (
    state.status === "pinch-start" ||
    state.status === "dragging" ||
    state.status === "release" ||
    state.status === "confirm" ||
    state.status === "commit"
  ) {
    return state;
  }
  return null;
}

function getHoverSquare(state: InteractionState): string | null {
  if (state.status === "hover") {
    return state.overSquare;
  }
  if (state.status === "dragging" && state.overSquare) {
    return state.overSquare;
  }
  if (state.status === "release" && state.toSquare) {
    return state.toSquare;
  }
  if (state.status === "confirm") {
    return state.toSquare;
  }
  return null;
}

function Chess3DScene({
  fen,
  boardPose,
  selectedSquare,
  focusedSquare,
  interactionState,
  cursorBoard,
  cursorInBounds,
  isPinching
}: {
  fen: string;
  boardPose: THREE.Matrix4 | null;
  selectedSquare: string | null;
  focusedSquare: string | null;
  interactionState: InteractionState;
  cursorBoard: { x: number; y: number } | null;
  cursorInBounds: boolean;
  isPinching: boolean;
}) {
  const groupRef = useRef<THREE.Group>(null);
  const pieces = useMemo(() => parseFen(fen), [fen]);

  useEffect(() => {
    if (!groupRef.current || !boardPose) {
      return;
    }
    groupRef.current.matrixAutoUpdate = false;
    groupRef.current.matrix.copy(boardPose);
    groupRef.current.matrixWorldNeedsUpdate = true;
  }, [boardPose]);

  const dragState = getDragState(interactionState);
  const draggingSquare = dragState?.fromSquare ?? null;
  const draggingPiece = draggingSquare ? pieces.get(draggingSquare) : null;

  const dragTarget = useMemo(() => {
    if (!dragState || !draggingSquare) {
      return null;
    }

    if (
      dragState.status === "release" ||
      dragState.status === "confirm" ||
      dragState.status === "commit"
    ) {
      const dropSquare = dragState.toSquare ?? dragState.fromSquare;
      const dropCenter = squareToBoardCenter(dropSquare);
      if (dropCenter) {
        return dropCenter;
      }
    }

    if (cursorBoard) {
      return cursorBoard;
    }

    return squareToBoardCenter(draggingSquare);
  }, [cursorBoard, dragState, draggingSquare]);

  const highlightSquares = useMemo(() => {
    const squares = new Set<string>();
    if (selectedSquare) {
      squares.add(selectedSquare);
    }
    if (focusedSquare) {
      squares.add(focusedSquare);
    }
    if (dragState) {
      squares.add(dragState.fromSquare);
      if ("overSquare" in dragState && dragState.overSquare) {
        squares.add(dragState.overSquare);
      }
      if ("toSquare" in dragState && dragState.toSquare) {
        squares.add(dragState.toSquare);
      }
    }
    return squares;
  }, [dragState, focusedSquare, selectedSquare]);

  const hoverSquare = getHoverSquare(interactionState);

  if (!boardPose) {
    return null;
  }

  return (
    <>
      <ambientLight intensity={0.55} />
      <directionalLight
        position={[1.5, -2.2, 2.4]}
        intensity={1.1}
        castShadow
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
      />
      <directionalLight position={[-1.2, 1.6, 1.5]} intensity={0.35} />
      <pointLight position={[0.5, -0.5, 0.9]} intensity={0.25} />

      <group ref={groupRef}>
        <BoardBase />

        {Array.from({ length: 8 }, (_, row) =>
          Array.from({ length: 8 }, (_, col) => {
            const square = `${FILES[col]}${8 - row}`;
            const x = (col + 0.5) * SQUARE_SIZE;
            const y = (row + 0.5) * SQUARE_SIZE;
            const isDark = (col + row) % 2 === 1;
            const isHighlighted = highlightSquares.has(square);
            const isHovered = hoverSquare === square;

            return (
              <BoardSquare3D
                key={square}
                position={[x, y, SQUARE_SIZE * 0.04]}
                isDark={isDark}
                isHighlighted={isHighlighted}
                isHovered={isHovered}
                size={SQUARE_SIZE}
              />
            );
          })
        )}

        {Array.from(pieces.entries()).map(([square, piece]) => {
          if (draggingSquare === square && draggingPiece) {
            return null;
          }
          const center = squareToBoardCenter(square);
          if (!center) {
            return null;
          }

          return (
            <ChessPiece3D
              key={`${square}-${piece}`}
              piece={piece}
              targetPosition={[center.x, center.y, PIECE_BASE_Z]}
              isSelected={selectedSquare === square}
              isDragging={false}
              isGhost={false}
              squareSize={SQUARE_SIZE}
            />
          );
        })}

        {draggingPiece && draggingSquare && (
          <ChessPiece3D
            key={`dragging-${draggingSquare}`}
            piece={draggingPiece}
            targetPosition={[
              dragTarget?.x ?? 0.5,
              dragTarget?.y ?? 0.5,
              PIECE_BASE_Z + (dragState?.status === "dragging" ? 0.14 : 0.1)
            ]}
            isSelected
            isDragging
            isGhost={false}
            squareSize={SQUARE_SIZE}
          />
        )}

        {draggingPiece &&
          draggingSquare &&
          dragState?.status === "dragging" &&
          dragState.overSquare && (
            <ChessPiece3D
              key={`ghost-${dragState.overSquare}`}
              piece={draggingPiece}
              targetPosition={(() => {
                const target = squareToBoardCenter(dragState.overSquare);
                if (!target) {
                  return [0.5, 0.5, PIECE_BASE_Z] as [number, number, number];
                }
                return [target.x, target.y, PIECE_BASE_Z];
              })()}
              isSelected={false}
              isDragging={false}
              isGhost
              squareSize={SQUARE_SIZE}
            />
          )}

        {cursorBoard && cursorInBounds && (
          <Cursor3D
            position={[cursorBoard.x, cursorBoard.y, PIECE_BASE_Z + 0.12]}
            isPinching={isPinching}
            squareSize={SQUARE_SIZE}
          />
        )}
      </group>
    </>
  );
}

type ChessExperience3DProps = {
  onSwitchTo2D: () => void;
};

export function ChessExperience3D({ onSwitchTo2D }: ChessExperience3DProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const [calibration, setCalibration] = useState<ScreenPoint[]>([]);
  const [isCalibrating, setIsCalibrating] = useState(false);
  const [selectedSquare, setSelectedSquare] = useState<string | null>(null);
  const [focusedSquare, setFocusedSquare] = useState<string>("e2");
  const [practiceLevel, setPracticeLevel] = useState<PracticeLevel>("intermediate");
  const [moveHistory, setMoveHistory] = useState<MoveDTO[]>([]);
  const [coachState, setCoachState] = useState<CoachState | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [showPerfHud, setShowPerfHud] = useState(false);
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 });
  const [interactionState, setInteractionState] = useState<InteractionState>({ status: "idle" });

  const [gameState, setGameState] = useState(() => createInitialGameState());
  const gameStateRef = useRef(gameState);
  const selectedSquareRef = useRef<string | null>(null);
  const interactionRef = useRef<InteractionState>({ status: "idle" });
  const attemptMoveRef = useRef<(from: string, to: string) => Promise<void>>(async () => {});

  const cameraState = useCamera(videoRef, true);
  const engineState = useEngine(true);
  const practiceConfig = PRACTICE_LEVELS[practiceLevel];

  const homography = useMemo(() => {
    if (calibration.length !== 4) {
      return null;
    }
    return computeHomography(BOARD_POINTS, calibration);
  }, [calibration]);

  const inverseHomography = useMemo(() => {
    if (!homography) {
      return null;
    }
    return invertHomography(homography);
  }, [homography]);

  const boardPose = useMemo(() => {
    if (!homography || canvasSize.width === 0 || canvasSize.height === 0) {
      return null;
    }
    return computeBoardPose(homography, canvasSize.width, canvasSize.height, CAMERA_FOV);
  }, [homography, canvasSize]);

  const gestureState = useHandGestures({
    enabled: process.env.NEXT_PUBLIC_DISABLE_HANDS !== "true",
    videoRef,
    inverseHomography,
    onEvent: useCallback(
      (event: Parameters<typeof reduceInteraction>[1]) => {
        const output = reduceInteraction(interactionRef.current, event);

        if (output.proposedMove) {
          const resetState: InteractionState = { status: "idle" };
          interactionRef.current = resetState;
          setInteractionState(resetState);
          void attemptMoveRef.current(output.proposedMove.from, output.proposedMove.to);
          return;
        }

        interactionRef.current = output.state;
        setInteractionState(output.state);
      },
      [attemptMoveRef, interactionRef, setInteractionState]
    )
  });

  const cursorBoard = useMemo(() => {
    if (!gestureState.cursor || !inverseHomography) {
      return null;
    }
    const board = screenToBoard(inverseHomography, gestureState.cursor);
    return {
      x: clamp(board.x, 0, 1),
      y: clamp(board.y, 0, 1),
      inBounds: board.x >= 0 && board.x <= 1 && board.y >= 0 && board.y <= 1
    };
  }, [gestureState.cursor, inverseHomography]);

  useEffect(() => {
    gameStateRef.current = gameState;
  }, [gameState]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const video = videoRef.current;
    if (!canvas || !video) {
      return;
    }

    const ctx = canvas.getContext("2d");
    if (!ctx) {
      return;
    }

    let animationId: number;

    const draw = () => {
      syncCanvasToVideo(canvas, video);
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      if (isCalibrating && calibration.length === 4) {
        const [p0, p1, p2, p3] = calibration;
        if (p0 && p1 && p2 && p3) {
          ctx.save();
          ctx.strokeStyle = "rgba(230, 107, 50, 0.6)";
          ctx.lineWidth = 2;
          ctx.setLineDash([8, 4]);
          ctx.beginPath();
          ctx.moveTo(p0.x, p0.y);
          ctx.lineTo(p1.x, p1.y);
          ctx.lineTo(p2.x, p2.y);
          ctx.lineTo(p3.x, p3.y);
          ctx.closePath();
          ctx.stroke();
          ctx.restore();
        }
      }

      if (gestureState.cursor) {
        ctx.save();
        ctx.fillStyle = "rgba(232, 107, 50, 0.4)";
        ctx.beginPath();
        ctx.arc(gestureState.cursor.x, gestureState.cursor.y, 8, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }

      animationId = requestAnimationFrame(draw);
    };

    draw();
    return () => cancelAnimationFrame(animationId);
  }, [calibration, gestureState.cursor, isCalibrating]);

  useEffect(() => {
    const stored = window.localStorage.getItem("hv_calibration");
    if (stored) {
      try {
        const parsed = JSON.parse(stored) as ScreenPoint[];
        if (Array.isArray(parsed) && parsed.length === 4) {
          setCalibration(parsed);
          return;
        }
      } catch {
        // ignore
      }
    }
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    const observer = new ResizeObserver(() => {
      const rect = container.getBoundingClientRect();
      setCanvasSize({ width: rect.width, height: rect.height });

      if (calibration.length === 0 && rect.width > 0) {
        setCalibration(defaultCalibration(rect.width, rect.height));
      }
    });

    observer.observe(container);
    return () => observer.disconnect();
  }, [calibration.length]);

  useEffect(() => {
    if (calibration.length === 4) {
      window.localStorage.setItem("hv_calibration", JSON.stringify(calibration));
    }
  }, [calibration]);

  const updateSelectedSquare = (square: string | null) => {
    selectedSquareRef.current = square;
    setSelectedSquare(square);
  };

  const attemptMove = async (from: string, to: string) => {
    const currentGame = gameStateRef.current;
    const uci = `${from}${to}`;
    const result = tryMove(currentGame.fen, uci);

    interactionRef.current = { status: "idle" };
    setInteractionState({ status: "idle" });

    if (!result.ok) {
      setStatusMessage(result.reason);
      setTimeout(() => setStatusMessage(null), 2000);
      return;
    }

    setStatusMessage(null);
    updateSelectedSquare(null);
    setFocusedSquare(to);
    setMoveHistory((prev) => [...prev, result.move]);

    const newState = {
      fen: result.fen,
      moveNumber: result.moveNumber,
      turn: result.turn,
      version: currentGame.version
    };

    setGameState(newState);
    gameStateRef.current = newState;

    await handlePracticeResponse(
      currentGame.fen,
      result.fen,
      result.turn,
      result.move.uci,
      engineState.engine,
      practiceConfig
    );
  };

  attemptMoveRef.current = attemptMove;

  const handlePracticeResponse = async (
    fenBeforeUser: string,
    fenAfterUser: string,
    turnAfterUser: "w" | "b",
    userMoveUci: string,
    engine: ChessEngine | null,
    config: PracticeConfig
  ) => {
    if (!engine) {
      return;
    }

    try {
      const analysisOptions = {
        timeMs: config.analysisMs,
        multipv: 1,
        skillLevel: config.skillLevel,
        limitStrength: config.limitStrength,
        elo: config.elo
      };
      const beforeEval = await engine.analyze(fenBeforeUser, analysisOptions);
      const afterEval = await engine.analyze(fenAfterUser, analysisOptions);

      const beforeScore = beforeEval[0]?.cp ?? 0;
      const afterScore = afterEval[0]?.cp ?? 0;
      const sign = turnAfterUser === "w" ? -1 : 1;
      const centipawnLoss = Math.max(0, (beforeScore - afterScore) * sign);

      const feedback = buildCoachFeedback(centipawnLoss);
      const evalAfter = {
        ...(afterEval[0]?.cp !== undefined ? { cp: afterEval[0].cp } : {}),
        ...(afterEval[0]?.mate !== undefined ? { mate: afterEval[0].mate } : {})
      };
      const narrative = buildCoachNarrative({
        fenBefore: fenBeforeUser,
        fenAfter: fenAfterUser,
        userMoveUci,
        bestLine: beforeEval[0]?.pv ?? [],
        replyLine: afterEval[0]?.pv ?? [],
        centipawnLoss,
        evalAfter
      });
      setCoachState({
        label: feedback.label,
        feedback: feedback.message,
        detail: narrative.detail,
        lineSan: narrative.bestLineSan,
        centipawnLoss: feedback.centipawnLoss
      });

      const engineMove = await engine.bestMove(fenAfterUser, {
        timeMs: config.replyMs,
        skillLevel: config.skillLevel,
        limitStrength: config.limitStrength,
        elo: config.elo
      });
      const reply = tryMove(fenAfterUser, engineMove);

      if (reply.ok) {
        const newState = {
          ...gameStateRef.current,
          fen: reply.fen,
          turn: reply.turn,
          moveNumber: reply.moveNumber
        };
        gameStateRef.current = newState;
        setGameState(newState);
        setMoveHistory((prev) => [...prev, reply.move]);
      }
    } catch {
      setStatusMessage("Engine analysis failed");
    }
  };

  const handleBoardClick = (event: React.MouseEvent) => {
    if (!inverseHomography || !containerRef.current) {
      return;
    }

    const rect = containerRef.current.getBoundingClientRect();
    const point = {
      x: rect.width - (event.clientX - rect.left),
      y: event.clientY - rect.top
    };
    const square = screenToSquare(inverseHomography, point);

    if (!square) {
      return;
    }
    setFocusedSquare(square);

    const currentSelection = selectedSquareRef.current;
    const currentGame = gameStateRef.current;

    if (!currentSelection) {
      const piece = getPieceAtSquare(currentGame.fen, square);
      if (piece && isPieceTurn(piece, currentGame.turn)) {
        updateSelectedSquare(square);
      }
      return;
    }

    void attemptMove(currentSelection, square);
  };

  const handleCalibrationDrag = (index: number, event: React.PointerEvent) => {
    if (!containerRef.current) {
      return;
    }
    const rect = containerRef.current.getBoundingClientRect();
    setCalibration((prev) =>
      prev.map((point, i) =>
        i === index ? { x: event.clientX - rect.left, y: event.clientY - rect.top } : point
      )
    );
  };

  const resetGame = () => {
    const initial = createInitialGameState();
    setGameState(initial);
    gameStateRef.current = initial;
    setMoveHistory([]);
    setCoachState(null);
    setStatusMessage(null);
    updateSelectedSquare(null);
    setFocusedSquare("e2");
    const resetState: InteractionState = { status: "idle" };
    interactionRef.current = resetState;
    setInteractionState(resetState);
  };

  return (
    <div className="chess-3d-experience">
      <div className="camera-section-3d">
        <div className="header-3d">
          <div>
            <h1 className="title-3d">HyperVision 3D AR Chess</h1>
            <p className="subtitle-3d">Pinch pieces to lift and move them on the board</p>
          </div>
          <div className="actions-3d">
            <button className="btn-mode" onClick={onSwitchTo2D}>
              Switch to 2D
            </button>
            <button className="btn-calibrate-3d" onClick={() => setIsCalibrating((p) => !p)}>
              {isCalibrating ? "Done" : "Calibrate"}
            </button>
            <button className="btn-reset" onClick={resetGame}>
              Reset
            </button>
            <button className="btn-icon-3d" onClick={() => setShowPerfHud((p) => !p)}>
              {showPerfHud ? "Stats" : "HUD"}
            </button>
          </div>
        </div>

        <div className="ar-container-3d" ref={containerRef} onClick={handleBoardClick}>
          <video ref={videoRef} className="video-3d" playsInline muted />
          <canvas ref={canvasRef} className="canvas-2d-overlay" />

          <div className="canvas-3d-overlay">
            <Canvas
              shadows
              gl={{ alpha: true, antialias: true }}
              camera={{ fov: CAMERA_FOV, near: 0.01, far: 50, position: [0, 0, 0] }}
              style={{ background: "transparent" }}
            >
              <Chess3DScene
                fen={gameState.fen}
                boardPose={boardPose}
                selectedSquare={selectedSquare}
                focusedSquare={focusedSquare}
                interactionState={interactionState}
                cursorBoard={cursorBoard ? { x: cursorBoard.x, y: cursorBoard.y } : null}
                cursorInBounds={cursorBoard?.inBounds ?? false}
                isPinching={gestureState.pinchActive}
              />
            </Canvas>
          </div>

          <PerfHud
            fps={gestureState.fps}
            latencyMs={gestureState.latencyMs}
            visible={showPerfHud}
          />

          {isCalibrating && (
            <div className="calibration-3d">
              {calibration.map((point, index) => (
                <div
                  key={`corner-${index}`}
                  className="handle-3d"
                  style={{ left: point.x - 12, top: point.y - 12 }}
                  onPointerDown={(e) => e.currentTarget.setPointerCapture(e.pointerId)}
                  onPointerMove={(e) => e.buttons === 1 && handleCalibrationDrag(index, e)}
                />
              ))}
              <div className="calibration-hint">Drag corners to align with your board</div>
            </div>
          )}
        </div>

        <div className="controls-3d">
          <div className="control-group-3d">
            <span className="label-3d">Difficulty</span>
            <div className="pills-3d">
              {(Object.keys(PRACTICE_LEVELS) as PracticeLevel[]).map((level) => (
                <button
                  key={level}
                  className={`pill-3d ${practiceLevel === level ? "active" : ""}`}
                  onClick={() => setPracticeLevel(level)}
                >
                  {PRACTICE_LEVELS[level].label}
                </button>
              ))}
            </div>
          </div>
          <div className="control-group-3d">
            <span className="label-3d">Status</span>
            <div className="status-3d">
              <span className={`dot-3d ${cameraState.status === "ready" ? "on" : ""}`} />
              <span>Camera</span>
              <span className={`dot-3d ${engineState.ready ? "on" : ""}`} />
              <span>Engine</span>
              <span className={`dot-3d ${gestureState.fps > 0 ? "on" : ""}`} />
              <span>Hand</span>
            </div>
          </div>
          <div className="control-group-3d turn-indicator">
            <span className="label-3d">Turn</span>
            <span className={`turn-badge ${gameState.turn === "w" ? "white" : "black"}`}>
              {gameState.turn === "w" ? "White" : "Black"}
            </span>
          </div>
        </div>
      </div>

      <div className="panel-3d">
        {coachState && (
          <div className="coach-3d">
            <h3>Coach</h3>
            <div className="coach-card-3d">
              <div className="coach-label-3d">{coachState.label}</div>
              <div className="coach-msg">{coachState.feedback}</div>
              {coachState.detail && <div className="coach-detail-3d">{coachState.detail}</div>}
              <div className="cpl-3d">CPL: {coachState.centipawnLoss.toFixed(0)}</div>
              {coachState.lineSan && coachState.lineSan.length > 0 && (
                <div className="coach-line-3d">
                  Line: {coachState.lineSan.slice(0, 3).join(" ")}
                </div>
              )}
            </div>
          </div>
        )}

        <div className="moves-3d">
          <h3>Moves</h3>
          <div className="move-list-3d">
            {moveHistory.length === 0 ? (
              <span className="empty-3d">No moves yet</span>
            ) : (
              moveHistory.map((move, i) => (
                <span key={`${move.uci}-${i}`} className="move-3d">
                  {i % 2 === 0 && <span className="num-3d">{Math.floor(i / 2) + 1}.</span>}
                  {move.san}
                </span>
              ))
            )}
          </div>
        </div>

        {statusMessage && <div className="error-3d">{statusMessage}</div>}

        <div className="instructions-3d">
          <h3>How to Play</h3>
          <ul>
            <li>Pinch a piece to lift it</li>
            <li>Move your hand across the board</li>
            <li>Release to drop the piece</li>
            <li>Tap squares as a fallback</li>
          </ul>
        </div>
      </div>

      <style jsx>{`
        .chess-3d-experience {
          display: grid;
          grid-template-columns: 1fr 300px;
          gap: 20px;
          max-width: 1500px;
          margin: 0 auto;
          padding: 16px;
        }

        @media (max-width: 1000px) {
          .chess-3d-experience {
            grid-template-columns: 1fr;
            padding: 12px;
          }
        }

        .camera-section-3d {
          background: rgba(15, 15, 18, 0.98);
          border-radius: 16px;
          overflow: hidden;
          box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
        }

        .header-3d {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 14px 18px;
          border-bottom: 1px solid rgba(255, 255, 255, 0.1);
          flex-wrap: wrap;
          gap: 12px;
        }

        .title-3d {
          font-family: var(--font-display);
          font-size: 1.3rem;
          color: #fff;
          margin: 0;
        }

        .subtitle-3d {
          font-size: 0.75rem;
          color: rgba(255, 255, 255, 0.5);
          margin: 2px 0 0;
        }

        .actions-3d {
          display: flex;
          gap: 8px;
          flex-wrap: wrap;
        }

        .btn-mode,
        .btn-reset {
          background: rgba(255, 255, 255, 0.1);
          border: none;
          color: white;
          padding: 8px 14px;
          border-radius: 8px;
          cursor: pointer;
          font-size: 0.85rem;
          transition: background 0.2s;
        }

        .btn-mode:hover,
        .btn-reset:hover {
          background: rgba(255, 255, 255, 0.2);
        }

        .btn-calibrate-3d {
          background: var(--color-ember, #e5542b);
          border: none;
          color: white;
          padding: 8px 14px;
          border-radius: 8px;
          cursor: pointer;
          font-weight: 500;
        }

        .btn-icon-3d {
          background: rgba(255, 255, 255, 0.1);
          border: none;
          padding: 8px 12px;
          border-radius: 8px;
          cursor: pointer;
          font-size: 0.8rem;
        }

        .ar-container-3d {
          position: relative;
          aspect-ratio: 16 / 10;
          min-height: 500px;
          background: #000;
        }

        .video-3d {
          position: absolute;
          inset: 0;
          width: 100%;
          height: 100%;
          object-fit: contain;
          transform: scaleX(-1);
        }

        .canvas-2d-overlay {
          position: absolute;
          inset: 0;
          width: 100%;
          height: 100%;
          pointer-events: none;
          transform: scaleX(-1);
        }

        .canvas-3d-overlay {
          position: absolute;
          inset: 0;
          pointer-events: none;
          transform: scaleX(-1);
        }

        .calibration-3d {
          position: absolute;
          inset: 0;
          z-index: 20;
        }

        .handle-3d {
          position: absolute;
          width: 24px;
          height: 24px;
          background: var(--color-ember, #e5542b);
          border: 3px solid white;
          border-radius: 50%;
          cursor: grab;
          box-shadow: 0 2px 8px rgba(0, 0, 0, 0.4);
          z-index: 25;
        }

        .handle-3d:active {
          cursor: grabbing;
          transform: scale(1.1);
        }

        .calibration-hint {
          position: absolute;
          bottom: 20px;
          left: 50%;
          transform: translateX(-50%);
          background: rgba(0, 0, 0, 0.8);
          color: white;
          padding: 10px 20px;
          border-radius: 8px;
          font-size: 0.85rem;
        }

        .controls-3d {
          display: flex;
          gap: 20px;
          padding: 14px 18px;
          border-top: 1px solid rgba(255, 255, 255, 0.08);
          flex-wrap: wrap;
        }

        .control-group-3d {
          display: flex;
          align-items: center;
          gap: 10px;
        }

        .label-3d {
          font-size: 0.7rem;
          text-transform: uppercase;
          color: rgba(255, 255, 255, 0.4);
          letter-spacing: 0.5px;
        }

        .pills-3d {
          display: flex;
          gap: 4px;
          background: rgba(255, 255, 255, 0.05);
          padding: 3px;
          border-radius: 8px;
        }

        .pill-3d {
          background: transparent;
          border: none;
          color: rgba(255, 255, 255, 0.6);
          padding: 6px 12px;
          border-radius: 6px;
          cursor: pointer;
          font-size: 0.8rem;
          transition: all 0.2s;
        }

        .pill-3d:hover {
          color: white;
        }

        .pill-3d.active {
          background: var(--color-ember, #e5542b);
          color: white;
        }

        .status-3d {
          display: flex;
          align-items: center;
          gap: 6px;
          font-size: 0.8rem;
          color: rgba(255, 255, 255, 0.5);
        }

        .dot-3d {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          background: rgba(255, 255, 255, 0.2);
        }

        .dot-3d.on {
          background: #22c55e;
          box-shadow: 0 0 6px #22c55e;
        }

        .turn-indicator {
          margin-left: auto;
        }

        .turn-badge {
          padding: 4px 12px;
          border-radius: 6px;
          font-size: 0.8rem;
          font-weight: 600;
        }

        .turn-badge.white {
          background: #f0f0e8;
          color: #1a1a1a;
        }

        .turn-badge.black {
          background: #1a1a1a;
          color: #f0f0e8;
        }

        .panel-3d {
          display: flex;
          flex-direction: column;
          gap: 14px;
        }

        .coach-3d,
        .moves-3d,
        .instructions-3d {
          background: rgba(255, 255, 255, 0.95);
          border-radius: 12px;
          padding: 16px;
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
        }

        .coach-3d h3,
        .moves-3d h3,
        .instructions-3d h3 {
          font-family: var(--font-display);
          font-size: 1rem;
          margin: 0 0 10px;
          color: #1a1a1a;
        }

        .coach-card-3d {
          background: linear-gradient(135deg, #f0fdf4, #dcfce7);
          border-radius: 10px;
          padding: 12px;
          font-size: 0.85rem;
        }

        .coach-label-3d {
          font-size: 0.7rem;
          text-transform: uppercase;
          color: var(--color-moss, #22c55e);
          font-weight: 600;
          margin-bottom: 4px;
        }

        .coach-msg {
          color: #333;
          line-height: 1.4;
        }

        .coach-detail-3d {
          margin-top: 6px;
          font-size: 0.78rem;
          color: #2b2b2b;
          line-height: 1.4;
        }

        .cpl-3d {
          font-size: 0.75rem;
          color: #666;
          margin-top: 8px;
        }

        .coach-line-3d {
          margin-top: 6px;
          font-size: 0.75rem;
          color: var(--color-moss, #22c55e);
        }

        .move-list-3d {
          display: flex;
          flex-wrap: wrap;
          gap: 4px 10px;
          font-family: "SF Mono", Monaco, monospace;
          font-size: 0.85rem;
          max-height: 200px;
          overflow-y: auto;
        }

        .empty-3d {
          color: #888;
          font-family: var(--font-sans);
          font-style: italic;
        }

        .num-3d {
          color: #888;
          margin-right: 2px;
        }

        .move-3d {
          color: #1a1a1a;
        }

        .error-3d {
          background: #fef2f2;
          color: #dc2626;
          padding: 12px;
          border-radius: 10px;
          font-size: 0.85rem;
          border-left: 4px solid #dc2626;
        }

        .instructions-3d ul {
          margin: 0;
          padding-left: 18px;
          font-size: 0.85rem;
          color: #555;
          line-height: 1.6;
        }

        .instructions-3d li {
          margin-bottom: 4px;
        }
      `}</style>
    </div>
  );
}

function getPieceAtSquare(fen: string, square: string): string | null {
  const pieces = parseFen(fen);
  return pieces.get(square) || null;
}

function isPieceTurn(piece: string, turn: "w" | "b"): boolean {
  const isWhite = piece === piece.toUpperCase();
  return (isWhite && turn === "w") || (!isWhite && turn === "b");
}
