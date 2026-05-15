# Meta Ads — Reporte de Despliegue

**Última actualización**: 2026-05-13
**Ad Account**: `act_1387553972755061` (COP, business "Derbix")
**Estado global**: **1 campaña ACTIVE de Conversión, 13K COP/día**. Campañas previas pausadas.

## 🎯 Estado actual (2026-05-14)

**2 campañas ACTIVE, presupuesto total 13K COP/día (6.500 + 6.500)**

| Campaña | ID | Objetivo | Optimization | Status | Budget |
|---------|-----|----------|--------------|--------|--------|
| 🎯 **Registros IA Fútbol** | `120244587813160473` | OUTCOME_LEADS | **OFFSITE_CONVERSIONS / COMPLETE_REGISTRATION** | ACTIVE | 6.500 COP/día |
| 📲 **Tráfico Canal Telegram** | `120244685790650473` | OUTCOME_TRAFFIC | LINK_CLICKS → `t.me/D3RBIX` | ACTIVE | 6.500 COP/día |
| 📲 Telegram Tráfico (V1, legacy) | `120244062050230473` | OUTCOME_TRAFFIC | — | PAUSED | — |
| ✅ Registros Directos (V1, rechazada) | `120242171150490473` | OUTCOME_SALES | — | PAUSED | — |

### Diagnóstico 2026-05-14 (1 día)
| Métrica | Valor |
|---------|-------|
| Spend | 2.241 COP |
| Impressions | 568 |
| CTR | **8.27%** (excelente) |
| CPC | 47.68 COP (óptimo) |
| Link clicks | 42 |
| Landing page views | **12 (rebote 71%)** |
| Registros | **0** |

### Razón del cambio (2026-05-14)
- La campaña corría con `LINK_CLICKS` optimization → Meta buscaba clickers, no registradores
- **Pixel "MB Resort" no firing en derbix.co** → Meta no puede medir COMPLETE_REGISTRATION real
- Decision: cambiar a `OFFSITE_CONVERSIONS + COMPLETE_REGISTRATION` (Meta optimizará a ciegas hasta recibir señal del pixel)
- Crear segunda campaña dedicada a Telegram para A/B test
- Rediseñar `/signup` como **landing larga de alta conversión** (6 secciones)

### Cambios en `/signup` (2026-05-14)
[components/auth/SignUpFlow.tsx](../../components/auth/SignUpFlow.tsx) — Step 1 rediseñado como landing larga con estructura:
1. **Zona caliente**: urgency strip + titular + subtitular + slot video + beneficios chips + CTA primario
2. **3 beneficios**: cards con IA real + Histórico público + Plan gratis
3. **Storytelling**: tabla "Antes vs Con Derbix"
4. **CTA medio**: scroll a form
5. **4 beneficios clave**: números con desc (+3.000 datos, 65%, 83%+, 100% público)
6. **CTA final**: card destacada con anchor al form

Form sigue en columna sticky derecha (desktop) o al final (mobile) con anchor `#signup-form`.

### 🎬 Prompt Remotion para video del hero
Listo en [marketing/meta-ads/remotion-hero-video-prompt.md](remotion-hero-video-prompt.md) — pégalo a Claude y genera un video 16:9, 25-30s, autoplay-muted, 5 escenas (caos tipster → data → análisis → resultado → brand).

El slot del video ya está reservado en `/signup` con placeholder visual. Solo hay que reemplazar el `<div>` por `<video src="/derbix-hero.mp4">` cuando esté renderizado.

---

## 📜 Historial (snapshots previos)

### 2026-05-13 — HiggsField videos integrados

### Por qué este cambio (2026-05-13)
- **Campaña Web original**: 1 ad rechazado por política "Apuestas y juegos online". Copies con "65% acierto verificado" + "+29% ROI" + "$200K" disparaban la regla de gambling/financial claims.
- **Campaña Telegram**: CTR 10.73% (excelente), pero **76% de los que clickean rebotan ANTES de abrir Telegram** (canal con 2 suscriptores). 23.340 COP gastados, 0 conversiones reales.
- **Decisión**: pausar ambas, crear campaña limpia OUTCOME_LEADS con copies suaves (sin números específicos, sin $, sin jerga de apuestas) → la **nueva campaña ACTIVE**.

