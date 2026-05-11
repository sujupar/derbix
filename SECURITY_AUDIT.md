# Derbix — Auditoría de Seguridad Pre-Lanzamiento

**Fecha**: 2026-05-11
**Estado**: 🚨 ACCIÓN URGENTE REQUERIDA antes de cualquier campaña pública

---

## 🔴 SECCIÓN 1 — ACCIONES MANUALES INMEDIATAS DEL DUEÑO

Estas acciones **no se pueden automatizar** desde código y son **bloqueantes** para el lanzamiento.

### 1.1 Rotar `SUPABASE_SERVICE_ROLE_KEY` (URGENTE)
La service-role JWT está hardcoded en **30+ archivos `scripts/`** y en `scripts/setup_all_cron_jobs.sql`, todos commiteados al repositorio en GitHub. Esta clave **bypass-ea todas las políticas RLS** y permite leer/escribir/borrar cualquier dato.

**Pasos:**
1. Entra a Supabase Dashboard → Project `nokejmhlpsaoerhddcyc` → Settings → API
2. Click en **"Reset service_role key"** (o JWT secret si quieres invalidar TODO)
3. Copia la nueva key y guárdala en:
   - `.env` local (variable `SUPABASE_SERVICE_ROLE_KEY`)
   - Supabase Edge Functions secrets (`npx supabase secrets set SUPABASE_SERVICE_ROLE_KEY=...`)
   - Re-deploy todas las edge functions
4. Re-genera todos los cron jobs con la nueva key (ver `scripts/setup_all_cron_jobs.sql` actualizado)

### 1.2 Revocar GitHub Personal Access Token
En `.git/config` local hay un PAT expuesto en la URL del remote (empieza con `ghp_X9...`, te lo conté en el chat). Aunque sólo está en tu máquina, debe ser revocado preventivamente.

**Pasos:**
1. Ve a https://github.com/settings/tokens
2. Revoca el token cuyo prefijo te dio el agente (empieza con `ghp_X9...`)
3. Genera uno nuevo con scopes mínimos
4. Cambia el remote: `git remote set-url origin https://github.com/sujupar/derbix.git` (sin embedded token, usa `gh auth login` o credential helper)

### 1.3 Rotar otros secretos posiblemente expuestos
- `API_FOOTBALL_KEY` (visible en `.env`, posiblemente en commits anteriores) → rotar en RapidAPI/api-football
- `WHOP_WEBHOOK_SECRET` → rotar en Whop Dashboard si fue commiteado en algún momento
- `WHOP_API_KEY` → rotar en Whop Dashboard
- `LS_WEBHOOK_SECRET` → rotar en Lemon Squeezy si fue commiteado
- `WOMPI_EVENT_SECRET` → rotar en Wompi
- `GEMINI_API_KEY` (`VITE_GEMINI_API_KEY`) → rotar en Google AI Studio (estuvo en bundle frontend)

### 1.4 Habilitar políticas de Auth en Supabase
Dashboard → Authentication → Settings:
- Password min length: **8** (actualmente 6 en el cliente)
- Enable "leaked password protection" (HIBP)
- Email confirmations: **Required**
- Rate limiting: deja los defaults si no están customizados

### 1.5 Aplicar migración SQL de hardening RLS
Ejecutar `supabase/migrations/20260511_security_hardening_rls.sql` (creado por mí en este audit) vía:
```bash
npx supabase db push
# o copiar el SQL al SQL Editor del Dashboard si la migración no aplica
```

---

## 🔴 SECCIÓN 2 — VULNERABILIDADES CRÍTICAS (CORREGIDAS EN CÓDIGO)

Estas las arreglé directamente en el código durante esta sesión. Requieren `git push` + redeploy de edge functions.

| ID | Componente | Vulnerabilidad | Archivo |
|----|------------|----------------|---------|
| C-1 | `whop-webhook` | Firma HMAC se omite si faltan headers → activación de suscripción premium gratis | `supabase/functions/whop-webhook/index.ts` |
| C-2 | `whop-webhook` | Sin verificación de timestamp → replay attacks | mismo archivo |
| C-3 | `wompi-webhook` | Lista de propiedades del checksum tomada del body atacante | `supabase/functions/wompi-webhook/index.ts` |
| C-4 | `fix-rls` | Endpoint público que ejecuta DDL (DROP/CREATE POLICY) sin auth | `supabase/functions/fix-rls/index.ts` |
| C-5 | `setup-tactical-tables` | DDL público sin auth + stack trace en respuesta | `supabase/functions/setup-tactical-tables/index.ts` |
| C-6 | `clear-day-analyses` | Borrado masivo de datos producción sin auth | `supabase/functions/clear-day-analyses/index.ts` |
| C-7 | `daily-analysis-generator` | Ejecuta análisis batch costosos sin auth | `supabase/functions/daily-analysis-generator/index.ts` |
| C-8 | `vite.config.ts` | Inlinea `VITE_GEMINI_API_KEY` en bundle frontend → cualquier visitante puede ver la key en DevTools | `vite.config.ts` |
| C-9 | RLS `profiles` | `UPDATE` sin `WITH CHECK` permite que cualquier usuario se promueva a `platform_owner` | migración nueva |
| C-10 | RLS `predictions` | `FOR ALL USING (true)` permite que cualquiera escriba predicciones falsas | migración nueva |
| C-11 | RLS `v9_debate_runs`, `v9_agent_outputs` | Tablas creadas sin RLS habilitado | migración nueva |

