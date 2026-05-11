
import { GroundingChunk } from "@google/genai";

// --- ENUMS & BASIC TYPES ---

export enum BetStatus {
    Pending = 'Pendiente',
    Won = 'Ganada',
    Lost = 'Perdida',
}

export enum LegStatus {
    Won = 'Ganadora',
    Lost = 'Perdida',
    Pending = 'Pendiente',
    Void = 'Anulada',
}

export type ConfidenceLevel = 'Alta' | 'Media' | 'Baja';

// --- DATABASE TYPES (SUPABASE REFLECTION) ---

export type OrganizationRole = 'owner' | 'admin' | 'usuario';
export type OrganizationStatus = 'active' | 'suspended' | 'trial' | 'cancelled';
export type SubscriptionPlanName = 'free' | 'starter' | 'pro' | 'premium';
/** @deprecated Use SubscriptionPlanName instead */
export type SubscriptionPlan = SubscriptionPlanName;
export type BillingPeriod = 'monthly' | 'annual';
export type SubscriptionStatus = 'active' | 'cancelled' | 'expired' | 'past_due' | 'paused' | 'on_trial' | 'trialing';

export interface LemonSqueezyWebhookEvent {
    id: string;
    event_name: string;
    ls_event_id: string;
    payload: Record<string, any>;
    processed: boolean;
    processed_at: string | null;
    error: string | null;
    created_at: string;
}

export interface Organization {
    id: string;
    name: string;
    slug: string;
    status: OrganizationStatus;
    subscription_plan: SubscriptionPlan;
    created_at: string;
    updated_at: string;
    metadata?: Record<string, any>;
    settings?: Record<string, any>;
}

export interface OrganizationWithDetails extends Organization {
    is_agency?: boolean;
    ownerEmail: string | null;
    ownerName: string | null;
    ownerUserId: string | null;
    activePlanName: string | null;
    activePlanDisplayName: string | null;
    subscriptionStatus: string | null;
    billingPeriod: string | null;
    whopMembershipId: string | null;
    subscriptionCreatedAt: string | null;
    subscriptionRenewsAt: string | null;
    subscriptionEndsAt: string | null;
    planPriceCents: number | null;
}

export interface OrganizationMember {
    id: string;
    organization_id: string;
    user_id: string;
    role: OrganizationRole;
    permissions?: Record<string, boolean>; // Granular permissions
    joined_at: string;
    profile?: {
        full_name: string;
        email: string;
        avatar_url?: string;
    };
}

export interface OrganizationInvitation {
    id: string;
    organization_id: string;
    email: string;
    role: OrganizationRole;
    token: string;
    invited_by: string;
    created_at: string;
    expires_at: string;
    accepted_at?: string;
}

export interface UserProfile {
    id: string;
    email: string;
    role: 'platform_owner' | 'agency_admin' | 'org_owner' | 'org_member' | 'user';
    full_name?: string;
    avatar_url?: string;
    organization_id?: string;
    is_org_owner?: boolean;
    phone_number?: string;
    phone_country_code?: string;
}

export type JobStatus = 'queued' | 'ingesting' | 'data_ready' | 'analyzing' | 'done' | 'insufficient_data' | 'failed';

export interface JobProgress {
    step: string;
    completeness_score: number;
    fetched_items: number;
    total_items: number;
    details?: string;
    missing_data?: string[];
}

export interface AnalysisJob {
    id: string;
    api_fixture_id: number;
    fixture_id: string;
    status: JobStatus;
    completeness_score: number;
    estimated_calls: number;
    actual_calls: number;
    progress_jsonb: JobProgress;
    last_error?: string;
    error_message?: string;
    created_at: string;
}

export interface PredictionDB {
    id: string;
    market_code: string; // '1X2', 'OU2.5', 'BTTS', etc.
    selection: string;
    probability: number;
    confidence: number; // 0-100 score numérico
    signal_strength: number;
    evidence_jsonb: any;
    is_won?: boolean | null; // Added for retro analysis result
    odds?: number | null; // Real-time odds
}

export interface AnalysisRun {
    id: string;
    job_id: string;
    fixture_id: string;
    summary_pre_text: string;
    report_pre_jsonb: any; // Reporte completo estructurado
    created_at: string;
    predictions?: PredictionDB[];
    post_match_analysis?: PostMatchAnalysis; // New structured analysis
    actual_outcome?: MatchOutcome;        // New: Data real del partido
}

