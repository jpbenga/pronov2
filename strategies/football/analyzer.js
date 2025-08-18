const fs = require('fs');
const path = require('path');
const apiClient = require('../../services/apiClient');

const strategiesPath = path.join(__dirname, 'analysis_strategies');
const strategyModules = fs.readdirSync(strategiesPath)
    .filter(file => file.endsWith('.js'))
    .map(file => require(path.join(strategiesPath, file)));

console.log(`INFO: [Football Analyzer] ${strategyModules.length} stratégies de football chargées.`);

const cache = { standings: new Map() };

async function getMatchDetails(fixture) {
    const { league, teams, fixture: { id: fixtureId } } = fixture;
    const season = new Date(fixture.fixture.date).getFullYear();
    const leagueId = league.id;

    const standingsCacheKey = `${leagueId}_${season}`;
    if (!cache.standings.has(standingsCacheKey)) {
        const standingsData = await apiClient.request('football', '/standings', { league: leagueId, season });
        cache.standings.set(standingsCacheKey, standingsData?.data?.response[0]?.league?.standings[0] || []);
    }
    const standings = cache.standings.get(standingsCacheKey);

    const [homeStatsData, awayStatsData, oddsData] = await Promise.all([
        apiClient.request('football', '/teams/statistics', { team: teams.home.id, league: leagueId, season }),
        apiClient.request('football', '/teams/statistics', { team: teams.away.id, league: leagueId, season }),
        apiClient.request('football', '/odds', { fixture: fixtureId })
    ]);
    
    const homeStandings = standings.find(t => t.team.id === teams.home.id);
    const awayStandings = standings.find(t => t.team.id === teams.away.id);

    if (!homeStandings || !awayStandings) return null;

    return {
        standings: { home: homeStandings, away: awayStandings },
        stats: { homeStats: homeStatsData?.data?.response, awayStats: awayStatsData?.data?.response },
        oddsData: oddsData?.data?.response[0]
    };
}

function getOddsForMarket(oddsData, market, bookmakerPriority) {
    if (!oddsData) return null;
    for (const bookmaker of bookmakerPriority) {
        const bookmakerData = oddsData.bookmakers.find(b => b.id === bookmaker.id);
        if (bookmakerData) {
            const bet = bookmakerData.bets.find(b => b.id === market.id);
            if (bet) {
                const value = bet.values.find(v => v.value === market.value);
                if (value) return { odd: parseFloat(value.odd), bookmakerName: bookmaker.name };
            }
        }
    }
    return null;
}

async function generatePredictions(allFixtures, settings, leagues) {
    const allPicks = [];
    console.log(`[Football Analyzer] Analyse de ${allFixtures.length} matchs de football...`);
    cache.standings.clear();

    for (const fixture of allFixtures) {
        const details = await getMatchDetails(fixture);
        if (!details) continue;

        const league = leagues.find(l => l.id === fixture.league.id) || { coeff: 0.7 };
        const isFavoriteHome = details.standings.home.rank < details.standings.away.rank;

        const matchData = {
            ...fixture, settings, league, ...details,
            favoriteName: isFavoriteHome ? fixture.teams.home.name : fixture.teams.away.name,
            isFavoriteHome: isFavoriteHome,
        };

        for (const strategy of strategyModules) {
            if (typeof strategy.execute === 'function') {
                const result = strategy.execute(matchData);
                if (result) {
                    const picksToAdd = Array.isArray(result) ? result : [result];
                    const simplifiedMatch = { id: fixture.fixture.id, date: fixture.fixture.date, home_team: fixture.teams.home.name, away_team: fixture.teams.away.name };
                    
                    picksToAdd.forEach(pick => {
                        const oddsResult = getOddsForMarket(details.oddsData, pick.market, settings.bookmakerPriority);
                        allPicks.push({ 
                            match: simplifiedMatch, 
                            ...pick,
                            odds: oddsResult?.odd || null,
                            bookmakerName: oddsResult?.bookmakerName || 'N/A'
                        });
                    });
                }
            }
        }
    }
    
    console.log(`[Football Analyzer] ${allPicks.length} pronostics générés au total (avec cotes).`);
    return allPicks;
}

module.exports = { generatePredictions };