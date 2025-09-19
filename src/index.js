import { Container, getContainer } from "@cloudflare/containers";

export class KokoroContainer extends Container {
  defaultPort = 8080; // Kokoro Web Docker image uses 8080
  sleepAfter = "10m"; // Optional: stop if not used for 10min
}

export default {
  async fetch(request, env, ctx) {
    // Each user could get a unique container instance if desired (by session)
    // For stateless/one global instance, just use a constant as key:
    const instance = getContainer(env.KOKORO_CONTAINER, "global");
    // Proxy the request to the container instance
    return instance.fetch(request);
  },
};
