# Sistema de Análisis Derbix vía Claude Cowork — Especificación Completa

**Versión del método:** `COWORK-V1` · **Motor persistido (`engine_version`):** `COWORK-V1` · **Timezone de negocio:** América/Bogotá (UTC−5) · **Fecha del documento:** 2026-07-22

Este documento define el reemplazo del pipeline de edge functions (`v9-pipeline-worker` + `v3-ai-analyzer` + `v2-create-job-sportmonks`) por una sesión programada de Claude Cowork (Opus 4.8, ultracode) que corre **la tarde anterior** (Bogotá), analiza cada partido de las ligas configuradas, y produce **un único archivo JSON** que el usuario **sube manualmente** en el panel Admin de Derbix. El verificador existente (`hourly-results-verifier`) **NO se toca** y sigue funcionando.

---

## 1. MÉTODO VALIDADO (pasos ejecutables por Cowork)

Cowork ejecuta este procedimiento una vez por corrida. La **fecha objetivo** `TARGET_DATE` = mañana en Bogotá (`YYYY-MM-DD`). La **lista de ligas** `LEAGUE_IDS` es un placeholder configurable (IDs de liga de SportMonks, p.ej. `8`=Premier, `564`=LaLiga, `384`=Serie A, `82`=Bundesliga, `301`=Ligue 1, `2`=Champions). Base de API: `https://api.sportmonks.com/v3/football`, auth `?api_token=$SPORTMONKS_API_KEY`, includes separados por `;`.

### Paso 0 — Preparación
1. Calcular `TARGET_DATE` = hoy Bogotá + 1 día. Fórmula de fecha Bogotá desde un timestamp UTC:
   ```
   Intl.DateTimeFormat('en-CA', {timeZone:'America/Bogota', year:'numeric', month:'2-digit', day:'2-digit'})
   ```
2. Calcular `NEXT_UTC` = `TARGET_DATE` + 1 día (necesario porque Bogotá UTC−5 abarca dos días UTC).

### Paso 1 — Descubrimiento de fixtures del día objetivo
3. Llamar DOS veces al endpoint de fecha (día objetivo y día siguiente UTC) y hacer merge/dedup por `fixture.id`:
   ```
   GET /fixtures/date/{TARGET_DATE}?api_token=KEY&include=participants;league;venue;state;scores&per_page=50&page=N
   GET /fixtures/date/{NEXT_UTC}?api_token=KEY&include=participants;league;venue;state;scores&per_page=50&page=N
   ```
   (Opcional, para reducir volumen: añadir `&filters=fixtureLeagues:{LEAGUE_IDS_CSV}`.)
4. Filtrar en memoria: conservar fixtures cuyo `getBogotaDate(starting_at) === TARGET_DATE` **y** cuyo `league.id ∈ LEAGUE_IDS`.
5. Si una liga configurada no tiene fixtures ese día → **saltarla** (no es error). Si el conjunto queda vacío → generar archivo con `matches: []` y `total_matches: 0` (día sin jornada).
6. De cada fixture retener: `fixture.id` (→ `fixture_id`), `league.id` (→ `league_id`), `league.name`, `starting_at` (UTC → `kickoff_utc`), `getBogotaDate(starting_at)` (→ `match_date`), `season.id`, y participantes por `meta.location`:
   - `home = participants.find(p => p.meta.location==='home')` → `home.id`, `home.name`, `home.image_path`
   - `away = participants.find(p => p.meta.location==='away')` → `away.id`, `away.name`, `away.image_path`

### Paso 2 — Pull de datos SportMonks por partido (orden exacto)
Para cada fixture, en este orden (los últimos 6 en paralelo tras obtener IDs):
7. **Fixture completo** (obtiene `homeTeamId`, `awayTeamId`, `seasonId`):
   ```
   GET /fixtures/{fixtureId}?api_token=KEY&include=participants;lineups;lineups.player;statistics.type;events;scores;venue;referees;formations;coaches;sidelined;weatherReport;xGFixture;league;season;state;round
   ```
8. **Historial home** (últimos 25, rango 2 años):
   ```
   GET /fixtures/between/{HOY-2A}/{HOY}/{homeTeamId}?api_token=KEY&include=participants;scores;venue;league;statistics;events;xGFixture&per_page=25&order=desc
   ```
9. **Historial away** (idéntico con `awayTeamId`).
10. **H2H**:
    ```
    GET /fixtures/head-to-head/{homeTeamId}/{awayTeamId}?api_token=KEY&include=participants;scores;statistics;events;referees&per_page=20
    ```
11. **Standings**:
    ```
    GET /standings/seasons/{seasonId}?api_token=KEY&include=participant;details
    ```
    (type_ids: 129 PJ, 130 G, 131 E, 132 P, 133 GF, 134 GC, 179 DG.)
12. **Odds pre-match** (fuente de cuotas reales — obligatorio):
    ```
    GET /odds/pre-match/fixtures/{fixtureId}?api_token=KEY&include=market;bookmaker
    ```
13. **Predictions/probabilities** (si el plan lo cubre; ignorar 403):
    ```
    GET /predictions/probabilities/fixtures/{fixtureId}?api_token=KEY
    ```

**Extracción de scores en historial** (gotcha: hay DOS entradas `CURRENT`, una por participante):
```
homeGoals = scores.find(s => s.description==='CURRENT' && s.score.participant==='home').score.goals
awayGoals = scores.find(s => s.description==='CURRENT' && s.score.participant==='away').score.goals
```
**type_ids de stats** para features/verificación: 34 córners, 84 amarillas, 83 rojas, 86 remates a puerta, 42 remates totales, 45 posesión, 580/xGFixture xG.

### Paso 3 — Investigación web dirigida (SIN Perplexity)
Para cada partido, buscar en la web (búsquedas en inglés y en el idioma local del club):
14. **Alineaciones confirmadas / probables**: `"{home} vs {away} predicted lineup {TARGET_DATE}"`, `"{home} team news"`. Buscar en fuentes deportivas reconocidas (sitios oficiales del club, medios deportivos mayores, agregadores de lineups reputados).
15. **Lesiones/suspensiones**: ausencias de titulares, especialmente goleador, creador (playmaker) y portero titular.
16. **Rotación/calendario**: partido europeo entre semana, tres partidos en siete días, viaje largo.
17. **Motivación**: fin de temporada (equipo ya salvado/campeón/sin objetivos vs. peleando título o descenso), derbi/rivalidad.
18. **Clima**: lluvia/viento fuerte → sesgo a menos goles.

