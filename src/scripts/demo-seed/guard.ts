const LOCAL_DB_HOSTS = new Set(["localhost", "127.0.0.1", "mysql"]);

export const assertDemoSeedAllowed = (input: {
  nodeEnv: string;
  databaseUrl: string;
  allowRemote: boolean;
}) => {
  if (input.nodeEnv === "production")
    throw new Error("seed:demo is disabled when NODE_ENV=production");
  const host = new URL(input.databaseUrl).hostname;
  if (!LOCAL_DB_HOSTS.has(host) && !input.allowRemote)
    throw new Error(
      `seed:demo wipes the database and refuses host "${host}"; set DEMO_SEED_ALLOW_REMOTE=true to override`,
    );
};
