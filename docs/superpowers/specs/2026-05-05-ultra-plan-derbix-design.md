# Ultra Plan Derbix — Pipeline IA + Telegram + PDF

**Fecha:** 2026-05-05
**Autor:** Julián Parra + Claude
**Estado:** Pendiente de aprobación
**Objetivo:** Lograr **consistencia** de calidad de pronósticos antes de lanzar campaña publicitaria.

---

## Contexto y Motivación

La plataforma Derbix está a días de salir a campaña pagada. El sistema actual de análisis IA produce resultados inconsistentes por tres razones identificadas:

1. **Fallback chain heredado:** el código tiene fallback automático a Gemini (sin saldo) y Groq (gratis, rate-limited). Cada fallback produce calidad distinta.
2. **Paralelismo fragmenta el razonamiento:** los 6 agentes actuales (Offensive, Defensive, Tactical, Contextual, Market, Skeptic) corren en paralelo sin verse entre sí. El Judge tiene que reconstruir coherencia desde 6 outputs desconectados.
3. **Datos disponibles pero no aprovechados:** el ETL trae predicciones SportMonks, datos de árbitro y H2H profundo que NO se pasan al pipeline de razonamiento.

Adicionalmente:
- La sección Telegram es solo un generador copy-paste con esquema obsoleto (5 picks teaser).
- El PDF actual (jsPDF) se ve poco profesional y no cumple su rol de "chupeta" para llevar usuarios a la plataforma.

Este spec define **3 cambios coordinados** que se implementan en orden y se validan con QA antes de campaña.

---

## Alcance

### Incluido
- Refactor del pipeline IA hacia arquitectura híbrida secuencial-paralelo
- Migración total a DeepSeek-V4 (sin fallback automático a otros LLMs)
- Threshold de oportunidades bajado de 83% a **80%**
- Eliminación de fallbacks Gemini/Groq como caída automática (solo retry sobre DeepSeek)
- Reescritura del Telegram Command Center con generación dinámica vía DeepSeek-Flash
- Migración del generador de PDFs de jsPDF a React-PDF con design system profesional
- 3 plantillas de PDF: Promo (sin pick), Premium (con pick), Parlay
- QA agent que valida todo end-to-end antes de campaña

### Fuera de alcance
- No se construye bot real de Telegram con webhooks/queue (decisión explícita: copy-paste)
- No se cambian planes de suscripción ni Whop integration
- No se cambia el ETL de SportMonks más allá de pasar al pipeline datos que ya se traen
- No se rediseñan páginas del frontend más allá del componente Telegram Command Center

---

## Parte 1 — Pipeline IA Híbrido Secuencial-Paralelo

### Decisión arquitectónica
Adoptamos **Opción C: Híbrido Secuencial-Paralelo** sobre las alternativas de mantener el sistema actual o migrar a una cadena 100% secuencial.

### Stages

#### Stage 0 — Data Foundation (determinístico, sin LLM)
Código TypeScript que toma el output completo del ETL (`v2-create-job-sportmonks`) y produce una ficha estructurada con features pre-calculadas. NO hace razonamiento, hace cálculos puros.

Outputs:
- `streak_home: "WWDLW"`, `streak_away: "WLDWW"`
- `days_rest_home: number`, `days_rest_away: number`
- `xg_rolling_home_5/10`, `xga_rolling_home_5/10` (idem visitante)
- `goals_avg_home_last5/10` (con ventana home/away separada)
- `referee_stats: {name, yellows_per_match, reds_per_match, home_bias}` — antes solo se traía nombre, ahora se computa
- `sportmonks_predictions: {1x2_probs, over25_prob, btts_prob}` — antes traído sin pasar
- `clv_apertura_cierre: %` (best-effort, depende de captura histórica de odds)
- `injuries_impact_estimated: {home_xg_loss, away_xg_loss}`
- `competition_context: {is_derby, is_relegation_battle, is_title_race}`
- `lineups_probable_extracted_from_perplexity: {home, away}` (best-effort)

Razón: garantiza que todos los partidos arranquen con los mismos datos calculados de la misma forma, anclados a números. Reduce hallucinations posteriores.

Tamaño output: ~2-4 KB de JSON estructurado.

#### Stage 1 — Statistical Foundation (1 call DeepSeek-V4)
**Input:** Stage 0 completo + system prompt extenso (~1500 tokens) sobre razonamiento estadístico futbolero.
**Output JSON estructurado:**
```json
{
  "thesis_baseline": "string (3-5 párrafos)",
  "probabilities_initial": {
    "home_win": number, "draw": number, "away_win": number,
    "over_25": number, "btts": number,
    "home_to_score": number, "away_to_score": number
  },
  "key_anchors": ["xG diff: 0.6", "form streak ATA differential", ...],
  "risks_flagged": ["lesión titular", "racha atípica"]
}
```
**Tamaño input:** ~15K tokens. **Output:** ~3K tokens.