**Confianza de fuente y qué hacer si no hay info:**
- `CONFIRMED` — XI oficial confirmado (típico ~1h antes; en corrida de la tarde anterior rara vez existe).
- `PROBABLE` — XI previsto por ≥2 fuentes reputadas concordantes.
- `UNAVAILABLE` — sin datos fiables → **no inventar**; marcar `lineup_status: "UNAVAILABLE"` y **topar la confianza de todo el partido en MEDIA** (nunca ALTA). El ajuste contextual del paso 5 queda en 0 cuando no hay información verificable.
- Regla dura: una fuente única no reputada NO sube la confianza; ante conflicto entre fuentes, usar la más conservadora.

### Paso 4 — Features y baseline matemático (determinista, ancla obligatoria)
Calcular con los datos del Paso 2. Defaults de liga: **`leagueAvgGoalsHome = 1.5`**, **`leagueAvgGoalsAway = 1.1`**.

**Features:**
19. Streak = últimos **5** resultados `"WWDLW"`. Días de descanso = días desde último partido (**default 7** sin dato).
20. Promedios goles a favor/contra ventanas **5 y 10** (`home_for_5`, `home_against_10`, `away_for_5`…). Preferir **xG for/against** si `xGFixture` está disponible (menos ruido); si no, usar goles como proxy.
21. Split real local/visita (NO 50/50): usar rendimiento del local como local y del visitante como visitante.
22. Árbitro: `{yellows_per_match, reds_per_match}` de sus partidos; null si no hay muestra.
23. Impacto de lesiones en xG: `injuryXGLoss = min(0.6, n_ausentes_titulares × 0.15)` (cada titular ausente −0.15 xG, tope −0.6). Aplicar al λ del equipo afectado.
24. Contexto: `is_relegation_battle` = gap a salvación < 5 pts; `is_title_race` = rank ≤ 3.

**Dixon-Coles (ancla principal de goles):**
25. Fuerzas: `attack_home = avgHomeGoalsFor / max(1.5, 0.1)`, `defense_away = avgAwayGoalsAgainst / max(1.1,0.1)`, análogos para el otro lado.
26. λ: `λ_home = attack_home × defense_away_rival × 1.5`; `λ_away = attack_away × defense_home_rival × 1.1`; piso **0.1**. Restar `injuryXGLoss` al λ del equipo con bajas.
27. **Time-decay** al promediar historial: peso `φ(t) = exp(−ξ · días)` con **`ξ = 0.0025`/día**.
28. Corrección de dependencia de marcadores bajos: **`ρ = −0.08`** sobre celdas 0-0, 1-0, 0-1, 1-1. Matriz **8×8** (`maxGoals=7`), normalizada → 1X2, doble oportunidad, Over/Under 0.5–4.5, BTTS, goles por equipo, top-5 marcadores, `expected_total_goals`.

**Elo (solo 1X2, como feature/prior):**
29. `E_home = 1/(1+10^((R_away−R_home−65)/400))` (ventaja local +65, baseline 1500). K: liga 20, copa 30, Champions 40, final 60. Multiplicador goal-diff cap 2.75. Draw rate base **0.26**, ajustado `max(0.15, 0.26·exp(−Δrating/400))`. Confianza: HIGH ≥15 partidos, MEDIUM ≥8, else LOW.

**Monte Carlo (distribución más rica):**
30. **10.000 simulaciones** Poisson independiente con λ de Dixon-Coles → 1X2, doble oportunidad, Over/Under 0.5–4.5, BTTS, goles por equipo, combinados (home_win_and_over25, home_win_and_btts, away_win_and_over25, draw_and_over25), top-5 marcadores.

**Ensemble:**
31. 1X2: `MC×0.5 + DC×0.3 + Elo×0.2`. Over 2.5 y BTTS: `MC×0.6 + DC×0.4`. Consistencia = `max(0, 1 − stdDev(home_win de los 3)×4)`.

### Paso 5 — Probabilidad anclada + ajuste contextual acotado
32. La probabilidad publicable de cada mercado **parte del ensemble** (`p_model_base`). El razonamiento del agente (rol: analista, no generador) aplica un **ajuste acotado** por el contexto del Paso 3:
    - Ausencia de goleador/creador → bajar prob de over/victoria del afectado; portero titular fuera → subir over.
    - Fatiga/rotación fuerte → moderar hacia el rival o hacia under.
    - Motivación nula (equipo salvado sin objetivo) → aumentar varianza (bajar confianza).
33. **Reglas duras del ajuste (anti-alucinación):**
    - Desviación máxima respecto al modelo: **±15 puntos porcentuales**. Cualquier desviación >15 pts DEBE citar razón concreta y verificable en `reasoning`; sin ella, volver al modelo.
    - Mercados **NO modelados** (córners, tarjetas, hándicap asiático, mitades): ser conservador y **topar confianza en MEDIA** siempre.
    - `lineup_status: UNAVAILABLE` → ajuste = 0.
    - El ajuste **solo reduce** el edge implícito frente al modelo cuando hay incertidumbre; nunca lo infla sin evidencia.

### Paso 6 — De-vig del mercado y edge
34. Del catálogo del Paso 2 (`/odds/pre-match`), para cada mercado tomar la cuota real (**mediana** entre bookmakers, prioridad bet365(2) > Pinnacle(6) > Unibet(5) > 10bet(25) > 1xBet(27) > William Hill(28) > Betway(32)); descartar valores fuera de `[1.01, 50]`.
35. **De-vig** de la cuota de referencia para obtener probabilidad justa de mercado. Método por defecto **power** (elevar cada prob implícita a `k` tal que sumen 1); si no, **multiplicativo** (`(1/odds)/Σ(1/odds)`). Guardar `p_market_devig`.
36. **Market blending** (mejora de calibración): `p_final = w·p_model_ajustada + (1−w)·p_market_devig`, con **w = 0.5** por defecto (rango operativo 0.3–0.6). Encoger hacia el mercado reduce varianza. Usar `p_final` para edge y gates.
37. **Edge** con cuota real: `edge = (p_final − 1/odds) / (1/odds)`. `p_implied = 1/max(odds, 1.01)`.

