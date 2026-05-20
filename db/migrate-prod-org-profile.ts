import "dotenv/config";
import { neon } from "@neondatabase/serverless";

async function run() {
  const sql = neon(process.env.DATABASE_URL!);
  console.log("Migrating organization_profile in:", process.env.DATABASE_URL?.slice(0, 50));

  const hasCol = async (name: string) => {
    const r = await sql`SELECT 1 FROM information_schema.columns WHERE table_name = 'organization_profile' AND column_name = ${name}`;
    return r.length > 0;
  };

  async function addCol(name: string, run: () => Promise<unknown>) {
    if (!(await hasCol(name))) { await run(); console.log(`  Added: ${name}`); }
    else console.log(`  Skip:  ${name}`);
  }

  await addCol("logo_key",                  () => sql`ALTER TABLE organization_profile ADD COLUMN logo_key text`);
  await addCol("brand_color",               () => sql`ALTER TABLE organization_profile ADD COLUMN brand_color text`);
  await addCol("template_style",            () => sql`ALTER TABLE organization_profile ADD COLUMN template_style text DEFAULT 'corporate'`);
  await addCol("pdf_template",              () => sql`ALTER TABLE organization_profile ADD COLUMN pdf_template text DEFAULT 'affirma'`);
  await addCol("title_position",            () => sql`ALTER TABLE organization_profile ADD COLUMN title_position text DEFAULT 'stamp'`);
  await addCol("table_font_size",           () => sql`ALTER TABLE organization_profile ADD COLUMN table_font_size text DEFAULT 'normal'`);
  await addCol("header_layout",             () => sql`ALTER TABLE organization_profile ADD COLUMN header_layout text DEFAULT 'standard'`);
  await addCol("org_name_size",             () => sql`ALTER TABLE organization_profile ADD COLUMN org_name_size text DEFAULT 'medium'`);
  await addCol("org_name_bold",             () => sql`ALTER TABLE organization_profile ADD COLUMN org_name_bold integer DEFAULT 1`);
  await addCol("org_name_uppercase",        () => sql`ALTER TABLE organization_profile ADD COLUMN org_name_uppercase integer DEFAULT 0`);
  await addCol("org_info_side",             () => sql`ALTER TABLE organization_profile ADD COLUMN org_info_side text DEFAULT 'left'`);
  await addCol("quotation_label_size",      () => sql`ALTER TABLE organization_profile ADD COLUMN quotation_label_size text DEFAULT 'normal'`);
  await addCol("quotation_label_bold",      () => sql`ALTER TABLE organization_profile ADD COLUMN quotation_label_bold integer DEFAULT 1`);
  await addCol("quotation_label_uppercase", () => sql`ALTER TABLE organization_profile ADD COLUMN quotation_label_uppercase integer DEFAULT 1`);
  await addCol("table_row_style",           () => sql`ALTER TABLE organization_profile ADD COLUMN table_row_style text DEFAULT 'default'`);
  await addCol("show_code_column",          () => sql`ALTER TABLE organization_profile ADD COLUMN show_code_column integer DEFAULT 1`);
  await addCol("quotation_no_format",       () => sql`ALTER TABLE organization_profile ADD COLUMN quotation_no_format text DEFAULT 'A'`);
  await addCol("phone",                     () => sql`ALTER TABLE organization_profile ADD COLUMN phone text`);
  await addCol("email",                     () => sql`ALTER TABLE organization_profile ADD COLUMN email text`);
  await addCol("website",                   () => sql`ALTER TABLE organization_profile ADD COLUMN website text`);
  await addCol("attention_name_size",       () => sql`ALTER TABLE organization_profile ADD COLUMN attention_name_size text DEFAULT 'medium'`);
  await addCol("attention_name_bold",       () => sql`ALTER TABLE organization_profile ADD COLUMN attention_name_bold integer DEFAULT 1`);
  await addCol("detail_font_size",          () => sql`ALTER TABLE organization_profile ADD COLUMN detail_font_size text DEFAULT 'normal'`);
  await addCol("detail_font_bold",          () => sql`ALTER TABLE organization_profile ADD COLUMN detail_font_bold integer DEFAULT 0`);
  await addCol("detail_alignment",          () => sql`ALTER TABLE organization_profile ADD COLUMN detail_alignment text DEFAULT 'right'`);
  await addCol("bank_statement_url",        () => sql`ALTER TABLE organization_profile ADD COLUMN bank_statement_url text`);
  await addCol("lampiran12_url",            () => sql`ALTER TABLE organization_profile ADD COLUMN lampiran12_url text`);
  await addCol("lampiran13_url",            () => sql`ALTER TABLE organization_profile ADD COLUMN lampiran13_url text`);

  console.log("Done.");
}

run().catch(console.error);
