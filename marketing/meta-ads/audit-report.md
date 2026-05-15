# Audit Report — Meta Ad Account `act_1387553972755061`

**Fecha**: 2026-04-21
**Método**: Meta Graph API v21.0, solo GET (read-only)
**Token**: temporal, pendiente de rotación post-implementación

---

## 1. Cuenta publicitaria

| Campo | Valor | Nota |
|-------|-------|------|
| ID | `act_1387553972755061` | OK |
| Nombre | `Carla Rodriguez 2025` | ⚠️ Nombre no alineado con marca Derbix |
| Status | `1` (ACTIVE) | OK |
| Moneda | **USD** | ⚠️ **NO COP** — el budget de 400K COP se ingresa convertido a USD |
| Timezone | `America/Los_Angeles` | ⚠️ **NO Bogotá** — daily budget resetea a 00:00 PT |
| Spend cap | `0` | Sin límite |
| Balance / Spent | `0 / 0` | Cuenta nueva |
| Business owner | `1167656124195588` (Derbix) | OK |

**Conversión de presupuesto**: 400.000 COP ≈ $96 USD/mes (TRM ~4.150). Split 50/50 → **$48 USD/mes por campaña** ≈ **$1.60 USD/día**. *Ver nota de viabilidad abajo.*

---

## 2. Campañas existentes

**RESULTADO**: `{"data": []}` — **NO HAY campañas en la cuenta** (ni activas, ni pausadas, ni en borrador visible por API).

El usuario mencionó "una campaña montada en desarrollador". Posibles explicaciones:
- El borrador existe en **Ads Manager UI como Draft local** (no persistido como objeto API hasta publicar).
- Se refiere a otra cuenta.
- Se refiere a este proyecto técnico (código) y no a una campaña real.

**Acción**: Partimos de cero. Creamos las 2 campañas nuevas en status `PAUSED` (equivale a "borrador publicable").

---

## 3. Facebook Page disponible

| Campo | Valor |
|-------|-------|
| ID | `819296391275945` |
| Nombre | `Derbix AI` |
| Categoría | ⚠️ `Bienes raíces` (incorrecta) |
| Tasks | ADVERTISE, ANALYZE, CREATE_CONTENT, MESSAGING, MODERATE, MANAGE |
| Link | https://www.facebook.com/819296391275945 |

**Acción**: usable para ambas campañas. Recomendación: cambiar categoría a "Tecnología/internet" o "Sitio web de deportes" desde Ads Manager (manual).

---

## 4. Meta Pixel

| Campo | Valor |
|-------|-------|
| ID | `25898755559731627` |
| Nombre | ⚠️ `MB Resort` (no-Derbix) |
| Last fired | `2026-04-20 23:43 PT` |

**Diagnóstico crítico**:
- El código de Derbix NO tiene pixel hardcoded. Edge function `meta-conversions-api` lee `META_PIXEL_ID` de env, pero no está confirmado que apunte a este pixel.
- El nombre "MB Resort" sugiere que este pixel pertenece a otro negocio que compartió el ad account o lo instaló previamente.
- El spec `2026-04-05-adquisicion-marketing-design.md` dice "La plataforma NO tiene Meta Pixel" — coherente con que el pixel de la cuenta sea ajeno a Derbix.

**Acción requerida antes de campañas de conversión**:
1. Crear un **Pixel nuevo "Derbix"** en Events Manager.
2. Instalarlo vía GTM (`GTM-P7V936CJ`) en `derbix.co`.
3. Configurar evento `CompleteRegistration` en `/signup` success.
4. Setear `META_PIXEL_ID` y `META_CONVERSIONS_TOKEN` en Supabase secrets.
5. Validar eventos en Events Manager (Test Events).

Sin esto, la campaña de **conversiones** optimizará a ciegas. El audit recomienda **crear la campaña web también como Traffic** inicialmente, y migrarla a Conversions tras 50+ eventos.

---

## 5. Evaluación de viabilidad del presupuesto

Con $1.60 USD/día/campaña:
- **Meta recomienda mínimo** ~$5-10 USD/día por ad set para salir de fase de aprendizaje.
- **Auction thin**: con tan bajo budget la entrega será errática (alto CPM, pocas impresiones).
- **Fase de aprendizaje**: no se completará (requiere ~50 eventos de optimización en 7 días).

**Recomendación**: concentrar el gasto en **14 días** (Opción B del brainstorming previo) → $3.30/día por campaña. Aún bajo, pero más viable.

Usuario confirmó **Opción A** (400K/mes completo). Procedemos con eso y avisamos métricas de aprendizaje.

---

## 6. Resumen ejecutivo

| Pregunta | Respuesta |
|----------|-----------|
| ¿Hay una campaña existente para auditar? | **No** — partimos de cero |
| ¿Puedo crear las 2 campañas? | **Sí, en status `PAUSED`** (borrador) |
| ¿Hay Page disponible? | Sí — `Derbix AI` |
| ¿Pixel listo para conversiones? | **No** — el pixel de la cuenta es de otro negocio; hay que crear uno nuevo para Derbix |
| ¿Budget viable? | Muy bajo, pero ejecutable con expectativas ajustadas |
| ¿Token con permisos suficientes? | Sí (ADVERTISE, ANALYZE sobre Page y Ad Account) |

---

## 7. Plan inmediato (propuesto)

1. **Campaña A — Telegram** (Traffic): OK para crear ya.
2. **Campaña B — Web Signup**: Crear como **Traffic** inicialmente (URL: `https://derbix.co/signup`). Migrar a Conversions cuando el pixel de Derbix esté firing.
3. Ambas en `PAUSED` (borrador).
4. Después de revisión, usuario autoriza ir a `ACTIVE`.