### Paso 7 — Selección de picks y gates (orden estricto)
Aplicar en orden; el pick que falle cualquiera se descarta:
38. **Gate probabilidad:** `p_final ≥ 0.80` (80%). Por debajo no es oportunidad.
39. **Gate cuota real:** la cuota debe existir en el catálogo (matching por tokens normalizados NFD/lowercase de `"market:selection"`; si el target tiene número como 2.5, el label debe tener el **mismo** número; rechazar Asian splits tipo "Under 2.5, 3.0"). Sin match → descartar (no publicar cuota inventada). **Draw No Bet:** enrutar solo a entradas `Empate No Acción`/"Match Winner (no draw)" en MAIN; nunca al token `empate`.
40. **Gate rango publicable:** `1.20 ≤ odds ≤ 4.50`.
41. **Gate coherencia prob↔odds** (`PROB_ODDS_SANITY_TABLE`, NUNCA quitar):

    | `p_final ≥` | odds máx |
    |---|---|
    | 0.95 | 1.25 |
    | 0.90 | 1.35 |
    | 0.85 | 1.50 |
    | 0.83 | 1.55 |
    | 0.80 | 1.60 |

    Modelo `edge=(prob−1/odds)/(1/odds)`. Se evalúa de mayor a menor banda; primer `prob ≥ minProb` gana. `odds ≤ 1.0` → inválida; `prob ∉ (0,1]` → inválida. edge > ~25% ≈ error → rechazar.
42. **Gate edge mínimo:** `edge ≥ 0.03` (3%) tras el blend (evita picks marginales; el blend ya recorta el edge falso).
43. **Límites de volumen:** máx **5 picks por partido**; máx **15 oportunidades por día** (global). Priorizar diversidad: evaluar explícitamente las 7 categorías (1X2, Doble Oportunidad, Over/Under Goles, BTTS, Córners, Tarjetas, Hándicap), idealmente 2-3 categorías distintas entre los picks del día.

### Paso 8 — Confianza y staking sugerido
44. **Confianza:**
    - `ALTA` — mercado modelado, `model_consistency ≥ 0.6`, muestra ≥15, `lineup_status ∈ {CONFIRMED, PROBABLE}`, sin divergencia LLM↔modelo >15 pts.
    - `MEDIA` — divergencia 15–25 pts, o mercado no modelado, o `lineup_status UNAVAILABLE`, o muestra 8–14.
    - `BAJA` — divergencia >25 pts (prob forzada al blend), muestra <8, o `elo_confidence=LOW` con `model_consistency<0.4`.
45. **Staking sugerido (informativo):** ¼-Kelly con cap 5%. `kelly_frac = max(0, ((p_final·(odds−1) − (1−p_final))/(odds−1)) × 0.25)`; `stake_pct = min(0.05, kelly_frac)`.

**Invariantes no negociables:** (1) los modelos matemáticos son el ancla y se computan siempre; (2) nunca publicar una cuota sin verificarla contra el catálogo real; (3) el gate de coherencia es la última defensa; (4) el blend solo reduce edge; (5) mercados no modelados topan en MEDIA.

---

## 2. FORMATO DEL ARCHIVO DIARIO (JSON)

Un único archivo autocontenido: `derbix-analysis-{TARGET_DATE}.json`. Todos los strings de `market`/`selection` usan el **vocabulario EXACTO** de SportMonks-normalizer (ver tabla más abajo).

### (a) Esquema con tipos y obligatoriedad

