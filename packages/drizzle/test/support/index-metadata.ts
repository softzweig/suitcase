import { SQL } from "drizzle-orm";

/** The index fields the postgres and sqlite table configs agree on. */
export type IndexConfig = {
  readonly name?: string;
  readonly columns: readonly unknown[];
  readonly unique: boolean;
  readonly method?: string;
  readonly where?: unknown;
};

/** The config of the index covering exactly these columns. */
export const indexOver = (
  indexes: readonly { readonly config: IndexConfig }[],
  columns: readonly string[],
) => {
  const found = indexes.find(({ config }) => rendered(config.columns) === columns.join(","));

  if (found === undefined) throw new Error(`no index over ${columns.join(", ")}`);

  return found.config;
};

/** A covered column renders as its name; a bare expression (an op class) as itself. */
const rendered = (columns: readonly unknown[]) =>
  columns.map((column) => (hasName(column) ? column.name : "<expression>")).join(",");

/** The SQL an index was declared with, with column references rendered as their names. */
export const sqlOf = (expression: unknown): string =>
  expression instanceof SQL
    ? expression.queryChunks
        .map((chunk) => {
          if (chunk === undefined) return "";
          if (hasName(chunk)) return chunk.name;
          if (hasStringValue(chunk)) return chunk.value.join("");
          if (chunk instanceof SQL) return sqlOf(chunk);

          return "";
        })
        .join("")
    : "";

const hasName = (value: unknown): value is { readonly name: string } =>
  typeof value === "object" && value !== null && "name" in value && typeof value.name === "string";

const hasStringValue = (value: unknown): value is { readonly value: readonly string[] } =>
  typeof value === "object" && value !== null && "value" in value && Array.isArray(value.value);
