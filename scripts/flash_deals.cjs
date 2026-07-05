const { createClient } = require('@supabase/supabase-js');
const { readFileSync } = require('fs');

const creds = JSON.parse(readFileSync('/root/.supabase_creds.json', 'utf-8'));
const supabaseUrl = 'https://fdwoezyataxhdtgjlfxt.supabase.co';
const supabase = createClient(supabaseUrl, creds.service_key);

async function runSql(sql) {
  const { data, error } = await supabase.rpc('exec_sql', { sql });
  if (error) console.error('Error:', error.message);
  return { data, error };
}

async function main() {
  console.log('=== Creating flash_deals table ===');
  await runSql(`
    CREATE TABLE IF NOT EXISTS public.flash_deals (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      title TEXT NOT NULL,
      description TEXT,
      banner_url TEXT,
      start_at TIMESTAMPTZ NOT NULL,
      end_at TIMESTAMPTZ NOT NULL,
      is_active BOOLEAN DEFAULT true,
      created_at TIMESTAMPTZ DEFAULT now()
    )
  `);

  console.log('=== Creating deal_items table ===');
  await runSql(`
    CREATE TABLE IF NOT EXISTS public.deal_items (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      deal_id UUID NOT NULL REFERENCES public.flash_deals(id) ON DELETE CASCADE,
      listing_id UUID NOT NULL REFERENCES public.listings(id) ON DELETE CASCADE,
      deal_price NUMERIC,
      discount_percent NUMERIC,
      max_quantity INTEGER DEFAULT 0,
      sold_quantity INTEGER DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT now()
    )
  `);

  console.log('=== Indexes ===');
  await runSql('CREATE INDEX IF NOT EXISTS idx_deal_items_deal ON public.deal_items(deal_id)');
  await runSql('CREATE INDEX IF NOT EXISTS idx_deal_items_listing ON public.deal_items(listing_id)');
  await runSql('CREATE INDEX IF NOT EXISTS idx_flash_deals_active ON public.flash_deals(is_active)');
  await runSql('CREATE INDEX IF NOT EXISTS idx_flash_deals_dates ON public.flash_deals(start_at, end_at)');

  console.log('=== Enabling RLS ===');
  await runSql('ALTER TABLE public.flash_deals ENABLE ROW LEVEL SECURITY');
  await runSql('ALTER TABLE public.deal_items ENABLE ROW LEVEL SECURITY');

  console.log('=== Policies for flash_deals ===');
  const dealPolicies = [
    `CREATE POLICY "Anyone can read active deals" ON public.flash_deals
      FOR SELECT USING (is_active = true AND now() BETWEEN start_at AND end_at)`,
    `CREATE POLICY "Admins can read all deals" ON public.flash_deals
      FOR SELECT USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'))`,
    `CREATE POLICY "Admins can insert deals" ON public.flash_deals
      FOR INSERT WITH CHECK (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'))`,
    `CREATE POLICY "Admins can update deals" ON public.flash_deals
      FOR UPDATE USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'))`,
    `CREATE POLICY "Admins can delete deals" ON public.flash_deals
      FOR DELETE USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'))`,
  ];

  for (const p of dealPolicies) {
    const name = p.split('"')[1];
    await runSql(`DROP POLICY IF EXISTS "${name}" ON public.flash_deals`);
    const { error } = await runSql(p);
    console.log(`Policy "${name}": ${error ? 'FAILED: ' + error.message : 'OK'}`);
  }

  console.log('=== Policies for deal_items ===');
  const itemPolicies = [
    `CREATE POLICY "Anyone can read deal items" ON public.deal_items
      FOR SELECT USING (true)`,
    `CREATE POLICY "Admins can insert deal items" ON public.deal_items
      FOR INSERT WITH CHECK (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'))`,
    `CREATE POLICY "Admins can update deal items" ON public.deal_items
      FOR UPDATE USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'))`,
    `CREATE POLICY "Admins can delete deal items" ON public.deal_items
      FOR DELETE USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'))`,
  ];

  for (const p of itemPolicies) {
    const name = p.split('"')[1];
    await runSql(`DROP POLICY IF EXISTS "${name}" ON public.deal_items`);
    const { error } = await runSql(p);
    console.log(`Policy "${name}": ${error ? 'FAILED: ' + error.message : 'OK'}`);
  }

  console.log('=== Grants ===');
  await runSql('GRANT ALL ON public.flash_deals TO anon, authenticated, service_role');
  await runSql('GRANT ALL ON public.deal_items TO anon, authenticated, service_role');

  // Verify
  console.log('\n=== Final Verification ===');
  const { data: tables } = await runSql(
    "SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename IN ('flash_deals','deal_items')"
  );
  console.log('Tables:', JSON.stringify(tables));
}

main().catch(console.error);