```jsonc
{
  "meta": {
    "schema_version":   "1.0",              // string, OBLIGATORIO
    "method_version":   "COWORK-V1",        // string, OBLIGATORIO -> engine_version en DB
    "engine_version":   "COWORK-V1",        // string, OBLIGATORIO (load-bearing: delete/replace key)
    "prompt_version":   "COWORK-V1",        // string, OBLIGATORIO (reports_v2.prompt_version NOT NULL)
    "target_date":      "2026-07-23",       // string YYYY-MM-DD Bogotá, OBLIGATORIO (== match_date)
    "generated_at_utc": "2026-07-22T22:10:00Z", // string ISO-8601, OBLIGATORIO
    "generated_at_bogota":"2026-07-22 17:10", // string, opcional
    "timezone":         "America/Bogota",   // string, opcional
    "leagues_included": [8, 564, 384],      // number[], OBLIGATORIO (SportMonks league IDs configurados)
    "total_matches":    2,                  // number, OBLIGATORIO
    "total_picks":      5                   // number, OBLIGATORIO
  },

  "matches": [
    {
      // ---- Identidad del partido (-> daily_matches) ----
      "fixture_id":      18535517,          // integer, OBLIGATORIO  (SportMonks fixture.id; api_fixture_id / value_picks_v2.fixture_id)
      "league_id":       8,                 // integer|null. En DB se persiste NULL (FK allowed_leagues). Se conserva aquí para trazabilidad.
      "league_name":     "Premier League",  // string, OBLIGATORIO
      "match_date":      "2026-07-23",       // string YYYY-MM-DD Bogotá, OBLIGATORIO (== meta.target_date)
      "scan_date":       "2026-07-22",       // string YYYY-MM-DD, OBLIGATORIO (daily_matches.scan_date NOT NULL)
      "kickoff_utc":     "2026-07-23T19:00:00Z", // string ISO-8601, OBLIGATORIO -> daily_matches.match_time
      "home_team":       "Manchester City",  // string, OBLIGATORIO
      "away_team":       "Liverpool",         // string, OBLIGATORIO
      "home_team_logo":  "https://.../city.png",  // string|null
      "away_team_logo":  "https://.../liverpool.png", // string|null
      "home_team_id":    9,                  // integer, opcional (trazabilidad)
      "away_team_id":    8,                  // integer, opcional
      "season_id":       23614,              // integer, opcional
      "match_status":    "NS",               // string, OBLIGATORIO (arranca 'NS'; el verificador lo actualiza)

      // ---- Contexto de investigación (informativo/auditoría) ----
      "research": {
        "lineup_status": "PROBABLE",          // CONFIRMED|PROBABLE|UNAVAILABLE, OBLIGATORIO
        "home_absences": ["Rodri (lesión)"],  // string[]
        "away_absences": [],
        "weather":       "Despejado, 18°C",   // string|null
        "motivation_note":"Ambos pelean título", // string|null
        "sources":       ["fuente-deportiva-A", "fuente-deportiva-B"] // string[]
      },

      // ---- Baseline matemático (auditoría + report_packet) ----
      "math_baseline": {
        "lambda_home": 1.82, "lambda_away": 1.34,   // number
        "expected_total_goals": 3.16,               // number
        "ensemble_1x2": { "home": 0.52, "draw": 0.24, "away": 0.24 }, // 0-1
        "over_2_5": 0.58, "btts_yes": 0.61,          // 0-1
        "elo": { "home": 1712, "away": 1698, "confidence": "HIGH" },
        "model_consistency": 0.74,                    // 0-1
        "home_sample_size": 18, "away_sample_size": 16
      },

      // ---- Picks -> value_picks_v2 ----
      "picks": [
        {
          "market":       "Más/Menos Goles",     // string EXACTO del dict, OBLIGATORIO
          "selection":    "Over 2.5",             // string EXACTO ("Mercado: Selección" sin el prefijo), OBLIGATORIO
          "p_model":      0.84,                   // number 0-1, OBLIGATORIO (== p_final)
          "p_implied":    0.556,                  // number 0-1, OBLIGATORIO (1/max(odds,1.01))
          "odds":         1.80,                   // number, OBLIGATORIO (cuota REAL del catálogo)
          "odds_source":  "real",                 // "real"|null, OBLIGATORIO ('real' o null; NUNCA 'unavailable' para oportunidades)
          "edge":         0.512,                  // number (fracción; (p_model - p_implied)/p_implied)
          "confidence":   82,                     // integer 0-100, OBLIGATORIO
          "confidence_label":"ALTA",              // ALTA|MEDIA|BAJA, opcional (deriva de confidence)
          "decision":     "BET",                  // "BET"|"WATCH"|"AVOID", OBLIGATORIO (siempre "BET" para publicados)
          "is_opportunity": true,                 // boolean, OBLIGATORIO (p_model>=0.80)
          "is_primary_pick": true,                // boolean (idx===0)
          "rank":         1,                      // integer (idx+1 dentro del partido)
          "reasoning":    "Ensemble over 0.58; ambos anotan alto; City sin bajas ofensivas...", // string -> risk_notes (STRING, no objeto)
          "bookmaker":    "bet365",               // string, opcional
          "kelly_stake_pct": 0.028                // number, opcional (¼-Kelly cap 5%)
        }
      ]
    }
  ]
}
```

**Notas de fidelidad al esquema real de la DB:**
- `value_picks_v2.risk_notes` se puebla con el **string** `reasoning` (no un objeto), replicando `v9-pipeline-worker`.
- `opportunity_rank` **NO va en el archivo** → siempre `null` al insertar; lo asigna la ingesta/`v2-generate-parlays` Step 5.5 globalmente.
- `opportunity_date` = `match_date` (fecha Bogotá) — lo deriva la ingesta, no el archivo.
- `engine_version`/`prompt_version` vienen de `meta` (load-bearing para delete-then-insert).
- `daily_matches.league_id` se inserta **NULL** aunque el archivo traiga `league_id` (FK a `allowed_leagues` con IDs distintos).
- `result` arranca `'PENDING'` (lo pone la ingesta, no el archivo).

### (b) Ejemplo real completo (1 partido, 3 picks)

```json
{
  "meta": {
    "schema_version": "1.0",
    "method_version": "COWORK-V1",
    "engine_version": "COWORK-V1",
    "prompt_version": "COWORK-V1",
    "target_date": "2026-07-23",
    "generated_at_utc": "2026-07-22T22:10:00Z",
    "generated_at_bogota": "2026-07-22 17:10",
    "timezone": "America/Bogota",
    "leagues_included": [8],
    "total_matches": 1,
    "total_picks": 3
  },
  "matches": [
    {
      "fixture_id": 18535517,
      "league_id": 8,
      "league_name": "Premier League",
      "match_date": "2026-07-23",
      "scan_date": "2026-07-22",
      "kickoff_utc": "2026-07-23T19:00:00Z",
      "home_team": "Manchester City",
      "away_team": "Liverpool",
      "home_team_logo": "https://cdn.sportmonks.com/images/soccer/teams/9/9.png",
      "away_team_logo": "https://cdn.sportmonks.com/images/soccer/teams/8/8.png",
      "home_team_id": 9,
      "away_team_id": 8,
      "season_id": 23614,
      "match_status": "NS",
      "research": {
        "lineup_status": "PROBABLE",
        "home_absences": ["Rodri (lesión de rodilla)"],
        "away_absences": ["Alisson (duda)"],
        "weather": "Nublado, 17°C, viento leve",
        "motivation_note": "Duelo directo por el título; ambos con máxima motivación",
        "sources": ["medio-deportivo-mayor-A", "agregador-lineups-B"]
      },
      "math_baseline": {
        "lambda_home": 1.86,
        "lambda_away": 1.28,
        "expected_total_goals": 3.14,
        "ensemble_1x2": { "home": 0.53, "draw": 0.23, "away": 0.24 },
        "over_2_5": 0.59,
        "btts_yes": 0.63,
        "elo": { "home": 1715, "away": 1700, "confidence": "HIGH" },
        "model_consistency": 0.76,
        "home_sample_size": 19,
        "away_sample_size": 17
      },
      "picks": [
        {
          "market": "Más/Menos Goles",
          "selection": "Over 2.5",
          "p_model": 0.83,
          "p_implied": 0.5556,
          "odds": 1.80,
          "odds_source": "real",
          "edge": 0.494,
          "confidence": 80,
          "confidence_label": "ALTA",
          "decision": "BET",
          "is_opportunity": true,
          "is_primary_pick": true,
          "rank": 1,
          "reasoning": "Ensemble Over2.5=0.59, blend con mercado de-vig sube a 0.83 tras confirmar ataque de City sin bajas ofensivas; lambda total 3.14. Portero visitante en duda refuerza over.",
          "bookmaker": "bet365",
          "kelly_stake_pct": 0.021
        },
        {
          "market": "Ambos Anotan",
          "selection": "Yes",
          "p_model": 0.81,
          "p_implied": 0.5882,
          "odds": 1.70,
          "odds_source": "real",
          "edge": 0.377,
          "confidence": 78,
          "confidence_label": "MEDIA",
          "decision": "BET",
          "is_opportunity": true,
          "is_primary_pick": false,
          "rank": 2,
          "reasoning": "BTTS ensemble 0.63; ambos equipos marcan en >70% de sus últimos 10. Blend con mercado 1.70 mantiene edge positivo.",
          "bookmaker": "Pinnacle",
          "kelly_stake_pct": 0.018
        },
        {
          "market": "Doble Oportunidad",
          "selection": "1X",
          "p_model": 0.86,
          "p_implied": 0.6667,
          "odds": 1.50,
          "odds_source": "real",
          "edge": 0.290,
          "confidence": 83,
          "confidence_label": "ALTA",
          "decision": "BET",
          "is_opportunity": true,
          "is_primary_pick": false,
          "rank": 3,
          "reasoning": "1X2 ensemble home=0.53 draw=0.23 => 1X=0.76 modelo; blend con mercado y ventaja de localía Elo (+65) sube a 0.86. Cuota 1.50 dentro de banda de coherencia (0.85->1.50).",
          "bookmaker": "bet365",
          "kelly_stake_pct": 0.030
        }
      ]
    }
  ]
}
```

