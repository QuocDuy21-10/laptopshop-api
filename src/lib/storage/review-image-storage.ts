export type PutReviewImageObject = {
  key: string;
  body: Buffer;
  contentLength: number;
};

export interface ReviewImageStorage {
  putObject(input: PutReviewImageObject): Promise<void>;
  deleteObject(key: string): Promise<void>;
  objectExists(key: string): Promise<boolean>;
  getSignedReadUrl(key: string, ttlSeconds: number): Promise<string>;
}