#### Stage 2 — Especialistas en paralelo (3 calls DeepSeek-V4)

Las 3 calls se hacen con `Promise.all`.

##### Stage 2a — Tactical
**Input:** Stage 0 + Stage 1 completo + datos especializados (lineups, formaciones, H2H expandido).
**Output:**
```json
{
  "matchup_analysis": "...",
  "lineup_impact": "...",
  "formation_clash": "...",
  "tactical_adjustments_thesis": "...",
  "supports_thesis": boolean,
  "modifies_probabilities": { "btts": +0.04, "over_25": +0.03 },
  "candidate_picks": [{"market":"...", "selection":"...", "rationale":"..."}]
}
```

##### Stage 2b — Contextual
**Input:** Stage 0 + Stage 1 + clima, lesiones, fatiga, árbitro, Perplexity.
**Output:** mismo schema base con campos `external_context_findings`, `weather_impact`, `injury_impact_specific`, `referee_pattern`.

##### Stage 2c — Market
**Input:** Stage 0 + Stage 1 + odds detalladas + value bets SportMonks + similar past picks (RAG).
**Output:** schema base con `value_opportunities: [{market, selection, odds, model_prob, edge}]`, `market_consensus`, `clv_signal`.

**Tamaño por call:** 16-18K tokens input, ~3K output cada uno.

#### Stage 3 — Skeptic (1 call DeepSeek-V4)
**Input:** Stage 0 + Stage 1 + outputs íntegros de Stages 2a/2b/2c + losing patterns históricos del modelo.
**Función:** ataca activamente cada pick candidato. Identifica picks frágiles que solo se sostienen en una dimensión, contradicciones entre stages, sobreajuste a recencia.
**Output:**
```json
{
  "attacks": [{
    "target_pick": "...",
    "attack_argument": "...",
    "verdict": "DESCARTAR" | "DEBILITAR_CONFIANZA" | "MANTENER"
  }],
  "picks_that_survive": [...]
}
```
**Tamaño:** ~25K tokens input.

#### Stage 4 — Synthesizer (1 call DeepSeek-V4)
**Input:** TODO lo anterior íntegro + reglas de consenso + ML calibration data.
**Función:** produce el veredicto final con picks confirmados, descartados y razonamiento.
**Output:** estructura compatible con `report_packet` actual para no romper persistencia.
**Tamaño:** ~30K tokens input, ~5K output.

#### Stage 5 — Validation Gate (determinístico, sin LLM)
Reglas duras antes de persistir en `value_picks_v2`:
- Probabilidad >= 80%
- Cuota >= 1.50 y <= 3.50
- Pick referenciado en al menos un Stage anterior
- Probabilidad consistente con cálculo de Stage 0 (gap < 5pp)
- Si falla cualquier regla: descarta el pick (no el análisis completo)

### Política de fallback (eliminada)
- **Solo DeepSeek-V4 para todos los Stages 1-4.**
- Si DeepSeek falla en cualquier stage:
  - Retry 1: espera 2s, retry
  - Retry 2: espera 4s, retry
  - Retry 3: espera 8s, retry
  - Si sigue fallando: marca el job como `failed` con razón. Cola de retry programa nuevo intento en 5min.
- **Cero fallback automático a Gemini, Groq, OpenRouter, Mistral.**
- Stage 0 y Stage 5 no requieren LLM, son código.

### Threshold oportunidades
- Cambia de 83% a **80%**
- Aplicar en: `v2-generate-parlays`, `HighProbPicks.tsx`, `daily-analysis-generator`, `resultsService.ts`, `applyCalibrationPostProcessingV3`, `hourly-results-verifier`
- Constante centralizada: `OPPORTUNITIES_THRESHOLD = 0.80` en archivo compartido

### temperature=0 forzado
Todas las llamadas a DeepSeek en Stages 1-4 usan `temperature: 0` (o el valor más cercano que DeepSeek soporte para máxima determinismo). El cliente LLM (`llm-client.ts`) debe ser auditado y modificado para garantizarlo.

### Schemas JSON estrictos
Cada stage define su schema con Zod (o JSON Schema). Si el output del LLM no valida, retry automático con prompt incluyendo el error de validación. Máximo 2 retries de validación por stage.

