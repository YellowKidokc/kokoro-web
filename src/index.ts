import { Container, getContainer } from "@cloudflare/containers";
import type {
  DurableObjectNamespace,
  DurableObjectState,
  R2Bucket,
} from "cloudflare:workers";

interface WorkerEnv {
  KOKORO_CONTAINER: DurableObjectNamespace<any>;
  KW_SECRET_API_KEY?: string;
  KW_PUBLIC_NO_TRACK?: string;
  AUDIO_JOBS_BUCKET?: R2Bucket;
}

const JSON_HEADERS = {
  "content-type": "application/json",
};

export class KokoroContainer extends Container<WorkerEnv> {
  defaultPort = 8080;
  sleepAfter = "10m";

  constructor(state: DurableObjectState, env: WorkerEnv) {
    super(state, env);

    this.envVars = {
      ...this.envVars,
      ...(env.KW_SECRET_API_KEY
        ? { KW_SECRET_API_KEY: env.KW_SECRET_API_KEY }
        : {}),
      ...(env.KW_PUBLIC_NO_TRACK
        ? { KW_PUBLIC_NO_TRACK: env.KW_PUBLIC_NO_TRACK }
        : {}),
    };
  }
}

export default {
  async fetch(request: Request, env: WorkerEnv): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/api/v1/storage/audio" && request.method === "POST") {
      return handleStorageUpload(request, env);
    }

    const instance = getContainer(env.KOKORO_CONTAINER, "global");

    try {
      return await instance.fetch(request);
    } catch (error) {
      console.error("Container fetch failed", error);
      return new Response("Service temporarily unavailable", { status: 502 });
    }
  },
};

function sanitizeFileName(name: string): string {
  const trimmed = name.trim();
  const replacedWhitespace = trimmed.replace(/\s+/g, "-");
  const sanitized = replacedWhitespace.replace(/[^a-zA-Z0-9._-]+/g, "");
  return sanitized.length > 0 ? sanitized : "audio";
}

function checkAuthorization(request: Request, env: WorkerEnv): Response | null {
  if (!env.KW_SECRET_API_KEY) {
    return null;
  }

  const header = request.headers.get("Authorization");
  if (!header) {
    return new Response(JSON.stringify({ message: "Authorization header is missing" }), {
      status: 401,
      headers: JSON_HEADERS,
    });
  }

  const token = header.replace(/Bearer\s+/i, "");
  if (token !== env.KW_SECRET_API_KEY) {
    return new Response(JSON.stringify({ message: "Unauthorized" }), {
      status: 401,
      headers: JSON_HEADERS,
    });
  }

  return null;
}

async function handleStorageUpload(request: Request, env: WorkerEnv): Promise<Response> {
  const unauthorized = checkAuthorization(request, env);
  if (unauthorized) {
    return unauthorized;
  }

  if (!env.AUDIO_JOBS_BUCKET) {
    return new Response(JSON.stringify({ message: "Audio storage is not configured" }), {
      status: 503,
      headers: JSON_HEADERS,
    });
  }

  try {
    const contentType = request.headers.get("content-type") ?? "application/octet-stream";
    const providedName = request.headers.get("x-file-name") ?? "audio";
    const safeName = sanitizeFileName(providedName);
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const key = `${timestamp}-${safeName}`;
    const body = await request.arrayBuffer();

    await env.AUDIO_JOBS_BUCKET.put(key, body, {
      httpMetadata: {
        contentType,
      },
    });

    return new Response(JSON.stringify({ key }), {
      status: 200,
      headers: JSON_HEADERS,
    });
  } catch (error) {
    console.error("Audio storage failed", error);
    return new Response(JSON.stringify({ message: "Failed to persist audio" }), {
      status: 500,
      headers: JSON_HEADERS,
    });
  }
}