export interface PostMatchAnalysis {
    tactical_analysis: string;
    statistical_breakdown: string;
    key_moments: string;
    performance_review: string;
    learning_feedback: string;
}

export interface MatchOutcome {
    score: { home: number; away: number };
    status: string;
    winner: string;
}

// --- LEGACY / FRONTEND TYPES (Mantenidos para compatibilidad visual temporal) ---

export interface BetLeg {
    sport: string;
    league: string;
    event: string;
    market: string;
    status: LegStatus;
    odds: number;
}

export interface Bet {
    id: number;
    user_id: string;
    date: string;
    event: string;
    market: string;
    stake: number;
    odds: number;
    status: BetStatus;
    payout: number;
    image?: string;
    legs?: BetLeg[];
}

export interface ExtractedBetInfo {
    date: string;
    stake: number;
    totalOdds: number;
    status: BetStatus;
    legs: BetLeg[];
}

export interface ChatMessage {
    role: 'user' | 'model';
    text: string;
    sources?: GroundingChunk[];
}

export interface PeriodStats {
    period: string;
    totalBets: number;
    combinedBets: number;
    singleBets: number;
    wonBets: number;
    lostBets: number;
    winRate: number;
    totalLegs: number;
    wonLegs: number;
    lostLegs: number;
    legWinRate: number;
    totalStaked: number;
    totalPayout: number;
    profitLoss: number;
    roi: number;
    averageOdds: number;
}

// --- DASHBOARD / AI TYPES ---

export interface TablaComparativaData {
    titulo: string;
    columnas: string[];
    filas: (string | number)[][];
}

export interface AnalisisEscenario {
    nombre: string;
    descripcion: string;
    probabilidad_aproximada: string;
    implicacion_apuestas?: string; // New field
}

export interface AnalisisSeccion {
    titulo: string;
    bullets?: string[];
    escenarios?: AnalisisEscenario[];
    contenido_texto?: string; // Generic text content fallback
}

export interface VeredictoAnalista {
    decision: "APOSTAR" | "OBSERVAR" | "EVITAR";
    titulo_accion: string;
    seleccion_clave?: string;
    probabilidad?: number;
    nivel_confianza?: string;
    razon_principal: string;
    riesgo_principal: string;
}

export interface DetallePrediccion {
    id: number;
    mercado: string;
    seleccion: string;
    probabilidad_estimado_porcentaje: number;
    justificacion_detallada: {
        base_estadistica: string[];
        contexto_competitivo: string[];
        conclusion: string;
    };
    odds?: number | null;
}

export interface GraficoSerie {
    nombre: string;
    valores: { [key: string]: number };
}

export interface GraficoSugerido {
    id: string;
    titulo: string;
    descripcion: string;
    tipo: string;
    eje_x: string;
    eje_y: string;
    series: GraficoSerie[];
}

export interface DashboardAnalysisJSON {
    // New Verdict Section
    veredicto_analista?: VeredictoAnalista;

    header_partido: {
        titulo: string;
        subtitulo: string;
        bullets_clave: string[];
    };
    resumen_ejecutivo: {
        frase_principal: string;
        puntos_clave: string[];
    };
    tablas_comparativas: {
        [key: string]: TablaComparativaData;
    };
    analisis_detallado: {
        contexto_competitivo: AnalisisSeccion;
        estilo_y_tactica: AnalisisSeccion;
        alineaciones_y_bajas: AnalisisSeccion;
        factores_situacionales: AnalisisSeccion;
        escenarios_de_partido?: AnalisisSeccion;
        analisis_escenarios?: AnalisisSeccion; // New Explicit Scenario Section
        impacto_arbitro?: AnalisisSeccion; // Explicit Referee Section
        analisis_tactico_formaciones?: AnalisisSeccion; // Explicit Formation Section
        factor_psicologico?: string; // New: Psychological Factor (Text)
    };
    graficos_sugeridos: GraficoSugerido[];
    predicciones_finales: {
        tabla_resumen?: any;
        detalle: DetallePrediccion[];
    };
    advertencias?: {
        titulo: string;
        bullets: string[];
    };
}

// --- VISUAL / DASHBOARD TYPES ---