## 🟠 SECCIÓN 3 — VULNERABILIDADES HIGH (CORREGIDAS)

| ID | Componente | Vulnerabilidad |
|----|------------|----------------|
| H-1 | Múltiples edge functions admin | Sin auth (`migrate-predictions`, `repair-predictions`, `manual-parlay-generator`, etc.) |
| H-2 | `send-admin-notification` | Spam de emails al admin sin auth |
| H-3 | `send-whatsapp-notification` | Spam masivo WhatsApp sin auth |
| H-4 | `telegram-content-generate` | LLM injection + invocación sin auth |
| H-5 | `whop-create-checkout` | `userId` tomado del body sin verificar JWT (IDOR) |
| H-6 | `invite-user` | Lectura de `profiles.role` con anon client |
| H-7 | `SignUpFlow.tsx` | Password mínimo 6 chars (subido a 8) |
| H-8 | `netlify.toml` | Sin headers de seguridad (CSP, HSTS, X-Frame, etc.) |
| H-9 | `RLS user_subscriptions` | `FOR ALL` con admin role → escalación a plan free premium |
| H-10 | `RLS organization_members` | Sin política INSERT/DELETE org-scoped + acceptInvitation no verifica email |
| H-11 | `RLS organizations` | Sin INSERT policy con `WITH CHECK is_agency = false` |
| H-12 | `services/supabaseService.ts` | Credenciales "quemadas" (anon key OK públicamente, pero práctica peligrosa) |
| H-13 | `vite.config.ts` | Source maps no deshabilitados explícitamente |

## 🟡 SECCIÓN 4 — VULNERABILIDADES MEDIUM (CORREGIDAS)

| ID | Componente | Vulnerabilidad |
|----|------------|----------------|
| M-1 | RLS `profiles` | Política legacy `Public profiles are viewable by everyone USING(true)` puede seguir activa |
| M-2 | `meta-conversions-api` | Sin auth → cualquiera puede inyectar eventos a Meta Pixel |
| M-3 | `seo-public-stats` | Service-role usado en endpoint público (defensa en profundidad) |
| M-4 | `wompi-webhook` | Devuelve HTTP 500 en errores → Wompi reintenta y duplica datos |
| M-5 | `ls-create-checkout` | Rate limiting consulta tabla equivocada |

---

## 🟢 SECCIÓN 5 — POST-LANZAMIENTO (RECOMENDADO)

- **WAF / Rate Limiting**: Cloudflare frente a Netlify para limitar requests por IP
- **Monitoreo**: Sentry para errores frontend + Logflare/BetterStack para edge functions
- **Backups**: Supabase PITR habilitado (Pro plan)
- **Penetration testing**: Tras lanzamiento, contratar pentest externo
- **SBOM + dependency scanning**: GitHub Dependabot + Snyk para `package.json` y deno deps
- **Secrets scanning**: GitHub secret scanning + pre-commit hook con `gitleaks`
- **Bug bounty**: Programa modesto en HackerOne/Intigriti tras 3-6 meses

---

## SCORECARD ACTUAL VS POST-FIX

| Área | Pre-audit | Post-fix |
|------|-----------|----------|
| Secrets management | 🔴 1/10 | 🟢 7/10 (depende de rotación manual del usuario) |
| Webhook integrity | 🔴 2/10 | 🟢 9/10 |
| RLS / multi-tenancy | 🔴 3/10 | 🟢 8/10 |
| Edge function auth | 🔴 2/10 | 🟢 8/10 |
| Frontend hardening | 🟠 5/10 | 🟢 8/10 |
| Auth flow | 🟠 6/10 | 🟢 9/10 |
| Headers / CSP | 🔴 1/10 | 🟢 8/10 |

---

## CHECKLIST FINAL ANTES DE CAMPAÑA

- [ ] **Rotada** `SUPABASE_SERVICE_ROLE_KEY`
- [ ] **Revocado** GitHub PAT viejo
- [ ] **Rotados** WHOP/LS/WOMPI/GEMINI/API_FOOTBALL secrets
- [ ] **Aplicada** migración `20260511_security_hardening_rls.sql`
- [ ] **Re-deployadas** todas las edge functions modificadas
- [ ] **Verificado** Auth Settings en Supabase (8 chars, HIBP, email confirm)
- [ ] **Validado** que nadie puede acceder a `/admin` sin rol agencia
- [ ] **Validado** que webhooks rechazan requests sin firma válida
- [ ] **Probado** flujo de signup + checkout + suscripción end-to-end con la nueva config
- [ ] **Source maps** confirmados deshabilitados en build de producción
- [ ] **Cron jobs** actualizados con nueva service-role key
