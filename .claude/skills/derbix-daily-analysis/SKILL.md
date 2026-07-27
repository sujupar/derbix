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
- **Ligas objetivo**: definidas en `leagues.json` (junto a este SKILL.md). NO se editan
  cada día — el método analiza SOLO las ligas de esa lista que TENGAN partidos el día
  objetivo y salta las que no jueguen (la mayoría de los días solo juegan unas pocas).
- Timezone de negocio: **América/Bogotá (UTC−5)**.

## Resolución de IDs de liga (primera corrida)
`leagues.json` trae `sportmonks_league_id: null` para cada liga. En la PRIMERA corrida en
vivo (o cuando `resolve_ids_on_first_run: true`):
1. Descarga el catálogo de ligas: `GET /v3/football/leagues?api_token=KEY&per_page=200` (pagina).
2. Empareja cada `name`+`country` de `leagues.json` con la liga real de SportMonks
   (nombre y país). Ante duda entre varias, elige la de la máxima categoría del país.
3. Escribe los `sportmonks_league_id` resueltos de vuelta en `leagues.json` y commitea el
   cambio (o repórtalos para fijarlos). En corridas siguientes usa los IDs ya fijados.
`LEAGUE_IDS` = el conjunto de `sportmonks_league_id` no nulos de `leagues.json`.

## Constantes del método (no cambiar sin recalibrar)
- leagueAvgGoalsHome=1.5, leagueAvgGoalsAway=1.1
- Dixon-Coles: xi(time-decay)=0.0025/día, rho=-0.08, maxGoals=7
- Elo: baseline=1500, ventaja local=+65, K liga=20/copa=30/CL=40/final=60, draw base=0.26
- Monte Carlo: 10000 simulaciones
- Ensemble 1X2: MC*0.5 + DC*0.3 + Elo*0.2 ; Over2.5/BTTS: MC*0.6 + DC*0.4
- Injury xG loss: min(0.6, n_ausentes*0.15)
- Blend con mercado: w=0.5 (rango 0.3-0.6)
- MODO VALOR (Opción B): el objetivo son picks que PAGUEN (cuota >= 1.40), no favoritos de
  cuota baja. Gates:
  - **p_final >= 0.72** (probabilidad mínima; ya NO 0.80).
  - **1.40 <= odds <= 4.50** (piso 1.40 = lo que la plataforma muestra y contabiliza; nada por debajo).
  - **edge >= 0.05** (5% — exige valor real, no cuota justa).
  - Tabla de coherencia (cap de cuota por banda de prob):
    0.95->1.25, 0.90->1.35, 0.85->1.50, 0.83->1.55, 0.80->1.60, 0.78->1.70, 0.75->1.78, 0.72->1.85.
  - Efecto: la banda publicable real es ~cuota 1.40-1.85 con prob 72-85% (ej. "74% @ 1.60").
- Límites: <=5 picks/partido, <=15 oportunidades/día
- **CUOTA DE REFERENCIA = CASA COLOMBIANA** (configurable). `BOOKMAKER_REF="BetPlay"`
  (alternativas: Wplay, Rushbet, Betsson, Codere). La cuota publicada DEBE ser la que un
  apostador ve en esta casa en Colombia — las cuotas europeas de SportMonks NO sirven como
  referencia (son inexactas para Colombia) y solo se usan como respaldo marcado. Ver paso 2b.
- Bookmakers SportMonks (SOLO respaldo/descubrimiento de mercados): bet365(2)>Pinnacle(6)>Unibet(5)>10bet(25)>1xBet(27)>WilliamHill(28)>Betway(32)
- **Copas y supercopas (type='cup'/'supercup' en leagues.json)**: los equipos ROTAN titulares.
  Si `rotation_risk` es 'high' (supercopas), exige alineación CONFIRMED o PROBABLE fiable antes
  de emitir picks; sin ella, topa confianza en BAJA y reduce el número de picks. Con
  'medium' (Champions/Libertadores), topa confianza en MEDIA salvo alineación confirmada.

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
Odds pre-match de SportMonks — SOLO para DESCUBRIR qué mercados existen y como RESPALDO
(NO es la cuota de referencia; ver paso 2b para la cuota colombiana real):
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

