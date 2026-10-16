import type { Instrumentation } from "next";

// =====================================================================
// INSTRUMENTATION: feeds the error log (/errors). On the Node server,
// console errors and warnings are copied to it, and every uncaught
// server error (page render, route, server action, proxy) is written
// with where it happened. See lib/errors/errorLog.ts.
// =====================================================================

export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { captureConsole } = await import("@/lib/errors/errorLog");
  captureConsole();
}

export const onRequestError: Instrumentation.onRequestError = async (error, request, context) => {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { describeError, logError } = await import("@/lib/errors/errorLog");
  const { message, stack } = describeError(error);
  const digest = typeof error === "object" && error !== null && "digest" in error ? String(error.digest) : null;
  await logError({ source: "server", location: `${context.routeType} ${context.routePath}`, path: `${request.method} ${request.path}`, message, stack, digest });
};
