import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface SynthesizedSpeech {
  readonly bytes: Uint8Array;
  readonly contentType: 'audio/wav';
  readonly filename: string;
  readonly durationMs: number;
}

export interface SpeechSynthesizer {
  synthesize(text: string): Promise<SynthesizedSpeech>;
}

export interface SpeechRunnerRequest {
  readonly executable: string;
  readonly args: readonly string[];
  /** Kept separate so tests can prove untrusted text is never a command arg. */
  readonly text: string;
}

export interface WindowsSapiSpeechOptions {
  readonly voiceName?: string;
  readonly rate?: number;
  readonly runner?: (request: SpeechRunnerRequest) => Promise<Uint8Array>;
}

export function readWavDurationMs(bytes: Uint8Array): number {
  if (bytes.byteLength < 44) throw new Error('invalid WAV: header is too short');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const byteRate = view.getUint32(28, true);
  let offset = 12;
  while (offset + 8 <= bytes.byteLength) {
    const chunkId = String.fromCharCode(bytes[offset]!, bytes[offset + 1]!, bytes[offset + 2]!, bytes[offset + 3]!);
    const chunkSize = view.getUint32(offset + 4, true);
    if (chunkId === 'data') {
      if (byteRate === 0) throw new Error('invalid WAV: byte rate is zero');
      return Math.round((chunkSize / byteRate) * 1000);
    }
    offset += 8 + chunkSize + (chunkSize % 2);
  }
  throw new Error('invalid WAV: data chunk not found');
}

export class WindowsSapiSpeechAdapter implements SpeechSynthesizer {
  private readonly runner: (request: SpeechRunnerRequest) => Promise<Uint8Array>;

  public constructor(private readonly options: WindowsSapiSpeechOptions = {}) {
    this.runner = options.runner ?? runWindowsSapi;
  }

  public async synthesize(text: string): Promise<SynthesizedSpeech> {
    if (!text.trim()) throw new Error('speech text is required');
    const scriptPath = fileURLToPath(new URL('../scripts/synthesize-sapi.ps1', import.meta.url));
    const rate = Math.max(-10, Math.min(10, Math.trunc(this.options.rate ?? 0)));
    const args = [
      '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
      '-File', scriptPath,
      '-Rate', String(rate),
    ];
    if (this.options.voiceName) args.push('-VoiceName', this.options.voiceName);
    const bytes = await this.runner({ executable: 'powershell.exe', args, text });
    return {
      bytes,
      contentType: 'audio/wav',
      filename: `companion-${Date.now()}.wav`,
      durationMs: readWavDurationMs(bytes),
    };
  }
}

async function runWindowsSapi(request: SpeechRunnerRequest): Promise<Uint8Array> {
  const taskDir = await mkdtemp(join(tmpdir(), 'dsh-sapi-'));
  const textPath = join(taskDir, 'input.txt');
  const outputPath = join(taskDir, 'output.wav');
  try {
    await writeFile(textPath, request.text, 'utf8');
    const args = [...request.args, '-TextFile', textPath, '-OutputFile', outputPath];
    await new Promise<void>((resolve, reject) => {
      const child = spawn(request.executable, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
      const stderr: Uint8Array[] = [];
      child.stderr.on('data', (chunk: Uint8Array) => stderr.push(chunk));
      child.on('error', reject);
      child.on('exit', (code) => {
        if (code === 0) resolve();
        else reject(new Error(`Windows SAPI synthesis failed (${code}): ${Buffer.concat(stderr).toString('utf8')}`));
      });
    });
    return new Uint8Array(await readFile(outputPath));
  } finally {
    await rm(taskDir, { recursive: true, force: true });
  }
}

