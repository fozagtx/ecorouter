import assert from "node:assert/strict";
import { after, test } from "node:test";
import { Pool } from "pg";
import { PostgresUpstreams } from "../dist/index.js";

const pool = process.env.DATABASE_URL ? new Pool({ connectionString: process.env.DATABASE_URL }) : undefined;
after(async () => pool?.end());

test("Postgres upstreams persist records and return only connected ids", { skip: !pool }, async () => {
  const store = new PostgresUpstreams(pool);
  await store.initialize();
  const record = {
    id: `gateway-test-${Date.now()}`,
    kind: "api",
    url: "https://upstream.example",
    auth_header: "Bearer private-test-token",
    seller: "G".repeat(56),
  };
  await store.put(record);
  try {
    assert.deepEqual(await store.get(record.id), record);
    assert.deepEqual([...await store.listConnected([record.id, "missing"])], [record.id]);
  } finally {
    await pool.query("DELETE FROM upstreams WHERE id = $1", [record.id]);
  }
});
