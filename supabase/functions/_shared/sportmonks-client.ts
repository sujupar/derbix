// supabase/functions/_shared/sportmonks-client.ts
// Cliente reutilizable para SportMonks Football API v3

const SPORTMONKS_BASE_URL = 'https://api.sportmonks.com/v3/football';

export interface SportMonksResponse<T> {
    data: T;
    pagination?: {
        count: number;
        per_page: number;
        current_page: number;
        next_page: string | null;
        has_more: boolean;
    };
    subscription?: any[];
    rate_limit?: {
        resets_in_seconds: number;
        remaining: number;
        requested_entity: string;
    };
}

/**
 * Fetch data from SportMonks API
 */
export async function fetchSportMonks<T>(
    endpoint: string,
    includes: string[] = [],
    filters: Record<string, string> = {}
): Promise<T | null> {
    const apiKey = Deno.env.get('SPORTMONKS_API_KEY');
    if (!apiKey) {
        console.error('[SportMonks] API key not configured');
        return null;
    }

    // Build URL with includes and filters
    const url = new URL(`${SPORTMONKS_BASE_URL}${endpoint}`);
    url.searchParams.set('api_token', apiKey);

    if (includes.length > 0) {
        url.searchParams.set('include', includes.join(';'));
    }

    for (const [key, value] of Object.entries(filters)) {
        url.searchParams.set(key, value);
    }

    console.log(`[SportMonks] Fetching: ${endpoint}`);

    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 20000); // 20s timeout per request
        const response = await fetch(url.toString(), { signal: controller.signal });
        clearTimeout(timeout);

        if (!response.ok) {
            const errorText = await response.text();
            console.error(`[SportMonks] Error ${response.status}: ${errorText}`);
            return null;
        }

        const json: SportMonksResponse<T> = await response.json();

        // Log rate limit info
        if (json.rate_limit) {
            console.log(`[SportMonks] Rate limit remaining: ${json.rate_limit.remaining}`);
        }

        return json.data;
    } catch (error) {
        console.error(`[SportMonks] Fetch error:`, error);
        return null;
    }
}

/**
 * Fetch ALL pages from a SportMonks endpoint concurrently or sequentially
 */
async function fetchAllSportMonks<T>(endpoint: string, includes: string[] = [], filters: Record<string, any> = {}): Promise<T[]> {
    let allData: T[] = [];
    let page = 1;
    let hasMore = true;
    const perPage = 50; // Max allowed by SportMonks usually

    // First request to check total and get first page
    // We add explicitly per_page and page
    const initialFilters = { ...filters, per_page: perPage, page: 1 };

    // Construct URL manually to allow easy looping
    // Reusing logic from fetchSportMonks but keeping it DRY would be better, but for now copying key parts to allow control

    // Better strategy: Use fetchSportMonksButReturnRawResponse if we want to reuse auth logic?
    // No, fetchSportMonks swallows pagination.
    // Let's modify fetchSportMonks to NOT swallowing, OR implement the loop here using a raw helper.
    // Let's stick to using fetchSportMonks but we can't fully know pagination status...
    // Actually, we can just loop until data is empty or less than per_page? No, 'pagination' object is needed for 'has_more'.

    // REFATORING STRATEGY: 
    // We will implement a `fetchRaw` that returns the full JSON.
    // Then usage can be specific.

    return await fetchAllPagesInternal<T>(endpoint, includes, filters);
}

async function fetchAllPagesInternal<T>(endpoint: string, includes: string[], filters: Record<string, any>): Promise<T[]> {
    const API_KEY = Deno.env.get('SPORTMONKS_API_KEY');
    if (!API_KEY) throw new Error('Missing SPORTMONKS_API_KEY');

    const BASE_URL = 'https://api.sportmonks.com/v3/football';
    let allData: any[] = [];
    let currentPage = 1;
    let hasMore = true;

    while (hasMore) {
        const url = new URL(`${BASE_URL}${endpoint}`);
        url.searchParams.set('api_token', API_KEY);
        if (includes.length > 0) url.searchParams.set('include', includes.join(';'));

        for (const [k, v] of Object.entries(filters)) url.searchParams.set(k, String(v));

        url.searchParams.set('per_page', '50');
        url.searchParams.set('page', String(currentPage));

        // console.log(`[SportMonks] Fetching page ${currentPage} of ${endpoint}...`);

        const res = await fetch(url.toString());
        if (!res.ok) {
            console.error(`[SportMonks] Error fetching page ${currentPage}: ${res.statusText}`);
            break;
        }

        const json = await res.json();
        if (json.data && Array.isArray(json.data)) {
            allData = allData.concat(json.data);
        }

        if (json.pagination && json.pagination.has_more) {
            currentPage++;
        } else {
            hasMore = false;
        }

        // Safety break
        if (currentPage > 20) {
            console.warn('[SportMonks] Pagination safety limit reached (20 pages)');
            break;
        }
    }

    return allData;
}