### Datos nuevos al pipeline
- Árbitro completo (no solo nombre): se extrae del output ETL existente
- Predicciones SportMonks: se incluyen como benchmark de comparación
- Streak explícito formato W-W-D-L-W
- Days_rest exacto entre partidos
- Lineups probables extraídos de Perplexity (parser mejorado)
- CLV: se intenta calcular si hay histórico de odds, si no se omite

### Archivos afectados (Parte 1)
- `supabase/functions/_shared/agents/orchestrator.ts` — refactor mayor a stages
- `supabase/functions/_shared/agents/configs.ts` — nuevos system prompts por stage
- `supabase/functions/_shared/agents/types.ts` — nuevos tipos por stage output
- `supabase/functions/_shared/agents/data-foundation.ts` — NUEVO (Stage 0)
- `supabase/functions/_shared/agents/validation-gate.ts` — NUEVO (Stage 5)
- `supabase/functions/_shared/llm-client.ts` — eliminar fallback chain, solo DeepSeek + retry
- `supabase/functions/v3-ai-analyzer/index.ts` — adaptar invocación a nuevo orchestrator
- `supabase/functions/v2-generate-parlays/index.ts` — threshold 80%
- `supabase/functions/hourly-results-verifier/index.ts` — threshold 80%
- `components/ai/HighProbPicks.tsx` — threshold 80%
- `services/resultsService.ts` — threshold 80%
- Constants centralized

---

## Parte 2 — Telegram Command Center

### Modelo
- **Sin bot**, sin webhooks, sin envío automático.
- Panel de copy-paste con generación dinámica de contenido.
- Admin abre el panel cada día, genera todos los mensajes, los copia y pega manualmente al canal en el momento que decida.

### Componente principal
**Archivo:** `components/admin/TelegramCommandCenter.tsx` (reescritura de `TelegramContentGenerator.tsx`).

### 6 bloques diarios

#### Bloque 1 — Mañana: Tip educativo
- Categoría seleccionable de un dropdown (default rota por día):
  1. Anti-tipster
  2. Transparencia / datos crudos
  3. Consejo profesional (bankroll, valor, disciplina)
  4. Dolor del apostador (identificación)
  5. Diferenciador Derbix
  6. Contexto temporal (fin de semana, derbis, etc.)
- Generado por `telegram-content-generate` edge function vía DeepSeek-Flash.
- Botón "Regenerar" produce variante distinta.
- Termina con CTA: `derbix.co?utm_source=telegram&utm_campaign=morning`.

#### Bloque 2 — Pronóstico del día (teaser)
- Auto-selecciona el pick #1 del día por mayor `edge%` de `value_picks_v2`.
- Selector dropdown por si el admin quiere otro pick.
- Plantilla teaser que NO revela mercado, selección ni cuota.
- Revela: equipos, liga, hora (Bogotá), volumen de datos analizados, frase contextual genérica.
- CTA: `derbix.co?utm_source=telegram&utm_campaign=daily_pick`.

#### Bloque 3 — PDF del pronóstico
- Botón "Descargar PDF" genera PDF promo (template chupeta) del pick del día.
- Caption preconfigurado para copiar.
- Admin sube el PDF manualmente al canal como archivo.

#### Bloque 4 — Mediodía: Consejo profesional
- Mismo mecanismo que Bloque 1 (DeepSeek-Flash + categorías rotativas).
- Subcategorías más enfocadas: bankroll, gestión emocional, valor, disciplina.

#### Bloque 5 — Resumen del día (al cierre)
- Datos automáticos desde DB:
  - Total picks verificados de hoy
  - Aciertos
  - ROI del día
- Renderiza plantilla con números reales + frase contra corriente.
- Botón "Regenerar" llama a DeepSeek-Flash para variante de prosa (manteniendo los números).

#### Bloque 6 — Welcome a nuevos
- Query: `profiles WHERE created_at::date = today AND telegram_username IS NOT NULL`.
- Lista los `@telegram_username` capturados en el registro de hoy.
- Plus textarea manual para que el admin agregue usernames de nuevos suscriptores del canal que aún no se hayan registrado en derbix.
- Plantilla de bienvenida que mezcla ambos.

### Cambio en registro de derbix
- Agregar campo opcional `telegram_username` en formulario de registro.
- Persistir en `profiles.telegram_username`.
- Migración SQL: `ALTER TABLE profiles ADD COLUMN telegram_username TEXT;`

### Edge function nueva
**`telegram-content-generate`**:
- Input: `{category, context_data}`
- Llama a DeepSeek-Flash con prompt según categoría
- Retorna: `{text, generated_at}`
- Sin persistencia (no se guarda contenido generado)

