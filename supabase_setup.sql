-- ═══════════════════════════════════════════════════════════════
-- WhatsApp Sender Pro — Setup Supabase (SAFE RE-RUN)
-- Pode executar múltiplas vezes sem erro
-- ═══════════════════════════════════════════════════════════════

-- 1. Tabela de perfis (estende auth.users)
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
  email TEXT,
  name TEXT,
  plan TEXT DEFAULT 'free' CHECK (plan IN ('free', 'pro', 'enterprise')),
  daily_limit INTEGER DEFAULT 200,
  is_admin BOOLEAN DEFAULT FALSE,
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'banned')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Ativar Row Level Security
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- 3. Policies: DROP antes de CREATE para evitar erro de duplicata
DROP POLICY IF EXISTS "Users can view own profile" ON public.profiles;
CREATE POLICY "Users can view own profile"
  ON public.profiles FOR SELECT
  USING (auth.uid() = id);

DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
CREATE POLICY "Users can update own profile"
  ON public.profiles FOR UPDATE
  USING (auth.uid() = id);

DROP POLICY IF EXISTS "Users can insert own profile" ON public.profiles;
CREATE POLICY "Users can insert own profile"
  ON public.profiles FOR INSERT
  WITH CHECK (auth.uid() = id);

-- 3b. Policy para service_role poder gerenciar (admin panel)
DROP POLICY IF EXISTS "Service role full access" ON public.profiles;
CREATE POLICY "Service role full access"
  ON public.profiles FOR ALL
  USING (true)
  WITH CHECK (true);

-- 4. Trigger: cria perfil automaticamente ao registrar
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, email, name)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'name', split_part(NEW.email, '@', 1))
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- 5. Tabela de templates por usuário
CREATE TABLE IF NOT EXISTS public.templates (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL,
  message TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.templates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can manage own templates" ON public.templates;
CREATE POLICY "Users can manage own templates"
  ON public.templates FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- 6. Tabela de histórico por usuário
CREATE TABLE IF NOT EXISTS public.history (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  message_preview TEXT,
  total INTEGER DEFAULT 0,
  sent INTEGER DEFAULT 0,
  failed INTEGER DEFAULT 0,
  results JSONB DEFAULT '[]'::jsonb,
  daily_sent INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can manage own history" ON public.history;
CREATE POLICY "Users can manage own history"
  ON public.history FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- 7. Tabela de agendamentos por usuário
CREATE TABLE IF NOT EXISTS public.schedules (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  name TEXT,
  scheduled_at TIMESTAMPTZ NOT NULL,
  customers JSONB NOT NULL,
  message_template TEXT,
  images JSONB DEFAULT '[]'::jsonb,
  send_image BOOLEAN DEFAULT FALSE,
  interval_min INTEGER DEFAULT 5000,
  interval_max INTEGER DEFAULT 15000,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'completed', 'failed', 'cancelled')),
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.schedules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can manage own schedules" ON public.schedules;
CREATE POLICY "Users can manage own schedules"
  ON public.schedules FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- 8. Tabela de stats diários por usuário
CREATE TABLE IF NOT EXISTS public.daily_stats (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  date DATE DEFAULT CURRENT_DATE,
  sent INTEGER DEFAULT 0,
  UNIQUE(user_id, date)
);

ALTER TABLE public.daily_stats ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can manage own stats" ON public.daily_stats;
CREATE POLICY "Users can manage own stats"
  ON public.daily_stats FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- ═══════════════════════════════════════════════════════════════
-- 9. Inserir profiles para usuários existentes que não têm
-- ═══════════════════════════════════════════════════════════════
INSERT INTO public.profiles (id, email, name)
SELECT id, email, COALESCE(raw_user_meta_data->>'name', split_part(email, '@', 1))
FROM auth.users
WHERE id NOT IN (SELECT id FROM public.profiles)
ON CONFLICT (id) DO NOTHING;

-- 10. Promover admin
UPDATE public.profiles SET is_admin = true WHERE email = 'hebertsandinha@gmail.com';

-- ═══════════════════════════════════════════════════════════════
-- ✅ PRONTO! Pode executar quantas vezes quiser sem erro.
-- ═══════════════════════════════════════════════════════════════