// Wrapper para el resultado que consume la UI
export interface VisualAnalysisResult {
    analysisText: string;
    sources?: GroundingChunk[];
    dashboardData?: DashboardAnalysisJSON | null;
    analysisRun?: AnalysisRun; // Nuevo campo: Data cruda de DB
    visualData?: any; // Legacy support
    payload?: any; // New field: Raw API Payload (Input)
    reportPacket?: any; // V9 raw report_packet from reports_v2 (used by PDF adapter)
}

export interface BettingRecommendationVisual {
    market: string;
    prediction: string;
    probability: number;
    confidence: ConfidenceLevel;
    reasoning: string;
}

export type MoraleLevel = 'Alta' | 'Media' | 'Baja' | 'Neutra';
export type PressureLevel = 'Alta' | 'Media' | 'Baja';

export interface TacticalVisual {
    name?: string;
    formation: string;
    strength: string;
    weakness: string;
    teamA?: string;
    teamB?: string;
}

export interface JugadorClave {
    nombre: string;
    impacto: string;
}

export interface NoticiasYFactoresEquipo {
    moral: MoraleLevel;
    presion: PressureLevel;
    resumenNoticias: string;
    impactoApuestas: string;
}

export interface ChartDataPoint {
    name: string;
    value: number;
}


// --- API-FOOTBALL MIRROR TYPES ---

export interface APITeam {
    id: number;
    name: string;
    logo: string;
}

export interface APIGoals {
    home: number | null;
    away: number | null;
}

export interface APIFixtureStatus {
    long: string;
    short: string;
    elapsed: number | null;
}

export interface APIFixture {
    id: number;
    referee: string | null;
    timezone: string;
    date: string;
    timestamp: number;
    venue: { id: number | null; name: string | null; city: string | null; };
    status: APIFixtureStatus;
}

export interface APILeague {
    id: number;
    name: string;
    country: string;
    logo: string;
    flag: string | null;
    season: number;
    round?: string;
}

export interface Game {
    fixture: APIFixture;
    league: APILeague;
    teams: { home: APITeam; away: APITeam; };
    goals: APIGoals;
}

export interface League {
    id: number;
    name: string;
    country: string;
    logo: string;
    season: number;
    games: Game[];
}

export interface Country {
    name: string;
    flag: string | null;
    leagues: League[];
}

export interface APIStanding {
    rank: number;
    team: {
        id: number;
        name: string;
        logo: string;
    };
    points: number;
    goalsDiff: number;
    group: string;
    form: string;
    status: string;
    description: string;
    all: {
        played: number;
        win: number;
        draw: number;
        lose: number;
        goals: {
            for: number;
            against: number;
        };
    };
    home: any;
    away: any;
    update: string;
}

export interface APIFixtureStatistics {
    team: {
        id: number;
        name: string;
        logo: string;
    };
    statistics: {
        type: string;
        value: any;
    }[];
}

export interface APIEvent {
    time: {
        elapsed: number;
        extra: number | null;
    };
    team: {
        id: number;
        name: string;
        logo: string;
    };
    player: {
        id: number;
        name: string;
    };
    assist: {
        id: number | null;
        name: string | null;
    };
    type: string;
    detail: string;
    comments: string | null;
}

export interface APILineupPlayer {
    id: number;
    name: string;
    number: number;
    pos: string;
    grid: string | null;
}

export interface APILineup {
    team: {
        id: number;
        name: string;
        logo: string;
        colors?: any;
    };
    coach: {
        id: number;
        name: string;
        photo?: string;
    };
    formation: string;
    startXI: { player: APILineupPlayer }[];
    substitutes: { player: APILineupPlayer }[];
}

export interface APITeamSeasonStats {
    league: any;
    team: any;
    form: string;
    fixtures: {
        played: { home: number; away: number; total: number };
        wins: { home: number; away: number; total: number };
        draws: { home: number; away: number; total: number };
        loses: { home: number; away: number; total: number };
    };
    goals: {
        for: { total: { home: number; away: number; total: number } };
        against: { total: { home: number; away: number; total: number } };
    };
}


// --- TYPES FOR DASHBOARD DATA ---
export interface DashboardData {
    importantLeagues: League[];
    countryLeagues: Country[];
}