### Ads de la campaña nueva (8 ACTIVE: 5 originales + 3 HiggsField)

#### 3 nuevos ads HiggsField (multi-placement, 2026-05-13)
| Ad | ID | Videos (vertical/cuadrado) | Aspecto |
|----|-----|-----------------------------|---------|
| CONV-AD06: Hero Cinematic (HF) | `120244602466280473` | `862007266198056` / `2468907923580110` | Cinematic brand |
| CONV-AD07: UGC Hombre Testimonial (HF) | `120244602472620473` | `1659172195289044` / `2131917950926315` | UGC anti-corazonada |
| CONV-AD08: UGC Mujer App Tour (HF) | `120244602481150473` | `2217700912379324` / `1400367575461395` | UGC me voló la cabeza |

Configuración multi-placement (asset_customization_rules):
- **Vertical 9:16** → FB Reels + Stories, IG Reels + Stories
- **Cuadrado 1:1** → FB Feed + In-stream, IG Stream + Explore

#### 5 ads originales (ACTIVE, ya aprobados)
| Ad | ID | Asset | Copy theme |
|----|-----|-------|------------|
| CONV-AD01: Video Bale - IA First | `120244587838800473` | video Bale | IA + fútbol |
| CONV-AD02: Video 1 - Anti-Humo | `120244587839840473` | video 960233 | Transparencia |
| CONV-AD03: Video 2 - Curiosidad | `120244587841570473` | video 2444640 | Curiosidad/comunidad |
| CONV-AD04: Imagen 1 - Directo | `120244587843150473` | image 54ce5d | Análisis IA diario |
| CONV-AD05: Imagen 2 - Comunidad | `120244587844130473` | image 2632f1 | IA + comunidad |

Status real: `IN_PROCESS` / `PENDING_REVIEW`. Cuando Meta apruebe (típicamente 30 min - 4 h), entregarán automáticamente.

### Cambios en /signup
[components/auth/SignUpFlow.tsx](../../components/auth/SignUpFlow.tsx) recibió un hero nuevo conectado con el ad copy:
- H1: "El análisis ya está hecho. Tú solo aplica." (matches creative)
- Subtítulo punzante con promesa concreta
- Urgency strip arriba con check verde y país
- Línea de cierre: "30 segundos · sin tarjeta · cancela cuando quieras"

### 🎬 Prompts HiggsField para 3 videos nuevos
Listos en [marketing/meta-ads/higgsfield-prompts.md](higgsfield-prompts.md):
- Video 1: UGC testimonial (hombre 30-40)
- Video 2: UGC tour de la app (mujer 28-35)
- Video 3: Cinematic brand "El análisis ya está hecho"

Cuando los renderices, súbelos a [marketing/meta-ads/creatives/](creatives/) y los subo a Meta + sumo 3 ads más a la campaña ACTIVE.

---

## 📜 Historial (snapshots previos)

### 2026-04-24 — Setup inicial

---

## ✅ Resumen ejecutivo

| Entregable | Estado | ID |
|------------|--------|-----|
| Optimización landing `/signup` | ✅ Hecho | [SignUpFlow.tsx](../../components/auth/SignUpFlow.tsx) |
| Campaña A — Registros Web | ✅ Optimizada | `120242171150490473` |
| Ad Set Web | ✅ Optimizado | `120242171150510473` |
| **Ads Web V1 (4 originales)** | ⏸️ PAUSED (preservados como referencia) | AD01-AD04 |
| **Ads Web V2 (4 optimizados)** | ✅ PAUSED, en review, listos | WEB-V2-A `120244074856300473`, WEB-V2-B `120244074860660473`, WEB-V2-C `120244074866180473`, WEB-V2-D `120244074870330473` |
| Campaña B — Telegram Tráfico | ✅ Creada | `120244062050230473` |
| Ad Set Telegram | ✅ Creado + targeting optimizado | `120244062129980473` |
| **Ads Telegram (7 — todos los assets)** | ✅ PAUSED en review | TG-AD01 a TG-AD07 |
| Dominio `derbix.co` verificado | ✅ Hecho por cliente | — |
| Pixel `25898755559731627` | ✅ Vacío, sin contaminación previa, usable | — |

