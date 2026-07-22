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
- **FILOSOFÍA — LA INTERPRETACIÓN LIDERA (no la matemática):** las casas de apuestas son
  eficientes en lo cuantitativo, pero NO ponderan bien el ajuste TÁCTICO (choque de estilos,
  duelos individuales, cómo una formación explota a otra, cómo una ausencia rompe un plan).
  Ahí está el valor real y las cuotas altas "fáciles". El razonamiento táctico de Claude es
  la FUENTE de alfa; la matemática es una REFERENCIA/prior y un chequeo de cordura, NO un
  ancla. **NO se promedia hacia el mercado** (eso mataba la interpretación).
- **CONTROL DE CALIDAD = AUTO-CRÍTICA ADVERSARIAL** (reemplaza al ancla matemática): cada pick
  debe tener un MECANISMO táctico concreto y SOBREVIVIR a su propia refutación (paso 6b). Sin
  mecanismo articulable o si el contra-argumento gana → no es pick.
- MODO VALOR — objetivo: picks que PAGUEN, **priorizando cuota >= 1.70**. Gates:
  - **1.50 <= odds <= 4.50**, priorizando **odds >= 1.70** (la zona donde la interpretación paga).
  - **edge >= 0.08** (8% — valor real vs el mercado, ya sin blend).
  - Coherencia prob↔odds RELAJADA (permite alta prob a cuota alta cuando hay tesis; solo
    rechaza lo absurdo, edge implícito >~65%): 0.90->1.45, 0.85->1.72, 0.80->2.00, 0.75->2.25,
    0.70->2.50, 0.65->2.75, 0.60->3.00.
  - Efecto: aparecen picks tipo "72% @ 2.10" o "65% @ 2.60" cuando la tesis táctica lo respalda.
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

### 4. Baseline matemático (REFERENCIA, no ancla)
Calcula features (streak 5, descanso default 7, promedios 5/10 con xG si hay, injury xG loss).
Corre Dixon-Coles (lambda_home=attack_home*defense_away*1.5, lambda_away=attack_away*defense_home*1.1,
piso 0.1, time-decay xi=0.0025, rho=-0.08, matriz 8x8), Elo (1X2) y Monte Carlo 10000 sims.
Ensemble → math_baseline. **Úsalo como prior y chequeo de cordura, NO como la probabilidad final.**
Su rol: darte un punto de partida y avisarte cuando tu lectura táctica se aleje MUCHO (>30-35 pts)
del baseline — en ese caso, tu tesis debe ser extraordinaria y explícita.

### 5. ANÁLISIS TÁCTICO PROFUNDO (el corazón — aquí manda el razonamiento)
Esta es la fuente de valor. Analiza a fondo CÓMO juegan los equipos y cómo se enfrentan:
- **Estilo de cada equipo**: posesión / pressing alto / bloque bajo / directo / contragolpe / transiciones.
- **Formaciones y su CHOQUE**: dónde una crea superioridad (ej. 3 mediocampistas vs 2; extremos
  contra laterales adelantados; hombre libre entre líneas).
- **Duelos individuales clave**: extremo veloz vs lateral lento; '9' aéreo vs central bajito;
  creador vs mediocentro destructor; portero flojo por abajo.
