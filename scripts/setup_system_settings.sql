-- ============================================================
-- SETUP SYSTEM SETTINGS
-- Fecha: 2026-01-06
-- Objetivo: Crear tabla de configuración global para automatización
-- ============================================================

-- 1. Crear Tabla
CREATE TABLE IF NOT EXISTS system_settings (
    key TEXT PRIMARY KEY,
    value JSONB NOT NULL,
    description TEXT,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_by UUID REFERENCES auth.users(id)
);

-- 2. Habilitar RLS (Seguridad)
ALTER TABLE system_settings ENABLE ROW LEVEL SECURITY;

-- 3. Políticas de Acceso
-- Lectura: Permitir a usuarios autenticados (o solo admins, según preferencia. Por ahora autenticados para que el dashboard lea)
CREATE POLICY "Allow read access for authenticated users" ON system_settings
    FOR SELECT TO authenticated USING (true);

-- Escritura: Solo Service Role (Edge Functions) y Admins (si implementamos roles en DB)
-- Por ahora, permitimos update a autenticados pero idealmente debería restringirse a admins.
-- Asumimos que el dashboard valida el rol antes de mostrar los controles.
CREATE POLICY "Allow update for authenticated users" ON system_settings
    FOR UPDATE TO authenticated USING (true);
    
-- Insertar también por si acaso (inicialización)
CREATE POLICY "Allow insert for authenticated users" ON system_settings
    FOR INSERT TO authenticated WITH CHECK (true);


-- 4. Insertar Valores por Defecto (SOLO SI NO EXISTEN)
INSERT INTO system_settings (key, value, description)
VALUES
    ('auto_analysis_enabled', 'true'::jsonb, 'Activa/Desactiva el análisis automático de partidos'),
    ('auto_learning_enabled', 'false'::jsonb, 'Activa/Desactiva el auto-entrenamiento del modelo')
ON CONFLICT (key) DO NOTHING;

-- 5. Verificar
SELECT * FROM system_settings;