### Tabla nueva (mínima)
**`telegram_content_templates`**:
- `id, category, system_prompt_template, last_used_at, use_count, is_active`
- Permite que el admin edite los system prompts por categoría desde el panel sin redeploy
- 6 rows iniciales seed (uno por categoría)

### Eliminado del actual
- Esquema de "5 picks morning teaser" → reemplazado por Bloque 2 con un solo pick
- Tips estáticos hardcoded → reemplazados por generación DeepSeek-Flash
- Mensajes determinísticos por día → ahora cada regeneración es distinta

### Archivos afectados (Parte 2)
- `components/admin/TelegramContentGenerator.tsx` → renombrar a `TelegramCommandCenter.tsx` y reescribir
- `components/auth/SignUpForm.tsx` (o equivalente) — agregar campo telegram_username
- `services/profileService.ts` — soportar telegram_username
- `supabase/functions/telegram-content-generate/index.ts` — NUEVO
- `supabase/migrations/20260505_telegram_command_center.sql` — NUEVO (columna telegram_username + tabla templates)

---

## Parte 3 — PDF Design System

### Decisión técnica
Migrar de **jsPDF + jsPDF-AutoTable** a **`@react-pdf/renderer`**. Mantenemos la API pública de `pdfGenerator.ts` (firmas de funciones) para no romper consumidores existentes.

### Estructura nueva
```
services/pdf/
├── design-system/
│   ├── tokens.ts            (colores, tipografía Outfit/Inter, spacing 4pt grid)
│   ├── fonts.ts             (registro de Inter + Outfit con weights)
│   ├── components/          (Page, CoverPage, SectionHeader, KPICard, DataTable,
│   │                         Quote, BarChart, DonutChart, Divider, CTAFooter,
│   │                         Logo, QRCode)
│   └── layouts/
│       └── ReportLayout.tsx (master layout con grid)
├── templates/
│   ├── PromoMatchPDF.tsx    (la "chupeta", sin pick específico)
│   ├── PremiumMatchPDF.tsx  (completo, con pick)
│   └── ParlayPDF.tsx
├── generators/
│   ├── generatePromoMatchPDF.ts
│   ├── generatePremiumMatchPDF.ts
│   └── generateParlayPDF.ts
└── pdfGenerator.ts          (adapter público que delega a generators según options)
```

### Design tokens críticos
- Sistema 4pt grid (todos los espaciados son múltiplos de 4)
- Tipografía:
  - Display: Outfit 32pt 700
  - H1: Outfit 22pt 600
  - H2: Outfit 16pt 600
  - H3: Inter 13pt 600
  - Body: Inter 10.5pt 400 (line-height 1.55)
  - KPI Number: Outfit 28pt 700
