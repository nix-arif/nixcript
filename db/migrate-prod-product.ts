import "dotenv/config";
import { neon } from "@neondatabase/serverless";

async function run() {
  const sql = neon(process.env.DATABASE_URL!);

  console.log("Migrating product table in:", process.env.DATABASE_URL?.slice(0, 50));

  const hasCol = async (name: string) => {
    const r = await sql`SELECT 1 FROM information_schema.columns WHERE table_name = 'product' AND column_name = ${name}`;
    return r.length > 0;
  };

  const getType = async (name: string) => {
    const r = await sql`SELECT data_type FROM information_schema.columns WHERE table_name = 'product' AND column_name = ${name}`;
    return r.length > 0 ? r[0].data_type : null;
  };

  // Rename columns: add mda_ prefix
  if (await hasCol("registration_no")) {
    await sql`ALTER TABLE product RENAME COLUMN registration_no TO mda_registration_no`;
    console.log("  Renamed: registration_no → mda_registration_no");
  } else console.log("  Skip: registration_no already renamed");

  if (await hasCol("page_no")) {
    await sql`ALTER TABLE product RENAME COLUMN page_no TO mda_page_no`;
    console.log("  Renamed: page_no → mda_page_no");
  } else console.log("  Skip: page_no already renamed");

  if (await hasCol("valid_from")) {
    await sql`ALTER TABLE product RENAME COLUMN valid_from TO mda_valid_from`;
    console.log("  Renamed: valid_from → mda_valid_from");
  } else console.log("  Skip: valid_from already renamed");

  if (await hasCol("expired_on")) {
    await sql`ALTER TABLE product RENAME COLUMN expired_on TO mda_expired_on`;
    console.log("  Renamed: expired_on → mda_expired_on");
  } else console.log("  Skip: expired_on already renamed");

  if (await hasCol("pdf_file")) {
    await sql`ALTER TABLE product RENAME COLUMN pdf_file TO mda_pdf_file`;
    console.log("  Renamed: pdf_file → mda_pdf_file");
  } else console.log("  Skip: pdf_file already renamed");

  if (await hasCol("match_x")) {
    await sql`ALTER TABLE product RENAME COLUMN match_x TO mda_match_x`;
    console.log("  Renamed: match_x → mda_match_x");
  } else console.log("  Skip: match_x already renamed");

  if (await hasCol("match_y")) {
    await sql`ALTER TABLE product RENAME COLUMN match_y TO mda_match_y`;
    console.log("  Renamed: match_y → mda_match_y");
  } else console.log("  Skip: match_y already renamed");

  if (await hasCol("row_height")) {
    await sql`ALTER TABLE product RENAME COLUMN row_height TO mda_row_height`;
    console.log("  Renamed: row_height → mda_row_height");
  } else console.log("  Skip: row_height already renamed");

  if (await hasCol("page_width")) {
    await sql`ALTER TABLE product RENAME COLUMN page_width TO mda_page_width`;
    console.log("  Renamed: page_width → mda_page_width");
  } else console.log("  Skip: page_width already renamed");

  if (await hasCol("page_height")) {
    await sql`ALTER TABLE product RENAME COLUMN page_height TO mda_page_height`;
    console.log("  Renamed: page_height → mda_page_height");
  } else console.log("  Skip: page_height already renamed");

  // Change mda_valid_from from text to timestamp (data is DD/MM/YYYY format)
  if ((await getType("mda_valid_from")) === "text") {
    await sql`ALTER TABLE product ALTER COLUMN mda_valid_from TYPE timestamp without time zone USING CASE WHEN mda_valid_from IS NULL OR mda_valid_from = '' THEN NULL ELSE TO_TIMESTAMP(mda_valid_from, 'DD/MM/YYYY') END`;
    console.log("  Converted: mda_valid_from text → timestamp");
  } else {
    console.log("  Skip: mda_valid_from is", await getType("mda_valid_from"));
  }

  // Change mda_expired_on from text to timestamp (data is DD/MM/YYYY format)
  if ((await getType("mda_expired_on")) === "text") {
    await sql`ALTER TABLE product ALTER COLUMN mda_expired_on TYPE timestamp without time zone USING CASE WHEN mda_expired_on IS NULL OR mda_expired_on = '' THEN NULL ELSE TO_TIMESTAMP(mda_expired_on, 'DD/MM/YYYY') END`;
    console.log("  Converted: mda_expired_on text → timestamp");
  } else {
    console.log("  Skip: mda_expired_on is", await getType("mda_expired_on"));
  }

  // Add image_key if missing
  if (!(await hasCol("image_key"))) {
    await sql`ALTER TABLE product ADD COLUMN image_key text`;
    console.log("  Added: image_key");
  } else {
    console.log("  Skip: image_key already exists");
  }

  console.log("Done.");
}

run().catch(console.error);
