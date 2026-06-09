import { existsSync, openSync, readFileSync, readSync, statSync, closeSync } from "node:fs";
import { join } from "node:path";

const ROOT_STATE_ID = 0;
const INVALID_CODE = 0xffffffff;

export interface SurfaceMatcherOptions {
  stateCacheBlocks?: number;
  outputCacheBlocks?: number;
  qidCacheBlocks?: number;
  mapCacheBlocks?: number;
  blockBytes?: number;
  captureSurface?: boolean;
  captureWindowUtf16?: number;
}

export interface RuntimeManifest {
  format: string;
  endian: "little";
  mode: "charwise";
  state_record_bytes: number;
  state_output_record_bytes: number;
  qid_index_record_bytes: number;
  states_len: number;
  surface_count: number;
  state_output_count: number;
  mapper_table_len: number;
  files: {
    char_code_map: string;
    states: string;
    state_outputs: string;
    qid_index: string;
    qid_values: string;
  };
}

export interface SurfaceMatch {
  start: number;
  end: number;
  utf16Length: number;
  surface?: string;
  surfaceId: number;
  qids: string[];
  qidNumbers: number[];
}

interface StateRecord {
  base: number;
  check: number;
  fail: number;
  outputPos: number;
}

interface OutputRecord {
  surfaceId: number;
  utf16Length: number;
  parentOutputPos: number;
}

export class SurfaceMatcher {
  readonly rootDir: string;
  readonly manifest: RuntimeManifest;

  private readonly charCodeMap: U32Table;
  private readonly states: RecordTable;
  private readonly stateOutputs: RecordTable;
  private readonly qidIndex: RecordTable;
  private readonly qidValues: U32Table;
  private readonly captureSurface: boolean;
  private readonly captureWindowUtf16: number;

  static exists(rootDir: string): boolean {
    return existsSync(join(rootDir, "manifest.json"));
  }

  static open(rootDir: string, options: SurfaceMatcherOptions = {}): SurfaceMatcher {
    return new SurfaceMatcher(rootDir, options);
  }

  private constructor(rootDir: string, options: SurfaceMatcherOptions) {
    this.rootDir = rootDir;
    this.manifest = readRuntimeManifest(rootDir);
    validateManifest(this.manifest);
    this.captureSurface = options.captureSurface ?? true;
    this.captureWindowUtf16 = options.captureWindowUtf16 ?? 4096;

    const blockBytes = options.blockBytes ?? 64 * 1024;
    this.charCodeMap = new U32Table(
      join(rootDir, this.manifest.files.char_code_map),
      options.mapCacheBlocks ?? 4,
      blockBytes,
    );
    this.states = new RecordTable(
      join(rootDir, this.manifest.files.states),
      this.manifest.state_record_bytes,
      options.stateCacheBlocks ?? 64,
      blockBytes,
    );
    this.stateOutputs = new RecordTable(
      join(rootDir, this.manifest.files.state_outputs),
      this.manifest.state_output_record_bytes,
      options.outputCacheBlocks ?? 16,
      blockBytes,
    );
    this.qidIndex = new RecordTable(
      join(rootDir, this.manifest.files.qid_index),
      this.manifest.qid_index_record_bytes,
      options.qidCacheBlocks ?? 16,
      blockBytes,
    );
    this.qidValues = new U32Table(
      join(rootDir, this.manifest.files.qid_values),
      options.qidCacheBlocks ?? 16,
      blockBytes,
    );
  }

