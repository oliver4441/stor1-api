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
  console.log('=== Creating store_settings table ===');
  await runSql(`
    CREATE TABLE IF NOT EXISTS public.store_settings (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      store_name TEXT NOT NULL DEFAULT 'Omix Store',
      tagline TEXT DEFAULT '',
      description TEXT DEFAULT '',
      logo_url TEXT DEFAULT '',
      banner_url TEXT DEFAULT '',
      phone TEXT DEFAULT '+254 768 213 649',
      email TEXT DEFAULT 'omixsystems@gmail.com',
      address TEXT DEFAULT 'Kericho, Kenya',
      whatsapp TEXT DEFAULT '+254 768 213 649',
      total_orders INTEGER DEFAULT 0,
      satisfaction_rate NUMERIC DEFAULT 0,
      member_since DATE DEFAULT CURRENT_DATE,
      response_time TEXT DEFAULT 'Under 1 hour',
      is_verified BOOLEAN DEFAULT true,
      created_at TIMESTAMPTZ DEFAULT now(),
      updated_at TIMESTAMPTZ DEFAULT now()
    );
  `);

  console.log('=== Indexes ===');
  await runSql('CREATE INDEX IF NOT EXISTS idx_store_settings_id ON public.store_settings(id)');

  console.log('=== Updating updated_at trigger function ===');
  await runSql(`
    CREATE OR REPLACE FUNCTION public.update_modified_column()
    RETURNS TRIGGER AS $$
    BEGIN NEW.updated_at = now(); RETURN NEW; END;
    $$ LANGUAGE plpgsql;
  `);

  console.log('=== Creating updated_at trigger ===');
  await runSql(`
    DROP TRIGGER IF EXISTS update_store_settings_modtime ON public.store_settings;
    CREATE TRIGGER update_store_settings_modtime BEFORE UPDATE ON public.store_settings
    FOR EACH ROW EXECUTE PROCEDURE public.update_modified_column();
  `);

  console.log('=== Enabling RLS ===');
  await runSql('ALTER TABLE public.store_settings ENABLE ROW LEVEL SECURITY');

  console.log('=== Policies for store_settings ===');
  const policies = [
    `CREATE POLICY "Anyone can read store settings" ON public.store_settings
      FOR SELECT USING (true)`,
    `CREATE POLICY "Admins can insert store settings" ON public.store_settings
      FOR INSERT WITH CHECK (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'))`,
    `CREATE POLICY "Admins can update store settings" ON public.store_settings
      FOR UPDATE USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'))`,
    `CREATE POLICY "Admins can delete store settings" ON public.store_settings
      FOR DELETE USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'))`,
  ];

  for (const p of policies) {
    const name = p.split('"')[1];
    await runSql(`DROP POLICY IF EXISTS "${name}" ON public.store_settings`);
    const { error } = await runSql(p);
    console.log(`Policy "${name}": ${error ? 'FAILED: ' + error.message : 'OK'}`);
  }

  console.log('=== Inserting default store row ===');
  await runSql(`
    INSERT INTO public.store_settings (store_name, tagline, description, phone, email, address, whatsapp, total_orders, satisfaction_rate, member_since, response_time, is_verified)
    VALUES (
      'Omix Store',
      'Kericho''s Premier Tech Marketplace',
      'Omix Store is Kericho''s trusted destination for quality electronics, gadgets, and accessories. We offer genuine products at competitive prices with fast delivery across Kenya.',
      '+254 768 213 649',
      'omixsystems@gmail.com',
      'Kericho, Kenya',
      '+254 768 213 649',
      1520,
      98.5,
      '2024-01-15',
      'Under 1 hour',
      true
    )
    ON CONFLICT (id) DO NOTHING;
  `);

  console.log('=== Grants ===');
  await runSql('GRANT ALL ON public.store_settings TO anon, authenticated, service_role');

  // Verify
  console.log('\n=== Final Verification ===');
  const { data: tables } = await runSql(
    "SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename IN ('store_settings')"
  );
  console.log('Tables:', JSON.stringify(tables));

  const { data: row } = await runSql('SELECT store_name, tagline FROM public.store_settings LIMIT 1');
  console.log('Default row:', JSON.stringify(row));
}

main().catch(console.error);
