const fs = require('fs');
const path = require('path');
const apiClient = require('../../services/apiClient');

const strategiesPath = path.join(__dirname, 'analysis_strategies');
const strategyModules = fs.readdirSync(strategiesPath)
    .filter(file => file.endsWith('.js'))
    .map(file => {
        const strategy = require(path.join(strategiesPath, file));
        strategy.strategyName = path.basename(file, '.js'); 
        return strategy;
    });

async function getMatchDetails(fixture, isBacktest) {
    const { league, teams, fixture: { id: fixtureId } } = fixture;
    const season = new Date(fixture.fixture.date).getFullYear();
    const leagueId = league.id;

    const oddsPromise = !isBacktest ? apiClient.request('football', '/odds', { fixture: fixtureId }) : Promise.resolve(null);

    const [homeStatsData, awayStatsData, oddsResponse] = await Promise.all([
        apiClient.request('football', '/teams/statistics', { team: teams.home.id, league: leagueId, season }),
        apiClient.request('football', '/teams/statistics', { team: teams.away.id, league: leagueId, season }),
        oddsPromise
    ]);

    return {
        stats: { homeStats: homeStatsData?.data?.response, awayStats: awayStatsData?.data?.response },
        oddsData: oddsResponse?.data?.response[0]
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

async function generatePredictions(allFixtures, settings, leagues, marketWhitelist = null) {
    const allPicks = [];

    for (const fixture of allFixtures) {
        const isBacktest = fixture.fixture.status.short === 'FT';
        const leagueConfig = leagues.find(l => l.id === fixture.league.id);
        if (!leagueConfig) continue;

        const homeStandings = fixture.homeStandings;
        const awayStandings = fixture.awayStandings;
        
        if (!homeStandings || !awayStandings) continue;

        const details = await getMatchDetails(fixture, isBacktest);

        if (!details || !details.stats.homeStats || !details.stats.awayStats) continue;
        
        const isFavoriteHome = homeStandings.rank < awayStandings.rank;
        const favoriteName = isFavoriteHome ? fixture.teams.home.name : fixture.teams.away.name;

        const matchData = { 
            ...fixture,
            standings: { home: homeStandings, away: awayStandings },
            settings,
            league: leagueConfig, 
            ...details, 
            isFavoriteHome,
            favoriteName 
        };

        for (const strategy of strategyModules) {
            const result = strategy.execute(matchData);
            if (result) {
                const picksToAdd = Array.isArray(result) ? result : [result];
                const simplifiedMatch = { 
                    id: fixture.fixture.id, 
                    date: fixture.fixture.date, 
                    home_team: fixture.teams.home.name, 
                    away_team: fixture.teams.away.name, 
                    goals: fixture.goals 
                };
                
                picksToAdd.forEach(pick => {
                    if (isBacktest) {
                        allPicks.push({ match: simplifiedMatch, ...pick, isFavoriteHome, odds: null, bookmakerName: 'N/A' });
                    } else {
                        const oddsResult = getOddsForMarket(details.oddsData, pick.market, settings.bookmakerPriority);
                        if (oddsResult) {
                            allPicks.push({ match: simplifiedMatch, ...pick, isFavoriteHome, odds: oddsResult.odd, bookmakerName: oddsResult.bookmakerName });
                        }
                    }
                });
            }
        }
    }

    if (marketWhitelist) {
        return allPicks.filter(p => marketWhitelist.has(p.betType.startsWith("Double Chance") ? "Double Chance Favori" : p.betType));
    }
    
    return allPicks;
}

module.exports = { generatePredictions };