### (c) Vocabulario EXACTO obligatorio (`market` → categoría)

`Resultado 1X2`, `Empate No Acción`, `Doble Oportunidad` (MAIN) · `Más/Menos Goles`, `Ambos Anotan` (GOALS) · `Asian Handicap`, `Total Goles Local`, `Total Goles Equipo` (TEAMS) · `Resultado al Descanso`, `Resultado 1er Tiempo`, `Resultado 2do Tiempo`, `Más/Menos Goles 1T` (HALVES) · `Más/Menos Esquinas`, `Asian Handicap Esquinas` (CORNERS) · `Half Time / Full Time`, `Resultado y Ambos Anotan`, `Resultado y Total Goles`, `Total Goles + BTTS` (COMBOS) · `Marcador Exacto`, `Total Tarjetas` (OTHERS).

**Selecciones** (formato tras "Mercado: "): `Manchester City (Local)`, `Liverpool (Visitante)`, `Empate`, `Over 2.5`, `Under 2.5`, `Yes`, `No`, `1X`, `X2`, `12`. Draw No Bet: market `Empate No Acción`, selection `Manchester City (Local)` (nunca `Empate`).

---

## 3. INGESTA EN DERBIX (plan de implementación)

### (a) Nueva edge function: `import-daily-analysis`

Ruta: `supabase/functions/import-daily-analysis/index.ts`. Deploy: `npx supabase functions deploy import-daily-analysis` (**CON** verify-jwt — solo admin autenticado; a diferencia de las del pipeline).

**Contrato:** recibe `POST` con el JSON completo del archivo en el body (`{ payload: <archivo>, dryRun?: boolean, overwrite?: boolean }`). Devuelve `{ ok, counts, warnings, errors, preview }`.

**Lógica (orden estricto, respeta reglas de datos de CLAUDE.md):**

1. **Auth + rol:** verificar JWT y que el usuario sea `platform_owner`/`agency_admin`/`superadmin` (patrón de `TeamManagement`/superadmin). Rechazar si no.
2. **Validación de esquema** (antes de escribir nada):
   - `meta` presente con `target_date`, `engine_version`, `prompt_version`, `total_matches`, `total_picks`.
   - Cada match: `fixture_id` (int), `home_team`, `away_team`, `match_date`, `kickoff_utc`, `scan_date`.
   - Cada pick: `market` ∈ dict de mercados, `selection` no vacío, `p_model ∈ (0,1]`, `odds ≥ 1.01`, `decision ∈ {BET,WATCH,AVOID}`, `confidence ∈ [0,100]`.
   - **Re-validar gates server-side** (defensa en profundidad): coherencia prob↔odds (`checkProbOddsCoherence` de `_shared/odds-selector.ts`), rango `1.20 ≤ odds ≤ 4.50`, `p_model ≥ 0.80` para `is_opportunity`. Picks que fallen → excluidos con warning (no abortan el import).
   - Consistencia de fechas: `match_date === meta.target_date`.
   - Si `dryRun` → devolver `preview` (conteos, picks aceptados/rechazados, warnings) sin escribir.
3. **Por cada match, upsert en `daily_matches`** con `onConflict: 'api_fixture_id,match_date'` (compuesto, obligatorio):
   ```
   { scan_date, match_date, api_fixture_id: fixture_id, league_id: null, league_name,
     home_team, away_team, home_team_logo, away_team_logo, match_time: kickoff_utc,
     match_status: 'NS', is_analyzed: true }
   ```
   **NUNCA** tocar `home_score`/`away_score`/`match_status` si la fila ya existe con resultado (no sobreescribir lo que el verificador escribió; usar upsert que preserve esos campos — hacer `select` previo y solo actualizar identidad/logos).
4. **Crear job en `analysis_jobs_v2`** por partido (raíz FK):
   ```
   { fixture_id, status: 'done', engine_version: meta.engine_version, retry_count: 0, permanent_failure: false }
   ```
   Guardar `job_id` devuelto.
5. **Insertar `reports_v2`** (delete-then-insert por `fixture_id + engine_version`):
   ```
   { job_id, fixture_id, prompt_version: meta.prompt_version, engine_version: meta.engine_version,
     report_packet: { resumen_ejecutivo, pronosticos: picks, math_models_used: math_baseline,
                      research, ... }, math_models_used: math_baseline, debate_metadata: null }
   ```
   `report_packet` debe traer una estructura que `adaptV3ToFrontend()` sepa scavengear (`resumen_ejecutivo`, `pronosticos`); reutilizar los campos del match.