/**
 * Get fixtures for a specific date (ALL PAGES)
 */
export async function getFixturesByDate(date: string): Promise<any[]> {
    return await fetchAllSportMonks<any>(
        `/fixtures/date/${date}`,
        ['participants', 'league', 'venue', 'state', 'scores'],
        {}
    ) || [];
}

/**
 * Get complete fixture data with all includes
 */
export async function getFixtureComplete(fixtureId: number): Promise<any | null> {
    return await fetchSportMonks<any>(
        `/fixtures/${fixtureId}`,
        [
            'participants',
            'lineups',
            'lineups.player',
            'statistics.type',
            'events',
            'scores',
            'venue',
            'referees',
            'formations',
            'coaches',
            'sidelined',
            'weatherReport',
            'xGFixture',
            'league',
            'season',
            'state',
            'round'
        ],
        {}
    );
}

/**
 * Get team's last N fixtures
 * Note: v3 API prefers flat filters for some endpoints or specific include logic.
 * The 'participant_id' parameter works directly.
 */
export async function getTeamFixtures(
    teamId: number,
    last: number = 40,
    includes: string[] = ['participants', 'scores', 'venue', 'league', 'statistics', 'events', 'lineups', 'referees', 'formations']
): Promise<any[]> {
    // V3 API requires explicit date range for team fixtures
    const end = new Date();
    const start = new Date();
    start.setFullYear(start.getFullYear() - 2); // Look back 2 years to ensure we get 40 matches

    const startStr = start.toISOString().split('T')[0];
    const endStr = end.toISOString().split('T')[0];

    return await fetchSportMonks<any[]>(
        `/fixtures/between/${startStr}/${endStr}/${teamId}`,
        includes,
        {
            'per_page': last.toString(),
            'order': 'desc' // Newest first
        }
    ) || [];
}

/**
 * Get head-to-head fixtures between two teams
 */
export async function getH2H(teamId1: number, teamId2: number): Promise<any[]> {
    return await fetchSportMonks<any[]>(
        `/fixtures/head-to-head/${teamId1}/${teamId2}`,
        ['participants', 'scores', 'statistics', 'events', 'lineups', 'referees'],
        { 'per_page': '20' }
    ) || [];
}

/**
 * Get standings for a season
 */
export async function getStandings(seasonId: number): Promise<any[]> {
    return await fetchSportMonks<any[]>(
        `/standings/seasons/${seasonId}`,
        ['participant', 'details'],
        {}
    ) || [];
}

/**
 * Get predictions/probabilities for a fixture
 * Protected: Returns null if plan doesn't include this feature (403)
 */
export async function getPredictions(fixtureId: number): Promise<any | null> {
    try {
        return await fetchSportMonks<any>(
            `/predictions/probabilities/fixtures/${fixtureId}`,
            [],
            {}
        );
    } catch (e) {
        console.warn(`[SportMonks] Predictions endpoint skipped: ${e}`);
        return null;
    }
}

/**
 * Get value bets for a fixture
 * Protected: Returns empty array if plan doesn't include this feature (403)
 */
export async function getValueBets(fixtureId: number): Promise<any[]> {
    try {
        return await fetchSportMonks<any[]>(
            `/predictions/value-bets/fixtures/${fixtureId}`,
            [],
            {}
        ) || [];
    } catch (e) {
        console.warn(`[SportMonks] ValueBets endpoint skipped: ${e}`);
        return [];
    }
}

/**
 * Get pre-match odds for a fixture
 */
export async function getOdds(fixtureId: number): Promise<any[]> {
    return await fetchSportMonks<any[]>(
        `/odds/pre-match/fixtures/${fixtureId}`,
        ['market', 'bookmaker'],
        {}
    ) || [];
}
