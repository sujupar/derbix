# Spec: Campañas Meta Ads — Derbix Abril 2026

**Fecha**: 2026-04-24
**Estado**: Aprobado por usuario
**Ejecutor**: Claude (vía Meta Graph API v21.0)
**Relacionado con**: [2026-04-05-adquisicion-marketing-design.md](./2026-04-05-adquisicion-marketing-design.md)

---

## Contexto

Implementar las 2 campañas de adquisición definidas en el spec del 5 de abril. Todo queda en estado `PAUSED` (borrador publicable) para que el usuario revise y active manualmente.

Usuario confirmó que **NO** se cambia:
- Cuenta publicitaria (`act_1387553972755061` — "Carla Rodriguez 2025", USD, LA timezone)
- Pixel existente (`25898755559731627` — "MB Resort")
- Page (`819296391275945` — "Derbix AI")

Decisión: **nombres irrelevantes**, se usan tal como están.

---

## Parámetros globales

| Parámetro | Valor |
|-----------|-------|
| Ad Account | `act_1387553972755061` |
| Page | `819296391275945` (Derbix AI) |
| País | Colombia (`CO`) |
| Moneda de budgets | USD |
| Presupuesto total | ~$96 USD/mes (equivalente a 400K COP, TRM ~4.150) |
| Split | 50/50 → $48 USD/mes/campaña → daily_budget $1.60 USD = **160 centavos** |
| Special ad categories | `[]` (no aplica) |
| Buying type | `AUCTION` |
| Status | `PAUSED` (borrador) |
| Objetivo default | `OUTCOME_TRAFFIC` (ambas; la web migra a Conversions cuando haya pixel Derbix) |

> **Nota de moneda**: Meta API exige `daily_budget` en unidades mínimas de la moneda de la cuenta. Cuenta en USD → `160` = $1.60 USD/día.

---

## Campaña A — Telegram Traffic

### Campaign
```json
{
  "name": "[Derbix] Telegram Traffic — Colombia — Abr 2026",
  "objective": "OUTCOME_TRAFFIC",
  "status": "PAUSED",
  "special_ad_categories": [],
  "buying_type": "AUCTION"
}
```

### Ad Set
```json
{
  "name": "Telegram — CO — Amantes de apuestas deportivas",
  "daily_budget": 160,
  "billing_event": "IMPRESSIONS",
  "optimization_goal": "LINK_CLICKS",
  "bid_strategy": "LOWEST_COST_WITHOUT_CAP",
  "destination_type": "WEBSITE",
  "targeting": {
    "geo_locations": { "countries": ["CO"] },
    "age_min": 21,
    "age_max": 55,
    "genders": [1, 2],
    "locales": [6],
    "flexible_spec": [{
      "interests": [
        { "id": "6003107902433", "name": "Football" },
        { "id": "6003439040219", "name": "Sports betting" }
      ],
      "behaviors": []
    }],
    "publisher_platforms": ["facebook", "instagram"],
    "facebook_positions": ["feed", "story", "instream_video", "marketplace"],
    "instagram_positions": ["stream", "story", "reels"],
    "device_platforms": ["mobile", "desktop"]
  },
  "status": "PAUSED"
}
```

### Ad Creative (placeholder, falta imagen)
```text
Primary text:
🎯 Pronósticos deportivos con IA. 83%+ de probabilidad real.
Únete GRATIS al canal de Telegram y recibe picks diarios antes que nadie.
Deja atrás a los tipsters que prometen y no cumplen. ⚽️📊

Headline:
Canal VIP Gratis — Picks con IA

Description:
Análisis generado por IA. Solo las apuestas con valor real.

CTA: LEARN_MORE
Link: https://t.me/D3RBIX
```

---

## Campaña B — Web Signup Traffic

### Campaign
```json
{
  "name": "[Derbix] Registros Web — Colombia — Abr 2026",
  "objective": "OUTCOME_TRAFFIC",
  "status": "PAUSED",
  "special_ad_categories": [],
  "buying_type": "AUCTION"
}
```

### Ad Set
```json
{
  "name": "Web Signup — CO — Apostadores valor",
  "daily_budget": 160,
  "billing_event": "IMPRESSIONS",
  "optimization_goal": "LANDING_PAGE_VIEWS",
  "bid_strategy": "LOWEST_COST_WITHOUT_CAP",
  "destination_type": "WEBSITE",
  "targeting": {
    "geo_locations": { "countries": ["CO"] },
    "age_min": 25,
    "age_max": 55,
    "genders": [1, 2],
    "locales": [6],
    "flexible_spec": [{
      "interests": [
        { "id": "6003439040219", "name": "Sports betting" },
        { "id": "6003107902433", "name": "Football" },
        { "id": "6003020834693", "name": "Gambling" }
      ]
    }],
    "publisher_platforms": ["facebook", "instagram"],
    "facebook_positions": ["feed", "story", "instream_video"],
    "instagram_positions": ["stream", "story", "reels", "explore"],
    "device_platforms": ["mobile", "desktop"]
  },
  "status": "PAUSED"
}
```

### Ad Creative (placeholder)
```text
Primary text:
Deja de caer en tipsters que no aciertan.
Derbix analiza cada partido con IA y te muestra solo las apuestas con VALOR REAL.
✅ 83%+ de probabilidad
✅ Análisis verificable
✅ Prueba gratis sin tarjeta

Headline:
Apuestas con datos, no corazonadas

Description:
Registro gratis. Cancela cuando quieras.

CTA: SIGN_UP
Link: https://derbix.co/signup?utm_source=meta&utm_medium=cpc&utm_campaign=derbix-registros-abr2026&utm_content=signup-v1
```

---

## Creativos pendientes

Usuario indicó que subiría piezas a [marketing/meta-ads/creatives/](../../../marketing/meta-ads/creatives/). A fecha 2026-04-24 la carpeta está vacía.

**Plan**: crear toda la estructura (Campaign + Ad Set + Saved Audiences) ahora, y dejar los Ad Creatives documentados como texto. Cuando lleguen las imágenes/videos:
1. Subir el hash al ad account (`POST /act_xxx/adimages` o `/advideos`)
2. Crear AdCreative con el hash + copy aprobado
3. Crear Ad (vinculando AdCreative ↔ Ad Set) en status `PAUSED`

---

## Entregable final

Un reporte en [marketing/meta-ads/deployment-report.md](../../../marketing/meta-ads/deployment-report.md) con:
- IDs de Campaign / Ad Set / Saved Audience creados
- Links directos a Ads Manager
- Checklist de qué falta (creativos + pixel Derbix)
- Instrucciones para activar (cambiar PAUSED → ACTIVE)

---

## Consideraciones

1. **Fase de aprendizaje**: con $1.60/día no se completará. Advertido en audit-report.
2. **Categorías especiales**: apuestas pueden requerir `SOCIAL_ISSUES, ELECTIONS_OR_POLITICS` o restricciones por país. Colombia permite anuncios de apuestas con verificación. Si Meta rechaza, se documenta y se propone autorización vía Business Manager.
3. **Reversibilidad**: todo lo creado está en `PAUSED`. Se puede borrar con un `DELETE` a cada ID si algo sale mal.
4. **Token**: usuario rotará al terminar implementación.
