export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? "mysql://root:test@127.0.0.1:3307/laptopshop_test";

if (!new URL(TEST_DATABASE_URL).pathname.endsWith("_test")) {
  throw new Error(
    `Refusing to run integration tests on ${TEST_DATABASE_URL}: name must end in _test`,
  );
}