6. **Insertar `value_picks_v2`** (delete `WHERE fixture_id=X AND engine_version=meta.engine_version`, luego insert):
   ```
   { job_id, fixture_id, market, selection, p_model, p_implied, odds, edge,
     decision, confidence, engine_version: meta.engine_version,
     risk_notes: reasoning (STRING), is_primary_pick, rank,
     is_opportunity: (p_model>=0.80), opportunity_date: match_date, opportunity_rank: null,
     odds_source: 'real', result: 'PENDING' }
   ```
7. **Asignar `opportunity_rank` global** (equivalente a `v2-generate-parlays` Step 5.5): tras insertar todos los picks del día, seleccionar los `is_opportunity=true` de `opportunity_date=target_date`, ordenar por `p_model desc` (secundario `edge desc`), tomar top 20 (`MAX_OPPORTUNITIES_PER_DAY` es 15 para picks nuevos; el rank global usa hasta 20) y setear `opportunity_rank = 1..N`. **Surgical**, no bulk reset. Alternativa: invocar `v2-generate-parlays` con `{ date: target_date, forceRegenerate: true }` al final para reusar su Step 5.5 exacto (recomendado — evita duplicar lógica).
8. Devolver `{ ok:true, counts: {matches, picks_inserted, picks_rejected}, warnings, errors }`.

**Compatibilidad con el verificador:** intacta. `hourly-results-verifier` solo necesita filas en `daily_matches` (por `api_fixture_id`+`match_date`) y picks en `value_picks_v2` con `result='PENDING'`, `is_opportunity`, `odds_source ∈ {real,null}`, `fixture_id`, `market`, `selection`, `p_model`, `odds`, `job_id`. Todos provistos.

### (b) UI de subida en el panel Admin

Ubicación real: **`components/superadmin/OperationsCenter.tsx`** (ya es el centro de operaciones; hoy tiene el toggle "Análisis Diario"). Añadir una tarjeta/sección **"Importar Análisis del Día"**. Alternativa: nuevo componente `components/admin/DailyAnalysisImport.tsx` enlazado desde el panel `admin` (Page `'admin'` en `App.tsx`, visible solo a `isAgencySuperadmin`).

Flujo de la UI:
1. `<input type="file" accept="application/json">` + drag-and-drop.
2. Al seleccionar: `JSON.parse` en cliente, mostrar **preview** — fecha objetivo, nº partidos, nº picks, ligas incluidas, tabla de picks (partido, mercado, selección, prob, cuota, confianza).
3. Botón **"Validar"** → invoca `import-daily-analysis` con `dryRun:true`; muestra picks aceptados/rechazados y warnings (cuota incoherente, fuera de rango, fecha inconsistente).
4. Botón **"Confirmar importación"** → invoca con `dryRun:false`. Patrón:
   ```typescript
   const { data, error } = await supabase.functions.invoke('import-daily-analysis', {
     body: { payload: parsedJson, dryRun: false, overwrite: reimport }
   });
   ```
5. Mostrar resultado: conteos insertados, errores, link a Oportunidades del día. Estados: idle → parsing → validated → importing → done/error, con toasts (patrón de los otros dashboards admin).

### (c) Riesgos y validaciones

- **Idempotencia / re-subida del mismo día:** el patrón delete-then-insert por `(fixture_id, engine_version)` en `value_picks_v2` y `reports_v2`, y el upsert `onConflict:'api_fixture_id,match_date'` en `daily_matches`, hacen la re-importación segura y repetible. **Preservar** `result`/`home_score`/`away_score`/`verified_at` si ya existen (no pisar trabajo del verificador). Flag `overwrite` controla si se reemplazan picks ya verificados (por defecto: NO tocar picks con `result != 'PENDING'`).
- **Autenticación:** función CON verify-jwt + check de rol admin (NO `--no-verify-jwt`, a diferencia del pipeline). Rechazar no-admins.
- **Límites de plan:** la ingesta es acción de admin/plataforma, no de usuario final → no consume `checkLimit`/`trackUsage`. El gating por plan de qué picks ve cada usuario lo sigue haciendo el frontend (`opportunity_rank` + `PLAN_PREDICTIONS_PERCENTAGES`).
- **Validación de contenido:** rechazar picks con `market` fuera del dict, cuota inventada (sin `odds_source:'real'`), o que fallen el gate de coherencia (defensa server-side aunque Cowork ya los filtró).
- **Fecha:** rechazar si `meta.target_date !== match.match_date` o si el día ya pasó (`target_date < hoy Bogotá`) salvo `overwrite:true`.
- **Atomicidad:** procesar por partido; acumular errores por partido sin abortar todo el archivo; reportar parciales.

---

## 4. SKILL DE COWORK (contenido de `SKILL.md`)

Guardar en `.claude/skills/derbix-daily-analysis/SKILL.md`.

````markdown
---
name: derbix-daily-analysis
description: >
  Genera el archivo JSON diario de análisis de fútbol de Derbix para las ligas
  configuradas. Descubre los fixtures del día objetivo (mañana, Bogotá) vía la API
  de SportMonks con curl, investiga alineaciones/lesiones/clima/motivación en la web,
  aplica el método cuantitativo validado (Dixon-Coles + Elo + Monte Carlo + de-vig
  de mercado + gates de coherencia) a CADA partido, y escribe un único archivo
  derbix-analysis-<TARGET_DATE>.json listo para subida manual en el panel Admin.
  Úsalo cuando toque generar el análisis del día siguiente (corrida de la tarde anterior).
---

# Derbix — Análisis Diario (Cowork)

## Prerrequisitos
- Variable de entorno/secreto **SPORTMONKS_API_KEY** disponible en la sesión.
- Acceso de red saliente a **api.sportmonks.com** (HTTPS) y a la web para búsquedas.
- Placeholder configurable **LEAGUE_IDS**: lista de IDs de liga de SportMonks a analizar
  hoy. EDITA esta línea cada corrida si cambia:
  ```
  LEAGUE_IDS="8,564,384"   # ej: 8=Premier, 564=LaLiga, 384=Serie A. Variable por día.
  ```
