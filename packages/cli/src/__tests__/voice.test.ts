import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";

vi.mock("node:child_process", () => ({
  execFileSync: vi.fn(),
  spawn: vi.fn(),
}));

vi.mock("node:fs", async () => {
  const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
  return {
    ...actual,
    default: {
      ...actual,
      existsSync: vi.fn(),
      readFileSync: vi.fn(),
      unlinkSync: vi.fn(),
    },
    existsSync: vi.fn(),
    readFileSync: vi.fn(),
    unlinkSync: vi.fn(),
  };
});

// Mock resolveBinary from preflight — controls toolchain + PATH resolution
const mockResolveBinary = vi.fn<(name: string) => string | undefined>();
vi.mock("../preflight", () => ({
  resolveBinary: (...args: unknown[]) => mockResolveBinary(args[0] as string),
}));

import { checkVoiceAvailability, resolveVoiceConfig, transcribe } from "../voice";

const mockExecFileSync = vi.mocked(execFileSync);
const mockExistsSync = vi.mocked(fs.existsSync);

beforeEach(() => {
  vi.resetAllMocks();
  delete process.env.DOJOPS_WHISPER_BIN;
  delete process.env.DOJOPS_WHISPER_MODEL;
});

afterEach(() => {
  delete process.env.DOJOPS_WHISPER_BIN;
  delete process.env.DOJOPS_WHISPER_MODEL;
});

describe("checkVoiceAvailability", () => {
  it("reports all missing when nothing is installed", () => {
    mockResolveBinary.mockReturnValue(undefined);
    mockExistsSync.mockReturnValue(false);

    const status = checkVoiceAvailability();
    expect(status.available).toBe(false);
    expect(status.missing).toHaveLength(3);
    expect(status.missing[0]).toContain("sox");
    expect(status.missing[1]).toContain("whisper");
    expect(status.missing[2]).toContain("model");
  });

  it("reports available when all deps found via toolchain", () => {
    // resolveBinary calls: rec -> found, whisper-cli -> found
    mockResolveBinary.mockImplementation((name: string) => {
      if (name === "rec") return "/home/user/.dojops/toolchain/bin/rec";
      if (name === "whisper-cli") return "/home/user/.dojops/toolchain/bin/whisper-cli";
      return undefined;
    });

    // Model path via env var
    process.env.DOJOPS_WHISPER_MODEL = "/path/to/model.bin";
    mockExistsSync.mockReturnValue(true);

    const status = checkVoiceAvailability();
    expect(status.available).toBe(true);
    expect(status.missing).toHaveLength(0);
    expect(status.recBin).toBe("/home/user/.dojops/toolchain/bin/rec");
    expect(status.whisperBin).toBe("/home/user/.dojops/toolchain/bin/whisper-cli");
  });

  it("uses DOJOPS_WHISPER_BIN env var over toolchain resolution", () => {
    process.env.DOJOPS_WHISPER_BIN = "/custom/whisper";
    process.env.DOJOPS_WHISPER_MODEL = "/custom/model.bin";
    mockResolveBinary.mockImplementation((name: string) => {
      if (name === "rec") return "/usr/bin/rec";
      return undefined;
    });
    mockExistsSync.mockReturnValue(true);

    const status = checkVoiceAvailability();
    expect(status.whisperBin).toBe("/custom/whisper");
  });

  it("finds model in default ~/.dojops/voice/ location", () => {
    mockResolveBinary.mockImplementation((name: string) => {
      if (name === "rec") return "/usr/bin/rec";
      if (name === "whisper-cli") return "/usr/local/bin/whisper-cli";
      return undefined;
    });
    // existsSync: first two model candidates false, third true
    mockExistsSync.mockImplementation((p: fs.PathLike) => {
      return String(p).includes(".dojops/voice/ggml-base.en.bin");
    });

    const status = checkVoiceAvailability();
    expect(status.available).toBe(true);
    expect(status.modelPath).toContain(".dojops/voice/ggml-base.en.bin");
  });
});

describe("resolveVoiceConfig", () => {
  it("throws with helpful message when deps missing", () => {
    mockResolveBinary.mockReturnValue(undefined);
    mockExistsSync.mockReturnValue(false);

    expect(() => resolveVoiceConfig()).toThrow("Voice input requires:");
  });

  it("mentions toolchain install in error message", () => {
    mockResolveBinary.mockReturnValue(undefined);
    mockExistsSync.mockReturnValue(false);

    expect(() => resolveVoiceConfig()).toThrow("dojops toolchain install whisper-cpp");
  });

  it("returns config when all deps available", () => {
    process.env.DOJOPS_WHISPER_BIN = "/usr/local/bin/whisper-cli";
    process.env.DOJOPS_WHISPER_MODEL = "/models/ggml-base.en.bin";
    mockResolveBinary.mockImplementation((name: string) => {
      if (name === "rec") return "/usr/bin/rec";
      return undefined;
    });
    mockExistsSync.mockReturnValue(true);

    const config = resolveVoiceConfig();
    expect(config.whisperBin).toBe("/usr/local/bin/whisper-cli");
    expect(config.modelPath).toBe("/models/ggml-base.en.bin");
    expect(config.recBin).toBe("/usr/bin/rec");
  });
});

describe("transcribe", () => {
  const config = {
    whisperBin: "/usr/local/bin/whisper-cli",
    modelPath: "/models/ggml-base.en.bin",
    recBin: "/usr/bin/rec",
  };

  it("returns transcribed text from stdout", () => {
    mockExecFileSync.mockReturnValueOnce("  Hello world  \n" as never);
    mockExistsSync.mockReturnValue(false); // no .txt fallback needed

    const text = transcribe(config, "/tmp/audio.wav");
    expect(text).toBe("Hello world");
    expect(mockExecFileSync).toHaveBeenCalledWith(
      "/usr/local/bin/whisper-cli",
      expect.arrayContaining(["-m", "/models/ggml-base.en.bin", "-f", "/tmp/audio.wav"]),
      expect.any(Object),
    );
  });

  it("falls back to .txt file when stdout is empty", () => {
    mockExecFileSync.mockImplementationOnce(() => {
      throw new Error("whisper error");
    });
    mockExistsSync
      .mockReturnValueOnce(true) // .txt file exists
      .mockReturnValueOnce(true); // cleanup: audio file exists
    vi.mocked(fs.readFileSync).mockReturnValueOnce("Fallback text\n" as never);

    const text = transcribe(config, "/tmp/audio.wav");
    expect(text).toBe("Fallback text");
  });

  it("throws when transcription fails and no .txt fallback", () => {
    mockExecFileSync.mockImplementationOnce(() => {
      throw new Error("whisper crash");
    });
    mockExistsSync.mockReturnValue(false); // no .txt file

    expect(() => transcribe(config, "/tmp/audio.wav")).toThrow("Transcription failed");
  });
});