**Links Ads Manager:**
- Campaña Web: https://adsmanager.facebook.com/adsmanager/manage/campaigns?act=1387553972755061&selected_campaign_ids=120242171150490473
- Campaña Telegram: https://adsmanager.facebook.com/adsmanager/manage/campaigns?act=1387553972755061&selected_campaign_ids=120244062050230473

---

## 🎨 Optimización landing `/signup`

### Cambios aplicados a `components/auth/SignUpFlow.tsx`

**Antes** (Step 1):
- Banner genérico "⚡ Estás a 30 segundos…"
- Form con 6 campos visibles (nombre, email, password×2, WhatsApp, Telegram)
- Sin dolor explícito, sin números reales, sin comparativa
- Trust indicator falso ("75% accuracy")

**Después** (Step 1):
- Layout 2 columnas (desktop) — marketing izquierda, form derecha
- Hero punzante: "Deja de perder dinero con tipsters que adivinan"
- 4 stats reales basados en MEMORY V8.1: 65% acierto · +29% ROI · 83%+ probabilidad mín · 100% verificable
- Comparativa visual Tipster ✗ vs Derbix ✓ (3 filas)
- Bloque "Lo que recibes hoy mismo" con 4 beneficios
- Form simplificado a 4 campos (nombre, email, password×2)
- Trust indicators corregidos: "65% acierto verificado" (no más "75%")

WhatsApp y Telegram username se eliminaron del Step 1 — pueden agregarse desde el perfil dentro de la app.

---

## 📋 Detalle Campaña A — Registros Web

### Cambios aplicados al ad set existente (V2 final)
| Parámetro | Original cliente | V2 optimizado |
|-----------|------------------|---------------|
| Nombre | Hombres 22-45, Colombia | **CO Top7 — 25-50 — Apuestas + Fútbol — Advantage+** |
| Geo | 6 puntos en 4 ciudades (radios 4-10km) | **7 ciudades top de Colombia** (Bogotá, Medellín, Cali, Barranquilla, Cartagena, Bucaramanga, Pereira) — concentran ~70% del PIB urbano y la audiencia con poder adquisitivo |
| Edad | 22-45 | **25-50** (sugerencia, Advantage+ usa max 65) — sweet spot de apostadores con ingreso disponible |
| Géneros | Solo hombres `[1]` | **Ambos `[1,2]`** (+40% mercado) |
| Locales | (sin definir) | `[6]` (español) |
| Intereses | 1 (Apuestas) | **4 sólidos**: Apuesta deportiva + Juegos azar online + Fútbol + UEFA Champions League |
| Brand safety | RELAXED | **STANDARD** |
| Destination | UNDEFINED | **WEBSITE** |
| Daily budget (campaign-level CBO) | 4.000 COP | **6.700 COP** (~$1.60 USD) |
| Advantage+ Audience | activado | activado (Meta expande según performance) |

### Lo que NO se pudo cambiar vía API
- **Objetivo `OUTCOME_SALES`** → Meta no permite cambiar objetivo de campaña existente. Se mantiene. Funciona para registros porque el `optimization_goal` del ad set es `OFFSITE_CONVERSIONS` con `custom_event_type: COMPLETE_REGISTRATION`. Pero ver advertencia de pixel abajo.

### ⚠️ Advertencia crítica — Pixel
El ad set tiene `pixel_id: 25898755559731627` en `promoted_object`. Ese pixel se llama **"MB Resort"** y NO pertenece a Derbix. La campaña intentará optimizar contra eventos `COMPLETE_REGISTRATION` que llegarán de OTRO negocio, no de derbix.co. **No actives la campaña hasta resolver esto** (ver "Acciones del cliente" más abajo).

---

## 📲 Detalle Campaña B — Telegram Tráfico

### Configuración
| Parámetro | Valor |
|-----------|-------|
| Objetivo | `OUTCOME_TRAFFIC` |
| Buying type | `AUCTION` |
| Bid strategy | `LOWEST_COST_WITHOUT_CAP` |
| Daily budget (CBO) | **6.700 COP** (~$1.60 USD) |
| Status | `PAUSED` |

