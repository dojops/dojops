/**
 * Voice input module — local speech-to-text via whisper.cpp + SoX audio recording.
 *
 * Dependencies:
 * - `rec` (from SoX) — audio recording to WAV (system package)
 * - whisper.cpp binary (`whisper-cli`) — speech-to-text (via `dojops toolchain install whisper-cpp` or system)
 * - A whisper.cpp model file (e.g. ggml-base.en.bin)
 *
 * Configuration:
 * - DOJOPS_WHISPER_BIN: path to whisper binary (auto-detected via toolchain + PATH)
 * - DOJOPS_WHISPER_MODEL: path to .bin model file (defaults to ~/.dojops/voice/ggml-base.en.bin)
 */

import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { resolveBinary } from "./preflight.js";

export interface VoiceConfig {
  whisperBin: string;
  modelPath: string;
  recBin: string;
}

/** Names to search for the whisper.cpp binary (toolchain sandbox first, then PATH). */
const WHISPER_BIN_NAMES = ["whisper-cli", "whisper-cpp", "whisper", "main"];

/** Default model filename when auto-resolving. */
const DEFAULT_MODEL = "ggml-base.en.bin";

function findWhisperBin(): string | undefined {
  const envBin = process.env.DOJOPS_WHISPER_BIN;
  if (envBin) {
    return fs.existsSync(envBin) ? envBin : undefined;
  }
  // resolveBinary checks ~/.dojops/toolchain/bin/ first, then system PATH
  for (const name of WHISPER_BIN_NAMES) {
    const found = resolveBinary(name);
    if (found) return found;
  }
  return undefined;
}

