import pg from 'pg';

const DEFAULT_DATABASE_URL = 'postgres://tengo:tengo@localhost:5432/tenders';

const INT8_OID = 20;
const DATE_OID = 1082;

// Identity columns are bigint; tender ids stay far below Number.MAX_SAFE_INTEGER.
pg.types.setTypeParser(INT8_OID, Number);
// Keep calendar dates as YYYY-MM-DD rather than a Date at the server's local midnight.
pg.types.setTypeParser(DATE_OID, (value) => value);

export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL,
});

export async function withTransaction<T>(work: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    // A failed rollback (typically a broken connection) must not hide the error that caused it.
    await client
      .query('ROLLBACK')
      .catch((rollbackError: unknown) => console.error('ROLLBACK failed:', rollbackError));
    throw error;
  } finally {
    client.release();
  }
}
