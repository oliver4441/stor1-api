const { createClient } = require('@supabase/supabase-js');
const { readFileSync } = require('fs');

const creds = JSON.parse(readFileSync('/root/.supabase_creds.json', 'utf-8'));
const supabaseUrl = 'https://fdwoezyataxhdtgjlfxt.supabase.co';
const supabase = createClient(supabaseUrl, creds.service_key);

async function runSql(sql, label) {
  console.log(`\n=== ${label} ===`);
  const { data, error } = await supabase.rpc('exec_sql', { sql });
  if (error) {
    console.error(`Error: ${error.message}`);
  } else {
    console.log(`OK: ${JSON.stringify(data)}`);
  }
  return { data, error };
}

async function main() {
  console.log('=== Guest Checkout Migration ===\n');

  // 1. Make user_id nullable
  await runSql(
    "ALTER TABLE public.omix_orders ALTER COLUMN user_id DROP NOT NULL",
    'Make user_id nullable'
  );

  // 2. Add guest_id column
  await runSql(
    "ALTER TABLE public.omix_orders ADD COLUMN IF NOT EXISTS guest_id TEXT",
    'Add guest_id column'
  );

  // 3. Create index on guest_id
  await runSql(
    "CREATE INDEX IF NOT EXISTS idx_omix_orders_guest ON public.omix_orders(guest_id)",
    'Create index on guest_id'
  );

  // 4. Add table to publication (ignore error if already exists)
  await runSql(
    "ALTER PUBLICATION supabase_realtime ADD TABLE public.omix_orders",
    'Add to publication (error OK if already exists)'
  );

  console.log('\n=== Migration Complete ===');
}

main().catch(console.error);
