import session from "express-session";
import { createApp } from "../../src/app";

export const buildApp = () => createApp({ sessionStore: new session.MemoryStore() });
