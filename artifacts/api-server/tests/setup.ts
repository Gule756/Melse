const testDatabaseUrl = process.env.TEST_DATABASE_URL;

if (testDatabaseUrl) {
  process.env.DATABASE_URL = testDatabaseUrl;
} else if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = "postgres://localhost/melse_unit_tests";
}
