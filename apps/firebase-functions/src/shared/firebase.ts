import { getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

export function getAdminApp() {
  if (!getApps().length) {
    initializeApp();
  }
  return getApps()[0];
}

export function getDb() {
  getAdminApp();
  return getFirestore();
}
