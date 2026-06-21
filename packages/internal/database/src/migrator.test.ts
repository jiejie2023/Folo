import type { SQL } from "drizzle-orm"
import { describe, expect, test } from "vitest"

import { migrate } from "./migrator"

const getQueryText = (query: SQL): string => {
  const { queryChunks } = query as unknown as {
    queryChunks: Array<{ value?: string[] }>
  }

  return queryChunks.flatMap((chunk) => chunk.value ?? []).join("")
}

describe("sqlite proxy migrator", () => {
  test("skips duplicate ADD COLUMN statements without failing the migration", async () => {
    const executedQueries: string[] = []
    const config: Parameters<typeof migrate>[1] = {
      journal: {
        version: "7",
        dialect: "sqlite",
        entries: [
          {
            idx: 39,
            version: "6",
            when: 1781362357434,
            tag: "0039_local_first_subscriptions",
            breakpoints: true,
          },
        ],
      },
      migrations: {
        m0039: [
          "ALTER TABLE `subscriptions` ADD `synced` integer DEFAULT 0 NOT NULL;",
          "UPDATE `subscriptions` SET `source` = 'local' WHERE `source` = 'cloud';",
        ].join("--> statement-breakpoint"),
      },
    }
    const db = {
      run: async (query: SQL) => {
        const text = getQueryText(query)

        if (text.includes("ADD `synced`")) {
          throw new Error("duplicate column name: synced")
        }

        executedQueries.push(text)
      },
      values: async <TResult extends unknown[]>(query: SQL): Promise<TResult[]> => {
        const text = getQueryText(query)

        if (text.includes('FROM "__drizzle_migrations"')) {
          return [[38, "", "1781327562760"]] as unknown as TResult[]
        }

        if (text.startsWith("PRAGMA table_info")) {
          return [
            [0, "id"],
            [1, "synced"],
          ] as unknown as TResult[]
        }

        return []
      },
    }

    await expect(migrate(db, config)).resolves.toBeUndefined()

    expect(executedQueries.some((query) => query.includes("ADD `synced`"))).toBe(false)
    expect(
      executedQueries.some((query) =>
        query.includes("UPDATE `subscriptions` SET `source` = 'local'"),
      ),
    ).toBe(true)
  })
})
