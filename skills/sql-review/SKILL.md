---
name: sql-review
description: "Reviews or writes SQL for correctness, performance, and the footguns that corrupt data or take a table offline. Use when writing a query, reviewing a migration, or before running an UPDATE or DELETE against production."
user-invocable: true
---

# sql-review

The dangerous SQL is the SQL that runs fine in dev and wrong in prod: a DELETE that matches every row, a JOIN that fans out, a migration that locks a table for ten minutes. This skill catches those before they ship.

## When to use

Writing a non-trivial query, reviewing a migration, or about to run a write statement against real data.

## Before any UPDATE or DELETE

Run the WHERE clause as a SELECT first. The count it returns is the number of rows you are about to change.

```sql
-- Don't run this yet:
DELETE FROM orders WHERE status = 'cancelld';   -- typo: matches 0 rows, or the wrong ones

-- Run this first:
SELECT count(*) FROM orders WHERE status = 'cancelld';
```

If the count surprises you, stop. The count is a sanity check, not a lock — rows can change between the SELECT and the write. The transaction is what lets you back out:

```sql
BEGIN;
DELETE FROM orders WHERE status = 'cancelled';
-- read the row count it reports, then:
COMMIT;   -- or ROLLBACK; if it's wrong
```

## Correctness

- **NULL is not a value.** `col = NULL` is never true — use `IS NULL`. `NOT IN (subquery)` returns nothing if the subquery yields a single NULL.
- **JOIN fan-out.** A one-to-many JOIN multiplies rows, and now your `SUM` is wrong. Check the grain before you aggregate.
- **GROUP BY.** Every non-aggregated column in the SELECT must be in the GROUP BY.
- **Implicit casts.** Comparing a string column to a number can scan the whole table or match nothing.

## Performance

```sql
EXPLAIN ANALYZE <your query>;
```

`EXPLAIN ANALYZE` runs the query to get real timings — on an UPDATE, DELETE, or INSERT that means it actually writes. Use plain `EXPLAIN` for those, or wrap it in a transaction you `ROLLBACK`.

Read it for:

- **Seq Scan on a large table** where you expected an index — the WHERE column isn't indexed, or a function wraps it (`WHERE lower(email) = ...` can't use a plain index on `email`).
- **Nested loops over large row counts** — usually a missing index on the join key.
- `SELECT *` in anything that runs often — name the columns you need.
- No `LIMIT` on a query that feeds a UI.

## Migrations

- Adding a column with a default: a *constant* default is a fast metadata change on modern Postgres (11+) and MySQL 8, but a *volatile* default (a function call) still rewrites the whole table. Check your engine and version, and backfill large tables in batches.
- Creating an index locks writes unless you use the concurrent form (`CREATE INDEX CONCURRENTLY` on Postgres) — which can't run inside a transaction and leaves an invalid index behind if it fails, so check for one afterward. MySQL/InnoDB and SQL Server have their own online-DDL forms.
- Write the rollback statement before you run the migration, not after it fails.

## Output

When reviewing, lead with anything that can lose data or lock a table. Performance notes come second. Quote the line and give the corrected SQL, not just the diagnosis.