function findModelPath(): string | undefined {
  const envModel = process.env.DOJOPS_WHISPER_MODEL;
  if (envModel) {
    return fs.existsSync(envModel) ? envModel : undefined;
  }
  // Check default locations: global first, then project-scoped, then common system paths
  const candidates = [path.join(os.homedir(), ".dojops", "voice", DEFAULT_MODEL)];

  // Also check project-scoped .dojops/voice/ (walk up from cwd)
  let dir = process.cwd();
  const root = path.parse(dir).root;
  while (dir !== root) {
    const projectModel = path.join(dir, ".dojops", "voice", DEFAULT_MODEL);
    if (!candidates.includes(projectModel)) candidates.push(projectModel);
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  candidates.push(
    path.join(os.homedir(), ".local", "share", "whisper.cpp", "models", DEFAULT_MODEL),
    path.join(os.homedir(), "whisper.cpp", "models", DEFAULT_MODEL),
  );
  return candidates.find((c) => fs.existsSync(c));
}

function findRecBin(): string | undefined {
  // SoX is a system package — resolve via toolchain + PATH
  return resolveBinary("rec") ?? resolveBinary("sox");
}

export interface VoiceStatus {
  available: boolean;
  recBin?: string;
  whisperBin?: string;
  modelPath?: string;
  missing: string[];
}

/** Check if voice input dependencies are available. */
export function checkVoiceAvailability(): VoiceStatus {
  const recBin = findRecBin();
  const whisperBin = findWhisperBin();
  const modelPath = findModelPath();
  const missing: string[] = [];

  if (!recBin) missing.push("sox (provides `rec` command for audio recording)");
  if (!whisperBin) missing.push("whisper.cpp binary (run: dojops toolchain install whisper-cpp)");
  if (!modelPath)
    missing.push(`whisper model (${DEFAULT_MODEL} — auto-downloaded with whisper-cpp install)`);

  return {
    available: missing.length === 0,
    recBin,
    whisperBin,
    modelPath,
    missing,
  };
}

/** Resolve voice config or throw with helpful error messages. */
export function resolveVoiceConfig(): VoiceConfig {
  const status = checkVoiceAvailability();
  if (!status.available) {
    const lines = ["Voice input requires:"];
    for (const m of status.missing) lines.push(`  - ${m}`);
    lines.push(
      "",
      "Install whisper.cpp: dojops toolchain install whisper-cpp",
      "Install SoX:         brew install sox (macOS) / apt install sox (Linux)",
    );
    throw new Error(lines.join("\n"));
  }
  return {
    whisperBin: status.whisperBin!,
    modelPath: status.modelPath!,
    recBin: status.recBin!,
  };
}

/**
 * Interactive recording — spawns `rec` as a child process and waits for
 * Enter key or Ctrl+C to stop. Temporarily hijacks SIGINT so that
 * Ctrl+C only kills the recording, not the parent process (chat session).
 */
export function recordAudioInteractive(
  config: VoiceConfig,
  opts?: { maxSeconds?: number },
): Promise<string> {
  const tmpFile = path.join(os.tmpdir(), `dojops-voice-${Date.now()}.wav`);
  const maxSec = opts?.maxSeconds ?? 30;

  const child = spawn(
    config.recBin,
    ["-r", "16000", "-c", "1", "-b", "16", tmpFile, "trim", "0", String(maxSec)],
    {
      stdio: ["pipe", "pipe", "pipe"],
    },
  );

  return new Promise<string>((resolve, reject) => {
    // Save existing SIGINT listeners and replace with one that only kills the child
    const savedSigint = process.listeners("SIGINT").slice();
    process.removeAllListeners("SIGINT");

    let stdinCleanup: (() => void) | undefined;

    function stopChild(): void {
      if (!child.killed) child.kill("SIGTERM");
    }

    function cleanup(): void {
      process.removeAllListeners("SIGINT");
      for (const fn of savedSigint) {
        process.on("SIGINT", fn as NodeJS.SignalsListener);
      }
      if (stdinCleanup) stdinCleanup();
    }

    process.on("SIGINT", stopChild);

    // Listen for Enter key or Ctrl+C on stdin (TTY only)
    if (process.stdin.isTTY) {
      const wasRaw = process.stdin.isRaw;
      const wasPaused = process.stdin.isPaused();
      process.stdin.setRawMode(true);
      process.stdin.resume();
      const onData = (data: Buffer): void => {
        const key = data[0];
        // Enter (CR/LF), Space, or Ctrl+C (0x03)
        if (key === 0x0d || key === 0x0a || key === 0x20 || key === 0x03) {
          stopChild();
        }
      };
      process.stdin.on("data", onData);
      stdinCleanup = () => {
        process.stdin.removeListener("data", onData);
        try {
          process.stdin.setRawMode(wasRaw);
        } catch {
          /* non-fatal */
        }
        if (wasPaused) process.stdin.pause();
      };
    }

    child.on("close", () => {
      cleanup();
      if (fs.existsSync(tmpFile)) {
        resolve(tmpFile);
      } else {
        reject(new Error("Recording failed — no audio captured."));
      }
    });

    child.on("error", (err) => {
      cleanup();
      reject(err);
    });
  });
}

/**
 * Transcribe an audio file using whisper.cpp.
 * Returns the transcribed text.
 */
export function transcribe(config: VoiceConfig, audioPath: string): string {
  try {
    const output = execFileSync(
      config.whisperBin,
      [
        "-m",
        config.modelPath,
        "-f",
        audioPath,
        "--no-timestamps",
        "--print-special",
        "false",
        "-otxt",
      ],
      {
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"],
        timeout: 60_000, // 60s max for transcription
      },
    );

    // whisper.cpp outputs text to stdout — clean it up
    return output.trim();
  } catch (err) {
    // Some whisper builds write to a .txt file instead of stdout
    const txtPath = audioPath.replace(/\.wav$/, ".txt");
    if (fs.existsSync(txtPath)) {
      const text = fs.readFileSync(txtPath, "utf-8").trim();
      fs.unlinkSync(txtPath);
      return text;
    }
    throw new Error(`Transcription failed: ${err instanceof Error ? err.message : String(err)}`, {
      cause: err,
    });
  } finally {
    // Clean up the audio file
    try {
      if (fs.existsSync(audioPath)) fs.unlinkSync(audioPath);
    } catch {
      // Non-fatal
    }
  }
}

/**
 * Full voice input flow: record (interactive) + transcribe.
 * Returns the transcribed text, or empty string if nothing was captured.
 */
export async function voiceInput(config: VoiceConfig, maxSeconds?: number): Promise<string> {
  const audioPath = await recordAudioInteractive(config, { maxSeconds });
  const text = transcribe(config, audioPath);
  return text;
}