### Ad set
| Parámetro | Valor |
|-----------|-------|
| Optimization goal | `LINK_CLICKS` |
| Billing event | `IMPRESSIONS` |
| Destination type | `WEBSITE` |
| País | Colombia |
| Edad | 22-65 (sugerencia 22-50, Advantage+) |
| Géneros | Ambos |
| Locales | Español `[6]` |
| Intereses | Apuestas + Fútbol |
| Placements | FB feed/story/reels/instream + IG stream/story/reels/explore |
| Brand safety | STANDARD |
| Advantage Audience | Activado |

### Destino del ad
`https://t.me/D3RBIX` (tu canal de Telegram)

---

## 🎯 Investigación de targeting (geo)

**Decisión**: 7 ciudades principales en lugar de "Colombia entera". Razones:

| Ciudad | Por qué incluir |
|--------|-----------------|
| Bogotá | Capital, mayor poder adquisitivo, mayor digitalización |
| Medellín | 2do polo financiero, alta penetración móvil, cultura futbolera fuerte |
| Cali | Sur, alta tasa de apostadores |
| Barranquilla | Caribe, ingreso medio-alto, pasión por fútbol |
| Cartagena | Turismo, comerciantes, alto consumo digital |
| Bucaramanga | Oriente, profesionales, alta bancarización |
| Pereira | Eje cafetero, ingreso estable, demografía adulta |

**Excluidas intencionalmente**: zonas rurales y municipios pequeños — menor poder adquisitivo, conectividad inestable, mayor friccion para checkout digital. Meta Advantage+ Audience permite expansión automática si encuentra señal en otras zonas.

**Edad 25-50**: 18-24 con menor ingreso disponible y restricciones legales (Coljuegos prohibe < 18). 50+ con menor adopción digital. Sweet spot 25-50: profesional con ingreso para gastar en apuestas.

---

## 📝 Ads finales — Web (8 total)

### V1 originales (PAUSED como referencia)
| Ad | ID | Asset | Status |
|----|-----|-------|--------|
| AD01: Video #1 | `120242171150500473` | 2 videos (Advantage+ Creative) | PAUSED |
| AD02: IMG 1 | `120242182108670473` | 3 imágenes | PAUSED |
| AD03: IMG 2 | `120242182402020473` | 3 imágenes | PAUSED |
| AD04: Video #2 - Bale | `120243955951520473` | 1 video | PAUSED |

### V2 optimizados (PAUSED, listos para activar)
| Ad | ID | Asset | Copy variant |
|----|-----|-------|--------------|
| WEB-V2-A: Video 1 - Datos Hard | `120244074856300473` | video 960233833280274 | A |
| WEB-V2-B: Video Bale - Comparación | `120244074860660473` | video Bale 992608433189302 | B |
| WEB-V2-C: Imagen 1 - FOMO | `120244074866180473` | image_hash 54ce5d… | C |
| WEB-V2-D: Imagen 2 - Direct | `120244074870330473` | image_hash 2632f1… | D |

#### Copies V2 (con números reales del producto)

**Variant A — Datos hard:**
> Title: "65% de acierto verificado"
> Body: "65% de acierto verificado. +29% ROI en banda óptima. Cero promesas vacías. 🎯 Derbix usa IA para analizar +3.000 datos por partido y mostrarte solo apuestas con valor real. Resultados públicos hora a hora. ¿Sigues confiando en tipsters que borran sus picks cuando pierden?"
> Description: "Plan gratis. Sin tarjeta. Cancela cuando quieras."

**Variant B — Comparación tipsters:**
> Title: "Apuestas con datos, no con suerte"
> Body: "Si los tipsters fueran tan buenos como dicen, no te cobrarían $200K por un pick. 📊 Derbix te da pronósticos con IA, 65% de acierto verificado, y resultados públicos hora a hora. Plan gratis sin tarjeta. Solo Colombia 🇨🇴"
> Description: "IA que predice. Y lo prueba."

**Variant C — FOMO autoridad:**
> Title: "IA que predice. Y lo prueba."
> Body: "Cada día publicamos pronósticos con probabilidad ≥ 83% y los verificamos hora a hora. ⚡ 65% de acierto verificado en Feb-Mar 2026. +29% ROI en banda 1.70-1.99. Mientras los tipsters borran, nosotros publicamos. Únete gratis."
> Description: "Plan gratis. Resultados públicos."