- Timezone de negocio: **América/Bogotá (UTC−5)**.

## Constantes del método (no cambiar sin recalibrar)
- leagueAvgGoalsHome=1.5, leagueAvgGoalsAway=1.1
- Dixon-Coles: xi(time-decay)=0.0025/día, rho=-0.08, maxGoals=7
- Elo: baseline=1500, ventaja local=+65, K liga=20/copa=30/CL=40/final=60, draw base=0.26
- Monte Carlo: 10000 simulaciones
- Ensemble 1X2: MC*0.5 + DC*0.3 + Elo*0.2 ; Over2.5/BTTS: MC*0.6 + DC*0.4
- Injury xG loss: min(0.6, n_ausentes*0.15)
- Blend con mercado: w=0.5 (rango 0.3-0.6)
- Gates: p_model>=0.80 ; 1.20<=odds<=4.50 ; edge>=0.03 ; tabla coherencia:
  0.95->1.25, 0.90->1.35, 0.85->1.50, 0.83->1.55, 0.80->1.60
- Límites: <=5 picks/partido, <=15 oportunidades/día
- Bookmakers por prioridad: bet365(2)>Pinnacle(6)>Unibet(5)>10bet(25)>1xBet(27)>WilliamHill(28)>Betway(32)

## Procedimiento

### 0. Fechas
- TARGET_DATE = mañana en Bogotá (YYYY-MM-DD).
- NEXT_UTC = TARGET_DATE + 1 día.
- Función fecha Bogotá desde timestamp UTC:
  `TZ='America/Bogota' date -d "<utc>" +%F` (o Intl.DateTimeFormat en-CA America/Bogota).

### 1. Descubrir fixtures del día objetivo
Para D in {TARGET_DATE, NEXT_UTC}, paginar per_page=50:
```bash
API="https://api.sportmonks.com/v3/football"
curl -s "$API/fixtures/date/${D}?api_token=${SPORTMONKS_API_KEY}\
&include=participants;league;venue;state;scores&per_page=50&page=1"
```
- Merge/dedup por fixture.id.
- Conservar solo fixtures con getBogotaDate(starting_at)==TARGET_DATE Y league.id en LEAGUE_IDS.
- Ligas sin partidos: saltar. Sin ningún fixture: emitir archivo con matches:[] y total_matches:0.
- Extraer por fixture: id, league.id, league.name, starting_at (UTC), season.id,
  home=participants[meta.location=='home'], away=participants[meta.location=='away']
  (id, name, image_path).

### 2. Pull de datos por partido (curl)
Fixture completo:
```bash
curl -s "$API/fixtures/${FID}?api_token=${SPORTMONKS_API_KEY}\
&include=participants;lineups;lineups.player;statistics.type;events;scores;venue;referees;formations;coaches;sidelined;weatherReport;xGFixture;league;season;state;round"
```
Historial home y away (últimos 25, rango 2 años; TWO_YRS_AGO=hoy-2años):
```bash
curl -s "$API/fixtures/between/${TWO_YRS_AGO}/${TODAY}/${HOME_ID}?api_token=${SPORTMONKS_API_KEY}\
&include=participants;scores;venue;league;statistics;events;xGFixture&per_page=25&order=desc"
```
H2H:
```bash
curl -s "$API/fixtures/head-to-head/${HOME_ID}/${AWAY_ID}?api_token=${SPORTMONKS_API_KEY}\
&include=participants;scores;statistics;events;referees&per_page=20"
```
Standings:
```bash
curl -s "$API/standings/seasons/${SEASON_ID}?api_token=${SPORTMONKS_API_KEY}&include=participant;details"
```
Odds pre-match (cuotas REALES — obligatorio):
```bash
curl -s "$API/odds/pre-match/fixtures/${FID}?api_token=${SPORTMONKS_API_KEY}&include=market;bookmaker"
```
Predictions (opcional; ignora 403):
```bash
curl -s "$API/predictions/probabilities/fixtures/${FID}?api_token=${SPORTMONKS_API_KEY}"
```
Scores en historial: hay DOS entradas description=CURRENT (una por participante);
lee score.participant=='home'/'away' -> score.goals. Stats por type_id:
34 córners, 84 amarillas, 83 rojas, 86 remates a puerta, xGFixture=xG.

### 3. Investigación web (SIN Perplexity)
Por partido, busca: alineación probable/confirmada, lesiones/suspensiones (goleador,
creador, portero), rotación por calendario europeo, motivación de fin de temporada, clima.
- CONFIRMED (XI oficial) / PROBABLE (>=2 fuentes reputadas concuerdan) / UNAVAILABLE.
- UNAVAILABLE o fuente única no fiable -> ajuste contextual = 0 y confianza tope MEDIA.
- Registra fuentes y ausencias en research.*.

### 4. Baseline matemático
Calcula features (streak 5, descanso default 7, promedios 5/10 con xG si hay,
injury xG loss). Corre Dixon-Coles (lambda_home=attack_home*defense_away*1.5,
lambda_away=attack_away*defense_home*1.1, piso 0.1, time-decay xi=0.0025, rho=-0.08,
matriz 8x8). Corre Elo (1X2). Corre Monte Carlo 10000 sims con esos lambda.
Ensemble con los pesos de arriba. Guarda math_baseline por partido.

### 5. Probabilidad anclada + ajuste
p_model_base = ensemble. Ajusta ±15 pts MÁX por contexto verificable (cita razón en
reasoning). Mercados no modelados (córners/tarjetas/hándicap/mitades) -> conservador,
confianza tope MEDIA.

### 6. De-vig + edge
Del catálogo de odds: mediana entre bookmakers priorizados, descarta fuera de [1.01,50].
De-vig por 'power' (o multiplicativo). p_final = 0.5*p_model_ajustada + 0.5*p_market_devig.
edge = (p_final - 1/odds)/(1/odds). p_implied=1/max(odds,1.01).

### 7. Selección + gates (en orden)
1) p_final>=0.80  2) cuota existe en catálogo (match por tokens, mismo número; DNB solo a
Empate No Acción)  3) 1.20<=odds<=4.50  4) coherencia (tabla)  5) edge>=0.03.
Máx 5 picks/partido, 15 oportunidades/día, prioriza diversidad de categorías.