### 2b. Cuotas de referencia — CASA COLOMBIANA (fuente PRINCIPAL de cuotas)
Las cuotas de SportMonks son de bookmakers europeos y NO representan lo que un apostador
paga en Colombia. La cuota publicada de cada pick DEBE ser la de `BOOKMAKER_REF` (casa
colombiana). Por cada partido, en orden hasta obtener la cuota de los mercados de interés
(1X2, Doble Oportunidad, Más/Menos Goles, Ambos Anotan, y los demás que evalúes):
1. **Navegador headless** (Chromium+Playwright YA instalado — NO ejecutar "playwright install";
   usar el binario en /opt/pw-browsers). Abre la página del partido en el sitio de la casa
   (p.ej. betplay.com.co / wplay.co), acepta cookies, y lee la cuota decimal de cada mercado.
   Guarda mercado + selección + cuota exactos.
2. **Comparador de cuotas** si el sitio geobloquea o no carga (la IP de la nube no es de
   Colombia): busca en la web "cuotas {Local} vs {Visitante} {BOOKMAKER_REF}" o usa un
   comparador que incluya casas colombianas, y toma la cuota de la casa objetivo.
3. **Último recurso:** si NO consigues una cuota colombiana fiable para un mercado, NO
   publiques ese pick con una cuota europea inventada. Preferible OMITIR el pick. Solo si
   quieres conservarlo, usa la de SportMonks marcando `bookmaker:"SportMonks (respaldo)"` y
   bajando la confianza — pero omitir es lo preferido.
Registra por pick: `odds` = cuota colombiana decimal, `bookmaker` = BOOKMAKER_REF, `odds_source:"real"`.

> Nota práctica: desde el entorno de nube (IP fuera de Colombia) algunas casas pueden
> geobloquear o pedir verificación. La primera corrida nos dirá si funciona; si no, pasamos
> al comparador o configuramos un acceso adecuado. Reporta qué método funcionó.

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

### 6. De-vig + edge  (contra la CUOTA COLOMBIANA del paso 2b)
Usa la cuota de `BOOKMAKER_REF` obtenida en 2b como la cuota real del pick (NO la de SportMonks).
De-vig del conjunto de cuotas de esa casa por 'power' (o multiplicativo) para obtener
p_market_devig. p_final = 0.5*p_model_ajustada + 0.5*p_market_devig.
edge = (p_final - 1/odds)/(1/odds) con odds = cuota colombiana. p_implied=1/max(odds,1.01).

### 7. Selección + gates (en orden) — MODO VALOR
1) **p_final>=0.72**  2) cuota (colombiana, paso 2b) existe realmente; DNB solo a Empate No
Acción  3) **1.40<=odds<=4.50** (nada por debajo de 1.40; la plataforma lo oculta y no lo
contabiliza)  4) coherencia (tabla extendida 0.72-0.95)  5) **edge>=0.05**.
Objetivo: picks que paguen (banda real ~1.40-1.85 @ prob 72-85%, ej. "74% @ 1.60"), NO
favoritos de cuota <1.40. Máx 5 picks/partido, 15 oportunidades/día, prioriza diversidad.

### 8. Confianza + staking
ALTA/MEDIA/BAJA según reglas (modelado, consistencia>=0.6, muestra>=15, sin divergencia
>15pts). confidence entero 0-100. kelly_stake_pct = min(0.05, 0.25*kelly).

### 9. Escribir el archivo
Genera derbix-analysis-<TARGET_DATE>.json siguiendo EXACTAMENTE el esquema de la sección 2
del documento maestro. Usa el vocabulario EXACTO de mercados (Resultado 1X2, Más/Menos Goles,
Ambos Anotan, Doble Oportunidad, Empate No Acción, Más/Menos Esquinas, Total Tarjetas,
Asian Handicap, ...) y selecciones ("Over 2.5", "Yes", "1X", "<Equipo> (Local)", "Empate").
Campos obligatorios por pick: market, selection, p_model (0-1), p_implied, odds (=cuota
colombiana), odds_source:"real", bookmaker (=BOOKMAKER_REF), edge, confidence (int),
decision:"BET", is_opportunity, reasoning (STRING). meta con engine_version="COWORK-V1",
prompt_version="COWORK-V1", target_date, generated_at_utc, leagues_included, total_matches,
total_picks.

### 10. Entregar
Guarda el archivo y repórtalo (ruta + resumen: nº partidos, nº picks, ligas). El usuario
lo sube manualmente en Admin -> Importar Análisis del Día.

## Reglas duras
- La cuota publicada DEBE ser de la casa colombiana (BOOKMAKER_REF), obtenida en vivo (paso 2b).
  NUNCA usar una cuota europea de SportMonks como referencia (solo respaldo marcado, y de
  preferencia omitir el pick si no hay cuota colombiana fiable).
