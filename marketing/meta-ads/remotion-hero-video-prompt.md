# 🎬 Prompt para Claude + Remotion — Video del Hero `/signup`

**Destino**: slot vertical en hero de la landing `/signup` (ver [SignUpFlow.tsx](../../components/auth/SignUpFlow.tsx) — `aspect-video` rounded-2xl con placeholder play button).
**Stack**: Remotion (React-based programmatic video) — el proyecto ya tiene React 19 + TypeScript + Tailwind.
**Output esperado**: `.mp4` 16:9 (1920×1080), 25-30s, autoplay muted, loopable, sin requerir audio.

---

## 📋 Copia-pega este prompt completo a Claude

```
Construye un video programático con Remotion (React-based) para Derbix
— una plataforma SaaS colombiana de análisis de fútbol con IA.

CONTEXTO DEL PRODUCTO:
- Derbix analiza +3.000 datos por partido (forma, xG, momentum, lesiones, clima)
- Output: pronósticos con probabilidad calibrada para fanáticos del fútbol
- Marca: dark mode (slate-950 / slate-900), acento emerald-500 (#10b981)
- Tipografía: Inter (UI), Outfit (display)
- Estilo visual: glass-morphism, backdrop-blur, bordes white/5
- Idioma: español (Colombia)

ENTREGABLE:
- Composition Remotion 16:9, 1920×1080, 30 fps, duración 25-30 segundos
- Sin audio (autoplay muted en el navegador, debe ser comprensible solo visual)
- Loopable (último frame transita suave al primero)
- Export: derbix-hero.mp4 con bitrate suficiente para web

ESTRUCTURA NARRATIVA (5 escenas, ~5-6s cada una):

═══════════════════════════════════════════════════════
SCENE 1 (0-5s) — "EL CAOS DEL APOSTADOR"
═══════════════════════════════════════════════════════
- Fondo: oscuro (slate-950) con noise sutil
- Animación: múltiples cards de "tipster" cayendo, sobreponiéndose, cada una
  con texto difuso tipo "Apuesta segura ⭐⭐⭐", "100% GANADOR 🔥",
  "Trust me bro", "Ganador con esta apuesta 💰"
- Las cards rotan ligeramente, opacas, en caos
- Color: tonos rojizos/grises (sensación de basura informativa)
- Texto sobreposito grande (Outfit Bold, blanco 80%):
  "Demasiado humo."
- Transición a Scene 2: las cards explotan en partículas que se reorganizan

═══════════════════════════════════════════════════════
SCENE 2 (5-10s) — "ENTRA EL DATO"
═══════════════════════════════════════════════════════
- Las partículas se reorganizan formando un dashboard
- Fondo cambia a slate-900 con grid sutil
- Aparece UI mockup de Derbix (animado con springs):
  * Top: header con logo "Derbix" (Outfit Bold, emerald-500)
  * Central: card grande de un partido genérico ("EQ. A vs EQ. B")
  * Datos animando con counters numéricos creciendo:
    - "Datos analizados: 0 → 3.247"
    - "Probabilidad: 0% → 87%"
    - "xG: 0.0 → 2.4"
- Counters animan con Easing.easeOutCubic
- Mini gráficos de líneas creciendo en barras al lado de los números
- Texto inferior (Inter Medium, slate-300):
  "Cada partido. Procesado con IA."

═══════════════════════════════════════════════════════
SCENE 3 (10-15s) — "EL ANÁLISIS"
═══════════════════════════════════════════════════════
- Camera tracking (efecto motion) hacia un detalle del dashboard
- Aparece secuencia rápida de "categorías" analizadas, cada una con su pill:
  → "Forma reciente: 4V-1E"
  → "xG promedio: 2.1"
  → "Momentum: +12%"
  → "Cabeza a cabeza: 60%"
  → "Lesiones: 0"
  → "Clima: óptimo"
- Cada pill aparece con springInterpolation desde la derecha, se queda 0.5s,
  se va por la izquierda
- Fondo: gradient sutil emerald-500/5 a slate-900
- Texto central (Outfit Bold, blanco):
  "+3.000 datos por partido"

═══════════════════════════════════════════════════════
SCENE 4 (15-20s) — "EL RESULTADO LIMPIO"
═══════════════════════════════════════════════════════
- Toda la complejidad colapsa en UN solo card minimal en el centro
- Card grande (glass-morphism, border emerald-500/30):
  - Top: "Análisis listo"
  - Middle: Probabilidad grande con counter: "87%"
  - Bottom: Pill verde "Alta confianza"
- A los lados: 4 micro-stats con check-marks:
  ✓ +3.000 datos
  ✓ IA calibrada
  ✓ Histórico público
  ✓ Plan gratis
- Texto principal (Outfit Black, blanco, grande):
  "El análisis ya está hecho."

═══════════════════════════════════════════════════════
SCENE 5 (20-25s) — "BRAND + CTA"
═══════════════════════════════════════════════════════
- El card se reduce y se ubica como dashboard background blureado
- Foreground: logo Derbix grande aparece con efecto de "build" (cada letra fade-in
  + scale up secuencialmente)
- Logo Derbix: tipografía Outfit Black, color blanco con accent emerald-500 en la "X"
- Tagline debajo (Inter Medium, slate-300):
  "Inteligencia deportiva con IA"
- Bottom: pill emerald-500 que pulsa suave
  "derbix.co/signup — Gratis"
- Frame final: hold 2s, luego sutile fade-out para hacer loop limpio a Scene 1

═══════════════════════════════════════════════════════

REQUISITOS TÉCNICOS REMOTION:

1. Usa @remotion/transitions para entre-escenas (slide, fade, wipe según convenga)
2. Springs naturales con `spring({ frame, fps, config: { damping: 200 } })`
3. Counters animados con interpolate + easing
4. Tipografía cargada desde Google Fonts (Inter + Outfit) con @remotion/google-fonts
5. Composición: <Sequence> por escena, duraciones en frames (30fps × seconds)
6. NO uses imágenes externas — todo debe ser CSS/SVG/typography animados
7. Color palette estricta:
   - slate-950: #020617
   - slate-900: #0f172a
   - slate-800: #1e293b
   - white: #ffffff
   - brand emerald: #10b981
   - brand emerald light: #34d399
   - red (sólo en Scene 1 para humo): #ef4444 con baja opacidad

ESTRUCTURA DE ARCHIVOS A CREAR:

src/remotion/
├── HeroVideo.tsx          # Composition root
├── scenes/
│   ├── Scene1Caos.tsx
│   ├── Scene2DataIn.tsx
│   ├── Scene3Analysis.tsx
│   ├── Scene4Result.tsx
│   └── Scene5Brand.tsx
├── components/
│   ├── TipsterCard.tsx    # Card animada Scene 1
│   ├── DataPill.tsx       # Pill con stat Scene 3
│   ├── StatCounter.tsx    # Counter numérico animado
│   ├── BrandLogo.tsx      # Logo Derbix con build-in
│   └── GridBackground.tsx # Fondo con grid sutil
└── tokens/
    └── colors.ts           # Paleta exportada

CONFIG REMOTION (remotion.config.ts):
- Width: 1920, Height: 1080
- FPS: 30
- Duration: 750 frames (25 segundos)
- Default codec: h264
- Quality: 85

RENDER COMMAND ESPERADO:
npx remotion render src/remotion/index.ts HeroVideo derbix-hero.mp4

CONSTRAINTS DE POLÍTICA META (importante porque será un creative público):
- NO usar palabras: "apuestas", "ganar", "tipster", porcentajes financieros
  específicos como "+29% ROI" (sí está OK decir "87% probabilidad" porque es
  un valor del modelo, no una promesa de ganancia)
- NO mostrar dinero, monedas, billetes, casino chips, slip de apuestas
- SÍ enfatizar: IA, análisis, datos, fútbol, probabilidad calibrada,
  histórico público, plan gratis

Cuando termines:
1. Crea la estructura de archivos completa
2. Implementa cada Scene como componente Remotion
3. Compón en HeroVideo.tsx con <Sequence>
4. Asegura que `npx remotion preview` muestre el video correctamente
5. Documenta cómo renderizar a .mp4 en un README breve
```

