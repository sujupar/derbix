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
