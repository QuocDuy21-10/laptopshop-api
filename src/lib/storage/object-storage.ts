export type PutObjectInput = {
  key: string;
  body: Buffer;
  contentLength: number;
  contentType?: string;
};

export interface ObjectStorage {
  putObject(input: PutObjectInput): Promise<void>;
  deleteObject(key: string): Promise<void>;
  objectExists(key: string): Promise<boolean>;
  getSignedReadUrl(key: string, ttlSeconds: number): Promise<string>;
}
