import OpenAI from "openai";
import { generateVoice } from "$lib/shared/kokoro";
import type { ProfileData } from "./store.svelte";
import umami from "$lib/client/umami";

export interface GeneratedAudioResult {
  objectUrl: string;
  blob: Blob;
  mimeType: string;
  extension: "mp3" | "wav";
}

/**
 * Generate runs the text to speech generation process both in the browser
 * and in the API.
 */
export async function generate(
  profile: ProfileData,
  overrides?: Partial<Pick<ProfileData, "text" | "format">>,
): Promise<GeneratedAudioResult> {
  umami.track("generate", {
    lang: profile.lang,
    voiceMode: profile.voiceMode,
    voiceFormula: profile.voiceFormula,
    model: profile.model,
    speed: profile.speed,
    format: overrides?.format ?? profile.format,
    acceleration: profile.acceleration,
    executionPlace: profile.executionPlace,
  });

  const text = overrides?.text ?? profile.text;
  const format = overrides?.format ?? profile.format;

  if (profile.executionPlace === "browser") {
    const result = await generateVoice({
      text,
      lang: profile.lang,
      voiceFormula: profile.voiceFormula,
      model: profile.model,
      speed: profile.speed,
      format,
      acceleration: profile.acceleration,
    });

    const resBlob = new Blob([result.buffer], { type: result.mimeType });
    const url = URL.createObjectURL(resBlob);

    return {
      objectUrl: url,
      blob: resBlob,
      mimeType: result.mimeType,
      extension: result.mimeType === "audio/wav" ? "wav" : "mp3",
    };
  }

  const openai = new OpenAI({
    dangerouslyAllowBrowser: true,
    baseURL: profile.apiBaseUrl,
    apiKey: profile.apiKey,
  });

  const mp3 = await openai.audio.speech.create({
    input: text,
    voice: profile.voiceFormula as OpenAI.Audio.SpeechCreateParams["voice"],
    model: profile.model,
    speed: profile.speed,
    response_format: format,
  });

  const mimeType = format === "wav" ? "audio/wav" : "audio/mpeg";
  const resBlob = new Blob([await mp3.arrayBuffer()], { type: mimeType });
  const url = URL.createObjectURL(resBlob);

  return {
    objectUrl: url,
    blob: resBlob,
    mimeType,
    extension: format,
  };
}