- **Mecanismos concretos**: línea defensiva alta vs velocidad rival; balón parado (córners/faltas);
  cómo una AUSENCIA rompe un plan (no "falta X" sino "sin su único pivote no salen jugando ante
  un pressing alto" → forzarán largos → perderán el mediocampo).
- **Escenario probable del partido**: ¿quién impone su juego?, ¿se abre o se cierra?, ¿goles o
  cerrojo?, game-state (si A se adelanta, B se lanza y deja espacios → más goles).
Con TODO eso, **estima tu probabilidad para cada mercado desde el análisis táctico**, usando el
baseline como referencia (no como límite). Aquí ves lo que el mercado no pondera.

### 6. Buscar VALOR contra el mercado (SIN promediar)
De-vig la cuota colombiana (paso 2b) → p_market. **Ya NO se promedia 50/50.**
- `p_model` (lo que publicas) = TU estimación táctica del paso 5 (no un blend hacia el mercado).
- El valor nace donde `p_model > p_market` **con un MECANISMO táctico concreto** que explique por
  qué el mercado se equivoca (ej. "el mercado sobrevalora a B por su nombre, pero su línea alta es
  suicida ante la velocidad de A; A marca 2+ con alta probabilidad").
- `edge = (p_model - 1/odds)/(1/odds)`; `p_implied = 1/max(odds,1.01)`.
- Prioriza **cuota 1.70-3.50** (la interpretación rara vez aporta valor por debajo de 1.50).

### 6b. AUTO-CRÍTICA ADVERSARIAL (el nuevo control anti-alucinación)
Para CADA pick candidato, ANTES de publicarlo:
1. Escribe el **argumento MÁS FUERTE EN CONTRA**: ¿por qué el mercado podría tener razón?, ¿qué
   escenario tumba tu tesis?, ¿qué NO estás viendo?
2. Si el contra-argumento es convincente y no tienes respuesta sólida → **DESCARTA** o baja a BAJA.
3. Publica SOLO si tu tesis sobrevive a su propia refutación.
4. Exige un mecanismo articulable (cómo/por qué). "Son mejores" NO es una tesis → no es pick.
Incluye en `reasoning`: la tesis táctica + el mecanismo + por qué sobrevive a la refutación.

### 7. Selección + gates (en orden) — MODO VALOR (interpretación)
1) cuota real de la casa colombiana (paso 2b); DNB solo a Empate No Acción
2) **1.50<=odds<=4.50**, PRIORIZANDO **odds>=1.70**
3) coherencia prob↔odds RELAJADA (0.90->1.45, 0.85->1.72, 0.80->2.00, 0.75->2.25, 0.70->2.50,
   0.65->2.75, 0.60->3.00) — solo rechaza lo absurdo
4) **edge>=0.08**
5) tesis táctica con mecanismo + SOBREVIVE la auto-crítica (6b)
Máx 5 picks/partido, 15/día. Prioriza diversidad de mercados y de partidos. Si un partido no
tiene una tesis táctica fuerte, NO fuerces un pick — mejor pocos y con convicción.

### 8. Confianza + staking (refleja CONVICCIÓN de la tesis)
- **ALTA**: mecanismo táctico claro, sobrevive la auto-crítica con holgura, alineación
  PROBABLE/CONFIRMED, datos sólidos.
- **MEDIA**: tesis razonable pero con contra-argumento parcial, o alineación incierta, o mercado
  no modelado (córners/tarjetas/hándicap).
- **BAJA**: tesis especulativa que apenas sobrevive, o datos flojos.
confidence entero 0-100. kelly_stake_pct = min(0.05, 0.25*kelly) sobre p_model y la cuota.

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
  NUNCA una cuota europea de SportMonks como referencia (solo respaldo marcado; mejor omitir).
- NUNCA publicar una cuota que no hayas obtenido realmente (nada inventado).
- Todo pick DEBE tener una TESIS TÁCTICA con MECANISMO concreto y sobrevivir la auto-crítica (6b).
  Sin eso, no es pick — por mucho edge numérico que parezca tener.
- La probabilidad publicada es TU lectura táctica, NO un promedio hacia el mercado. La matemática
  es referencia, no ancla.
- El gate de coherencia (relajado) sigue siendo la última defensa contra lo absurdo: NUNCA lo violes.
- Mercados no modelados (córners/tarjetas/hándicap) topan confianza en MEDIA.
- Sin alineación fiable, el análisis táctico es más débil -> confianza tope MEDIA (no BAJA automática
  si la tesis estructural es sólida, pero nunca ALTA).
- Prefiere POCOS picks con convicción táctica a muchos forzados.
