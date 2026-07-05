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
  // Check tables
  console.log('=== Check tables exist ===');
  await runSql("SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename IN ('conversations','messages')");

  // Check columns
  console.log('\n=== conversations columns ===');
  await runSql(`
    SELECT column_name, data_type, is_nullable
    FROM information_schema.columns
    WHERE table_schema='public' AND table_name='conversations'
    ORDER BY ordinal_position
  `);

  console.log('\n=== messages columns ===');
  await runSql(`
    SELECT column_name, data_type, is_nullable
    FROM information_schema.columns
    WHERE table_schema='public' AND table_name='messages'
    ORDER BY ordinal_position
  `);

  // Drop and recreate
  console.log('\n=== Dropping existing tables ===');
  await runSql('DROP TABLE IF EXISTS public.messages CASCADE');
  await runSql('DROP TABLE IF EXISTS public.conversations CASCADE');

  console.log('\n=== Recreating conversations ===');
  await runSql(`
    CREATE TABLE public.conversations (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      listing_id UUID REFERENCES public.listings(id) ON DELETE SET NULL,
      buyer_id UUID NOT NULL,
      subject TEXT NOT NULL DEFAULT 'New Inquiry',
      last_message_at TIMESTAMPTZ DEFAULT now(),
      last_message_preview TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  console.log('\n=== Recreating messages ===');
  await runSql(`
    CREATE TABLE public.messages (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      conversation_id UUID NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
      sender_id UUID NOT NULL,
      content TEXT NOT NULL,
      attachment_url TEXT,
      read_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  // Indexes
  console.log('\n=== Indexes ===');
  for (const idx of [
    'CREATE INDEX IF NOT EXISTS idx_conversations_buyer ON public.conversations(buyer_id)',
    'CREATE INDEX IF NOT EXISTS idx_conversations_listing ON public.conversations(listing_id)',
    'CREATE INDEX IF NOT EXISTS idx_conversations_last_msg ON public.conversations(last_message_at DESC)',
    'CREATE INDEX IF NOT EXISTS idx_messages_conversation ON public.messages(conversation_id)',
    'CREATE INDEX IF NOT EXISTS idx_messages_sender ON public.messages(sender_id)',
    'CREATE INDEX IF NOT EXISTS idx_messages_created ON public.messages(created_at ASC)',
  ]) {
    const { error } = await runSql(idx);
    if (error) console.log(`  Index error: ${error.message}`);
  }

  // Trigger
  await runSql(`
    CREATE OR REPLACE FUNCTION public.update_conversations_updated_at()
    RETURNS TRIGGER AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END; $$ LANGUAGE plpgsql SECURITY DEFINER
  `);
  await runSql(`
    DROP TRIGGER IF EXISTS trg_conversations_updated_at ON public.conversations;
    CREATE TRIGGER trg_conversations_updated_at BEFORE UPDATE ON public.conversations
    FOR EACH ROW EXECUTE FUNCTION public.update_conversations_updated_at()
  `);

  // RLS
  await runSql('ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY');
  await runSql('ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY');

  // Policies
  const policies = [
    `CREATE POLICY "Users can view own conversations" ON public.conversations FOR SELECT USING (buyer_id = auth.uid() OR EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'))`,
    `CREATE POLICY "Users can create conversations" ON public.conversations FOR INSERT WITH CHECK (buyer_id = auth.uid())`,
    `CREATE POLICY "Admins can update conversations" ON public.conversations FOR UPDATE USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'))`,
    `CREATE POLICY "Users can view conversation messages" ON public.messages FOR SELECT USING (EXISTS (SELECT 1 FROM public.conversations c WHERE c.id = messages.conversation_id AND (c.buyer_id = auth.uid() OR EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'))))`,
    `CREATE POLICY "Users can send messages" ON public.messages FOR INSERT WITH CHECK (sender_id = auth.uid() AND EXISTS (SELECT 1 FROM public.conversations c WHERE c.id = conversation_id AND (c.buyer_id = auth.uid() OR EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'))))`,
    `CREATE POLICY "Users can mark messages read" ON public.messages FOR UPDATE USING (EXISTS (SELECT 1 FROM public.conversations c WHERE c.id = messages.conversation_id AND (c.buyer_id = auth.uid() OR EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'))))`,
  ];

  for (const p of policies) {
    const name = p.split('"')[1];
    await runSql(`DROP POLICY IF EXISTS "${name}" ON ${p.includes('conversations') ? 'public.conversations' : 'public.messages'}`);
    const { error } = await runSql(p);
    console.log(`Policy "${name}": ${error ? 'FAILED: ' + error.message : 'OK'}`);
  }

  // Grants
  await runSql('GRANT ALL ON public.conversations TO anon, authenticated, service_role');
  await runSql('GRANT ALL ON public.messages TO anon, authenticated, service_role');

  // Realtime
  await runSql("ALTER PUBLICATION supabase_realtime ADD TABLE IF NOT EXISTS public.conversations");
  await runSql("ALTER PUBLICATION supabase_realtime ADD TABLE IF NOT EXISTS public.messages");

  // Verify
  console.log('\n=== Final Verification ===');
  const { data: tables } = await runSql("SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename IN ('conversations','messages')");
  console.log('Tables:', JSON.stringify(tables));
}

main().catch(console.error);
