import { Container, getContainer } from "@cloudflare/containers";
import type {
  DurableObjectNamespace,
  DurableObjectState,
} from "cloudflare:workers";

interface WorkerEnv {
  KOKORO_CONTAINER: DurableObjectNamespace<any>;
  KW_SECRET_API_KEY?: string;
  KW_PUBLIC_NO_TRACK?: string;
}

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
    const instance = getContainer(env.KOKORO_CONTAINER, "global");

    try {
      return await instance.fetch(request);
    } catch (error) {
      console.error("Container fetch failed", error);
      return new Response("Service temporarily unavailable", { status: 502 });
    }
  },
};