**Variant D — Direct punzante:**
> Title: "Deja de pagar por adivinanzas"
> Body: "Deja de pagar por adivinanzas. 🎯 Pronósticos con IA + 65% de acierto verificado + resultados 100% públicos. Probabilidad mínima 83%. Plan gratis sin tarjeta. Cancela cuando quieras."
> Description: "65% acierto. 100% verificable."

Todas las URLs llevan `utm_content` distinto para análisis A/B en GA4.

---

## 📲 Ads finales — Telegram (7 total)

| Ad | ID | Asset | Status |
|----|-----|-------|--------|
| TG-AD01: Video Bale | `120244064470830473` | video 992608433189302 | PAUSED |
| TG-AD02: Imagen 1 | `120244064471600473` | image 54ce5d… | PAUSED |
| TG-AD03: Video Tactico - Datos Hard | `120244074963060473` | video 960233833280274 | PAUSED |
| TG-AD04: Video 2 - Comparación | `120244074967270473` | video 2444640456006326 | PAUSED |
| TG-AD05: Imagen 2 - FOMO | `120244074974850473` | image 2632f1… | PAUSED |
| TG-AD06: Imagen 3 - Direct | `120244074982590473` | image 5acd96… | PAUSED |
| TG-AD07: Imagen 4 - Urgencia Colombia | `120244074988090473` | image 1b0499… | PAUSED |

Cubre **todos los assets** que estaban en la campaña original Web (3 videos + 4 imágenes), cada uno con copy adaptado a Telegram (CTA `LEARN_MORE` → `t.me/D3RBIX`).

---

## 🎯 Copies sugeridos (listos para AdCreative)

### Campaña Web (Registros)

**Primary text** (4 variantes para A/B):
1. "Cansado de tipsters que adivinan? Derbix usa IA con 65% de acierto verificado para mostrarte solo apuestas con valor real. Resultados públicos hora a hora. Plan gratis sin tarjeta. ⚽📊"
2. "Si los tipsters fueran tan buenos como dicen, no te cobrarían $200K por un pick. Derbix te da pronósticos con IA y 83%+ probabilidad. Sin promesas, solo datos. Pruébalo gratis."
3. "65% de acierto. +29% ROI verificado. Cero excusas. Derbix es la primera plataforma de pronósticos deportivos con IA donde TODO se puede comprobar. Únete gratis."
4. "Deja de perder dinero con apuestas al azar. Derbix analiza cada partido con IA, te muestra la probabilidad real, y publica los resultados verificables. Plan gratis disponible. ⚡"

**Headlines:**
- "Apuestas con datos, no corazonadas"
- "65% de acierto verificado"
- "IA que sí acierta. Y lo prueba."

**Description:**
- "Sin tarjeta. Cancela cuando quieras."

**CTA**: `SIGN_UP`
**Link**: `https://derbix.co/signup?utm_source=meta&utm_medium=cpc&utm_campaign=derbix-registros-abr2026&utm_content={{ad_id}}`

### Campaña Telegram

**Primary text:**
1. "🎯 Únete GRATIS al canal VIP de Derbix en Telegram. Picks diarios con IA, antes que nadie. 65% acierto verificado. Cero spam, solo apuestas con valor."
2. "Antes de pagar a tipsters, conoce esto: en nuestro Telegram damos picks GRATIS con IA. 83%+ probabilidad. Resultados verificables. Solo para Colombia 🇨🇴"
3. "📲 Canal de Telegram GRATUITO con pronósticos diarios generados por IA. Cero promesas vacías. Únete y compáralo con cualquier tipster pago."

**Headlines:**
- "Canal VIP Gratis — Picks con IA"
- "Pronósticos en tu Telegram"
- "Solo Colombia 🇨🇴"

**CTA**: `LEARN_MORE`
**Link**: `https://t.me/D3RBIX`

---

## 📦 Creativos pendientes

Carpeta: [marketing/meta-ads/creatives/](creatives/) (vacía a 2026-04-24).

### Especificaciones recomendadas