// Tipos legacy necesarios para evitar errores de compilación en componentes viejos
export interface GameDetails {
    fixture: APIFixture;
    league: APILeague;
    teams: { home: APITeam; away: APITeam };
    goals: APIGoals;
    events: APIEvent[] | null;
    lineups: APILineup[] | null;
    statistics: APIFixtureStatistics[] | null;
    h2h: Game[] | null;
    standings: APIStanding[][] | null;
    teamStats: { home: APITeamSeasonStats | null; away: APITeamSeasonStats | null; };
    lastMatches: { home: Game[] | null; away: Game[] | null; };
}
export interface GamedayBettingOpportunity { market: string; prediction: string; probability: number; reasoning: string; confidence: ConfidenceLevel; }
export interface GameAnalysis { league: string; matchup: string; time: string; overallContext: string; topOpportunities: GamedayBettingOpportunity[]; }
export type GamedayAnalysisResult = GameAnalysis[];
export interface LegAnalysis { legSummary: { event: string; market: string; prediction: string; }; analysis: { conclusion: string; confidence: ConfidenceLevel; probability: number; tacticalSynopsis: string; playerImpact: string; keyDataPoints: string[]; }; }
export interface BetTicketAnalysisResult { overallVerdict: string; strongestPick: string; riskiestPick: string; legAnalyses: LegAnalysis[]; }
export interface PerformanceReportResult { executiveSummary: string; keyMetrics: any; strengths: string[]; weaknesses: string[]; actionableRecommendations: string[]; chartsData: any; performanceBySport: any[]; performanceByMarket: any[]; learningAnalysis?: string; }
export interface PerformanceReportDB { id: number; user_id: string; created_at: string; start_date: string; end_date: string; report_data: PerformanceReportResult; }
export interface AnalyzedGameDB { partido_id: number; resultado_analisis: VisualAnalysisResult; partidos: any; }
export interface TopPickItem { gameId: number; analysisRunId?: string; matchup: string; date: string; league: string; teams: { home: { name: string; logo: string }; away: { name: string; logo: string }; }; bestRecommendation: BettingRecommendationVisual; result?: 'Won' | 'Lost' | 'Pending' | 'Void'; odds?: number; alternative?: { market: string; probability: number; }; }
export type CreateBetPayload = Omit<Bet, 'id' | 'user_id'>;

// --- RESULTS VERIFICATION TYPES ---

export type PickResult = 'WON' | 'LOST' | 'VOID' | 'PUSH' | 'PENDING';

export interface PublicResultsData {
    winRate: number;
    totalVerified: number;
    totalPending: number;
    won: number;
    lost: number;
    last7Days: { wins: number; losses: number; total: number };
    currentStreak: { type: 'win' | 'loss'; count: number };
    recentResults: Array<{
        id: string;
        home_team: string;
        away_team: string;
        market: string;
        selection: string;
        result: PickResult;
        odds: number | null;
        p_model: number;
        actual_score: string | null;
        verified_at: string;
        league?: string;
        match_date?: string;
        profit_loss: number;
        units?: number;
    }>;
    bankroll?: {
        base: number;
        current: number;
        profit: number;
        roi: number;
        periodProfit?: number;
        periodROI?: number;
        periodStaked?: number;
    };
    units?: {
        totalUnitsStaked: number;
        totalUnitsProfit: number;
        yield: number;
        periodUnitsStaked: number;
        periodUnitsProfit: number;
        periodYield: number;
    };
    maxDrawdown?: number;
    bestStreak?: number;
    worstStreak?: number;
    avgOdds?: number;
}

// --- PER-PLAN PERFORMANCE TYPES ---

export type PlanTier = 'free' | 'starter' | 'pro' | 'premium';

export interface PlanPerformanceSummary {
    planName: PlanTier;
    displayName: string;
    predictionsPercentage: number;
    picksCount: number;
    won: number;
    lost: number;
    pending: number;
    winRate: number;
    totalStaked: number;
    totalProfit: number;
    roi: number;
    avgOdds: number;
    currentStreak: { type: 'win' | 'loss'; count: number };
    unitsStaked: number;
    unitsProfit: number;
    yield: number;
    exclusivePicks: number;
    exclusiveWon: number;
    exclusiveLost: number;
    exclusiveWinRate: number;
    exclusiveROI: number;
}