  *scan(chunks: Iterable<string>): Generator<SurfaceMatch> {
    let stateId = ROOT_STATE_ID;
    let end = 0;
    let recentText = "";
    let recentStart = 0;

    for (const char of iterateCodePoints(chunks)) {
      stateId = this.nextStateId(stateId, char.codePointAt(0) ?? 0);
      end += char.length;

      if (this.captureSurface) {
        recentText += char;
        if (recentText.length > this.captureWindowUtf16) {
          const excess = recentText.length - this.captureWindowUtf16;
          recentText = recentText.slice(excess);
          recentStart += excess;
        }
      }

      const state = this.readState(stateId);
      for (const output of this.readOutputChain(state.outputPos)) {
        const start = end - output.utf16Length;
        const qidNumbers = this.readQidNumbers(output.surfaceId);
        const surface =
          this.captureSurface && start >= recentStart
            ? recentText.slice(start - recentStart, end - recentStart)
            : undefined;
        const match: SurfaceMatch = {
          start,
          end,
          utf16Length: output.utf16Length,
          surfaceId: output.surfaceId,
          qidNumbers,
          qids: qidNumbers.map((qid) => `Q${qid}`),
        };
        if (surface !== undefined) {
          match.surface = surface;
        }
        yield match;
      }
    }
  }

  scanCharacters(chars: Iterable<string>): Generator<SurfaceMatch> {
    return this.scan(chars);
  }

  close(): void {
    this.charCodeMap.close();
    this.states.close();
    this.stateOutputs.close();
    this.qidIndex.close();
    this.qidValues.close();
  }

  private nextStateId(initialStateId: number, codePoint: number): number {
    const mappedCode = this.readMappedCode(codePoint);
    if (mappedCode === undefined) {
      return ROOT_STATE_ID;
    }

    let stateId = initialStateId;
    while (true) {
      const childId = this.childStateId(stateId, mappedCode);
      if (childId !== undefined) {
        return childId;
      }
      if (stateId === ROOT_STATE_ID) {
        return ROOT_STATE_ID;
      }
      stateId = this.readState(stateId).fail;
    }
  }

  private childStateId(stateId: number, mappedCode: number): number | undefined {
    const base = this.readState(stateId).base;
    if (base === 0) {
      return undefined;
    }

    const childId = (base ^ mappedCode) >>> 0;
    if (childId >= this.manifest.states_len) {
      return undefined;
    }
    return this.readState(childId).check === stateId ? childId : undefined;
  }

  private readMappedCode(codePoint: number): number | undefined {
    if (codePoint < 0 || codePoint >= this.manifest.mapper_table_len) {
      return undefined;
    }
    const mapped = this.charCodeMap.read(codePoint);
    return mapped === INVALID_CODE ? undefined : mapped;
  }

  private readState(stateId: number): StateRecord {
    const offset = this.states.byteOffset(stateId);
    return {
      base: this.states.readU32At(offset),
      check: this.states.readU32At(offset + 4),
      fail: this.states.readU32At(offset + 8),
      outputPos: this.states.readU32At(offset + 12),
    };
  }

  private *readOutputChain(outputPos: number): Generator<OutputRecord> {
    let current = outputPos;
    while (current !== 0) {
      const outputId = current - 1;
      const offset = this.stateOutputs.byteOffset(outputId);
      const output = {
        surfaceId: this.stateOutputs.readU32At(offset),
        utf16Length: this.stateOutputs.readU32At(offset + 4),
        parentOutputPos: this.stateOutputs.readU32At(offset + 8),
      };
      yield output;
      current = output.parentOutputPos;
    }
  }

  private readQidNumbers(surfaceId: number): number[] {
    const offset = this.qidIndex.byteOffset(surfaceId);
    const qidOffset = this.qidIndex.readU32At(offset);
    const qidLength = this.qidIndex.readU32At(offset + 4);
    const qids: number[] = [];
    for (let index = 0; index < qidLength; index += 1) {
      qids.push(this.qidValues.read(qidOffset + index));
    }
    return qids;
  }
}

function readRuntimeManifest(rootDir: string): RuntimeManifest {
  return JSON.parse(readFileSync(join(rootDir, "manifest.json"), "utf8")) as RuntimeManifest;
}