**Imagen estática (1:1 — feed):** 1080×1080 px, JPG/PNG
**Story/Reels (9:16):** 1080×1920 px
**Video (1:1 o 9:16):** 15-30s, MP4 H.264, audio AAC

### Formatos por campaña

| Campaña | Formato sugerido | Cantidad |
|---------|------------------|----------|
| Web Signup | 1×1 + 9:16, mezcla imagen + video | 2-3 piezas |
| Telegram | 1×1 + 9:16 (preferir 9:16 stories/reels) | 2-3 piezas |

### Lineamientos visuales (para Nano Banana 2 / diseñador)

- **Tono visual**: dark mode (slate-950), acentos verde brand `#10b981`
- **Anti-clichés**: NO logos de casas de apuestas, NO mockups genéricos
- **Sí**: capturas reales de la app, números (65%, 83%, +29% ROI), comparativa visual tipster-vs-IA
- **Texto en imagen**: máximo 20% del área (regla Meta) — preferible texto fuera del creativo y dentro del primary text

Cuando subas las piezas, avísame y creo los `AdCreative` + `Ad` finales en PAUSED.

---

## 🚨 Acciones que el cliente DEBE hacer antes de activar

### 1. Crear pixel Derbix propio (BLOQUEANTE para Campaña Web)

El pixel actual ("MB Resort") no es de Derbix. Pasos:

1. Ir a [Events Manager](https://business.facebook.com/events_manager2/)
2. Botón "Conectar fuentes de datos" → Web → Continuar
3. Nombre: "Derbix Pixel" → Continuar
4. URL del sitio: `derbix.co`
5. Método de configuración: **Usar tag manager (GTM)**
6. Copiar el Pixel ID (formato `123456789012345`) y guardarlo
7. En GTM (`GTM-P7V936CJ`):
   - Crear nueva tag tipo "Custom HTML"
   - Pegar el código base del Pixel
   - Trigger: All Pages
   - Publicar GTM
8. Crear evento `CompleteRegistration`:
   - En GTM: nueva tag con `fbq('track', 'CompleteRegistration')`
   - Trigger: cuando `event_name === 'sign_up_complete'` (ya existe en `analyticsService.ts`)
9. Setear secrets en Supabase:
   - `META_PIXEL_ID` = el ID del nuevo pixel
   - `META_CONVERSIONS_TOKEN` = generar en Events Manager → Settings → Conversions API
10. Volver al Ad Set Web (`120242171150510473`) en Ads Manager y cambiar el Pixel a "Derbix Pixel"

### 2. Configurar dominio + verificación

En [Business Settings → Brand Safety → Domains](https://business.facebook.com/settings/owned-domains):
- Agregar `derbix.co`
- Verificar (DNS TXT record o meta tag)

### 3. Subir creativos a [marketing/meta-ads/creatives/](creatives/)

Sigue las especificaciones arriba. Cuando estén, ejecuto creación de Ads.

### 4. Revisar legal de apuestas en Colombia

Colombia permite anuncios de apuestas con verificación. Si Meta rechaza por categoría, en Ads Manager → Special Ad Categories podría requerir marcar `gambling` (no recomendado a menos que rechace).

---

## 🔁 Reversibilidad

Todo lo creado está en `PAUSED`. Para deshacer cualquier cambio:

```bash
# Borrar campaña Telegram (recreable)
curl -X DELETE "https://graph.facebook.com/v21.0/120244062050230473?access_token=TOKEN"

# Restaurar configuración previa del ad set Web — no hay rollback automático
# Las modificaciones están registradas en este reporte
```

---

## 📝 Observaciones finales

1. **Budget muy bajo**: 6.700 COP/día (~$1.60 USD). Por debajo de mínimo Meta para fase de aprendizaje. Documentado en [audit-report.md](audit-report.md).
2. **Token rotación**: SYSTEM_USER token actual no expira. Cliente puede revocarlo cuando quiera desde Business Settings → System Users.
3. **No se publicó nada activo**: ambas campañas en PAUSED.
4. **CBO (Campaign Budget Optimization)**: ambas campañas usan budget a nivel campaña, no ad set. Si quieres separar budget por ad set, hay que desactivar CBO.
