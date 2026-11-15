// 1x1 transparent PNG
export const PNG_1PX = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  "base64",
);

// a name the upload middleware could have generated
export const UPLOADED_NAME = "0b7c2f9e-4a1d-4c3b-8e5f-6a7b8c9d0e1f.webp";

export const fakeMediaStorage = () => ({
  putObject: jest.fn().mockResolvedValue(undefined),
  deleteObject: jest.fn().mockResolvedValue(undefined),
  objectExists: jest.fn().mockResolvedValue(true),
  getSignedReadUrl: jest.fn(),
  getObject: jest.fn().mockResolvedValue(null),
});