- NUNCA publicar una cuota que no hayas obtenido realmente (nada inventado).
- NUNCA violar el gate de coherencia prob<->odds.
- El blend con mercado SOLO reduce el edge, nunca lo infla.
- Mercados no modelados topan confianza en MEDIA.
- Sin info de alineación fiable -> ajuste 0, confianza MEDIA.

---

# PARTE II — Del análisis al producto (informe rico → oportunidades → plataforma)

Esta parte es OBLIGATORIA y define cómo el análisis se convierte en lo que ve el usuario.
NO se improvisa ni se recorta sobre la marcha: es el mismo procedimiento cada día.

## 11. Evaluar TODOS los mercados de cada partido (no solo los de valor)
El informe del cliente debe mostrar el partido COMPLETO, no solo los picks. Por cada partido
registra en el JSON (campo `markets`) TODOS los mercados relevantes con su probabilidad del
modelo + cuota real de BetPlay + edge, AUNQUE la cuota sea baja o no pase los gates:
- Resultado 1X2 (Local / Empate / Visitante)
- Doble Oportunidad (1X / 12 / X2)
- Más/Menos Goles (líneas 1.5, 2.5, 3.5)
- Ambos Anotan (Sí / No)
- Empate No Acción (Local / Visitante)
- Más/Menos Esquinas (línea principal) — conservador, confianza tope MEDIA
- Total Tarjetas (línea principal) — conservador, confianza tope MEDIA
Cada entrada: `{market, selection, prob (0-1), odds (BetPlay real), edge, valor:bool}`. `valor=true`
solo si pasa los gates de la Parte I. Añade para el informe: goles esperados (λ_local+λ_visitante),
BTTS %, córners esperados (stat type_id 34) y tarjetas esperadas (stat type_id 84) del historial.

## 12. Extraer las MEJORES oportunidades (informe → pestaña Oportunidades)
De los mercados evaluados en 11, los que pasan los gates de valor (Parte I) se convierten en
`picks` (máx 5/partido). Flujo obligatorio: **informe completo del partido → de ahí se extraen
las mejores → esas van a Oportunidades.** Un partido sin mercado de valor conserva su informe
pero NO aporta oportunidad. Cada partido rinde las oportunidades que tenga (ninguno es igual a otro).

## 12b. Autocrítica adversarial por pick
Antes de emitir cada pick intenta REFUTARLO: ¿qué escenario lo tumba? (baja clave, rotación,
clima, o una cuota "demasiado buena" = catálogo sospechoso). Si el contraargumento es fuerte y
no hay dato que lo mitigue, baja la confianza o descarta el pick. Registra la refutación en `reasoning`.

## 13. Esquema del archivo — campos por partido
Por cada match en `matches`: `fixture_id, league_name, home_team, away_team, home_team_logo,
away_team_logo, kickoff_utc, match_date (=TARGET_DATE), research{...}, math_baseline{...},
markets[TODOS], picks[valor]`. Vocabulario EXACTO de mercados/selecciones (ver sección 9).

## 14. Cómo se estructura en la plataforma (qué alimenta qué)
El importador `import-daily-analysis` mapea el archivo así:

| Pestaña | Tabla | Qué se muestra |
|---------|-------|----------------|
| **Partidos** | `daily_matches` (upsert) | 1 fila por partido (equipos, hora, liga). Si el listado en vivo de SportMonks viene vacío, la app cae a `daily_matches` como respaldo. |
| **Oportunidades** | `value_picks_v2` (`is_opportunity`, `opportunity_date`, `opportunity_rank`) | los `picks` de valor, rankeados global top-15 del día |
| **Informe** | `analisis` (`dashboardData`) + `reports_v2` (`report_packet`) | informe rico por partido: todos los mercados + secciones + datos del modelo |

La caché `analisis` es la fuente PRIMARIA del informe; `reports_v2` es respaldo. Ambos se
escriben delete-then-insert por `(fixture_id, engine_version)`. `is_opportunity = p_model >= 0.72`.

## 15. Contrato de presentación (correcciones aprobadas — NO regresar)
Permanentes; cualquier cambio futuro DEBE preservarlas:
- **Oportunidades**: NO mostrar la hora. Mostrar mercado+selección legible ("Ambos Anotan: No",
  no solo "No"). El texto se ENVUELVE en varias líneas, NUNCA se recorta con ellipsis. Cuota a la derecha.
- **Informe**: sin crash (React #31) — `matchup_tactico` es STRING, no objeto. Muestra TODOS los
  mercados en secciones, no un bloque de texto plano.
- **Partidos**: respaldo desde `daily_matches` cuando el listado en vivo de SportMonks viene vacío.
