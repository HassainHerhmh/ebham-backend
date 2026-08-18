import db from "../db.js";

const ready = {};

async function runMigrations(key, statements) {
  if (ready[key]) return;

  for (const sql of statements) {
    try {
      await db.query(sql);
    } catch (error) {
      if (error?.code !== "ER_DUP_FIELDNAME") {
        throw error;
      }
    }
  }

  ready[key] = true;
}

export async function ensureRestaurantI18nSchema() {
  await runMigrations("restaurants", [
    "ALTER TABLE restaurants ADD COLUMN name_en VARCHAR(255) NULL",
    "ALTER TABLE restaurants ADD COLUMN address_en VARCHAR(500) NULL",
  ]);
}

export async function ensureTypesI18nSchema() {
  await runMigrations("types", [
    "ALTER TABLE types ADD COLUMN name_en VARCHAR(255) NULL",
  ]);
}

export async function ensureCategoriesI18nSchema() {
  await runMigrations("categories", [
    "ALTER TABLE categories ADD COLUMN description TEXT NULL",
    "ALTER TABLE categories ADD COLUMN icon_url VARCHAR(500) NULL",
    "ALTER TABLE categories ADD COLUMN sort_order INT NULL DEFAULT 0",
    "ALTER TABLE categories ADD COLUMN name_en VARCHAR(255) NULL",
    "ALTER TABLE categories ADD COLUMN description_en TEXT NULL",
  ]);
}

export async function ensureProductsI18nSchema() {
  await runMigrations("products", [
    "ALTER TABLE products ADD COLUMN name_en VARCHAR(255) NULL",
    "ALTER TABLE products ADD COLUMN notes_en TEXT NULL",
  ]);
}

export async function ensureBranchesI18nSchema() {
  await runMigrations("branches", [
    "ALTER TABLE branches ADD COLUMN name_en VARCHAR(255) NULL",
  ]);
}

export async function ensureNeighborhoodsI18nSchema() {
  await runMigrations("neighborhoods", [
    "ALTER TABLE neighborhoods ADD COLUMN name_en VARCHAR(255) NULL",
  ]);
}

export async function ensureCustomersI18nSchema() {
  await runMigrations("customers", [
    "ALTER TABLE customers ADD COLUMN name_en VARCHAR(255) NULL",
  ]);
}