export interface PerPlanComparisonData {
    dateRange: { start: string; end: string };
    plans: Record<PlanTier, PlanPerformanceSummary>;
    baseBankroll: number;
}

export interface AdvancedAnalyticsFilters {
    startDate: string;
    endDate: string;
    market?: string;
    startingBankroll: number;
}

export interface AdvancedAnalyticsData {
    summary: {
        total_picks: number;
        verified_picks: number;
        pending_picks: number;
        won: number;
        lost: number;
        voided: number;
        accuracy: number;
        total_staked: number;
        total_profit: number;
        roi: number;
        yield: number;
        current_bankroll: number;
        max_drawdown: number;
        max_win_streak: number;
        max_loss_streak: number;
        current_streak: { type: 'win' | 'loss'; count: number };
    };
    by_market: Record<string, { won: number; lost: number; profit: number; staked: number; accuracy: number }>;
    by_league: Record<string, { won: number; lost: number; accuracy: number }>;
    bankroll_history: Array<{ date: string; bankroll: number; profit: number }>;
    picks: Array<{
        id: string;
        home_team: string;
        away_team: string;
        market: string;
        selection: string;
        result: PickResult;
        odds: number;
        p_model: number;
        actual_score: string | null;
        verified_at: string;
        profit_loss: number;
        league?: string;
    }>;
}

// --- DAILY RECAP TYPES ---

export type RecapTier = 'free' | 'starter' | 'pro' | 'premium' | 'admin';

export interface RecapPeriodStats {
    winRate: number;
    roi: number;
    won: number;
    lost: number;
    total: number;
}

export interface DailyRecapData {
    date: string;
    hasData: boolean;
    isBadDay: boolean;

    // Core stats (all tiers)
    totalPicks: number;
    winRate: number;
    won: number;
    lost: number;
    totalPending: number;

    // Financial (starter+)
    roi: number;
    profit: number;
    bankrollChange: number;

    // Streak (starter+)
    currentStreak: { type: 'win' | 'loss'; count: number };

    // Best pick (all tiers, blurred for free)
    bestPick: {
        home_team: string;
        away_team: string;
        market: string;
        selection: string;
        odds: number | null;
        p_model: number;
        result: PickResult;
        profit_loss: number;
        league?: string;
    } | null;

    // Winning picks list (limited by tier)
    winningPicks: Array<{
        home_team: string;
        away_team: string;
        market: string;
        selection: string;
        odds: number | null;
        result: PickResult;
        profit_loss: number;
        league?: string;
    }>;

    // Multi-period context (for bad days)
    periodStats?: {
        days7: RecapPeriodStats;
        days15: RecapPeriodStats;
        days30: RecapPeriodStats;
    };

    // Market insights (pro+)
    bestMarket?: { name: string; accuracy: number; profit: number };

    // League breakdown (premium)
    leagueBreakdown?: Record<string, { won: number; lost: number; accuracy: number }>;

    // Best odds hit (premium)
    bestOddsHit?: { odds: number; match: string; market: string };

    // Calibration insight (premium)
    calibrationInsight?: string;
}

// --- NOTIFICATION TYPES ---

export type NotificationChannel = 'whatsapp' | 'email' | 'push';
export type NotificationType = 'predictions_ready' | 'daily_results' | 'special_offers';
export type NotificationStatus = 'queued' | 'sent' | 'delivered' | 'read' | 'failed';

export interface NotificationPreference {
    id: string;
    user_id: string;
    channel: NotificationChannel;
    notification_type: NotificationType;
    enabled: boolean;
    created_at?: string;
    updated_at?: string;
}

export interface NotificationLogEntry {
    id: string;
    user_id: string;
    phone_number: string;
    notification_type: NotificationType;
    channel: NotificationChannel;
    template_name: string;
    whatsapp_message_id?: string;
    status: NotificationStatus;
    error_message?: string;
    short_url?: string;
    click_count: number;
    metadata?: Record<string, any>;
    sent_at?: string;
    delivered_at?: string;
    read_at?: string;
    created_at: string;
}

export interface NotificationAnalytics {
    totalSent: number;
    delivered: number;
    read: number;
    failed: number;
    deliveryRate: number;
    readRate: number;
    clickRate: number;
    byType: Record<NotificationType, {
        sent: number;
        delivered: number;
        clicked: number;
    }>;
    recentLogs: NotificationLogEntry[];
}