function validateManifest(manifest: RuntimeManifest): void {
  if (manifest.format !== "wikipage-spine-runtime-v1") {
    throw new Error(`unsupported runtime format: ${manifest.format}`);
  }
  if (manifest.endian !== "little") {
    throw new Error(`unsupported runtime endian: ${manifest.endian}`);
  }
  if (manifest.mode !== "charwise") {
    throw new Error(`unsupported runtime mode: ${manifest.mode}`);
  }
  if (manifest.state_record_bytes !== 16) {
    throw new Error(`unsupported state record size: ${manifest.state_record_bytes}`);
  }
  if (manifest.state_output_record_bytes !== 12) {
    throw new Error(`unsupported state output record size: ${manifest.state_output_record_bytes}`);
  }
  if (manifest.qid_index_record_bytes !== 8) {
    throw new Error(`unsupported qid index record size: ${manifest.qid_index_record_bytes}`);
  }
}

function* iterateCodePoints(chunks: Iterable<string>): Generator<string> {
  let pendingHighSurrogate = "";
  for (const chunk of chunks) {
    let text = pendingHighSurrogate + chunk;
    pendingHighSurrogate = "";
    if (text.length === 0) {
      continue;
    }
    const last = text.charCodeAt(text.length - 1);
    if (last >= 0xd800 && last <= 0xdbff) {
      pendingHighSurrogate = text[text.length - 1] ?? "";
      text = text.slice(0, -1);
    }
    for (const char of text) {
      yield char;
    }
  }
  if (pendingHighSurrogate.length > 0) {
    yield pendingHighSurrogate;
  }
}

class U32Table {
  private readonly file: CachedFile;

  constructor(path: string, cacheBlocks: number, blockBytes: number) {
    this.file = new CachedFile(path, cacheBlocks, blockBytes);
  }

  read(index: number): number {
    return this.file.readU32(index * 4);
  }

  close(): void {
    this.file.close();
  }
}

class RecordTable {
  private readonly file: CachedFile;

  constructor(path: string, private readonly recordBytes: number, cacheBlocks: number, blockBytes: number) {
    this.file = new CachedFile(path, cacheBlocks, blockBytes);
  }

  byteOffset(recordId: number): number {
    return recordId * this.recordBytes;
  }

  readU32At(offset: number): number {
    return this.file.readU32(offset);
  }

  close(): void {
    this.file.close();
  }
}

class CachedFile {
  private readonly fd: number;
  private readonly size: number;
  private readonly cache = new Map<number, Buffer>();

  constructor(path: string, private readonly maxBlocks: number, private readonly blockBytes: number) {
    this.fd = openSync(path, "r");
    this.size = statSync(path).size;
  }

  readU32(offset: number): number {
    if (offset < 0 || offset + 4 > this.size) {
      throw new Error(`read outside table bounds at byte offset ${offset}`);
    }
    const blockId = Math.floor(offset / this.blockBytes);
    const blockOffset = offset - blockId * this.blockBytes;
    const block = this.readBlock(blockId);
    if (blockOffset + 4 > block.length) {
      const bytes = Buffer.allocUnsafe(4);
      const bytesRead = readSync(this.fd, bytes, 0, 4, offset);
      if (bytesRead !== 4) {
        throw new Error(`short read at byte offset ${offset}`);
      }
      return bytes.readUInt32LE(0);
    }
    return block.readUInt32LE(blockOffset);
  }

  close(): void {
    closeSync(this.fd);
    this.cache.clear();
  }

  private readBlock(blockId: number): Buffer {
    const cached = this.cache.get(blockId);
    if (cached !== undefined) {
      this.cache.delete(blockId);
      this.cache.set(blockId, cached);
      return cached;
    }

    const start = blockId * this.blockBytes;
    const bytesToRead = Math.min(this.blockBytes, this.size - start);
    const block = Buffer.allocUnsafe(bytesToRead);
    const bytesRead = readSync(this.fd, block, 0, bytesToRead, start);
    if (bytesRead !== bytesToRead) {
      throw new Error(`short read at byte offset ${start}`);
    }

    if (this.maxBlocks > 0) {
      this.cache.set(blockId, block);
      while (this.cache.size > this.maxBlocks) {
        const oldestKey = this.cache.keys().next().value as number | undefined;
        if (oldestKey === undefined) {
          break;
        }
        this.cache.delete(oldestKey);
      }
    }
    return block;
  }
}