---

## 📦 Pasos para activarlo en tu repo

Cuando Claude termine el setup de Remotion:

```bash
# Instalar Remotion (si no está)
npm install remotion @remotion/cli @remotion/google-fonts @remotion/transitions

# Preview
npx remotion preview src/remotion/index.ts

# Render
npx remotion render src/remotion/index.ts HeroVideo public/derbix-hero.mp4
```

## 🔌 Integración en la landing `/signup`

El componente [`SignUpFlow.tsx`](../../components/auth/SignUpFlow.tsx) ya tiene el **slot listo** en el hero (busca el comentario `TODO: Hero video slot`). Para reemplazar el placeholder por el video renderizado:

```tsx
{/* ANTES (placeholder actual): */}
<div className="relative aspect-video bg-gradient-to-br ...">
    <div className="absolute inset-0 flex flex-col items-center justify-center">
        ...play button...
    </div>
</div>

{/* DESPUÉS (video real): */}
<video
    src="/derbix-hero.mp4"
    autoPlay
    loop
    muted
    playsInline
    className="aspect-video w-full rounded-2xl border border-white/10"
/>
```

Tras el `git push`, Netlify auto-deploys el video desde `public/derbix-hero.mp4` → `https://derbix.co/derbix-hero.mp4`.

---

## ⚠️ Notas de performance

- El video debe pesar **< 2 MB** para no afectar LCP (Largest Contentful Paint).
- Si pesa más, render con quality 70 o resolución 1280×720.
- Considerar generar también versión `.webm` (vp9) y servir con `<source>` fallback.
- `autoplay + muted + playsInline` es el combo iOS-safe.
