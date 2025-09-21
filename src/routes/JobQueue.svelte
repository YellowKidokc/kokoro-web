<script lang="ts">
  import { onDestroy } from "svelte";
  import AudioPlayer from "$lib/client/components/AudioPlayer.svelte";
  import { toaster } from "$lib/client/toaster";
  import { generate, type GeneratedAudioResult } from "./generate";
  import { profile } from "./store.svelte";

  type JobStatus = "idle" | "processing" | "completed" | "error";
  type Destination = "browser" | "cloudflare";

  interface Job {
    id: number;
    title: string;
    text: string;
    status: JobStatus;
    audioUrl: string | null;
    mimeType: string | null;
    extension: "mp3" | "wav";
    storageKey?: string;
    error?: string;
  }

  const maxJobs = 10;

  let jobs = $state<Job[]>(
    Array.from({ length: maxJobs }, (_, index) => ({
      id: index + 1,
      title: "",
      text: "",
      status: "idle" as JobStatus,
      audioUrl: null,
      mimeType: null,
      extension: "mp3",
    })),
  );

  let autoDestination = $state<Destination>("browser");
  let queueRunning = $state(false);
  let cancelRequested = $state(false);
  let hasQueuedJobs = $derived(jobs.some((job) => job.text.trim().length > 0));

  function updateJob(index: number, updater: (job: Job) => Job) {
    const original = jobs[index];
    if (!original) return;

    const updated = updater(original);

    if (original.audioUrl && original.audioUrl !== updated.audioUrl) {
      URL.revokeObjectURL(original.audioUrl);
    }

    jobs = jobs.map((job, idx) => (idx === index ? updated : job));
  }

  function handleTitleChange(index: number, value: string) {
    updateJob(index, (job) => ({ ...job, title: value }));
  }

  function handleTextChange(index: number, value: string) {
    updateJob(index, (job) => ({
      ...job,
      text: value,
      status: "idle",
      audioUrl: null,
      mimeType: null,
      storageKey: undefined,
      error: undefined,
      extension: profile.format,
    }));
  }

  function clearJob(index: number) {
    updateJob(index, (job) => ({
      ...job,
      title: "",
      text: "",
      status: "idle",
      audioUrl: null,
      mimeType: null,
      storageKey: undefined,
      error: undefined,
      extension: profile.format,
    }));
  }

  function useProfileText(index: number) {
    handleTextChange(index, profile.text);
  }

  function createFileName(job: Job, extension: "mp3" | "wav") {
    const base = job.title.trim() || `job-${job.id}`;
    const slug = base
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
    const safeSlug = slug || `job-${job.id}`;
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    return `${timestamp}-${safeSlug}.${extension}`;
  }

  function triggerBrowserDownload(result: GeneratedAudioResult, fileName: string) {
    const link = document.createElement("a");
    link.href = result.objectUrl;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  async function uploadToCloudflare(
    result: GeneratedAudioResult,
    fileName: string,
  ): Promise<string | undefined> {
    const headers: Record<string, string> = {
      "Content-Type": result.mimeType,
      "X-File-Name": fileName,
    };

    if (profile.apiKey) {
      headers["Authorization"] = `Bearer ${profile.apiKey}`;
    }

    const response = await fetch("/api/v1/storage/audio", {
      method: "POST",
      headers,
      body: result.blob,
    });

    const rawText = await response.text();

    if (!response.ok) {
      let message = rawText;
      try {
        const parsed = JSON.parse(rawText);
        message = parsed.message ?? message;
      } catch (error) {
        // Ignore parse errors, fall back to raw text
      }
      throw new Error(message || `Storage request failed (${response.status})`);
    }

    if (!rawText) return undefined;

    try {
      const parsed = JSON.parse(rawText);
      return parsed.key as string | undefined;
    } catch (error) {
      return undefined;
    }
  }

  async function processJob(index: number) {
    const job = jobs[index];
    if (!job) return;
    if (!job.text.trim()) return;

    updateJob(index, (current) => ({
      ...current,
      status: "processing",
      error: undefined,
      storageKey: undefined,
    }));

    let result: GeneratedAudioResult | null = null;

    try {
      result = await generate(profile, { text: job.text });
      const fileName = createFileName(job, result.extension);

      if (autoDestination === "browser") {
        triggerBrowserDownload(result, fileName);
      } else {
        try {
          const key = await uploadToCloudflare(result, fileName);
          if (key) {
            toaster.success(`Stored ${fileName} in Cloudflare storage`);
          }
          updateJob(index, (current) => ({
            ...current,
            storageKey: key,
          }));
        } catch (error: any) {
          throw new Error(error?.message ?? "Failed to store in Cloudflare");
        }
      }

      updateJob(index, (current) => ({
        ...current,
        status: "completed",
        audioUrl: result.objectUrl,
        mimeType: result.mimeType,
        extension: result.extension,
      }));
    } catch (error: any) {
      if (result?.objectUrl) {
        URL.revokeObjectURL(result.objectUrl);
      }

      const message = error?.message ?? "An error occurred";
      updateJob(index, (current) => ({
        ...current,
        status: "error",
        error: message,
      }));
      toaster.error(message);
    }
  }

  async function runQueue() {
    if (queueRunning) return;

    cancelRequested = false;
    queueRunning = true;

    for (let index = 0; index < jobs.length; index += 1) {
      if (cancelRequested) break;
      const job = jobs[index];
      if (!job.text.trim()) {
        continue;
      }

      await processJob(index);
    }

    queueRunning = false;
    cancelRequested = false;
  }

  function stopQueue() {
    if (!queueRunning) return;
    cancelRequested = true;
  }

  onDestroy(() => {
    jobs.forEach((job) => {
      if (job.audioUrl) {
        URL.revokeObjectURL(job.audioUrl);
      }
    });
  });
</script>

<div class="space-y-4">
  <div class="rounded-box border border-base-content/20 p-4">
    <h3 class="text-lg font-semibold">Automatic delivery</h3>
    <p class="text-sm opacity-80">
      Generate up to {maxJobs} jobs and automatically download them in your browser or
      push them to Cloudflare storage once each job finishes.
    </p>

    <div class="mt-4 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
      <div class="space-y-1">
        <span class="text-sm font-medium">Destination</span>
        <div class="flex flex-wrap items-center gap-4">
          <label class="flex items-center gap-2 text-sm">
            <input
              type="radio"
              class="radio"
              name="destination"
              value="browser"
              bind:group={autoDestination}
            />
            Browser download
          </label>
          <label class="flex items-center gap-2 text-sm">
            <input
              type="radio"
              class="radio"
              name="destination"
              value="cloudflare"
              bind:group={autoDestination}
            />
            Cloudflare storage
          </label>
        </div>
      </div>

      {#if autoDestination === "cloudflare"}
        <p class="text-sm text-warning">
          Requires the <code>AUDIO_JOBS_BUCKET</code> R2 binding in Wrangler and a valid API key.
        </p>
      {/if}
    </div>

    <div class="mt-4 flex flex-wrap items-center gap-2">
      <button
        class="btn btn-primary"
        onclick={runQueue}
        disabled={queueRunning || !hasQueuedJobs}
      >
        Start queue
      </button>
      <button class="btn btn-soft" onclick={stopQueue} disabled={!queueRunning}>
        Stop queue
      </button>
    </div>
  </div>

  <div class="grid gap-4 md:grid-cols-2">
    {#each jobs as job, index}
      <div class="rounded-box border border-base-content/20 p-4 space-y-3">
        <div class="flex items-center justify-between">
          <div class="space-y-0.5">
            <span class="text-sm font-semibold">Job {job.id}</span>
            <span class="text-xs uppercase tracking-wide opacity-70">
              {job.status === "processing"
                ? "Processing"
                : job.status === "completed"
                ? "Completed"
                : job.status === "error"
                ? "Error"
                : "Ready"}
            </span>
          </div>
          <div class="flex items-center gap-2">
            <button class="btn btn-xs btn-soft" onclick={() => useProfileText(index)}>
              Use input text
            </button>
            <button class="btn btn-xs btn-ghost" onclick={() => clearJob(index)}>
              Clear
            </button>
          </div>
        </div>

        <input
          class="input input-bordered w-full"
          type="text"
          placeholder="Optional title"
          value={job.title}
          oninput={(event) => handleTitleChange(index, (event.target as HTMLInputElement).value)}
        />

        <textarea
          class="textarea textarea-bordered w-full"
          rows={6}
          placeholder="Paste the text to narrate..."
          value={job.text}
          oninput={(event) => handleTextChange(index, (event.target as HTMLTextAreaElement).value)}
        ></textarea>

        {#if job.status === "error" && job.error}
          <p class="text-sm text-error">{job.error}</p>
        {/if}

        {#if job.status === "completed" && job.audioUrl}
          <div class="space-y-2">
            <AudioPlayer audioUrl={job.audioUrl} showSpectrogram={false} />
            {#if job.storageKey}
              <p class="text-xs">
                Stored in Cloudflare as <code>{job.storageKey}</code>
              </p>
            {/if}
          </div>
        {/if}
      </div>
    {/each}
  </div>
</div>
