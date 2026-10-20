export {};

declare global {
  namespace Express {
    interface Request {
      auth?: { id: number; role: string };
      advisorRequester?: { kind: "guest" | "user"; key: string };
    }
  }
}