### 8. Confianza + staking
ALTA/MEDIA/BAJA según reglas (modelado, consistencia>=0.6, muestra>=15, sin divergencia
>15pts). confidence entero 0-100. kelly_stake_pct = min(0.05, 0.25*kelly).

### 9. Escribir el archivo
Genera derbix-analysis-<TARGET_DATE>.json siguiendo EXACTAMENTE el esquema de la sección 2
del documento maestro. Usa el vocabulario EXACTO de mercados (Resultado 1X2, Más/Menos Goles,
Ambos Anotan, Doble Oportunidad, Empate No Acción, Más/Menos Esquinas, Total Tarjetas,
Asian Handicap, ...) y selecciones ("Over 2.5", "Yes", "1X", "<Equipo> (Local)", "Empate").
Campos obligatorios por pick: market, selection, p_model (0-1), p_implied, odds, odds_source:"real",
edge, confidence (int), decision:"BET", is_opportunity, reasoning (STRING). meta con
engine_version="COWORK-V1", prompt_version="COWORK-V1", target_date, generated_at_utc,
leagues_included, total_matches, total_picks.

### 10. Entregar
Guarda el archivo y repórtalo (ruta + resumen: nº partidos, nº picks, ligas). El usuario
lo sube manualmente en Admin -> Importar Análisis del Día.

## Reglas duras
- NUNCA publicar una cuota que no exista en el catálogo real de SportMonks.
- NUNCA violar el gate de coherencia prob<->odds.
- El blend con mercado SOLO reduce el edge, nunca lo infla.
- Mercados no modelados topan confianza en MEDIA.
- Sin info de alineación fiable -> ajuste 0, confianza MEDIA.
````

---

## 5. ACCIÓN PROGRAMADA (config)

### Horario (tarde anterior en Bogotá → cron UTC)
Objetivo: correr la tarde anterior, con fixtures del día siguiente ya cargados y odds pre-match disponibles. **Recomendado: 17:00 Bogotá.** Bogotá = UTC−5 → **22:00 UTC**. Cron (5 campos, UTC): **`0 22 * * *`** (diario a las 22:00 UTC = 17:00 Bogotá). Si se prefiere más tarde para tener alineaciones más asentadas, 18:00 Bogotá = `0 23 * * *`.

### Tipo de sesión
**Sesión nueva por disparo** (`create_new_session_on_fire: true`). Cada corrida es un trabajo autocontenido de punta a punta (descubrir → analizar → escribir archivo) sin necesidad de contexto previo; una sesión limpia evita arrastre de estado entre días. Notificaciones de completado activadas (push/email) para avisar que el archivo está listo para subir.

### Config de la routine (create_trigger)

```jsonc
{
  "name": "Derbix - Análisis diario (tarde anterior)",
  "cron_expression": "0 22 * * *",            // 17:00 America/Bogota
  "create_new_session_on_fire": true,
  "environment_id": "<env_id del proyecto derbix>",
  "notifications": { "push": true, "email": true },
  "prompt": "<ver abajo>"
}
```

### Prompt que dispara la routine (standalone — sesión fresca)

```
Ejecuta la skill `derbix-daily-analysis` de punta a punta para generar el archivo JSON
de análisis de fútbol de Derbix del DÍA SIGUIENTE (mañana en timezone América/Bogotá).

LIGAS A ANALIZAR HOY (LEAGUE_IDS, IDs de liga de SportMonks — EDITA esta lista según la
jornada; separadas por coma):
  LEAGUE_IDS = 8,564,384,82,301        // PLACEHOLDER: ajústalo cada día que cambien las ligas

Pasos:
1. Calcula TARGET_DATE = mañana en Bogotá (YYYY-MM-DD).
2. Descubre vía la API de SportMonks (curl, con $SPORTMONKS_API_KEY) todos los fixtures de
   TARGET_DATE que pertenezcan a las ligas de LEAGUE_IDS. Salta las ligas sin partidos.
3. Para CADA partido, aplica el método completo de la skill: pull de datos SportMonks,
   investigación web de alineaciones/lesiones/clima/motivación (SIN Perplexity), baseline
   matemático (Dixon-Coles + Elo + Monte Carlo), de-vig del mercado, y todos los gates
   (prob>=80%, rango 1.20-4.50, coherencia prob-cuota, edge>=3%).
4. Escribe UN archivo derbix-analysis-<TARGET_DATE>.json con el esquema exacto (meta +
   matches[] + picks[]), engine_version="COWORK-V1", usando el vocabulario EXACTO de
   mercados/selecciones.
5. Repórtame la ruta del archivo y un resumen (nº partidos, nº picks por confianza, ligas).
   El archivo lo subiré manualmente en Derbix (Admin -> Importar Análisis del Día).

Si no hay partidos en las ligas configuradas para TARGET_DATE, genera igualmente el archivo
con matches:[] y avísame.
```

### Secretos y red que el entorno necesita
- **`SPORTMONKS_API_KEY`** — secreto de sesión (SportMonks v3, plan que cubra fixtures/odds/standings; predictions es opcional).
- **Red saliente**: `api.sportmonks.com` (HTTPS) y acceso web para búsquedas de alineaciones/noticias.
- **NO** requiere credenciales de Supabase: Cowork **no escribe** en la DB; solo produce el archivo. La escritura ocurre cuando el usuario sube el archivo manualmente y `import-daily-analysis` lo procesa con el service role key propio de Derbix.

### Placeholder de ligas
`LEAGUE_IDS` es el único parámetro variable por día. Vive en dos lugares que deben quedar sincronizados: (1) la línea `LEAGUE_IDS` del prompt de la routine (editable con `update_trigger` sin recrear), y (2) opcionalmente la constante por defecto en la skill. IDs de referencia SportMonks: `8` Premier League, `564` LaLiga, `384` Serie A, `82` Bundesliga, `301` Ligue 1, `2` Champions League. **Verificar cada ID contra `/leagues` de SportMonks antes de la primera corrida** (los IDs de liga difieren de los de `allowed_leagues` de Derbix).
