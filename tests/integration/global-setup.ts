import { execSync } from "child_process";
import { TEST_DATABASE_URL } from "./db-url";

export default async () => {
  execSync("pnpm exec prisma migrate deploy", {
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL },
  });
};
