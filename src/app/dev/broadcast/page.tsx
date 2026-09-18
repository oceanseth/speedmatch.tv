import { notFound } from "next/navigation";
import BroadcastLoopbackHarness from "./BroadcastLoopbackHarness";

/**
 * Dev-only harness for the spectator video pipeline: records the local
 * camera through the real BroadcastRecorder into an in-memory "bucket"
 * and plays it back through the real BroadcastViewer, so the whole
 * capture→upload→manifest→player loop is exercisable before the server
 * mint/manifest routes exist. Not part of the product; 404s in prod.
 */
export default function BroadcastDevPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <BroadcastLoopbackHarness />;
}
