import { initializeApp, getApps } from "firebase/app";
import { connectAuthEmulator, getAuth, signInAnonymously } from "firebase/auth";
import {
  connectFirestoreEmulator,
  doc,
  getFirestore,
  onSnapshot,
  setDoc
} from "firebase/firestore";
import { connectFunctionsEmulator, getFunctions, httpsCallable } from "firebase/functions";

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY ?? "demo-key",
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN ?? "demo.local",
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? "hypervision-demo",
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID ?? "hypervision-demo-app",
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET ?? "",
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_SENDER_ID ?? ""
};

let cachedServices: {
  auth: ReturnType<typeof getAuth>;
  firestore: ReturnType<typeof getFirestore>;
  functions: ReturnType<typeof getFunctions>;
} | null = null;
let emulatorConnected = false;

export function getFirebaseApp() {
  const existing = getApps()[0];
  if (existing) {
    return existing;
  }
  return initializeApp(firebaseConfig);
}

export function getFirebaseServices() {
  if (cachedServices) {
    return cachedServices;
  }

  const app = getFirebaseApp();
  const auth = getAuth(app);
  const firestore = getFirestore(app);
  const functions = getFunctions(app);

  if (process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATOR === "true" && !emulatorConnected) {
    const authPort = Number(process.env.NEXT_PUBLIC_AUTH_EMULATOR_PORT ?? 9099);
    const firestorePort = Number(process.env.NEXT_PUBLIC_FIRESTORE_EMULATOR_PORT ?? 8085);
    const functionsPort = Number(process.env.NEXT_PUBLIC_FUNCTIONS_EMULATOR_PORT ?? 5001);

    connectAuthEmulator(auth, `http://localhost:${authPort}`, { disableWarnings: true });
    connectFirestoreEmulator(firestore, "localhost", firestorePort);
    connectFunctionsEmulator(functions, "localhost", functionsPort);
    emulatorConnected = true;
  }

  cachedServices = { auth, firestore, functions };
  return cachedServices;
}

export async function ensureAnonymousAuth() {
  const { auth } = getFirebaseServices();
  if (!auth.currentUser) {
    await signInAnonymously(auth);
  }
}

export { doc, onSnapshot, setDoc, httpsCallable };