- Paleta dark profesional (#0a0a0f base, emerald brand mantenido)
- Márgenes de página: 48pt top/bottom, 40pt sides
- Espacios entre secciones: 32pt

### Plantilla PROMO ("Chupeta") — 8 páginas
1. Portada cinematográfica con branding y sello dinámico tipo "N datos · 6 modelos · Consenso" — N se calcula desde el contexto real del análisis (suma de campos en MatchContext + entradas de stages), no hardcoded
2. Resumen ejecutivo con KPIs visuales — sin tocar mercados específicos
3. Análisis del equipo local con forma, xG, hallazgos cualitativos
4. Análisis del equipo visitante (mismo formato)
5. Factores contextuales (clima, lesiones, árbitro como contexto, momentum)
6. Lectura del mercado (categorías con dots de intensidad de valor — sin chivar mercado/selección exactos)
7. CTA full-page con QR code al partido en derbix.co
8. Disclaimer + sobre Derbix

**Regla clave:** ninguna página revela el pick específico, mercado, selección ni cuota. El PDF actúa como gancho de calidad que crea urgencia de ir a derbix.co.

### Plantilla PREMIUM
Misma base + páginas adicionales con pick completo, cuota, edge, razonamiento del Skeptic, tabla full de oportunidades. Sin CTA promocional.

### Plantilla PARLAY
Portada con riesgo, tabla de selecciones, cuota total, razonamiento. Versiones promo/premium.

### Hooks de integración
- `pdfGenerator.ts` mantiene firmas: `generateMatchAnalysisPDF(analysisRun, options)`, `generateParlayPDF(parlay, options)`
- Internamente delega a `generators/` según `options.isPromo`
- `AnalysisReportModal.tsx` y `SmartParlaysList.tsx` no requieren cambios

### Nuevo: integración con Telegram Command Center
- Bloque 3 del Command Center invoca `generatePromoMatchPDF(pick_del_dia)` → descarga PDF al disco del admin

### Archivos afectados (Parte 3)
- `services/pdf/pdfGenerator.ts` — refactor a adapter
- `services/pdf/design-system/**` — NUEVO directorio completo
- `services/pdf/templates/**` — NUEVO directorio
- `services/pdf/generators/**` — NUEVO directorio
- `package.json` — agregar `@react-pdf/renderer`, dependencias de fuentes
- `public/fonts/` — Inter y Outfit en formato compatible con react-pdf

---

## Plan de implementación (orden)

1. **Parte 1 — Pipeline IA** (más crítica para campaña)
   - Stage 0 (data-foundation.ts)
   - Refactor de orchestrator a stages
   - Eliminación de fallbacks en llm-client.ts
   - Validation gate
   - Threshold 80% en todos los lugares
2. **Parte 3 — PDF Design System** (necesario antes que Telegram porque Telegram lo invoca)
   - Setup React-PDF + fuentes
   - Design tokens + componentes
   - Template Promo (la "chupeta")
   - Templates Premium y Parlay
   - Adapter en pdfGenerator.ts manteniendo API
3. **Parte 2 — Telegram Command Center**
   - Migración SQL (telegram_username + telegram_content_templates)
   - Edge function telegram-content-generate
   - Reescritura del componente
   - Integración con generador de PDF
4. **QA Agent**
   - Pipeline contra 5 partidos reales
   - Telegram Command Center: generar todos los bloques
   - PDFs: 3 templates inspeccionados visualmente
   - End-to-end: análisis → display frontend → PDF → mensajes Telegram

---

## Criterios de aceptación

### Parte 1
- [ ] 5 partidos reales analizados con éxito en pipeline nuevo
- [ ] Cero llamadas a Gemini, Groq, OpenRouter, Mistral en logs durante análisis exitoso
- [ ] Output JSON válido contra schemas en cada stage
- [ ] Picks generados cumplen threshold 80% y validation gate
- [ ] Tiempo total por partido < 120s (margen sobre límite 150s de Supabase)
- [ ] Costos por análisis: documentados (esperado < $0.30 por partido con DeepSeek)

### Parte 2
- [ ] Telegram Command Center renderiza los 6 bloques con datos reales
- [ ] DeepSeek-Flash genera variantes distintas en regeneraciones
- [ ] Botón Copiar funciona en cada bloque
- [ ] Botón Descargar PDF descarga PDF promo válido
- [ ] Welcome lista usuarios reales registrados hoy con telegram_username

### Parte 3
- [ ] Las 3 plantillas PDF generan archivos visualmente profesionales
- [ ] Plantilla Promo NO revela pick, mercado ni selección en ninguna página
- [ ] Plantilla Promo incluye QR code funcional al partido en derbix.co
- [ ] Fuentes Outfit/Inter renderizan correctamente embebidas
- [ ] Tamaño de archivo razonable (< 1MB por PDF)

### QA / Pre-campaña
- [ ] QA agent ejecutado con éxito
- [ ] Cero errores en logs de un día completo de operación
- [ ] Pipeline analiza el batch diario sin caer

---

## Riesgos y mitigaciones

| Riesgo | Probabilidad | Impacto | Mitigación |
|---|---|---|---|
| DeepSeek se cae sin fallback | Bajo (SLA típico 99%+) | Alto (sin análisis ese rato) | Cola de retry a 5min; alerta visible al admin; manualmente puede reactivar fallback temporal si crisis |
| Costos DeepSeek mayores de lo estimado | Medio | Medio | Monitorear primer día; ajustar tamaño de prompts si necesario |
| temperature=0 produce análisis demasiado uniformes que no detectan matices | Bajo | Medio | Schemas estructurados + reglas de consenso compensan; los matices vienen del Stage 2 paralelo y Skeptic, no de variabilidad random |
| React-PDF no renderiza algún elemento del jsPDF actual | Medio | Bajo | Componentes equivalentes existen para todo lo usado; QA visual antes de campaña |
| DeepSeek-Flash genera contenido Telegram con tono inadecuado | Medio | Bajo | Editar manualmente antes de copiar; ajustar system prompts si recurrente |
| Threshold 80% baja ROI público y daña discurso "más ganas que pierdes" | Medio | Medio | Monitorear primera semana; volver a 83% si WR cae bajo 60% sostenidamente |

---

## Métricas de éxito post-campaña

- Win rate público >= 60% en primera semana de campaña
- ROI mensual > 0% (ideal +5% o más)
- Tiempo de generación de análisis: < 90s promedio
- 0 análisis con fallback a LLMs no-DeepSeek
- Costos mensuales de DeepSeek dentro del presupuesto definido (a confirmar con usuario)
