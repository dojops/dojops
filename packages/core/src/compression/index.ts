export {
  compressOutput,
  compressCILog,
  compressScannerOutput,
  stripAnsi,
  deduplicateLines,
} from "./output-compressor";
export type { CompressOptions, CompressResult } from "./output-compressor";
export { compressSourceCode, compressFileContents } from "./language-compressor";
export type { LanguageCompressResult, CompressedFile } from "./language-compressor";
