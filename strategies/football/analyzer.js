const fs = require('fs');
const path = require('path');
const apiClient = require('../../services/apiClient');

const strategiesPath = path.join(__dirname, 'analysis_strategies');
const strategyModules = fs.readdirSync(strategiesPath)
    .filter(file => file.endsWith('.js'))
    .map(file => {
        const strategy = require(path.join(strategiesPath, file));
        if (strategy.marketType) {
            strategy.strategyName = strategy.marketType;
        } else if (strategy.marketFamily) {
            strategy.strategyName = strategy.marketFamily.join(', ');
        } else {
            strategy.strategyName = path.basename(file, '.js');
        }
        return strategy;
    });

async function getMatchDetails(fixture, isBacktest) {
    const { league, teams, fixture: { id: fixtureId, date } } = fixture;
    const currentSeason = new Date(date).getFullYear();
    const leagueId = league.id;

    let homeStatsData = await apiClient.request('football', '/teams/statistics', { team: teams.home.id, league: leagueId, season: currentSeason });
    let awayStatsData = await apiClient.request('football', '/teams/statistics', { team: teams.away.id, league: leagueId, season: currentSeason });

    const isEarlySeason = (homeStatsData?.data?.response?.fixtures?.played?.total ?? 0) < 5;

    if (isEarlySeason) {
        const prevSeason = currentSeason - 1;
        homeStatsData = await apiClient.request('football', '/teams/statistics', { team: teams.home.id, league: leagueId, season: prevSeason });
        awayStatsData = await apiClient.request('football', '/teams/statistics', { team: teams.away.id, league: leagueId, season: prevSeason });
    }

    const oddsPromise = !isBacktest ? apiClient.request('football', '/odds', { fixture: fixtureId }) : Promise.resolve(null);
    const oddsResponse = await oddsPromise;

    return {
        stats: { homeStats: homeStatsData?.data?.response, awayStats: awayStatsData?.data?.response },
        oddsData: oddsResponse?.data?.response[0]
    };
}

function getUnibetOddsForMarket(oddsData, market, bookmakerConfig) {
    if (!oddsData || !bookmakerConfig || bookmakerConfig.length === 0) return null;
    const unibetId = bookmakerConfig[0].id;
    const unibetData = oddsData.bookmakers.find(b => b.id === unibetId);
    if (unibetData) {
        const bet = unibetData.bets.find(b => b.id === market.id);
        if (bet) {
            const value = bet.values.find(v => v.value === market.value);
            if (value) return { odd: parseFloat(value.odd), bookmakerName: 'Unibet' };
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
            const isStrategyAllowed = !marketWhitelist || 
                                      (strategy.marketType && marketWhitelist.has(strategy.marketType)) ||
                                      (strategy.marketFamily && strategy.marketFamily.some(mf => marketWhitelist.has(mf)));

            if (!isStrategyAllowed) {
                continue;
            }
            
            const result = strategy.execute(matchData);
            if (result) {
                const picksToAdd = Array.isArray(result) ? result : [result];
                const simplifiedMatch = { 
                    id: fixture.fixture.id, 
                    date: fixture.fixture.date, 
                    home_team: fixture.teams.home.name, 
                    away_team: fixture.teams.away.name, 
                    home_logo: fixture.teams.home.logo,
                    away_logo: fixture.teams.away.logo,
                    goals: fixture.goals,
                    leagueName: fixture.league.name
                };
                
                picksToAdd.forEach(pick => {
                    if (marketWhitelist && !marketWhitelist.has(pick.betType)) {
                        return;
                    }
                    if (isBacktest) {
                        allPicks.push({ match: simplifiedMatch, ...pick, isFavoriteHome, odds: null, bookmakerName: 'N/A' });
                    } else {
                        const oddsResult = getUnibetOddsForMarket(details.oddsData, pick.market, settings.bookmakerPriority);
                        if (oddsResult) {
                            allPicks.push({ match: simplifiedMatch, ...pick, isFavoriteHome, odds: oddsResult.odd, bookmakerName: oddsResult.bookmakerName });
                        }
                    }
                });
            }
        }
    }

    const { confidenceThreshold } = settings.analysisParams;
    const confidentPicks = allPicks.filter(p => p.score >= confidenceThreshold);

    console.log(`INFO: [Analyzer] ${allPicks.length} pronostics bruts générés, ${confidentPicks.length} retenus après filtre de confiance (${confidenceThreshold}%).`);
    
    return confidentPicks;
}

module.exports = { generatePredictions };