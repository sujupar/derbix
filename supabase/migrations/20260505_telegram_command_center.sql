-- supabase/migrations/20260505_telegram_command_center.sql
-- Telegram Command Center: copy-paste content generation system.
-- No bot, no webhooks. Just a panel that produces content and a templates table.

-- 1) Add telegram_username to profiles (optional capture during signup)
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS telegram_username TEXT;
CREATE INDEX IF NOT EXISTS idx_profiles_telegram_username ON profiles (telegram_username) WHERE telegram_username IS NOT NULL;

-- 2) Templates table for educational message system prompts (admin-editable)
CREATE TABLE IF NOT EXISTS telegram_content_templates (
  id BIGSERIAL PRIMARY KEY,
  category TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  system_prompt TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  use_count INTEGER NOT NULL DEFAULT 0,
  last_used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3) Seed initial 6 categories
INSERT INTO telegram_content_templates (category, display_name, system_prompt) VALUES
('anti_tipster', 'Anti-tipster', 'Genera un mensaje breve en español (máx 600 caracteres) para un canal de Telegram de apuestas deportivas. Tono: profesional, contra corriente, denuncia las prácticas turbias de los tipsters falsos (bloquear usuarios que pierden, falta de transparencia, no publicar resultados verificados). Termina con CTA: "👉 derbix.co". No uses emojis exagerados — máximo 2.'),
('transparency', 'Transparencia', 'Genera un mensaje breve en español (máx 600 caracteres) para Telegram. Tono: datos crudos, transparencia total. Habla de cómo Derbix publica TODOS los resultados verificados (gane o pierda), por qué eso construye confianza. Termina con CTA "👉 derbix.co". Máximo 2 emojis.'),
('professional_tip', 'Consejo profesional', 'Genera un consejo profesional sobre apuestas deportivas en español (máx 600 caracteres). Temas posibles: gestión de bankroll, valor vs cuota, disciplina emocional, paciencia, diversificación. Termina con CTA "👉 derbix.co". Máximo 2 emojis.'),
('bettor_pain', 'Dolor del apostador', 'Genera un mensaje en español (máx 600 caracteres) que describe un dolor común del apostador (perder racha de 3, intentar recuperar, terminar el mes en rojo, etc.) y lo conecta con la solución metodológica de Derbix. Tono empático pero firme. Termina con CTA "👉 derbix.co".'),
('derbix_diff', 'Diferenciador Derbix', 'Genera un mensaje en español (máx 600 caracteres) que destaca un aspecto único de Derbix: análisis de miles de datos, 6 modelos especializados, validación crítica, threshold del 80%. Tono profesional, no marketing barato. Termina con CTA "👉 derbix.co".'),
('temporal_context', 'Contexto temporal', 'Genera un mensaje en español (máx 600 caracteres) con ángulo temporal/estacional: día de la semana, derbis cercanos, fin de semana de fútbol europeo, etc. Conecta el contexto con la oportunidad. Termina con CTA "👉 derbix.co". Máximo 2 emojis.')
ON CONFLICT (category) DO NOTHING;

COMMENT ON TABLE telegram_content_templates IS 'System prompts for DeepSeek-Flash to generate Telegram educational messages. Editable from admin.';
