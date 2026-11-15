import type { Readable } from "stream";

export type PutObjectInput = {
  key: string;
  body: Buffer;
  contentLength: number;
  contentType?: string;
};

export type StoredObject = {
  body: Readable;
  contentType?: string;
  contentLength?: number;
  etag?: string;
};

export interface ObjectStorage {
  putObject(input: PutObjectInput): Promise<void>;
  deleteObject(key: string): Promise<void>;
  objectExists(key: string): Promise<boolean>;
  getSignedReadUrl(key: string, ttlSeconds: number): Promise<string>;
  // null when the key does not exist
  getObject(key: string): Promise<StoredObject | null>;
}
